'use strict';

// Core diff/validation engine.
//
// Compares a real .env against a reference .env.example and produces a
// structured report of findings. The engine is pure: it takes parsed inputs
// and returns data, with no I/O or printing. The CLI/reporter handle those.

const validators = require('./validators');

// Finding severity levels.
const LEVELS = { ERROR: 'error', WARN: 'warn', INFO: 'info' };

// Build a findings report from two parsed env structures.
//
//   env      - parse() result for the real .env
//   example  - parse() result for the .env.example (the schema/reference)
//   opts     - { checkSecrets, checkTypes }
//
// Returns { findings, summary } where findings is an array of:
//   { level, code, key, message, line }
function compare(env, example, opts = {}) {
  const checkSecrets = opts.checkSecrets !== false;
  const checkTypes = opts.checkTypes !== false;

  const findings = [];

  const envKeys = new Set(env.order);
  const exampleKeys = new Set(example.order);

  // 1. Missing keys: present in example, absent from env. (ERROR)
  for (const key of example.order) {
    if (!envKeys.has(key)) {
      const hint = validators.parseHint(example.entries.get(key).raw);
      // A key marked `optional` downgrades to a warning.
      const level = hint.required === false ? LEVELS.WARN : LEVELS.ERROR;
      findings.push({
        level,
        code: 'missing',
        key,
        message: `missing key "${key}" (defined in example)`,
        line: null,
      });
    }
  }

  // 2. Extra keys: present in env, not in example. (WARN)
  for (const key of env.order) {
    if (!exampleKeys.has(key)) {
      findings.push({
        level: LEVELS.WARN,
        code: 'extra',
        key,
        message: `extra key "${key}" (not in example)`,
        line: env.entries.get(key).line,
      });
    }
  }

  // 3. Empty values for keys the example expects to be set. (WARN)
  for (const key of env.order) {
    if (!exampleKeys.has(key)) continue;
    const entry = env.entries.get(key);
    if (entry.value.trim() === '') {
      findings.push({
        level: LEVELS.WARN,
        code: 'empty',
        key,
        message: `key "${key}" is empty`,
        line: entry.line,
      });
    }
  }

  // 4. Duplicate definitions in the real .env. (WARN)
  for (const dup of env.duplicates) {
    findings.push({
      level: LEVELS.WARN,
      code: 'duplicate',
      key: dup.key,
      message: `duplicate definition of "${dup.key}" (last value wins)`,
      line: dup.line,
    });
  }

  // 5. Unfilled placeholders: the real .env value is still the example's
  //    placeholder text, or an obvious template marker like <your-key-here>.
  //    Means someone copied .env.example but never filled this in. (WARN)
  for (const key of env.order) {
    if (!exampleKeys.has(key)) continue;
    const entry = env.entries.get(key);
    const value = entry.value.trim();
    if (value === '') continue; // already covered by the empty-value check

    const exampleValue = example.entries.get(key).value.trim();
    if (exampleValue !== '' && value === exampleValue) {
      findings.push({
        level: LEVELS.WARN,
        code: 'placeholder',
        key,
        message: `"${key}" still holds the example value "${value}" — looks unfilled`,
        line: entry.line,
      });
    } else if (/^<.*>$/.test(value) || /\byour[-_].+\b/i.test(value)) {
      findings.push({
        level: LEVELS.WARN,
        code: 'placeholder',
        key,
        message: `"${key}" = "${value}" looks like an unreplaced placeholder`,
        line: entry.line,
      });
    }
  }

  // 6. Type validation for present, non-empty keys. (ERROR)
  if (checkTypes) {
    for (const key of env.order) {
      const entry = env.entries.get(key);
      if (entry.value.trim() === '') continue;

      // Prefer an explicit hint from the example; fall back to key-name inference.
      let type = null;
      if (exampleKeys.has(key)) {
        const hint = validators.parseHint(example.entries.get(key).raw);
        if (hint.type) type = hint.type;
      }
      if (!type) type = validators.inferTypeFromKey(key);
      if (!type) continue;

      const result = validators.validateType(entry.value, type);
      if (result.unknownType) {
        findings.push({
          level: LEVELS.INFO,
          code: 'unknown-type',
          key,
          message: `unknown type hint "${type}" for "${key}" (skipped)`,
          line: entry.line,
        });
      } else if (!result.ok) {
        findings.push({
          level: LEVELS.ERROR,
          code: 'type',
          key,
          message: `"${key}" = "${entry.value}" is not a valid ${type}`,
          line: entry.line,
        });
      }
    }
  }

  // 7. Secret detection in the real .env. (WARN — secrets in .env are expected,
  //    but we flag them so they can be confirmed as not committed to VCS.)
  //    In the EXAMPLE file, a real secret is an ERROR (it should be a placeholder).
  if (checkSecrets) {
    for (const key of env.order) {
      const entry = env.entries.get(key);
      const det = validators.detectSecret(key, entry.value);
      if (det.isSecret) {
        findings.push({
          level: LEVELS.WARN,
          code: 'secret',
          key,
          message: `"${key}" ${det.reason}`,
          line: entry.line,
        });
      }
    }
    for (const key of example.order) {
      const entry = example.entries.get(key);
      const det = validators.detectSecret(key, entry.value);
      if (det.isSecret) {
        findings.push({
          level: LEVELS.ERROR,
          code: 'secret-in-example',
          key,
          message: `example file "${key}" ${det.reason} — should be a placeholder`,
          line: entry.line,
        });
      }
    }
  }

  const summary = summarize(findings);
  return { findings, summary };
}

function summarize(findings) {
  const summary = { error: 0, warn: 0, info: 0, total: findings.length };
  for (const f of findings) {
    if (f.level in summary) summary[f.level]++;
  }
  return summary;
}

module.exports = { compare, summarize, LEVELS };
