'use strict';

// Dependency-free .env parser.
// Returns { entries, order, duplicates } where:
//   entries    - Map of key -> { value, quoted, raw, line }
//   order      - array of keys in the order they first appeared
//   duplicates - array of { key, line } for keys defined more than once
//
// Parsing rules (compatible with common dotenv behavior):
//   - Blank lines and lines starting with `#` are ignored.
//   - `export KEY=value` is accepted (the `export ` prefix is stripped).
//   - Values may be wrapped in single or double quotes.
//   - Double-quoted values support \n, \r, \t, \\ escapes.
//   - Single-quoted values are literal (no escape processing).
//   - Inline comments (` #...`) are stripped from unquoted values only.
//   - Surrounding whitespace on unquoted values is trimmed.

function parseLine(line) {
  // Strip a leading `export ` (with optional extra spaces).
  let working = line.replace(/^\s*export\s+/, '');

  const eq = working.indexOf('=');
  if (eq === -1) {
    return null; // Not a KEY=VALUE line.
  }

  const key = working.slice(0, eq).trim();
  if (key === '' || !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(key)) {
    return null; // Invalid / non-identifier key.
  }

  let rawValue = working.slice(eq + 1);
  const { value, quoted } = parseValue(rawValue);
  return { key, value, quoted };
}

function parseValue(rawValue) {
  let v = rawValue.trim();

  if (v === '') {
    return { value: '', quoted: false };
  }

  const first = v[0];
  if (first === '"' || first === "'") {
    // Find the matching closing quote.
    const closingIndex = findClosingQuote(v, first);
    if (closingIndex !== -1) {
      const inner = v.slice(1, closingIndex);
      if (first === '"') {
        return { value: unescapeDouble(inner), quoted: true };
      }
      return { value: inner, quoted: true }; // single quotes are literal
    }
    // No closing quote: fall through and treat as unquoted.
  }

  // Unquoted: strip inline comment (space + #) and trim.
  const commentIndex = findInlineComment(v);
  if (commentIndex !== -1) {
    v = v.slice(0, commentIndex);
  }
  return { value: v.trim(), quoted: false };
}

function findClosingQuote(str, quoteChar) {
  for (let i = 1; i < str.length; i++) {
    if (str[i] === '\\' && quoteChar === '"') {
      i++; // skip escaped char in double quotes
      continue;
    }
    if (str[i] === quoteChar) {
      return i;
    }
  }
  return -1;
}

function findInlineComment(str) {
  // A `#` preceded by whitespace (or at start) begins a comment.
  for (let i = 0; i < str.length; i++) {
    if (str[i] === '#' && (i === 0 || /\s/.test(str[i - 1]))) {
      return i;
    }
  }
  return -1;
}

function unescapeDouble(s) {
  return s.replace(/\\([nrt\\"'])/g, (_, ch) => {
    switch (ch) {
      case 'n':
        return '\n';
      case 'r':
        return '\r';
      case 't':
        return '\t';
      case '\\':
        return '\\';
      case '"':
        return '"';
      case "'":
        return "'";
      default:
        return ch;
    }
  });
}

function parse(content) {
  const entries = new Map();
  const order = [];
  const duplicates = [];

  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      continue;
    }

    const parsed = parseLine(line);
    if (parsed === null) {
      continue;
    }

    const { key, value, quoted } = parsed;
    if (entries.has(key)) {
      duplicates.push({ key, line: i + 1 });
    } else {
      order.push(key);
    }
    // Last definition wins (matches dotenv), but we record the duplicate.
    entries.set(key, { value, quoted, raw: line, line: i + 1 });
  }

  return { entries, order, duplicates };
}

module.exports = { parse, parseLine, parseValue };
