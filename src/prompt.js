'use strict';

// Minimal interactive prompt + "press any key to exit" helpers.
// Dependency-free: uses the raw readline interface over stdin/stdout.
//
// These only work when stdin is a TTY. When it isn't (piped, CI), the
// callers fall back to non-interactive behavior.

const readline = require('readline');

function isInteractive() {
  return process.stdin.isTTY === true && process.stdout.isTTY === true;
}

// Ask a single line question. Resolves with the trimmed answer (may be '').
function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

// Hold the window open until the user presses a key. No-op when not a TTY,
// so piped/automated runs exit immediately.
function pause(message) {
  return new Promise((resolve) => {
    if (!isInteractive()) {
      resolve();
      return;
    }
    process.stdout.write(message || '\nPress any key to exit...');
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    try {
      stdin.setRawMode(true);
    } catch {
      // Some terminals disallow raw mode; fall back to line-based wait.
      const rl = readline.createInterface({ input: stdin, output: process.stdout });
      rl.question('', () => {
        rl.close();
        resolve();
      });
      return;
    }
    stdin.resume();
    stdin.once('data', () => {
      try {
        stdin.setRawMode(wasRaw);
      } catch {
        /* ignore */
      }
      stdin.pause();
      process.stdout.write('\n');
      resolve();
    });
  });
}

module.exports = { isInteractive, ask, pause };
