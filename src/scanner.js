'use strict';

// Directory scanner for envdiff.
//
// Walks a directory tree, finds every real env file, pairs each with the
// most relevant example/reference file, and returns the pairs to diff.
//
// Pairing rules (per directory):
//   - An "env" file is one whose basename looks like a real env file
//     (.env, .env.local, .env.production, etc.) but NOT an example.
//   - An "example" file is one whose basename contains example/sample/
//     template/dist or ends in .example (e.g. .env.example, .env.sample).
//   - Each env file is paired with an example file in the SAME directory.
//     If several examples exist, the plain ".env.example" wins, else the
//     first one found. An env file with no example is reported unpaired.

const fs = require('fs');
const path = require('path');

// Directories we never descend into.
const IGNORED_DIRS = new Set([
  'node_modules',
  '.git',
  '.svn',
  '.hg',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  'env', // python virtualenv dir (not an env FILE)
  '.idea',
  '.vscode',
]);

const EXAMPLE_MARKERS = /(example|sample|template|dist|default)/i;

// Does this basename look like an env file at all?
function isEnvLikeName(name) {
  const lower = name.toLowerCase();
  // .env, .env.local, .env.production, env.foo, foo.env, .env.example ...
  return (
    lower === '.env' ||
    lower.startsWith('.env.') ||
    lower.startsWith('env.') ||
    lower.endsWith('.env')
  );
}

function isExampleName(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith('.example') || lower.endsWith('.sample')) return true;
  if (lower.endsWith('.template') || lower.endsWith('.dist')) return true;
  return EXAMPLE_MARKERS.test(lower);
}

// Recursively collect env-like files, skipping ignored dirs. Returns
// { dir -> { envs: [names], examples: [names] } } grouped by directory.
function collect(root, opts = {}) {
  const maxDepth = opts.maxDepth == null ? 25 : opts.maxDepth;
  const byDir = new Map();
  let scannedDirs = 0;

  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // unreadable dir — skip quietly
    }
    scannedDirs++;

    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(full, depth + 1);
      } else if (entry.isFile() && isEnvLikeName(entry.name)) {
        if (!byDir.has(dir)) byDir.set(dir, { envs: [], examples: [] });
        const bucket = byDir.get(dir);
        if (isExampleName(entry.name)) bucket.examples.push(entry.name);
        else bucket.envs.push(entry.name);
      }
    }
  }

  const stat = safeStat(root);
  if (stat && stat.isFile()) {
    // A single file was given — treat its directory as the scan root but
    // only consider that file plus its siblings for pairing.
    walk(path.dirname(root), 0);
  } else {
    walk(root, 0);
  }

  return { byDir, scannedDirs };
}

function safeStat(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

// Pick the best example file for a directory: prefer an exact ".env.example",
// then anything ending ".example", then the first available.
function pickExample(examples) {
  if (examples.length === 0) return null;
  const exact = examples.find((e) => e.toLowerCase() === '.env.example');
  if (exact) return exact;
  const dotExample = examples.find((e) => e.toLowerCase().endsWith('.example'));
  if (dotExample) return dotExample;
  return examples[0];
}

// Build the list of { env, example, dir } pairs plus any unpaired files.
// Returns { pairs, unpaired } with absolute paths.
function findPairs(root, opts = {}) {
  const { byDir, scannedDirs } = collect(root, opts);
  const pairs = [];
  const unpaired = [];

  for (const [dir, bucket] of byDir) {
    const example = pickExample(bucket.examples);
    if (bucket.envs.length === 0) {
      // Only an example present, no real env to compare — informational.
      for (const ex of bucket.examples) {
        unpaired.push({ dir, file: path.join(dir, ex), kind: 'example-only' });
      }
      continue;
    }
    for (const envName of bucket.envs) {
      if (example) {
        pairs.push({
          dir,
          env: path.join(dir, envName),
          example: path.join(dir, example),
        });
      } else {
        unpaired.push({
          dir,
          file: path.join(dir, envName),
          kind: 'no-example',
        });
      }
    }
  }

  // Stable ordering for deterministic output.
  pairs.sort((a, b) => a.env.localeCompare(b.env));
  unpaired.sort((a, b) => a.file.localeCompare(b.file));

  return { pairs, unpaired, scannedDirs };
}

module.exports = {
  findPairs,
  collect,
  isEnvLikeName,
  isExampleName,
  pickExample,
  IGNORED_DIRS,
};
