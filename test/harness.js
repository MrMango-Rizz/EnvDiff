'use strict';

// Tiny dependency-free test harness.
// Collects assertions, prints a summary, and sets exit code on failure.

let passed = 0;
let failed = 0;
const failures = [];
let currentSuite = '';

function suite(name) {
  currentSuite = name;
}

function test(name, fn) {
  try {
    fn();
    passed++;
  } catch (err) {
    failed++;
    failures.push({ suite: currentSuite, name, message: err.message });
  }
}

function eq(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg || 'eq'}: expected ${e}, got ${a}`);
  }
}

function ok(value, msg) {
  if (!value) {
    throw new Error(`${msg || 'ok'}: expected truthy, got ${JSON.stringify(value)}`);
  }
}

function notOk(value, msg) {
  if (value) {
    throw new Error(`${msg || 'notOk'}: expected falsy, got ${JSON.stringify(value)}`);
  }
}

function done() {
  const total = passed + failed;
  process.stdout.write('\n');
  if (failed === 0) {
    process.stdout.write(`\x1b[32m✓ all ${total} tests passed\x1b[0m\n`);
    process.exit(0);
  }
  process.stdout.write(`\x1b[31m✗ ${failed} of ${total} tests failed\x1b[0m\n\n`);
  for (const f of failures) {
    process.stdout.write(`  \x1b[31m✗\x1b[0m [${f.suite}] ${f.name}\n    ${f.message}\n`);
  }
  process.exit(1);
}

module.exports = { suite, test, eq, ok, notOk, done };
