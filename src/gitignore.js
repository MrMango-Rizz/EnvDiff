'use strict';

// Lightweight .gitignore awareness.
//
// The goal is narrow and practical: given a real .env file, decide whether
// it would be caught by a .gitignore somewhere up the tree. Committing a
// populated .env is one of the most common ways secrets leak, so a real
// env file that ISN'T ignored is worth an error.
//
// This is not a full gitignore implementation — it handles the patterns
// people actually use for env files: exact names, leading-slash anchors,
// directory globs (`**`), and simple `*` wildcards. Negation (`!`) is
// honored in last-match-wins order.

const fs = require('fs');
const path = require('path');

// Walk from the file's directory up to (and including) `stopAt`, collecting
// .gitignore files nearest-first. Returns [{ dir, patterns: [line] }].
function collectGitignores(fileDir, stopAt) {
  const chain = [];
  let dir = fileDir;
  // Guard against symlink loops / bad input with a generous cap.
  for (let i = 0; i < 100; i++) {
    const gi = path.join(dir, '.gitignore');
    let content = null;
    try {
      content = fs.readFileSync(gi, 'utf8');
    } catch {
      content = null;
    }
    if (content !== null) {
      const patterns = content
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l !== '' && !l.startsWith('#'));
      chain.push({ dir, patterns });
    }
    if (dir === stopAt) break;
    const parent = path.dirname(dir);
    if (parent === dir) break; // hit filesystem root
    dir = parent;
  }
  return chain;
}

// Translate a single gitignore glob into a RegExp anchored appropriately.
// `rel` matching is done against a POSIX-style path relative to the
// .gitignore's own directory.
function patternToRegExp(pattern) {
  let neg = false;
  let pat = pattern;
  if (pat.startsWith('!')) {
    neg = true;
    pat = pat.slice(1);
  }

  const dirOnly = pat.endsWith('/');
  if (dirOnly) pat = pat.slice(0, -1);

  const anchored = pat.startsWith('/');
  if (anchored) pat = pat.slice(1);

  // Escape regex metachars except the glob ones we handle (* ?).
  let re = '';
  for (let i = 0; i < pat.length; i++) {
    const ch = pat[i];
    if (ch === '*') {
      // `**` matches across directory separators; single `*` does not.
      if (pat[i + 1] === '*') {
        re += '.*';
        i++;
        if (pat[i + 1] === '/') i++; // consume the slash after **
      } else {
        re += '[^/]*';
      }
    } else if (ch === '?') {
      re += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(ch)) {
      re += '\\' + ch;
    } else {
      re += ch;
    }
  }

  // A pattern with no slash matches at any depth; an anchored or
  // slash-containing pattern matches from the .gitignore's directory.
  const hasSlash = pat.includes('/');
  const prefix = anchored || hasSlash ? '^' : '(^|.*/)';
  const suffix = dirOnly ? '(/.*)?$' : '(/.*)?$';
  return { re: new RegExp(prefix + re + suffix), neg };
}

// Is `filePath` ignored by the nearest applicable .gitignore chain,
// stopping the search at `stopAt` (usually the scan root)?
// Returns { ignored: bool, hasGitignore: bool }.
function isIgnored(filePath, stopAt) {
  const fileDir = path.dirname(filePath);
  const chain = collectGitignores(fileDir, stopAt);
  if (chain.length === 0) return { ignored: false, hasGitignore: false };

  let ignored = false;
  // Evaluate from the top of the tree down so nearer files can override,
  // and within a file, later lines win (last-match-wins for negation).
  for (let i = chain.length - 1; i >= 0; i--) {
    const { dir, patterns } = chain[i];
    const rel = toPosix(path.relative(dir, filePath));
    if (rel.startsWith('..')) continue; // shouldn't happen, be safe
    for (const p of patterns) {
      const { re, neg } = patternToRegExp(p);
      if (re.test(rel)) {
        ignored = !neg;
      }
    }
  }
  return { ignored, hasGitignore: true };
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

module.exports = { isIgnored, collectGitignores, patternToRegExp };
