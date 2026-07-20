#!/usr/bin/env node
'use strict';

// envdiff — compare a .env against a .env.example and flag problems.
//
// Two modes:
//   1. Pair mode:  envdiff <env> <example>   — compare two specific files.
//   2. Scan mode:  envdiff --scan <dir>      — walk a directory, find every
//      .env / .env.example pair, and check them all.
//
// With no arguments and an interactive terminal, envdiff prompts for a path
// to scan and holds the window open at the end (so a double-clicked .exe
// doesn't flash and vanish).
//
// Exit codes:
//   0  no errors (warnings/info may still be printed)
//   1  one or more ERROR-level findings
//   2  usage / file-access error

const fs = require('fs');
const path = require('path');

const parser = require('./parser');
const diff = require('./diff');
const reporter = require('./reporter');
const scanner = require('./scanner');
const gitignore = require('./gitignore');
const prompt = require('./prompt');
const colors = require('./colors');

const VERSION = require('../package.json').version;

function printUsage() {
  const lines = [
    'envdiff — catch broken .env files before your app crashes',
    '',
    'Usage:',
    '  envdiff                       interactive: prompts for a folder to scan',
    '  envdiff --scan <dir>          scan a directory tree for env files',
    '  envdiff <env-file> <example>  compare two specific files',
    '',
    'Options:',
    '  -s, --scan <dir>       scan a directory (recursively) for env pairs',
    '  -e, --env <path>       path to the real env file (default: .env)',
    '  -x, --example <path>   path to the reference file (default: .env.example)',
    '      --json             output findings as JSON',
    '      --no-secrets       skip secret detection',
    '      --no-types         skip type validation',
    '      --no-git           skip the .gitignore exposure check',
    '      --no-color         disable ANSI colors',
    '      --strict           treat warnings as errors (non-zero exit)',
    '      --no-pause         do not wait for a keypress before exiting',
    '  -h, --help             show this help',
    '  -v, --version          show version',
    '',
    'Exit codes: 0 = clean, 1 = errors found, 2 = usage error',
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

class UsageError extends Error {}

function parseArgs(argv) {
  const opts = {
    scan: null,
    env: null,
    example: null,
    json: false,
    checkSecrets: true,
    checkTypes: true,
    checkGit: true,
    color: null, // null = auto
    strict: false,
    pause: null, // null = auto (pause only when interactive)
    help: false,
    version: false,
  };
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '-h':
      case '--help':
        opts.help = true;
        break;
      case '-v':
      case '--version':
        opts.version = true;
        break;
      case '-s':
      case '--scan':
        opts.scan = argv[++i];
        break;
      case '-e':
      case '--env':
        opts.env = argv[++i];
        break;
      case '-x':
      case '--example':
        opts.example = argv[++i];
        break;
      case '--json':
        opts.json = true;
        break;
      case '--no-secrets':
        opts.checkSecrets = false;
        break;
      case '--no-types':
        opts.checkTypes = false;
        break;
      case '--no-git':
        opts.checkGit = false;
        break;
      case '--no-color':
        opts.color = false;
        break;
      case '--strict':
        opts.strict = true;
        break;
      case '--pause':
        opts.pause = true;
        break;
      case '--no-pause':
        opts.pause = false;
        break;
      default:
        if (arg.startsWith('-')) {
          throw new UsageError(`unknown option: ${arg}`);
        }
        positional.push(arg);
    }
  }

  // Positional handling:
  //   1 arg  -> a directory to scan, or a single env file's folder.
  //   2 args -> env + example (pair mode).
  if (opts.env === null && opts.example === null && opts.scan === null) {
    if (positional.length === 1) {
      // Decide scan vs single-file by what the path is.
      const p = positional[0];
      const stat = safeStat(p);
      if (stat && stat.isDirectory()) {
        opts.scan = p;
      } else {
        opts.env = p;
      }
    } else if (positional.length >= 2) {
      opts.env = positional[0];
      opts.example = positional[1];
    }
  } else {
    if (opts.env === null && positional[0]) opts.env = positional[0];
    if (opts.example === null && positional[1]) opts.example = positional[1];
  }

  return opts;
}

function safeStat(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function readFileOrThrow(p, label) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new UsageError(`${label} file not found: ${p}`);
    }
    throw new UsageError(`cannot read ${label} file ${p}: ${err.message}`);
  }
}

// Compare a single env/example file pair. Returns a report.
function comparePair(envPath, examplePath, opts) {
  const envContent = readFileOrThrow(envPath, 'env');
  const exampleContent = readFileOrThrow(examplePath, 'example');
  const env = parser.parse(envContent);
  const example = parser.parse(exampleContent);
  return diff.compare(env, example, {
    checkSecrets: opts.checkSecrets,
    checkTypes: opts.checkTypes,
  });
}

// Does an env file actually hold at least one non-empty value? A file full
// of blank keys is harmless to commit, so we only run the git check on files
// with real content.
function hasRealValues(envPath) {
  try {
    const parsed = parser.parse(fs.readFileSync(envPath, 'utf8'));
    for (const key of parsed.order) {
      if (parsed.entries.get(key).value.trim() !== '') return true;
    }
  } catch {
    /* unreadable — treat as no real values */
  }
  return false;
}

// Find the enclosing git repository root for a file, or null if the file
// isn't inside a repo. Used to bound the .gitignore search in pair mode.
function findGitRoot(startDir) {
  let dir = path.resolve(startDir);
  for (let i = 0; i < 100; i++) {
    if (safeStat(path.join(dir, '.git'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

// Run scan mode over a directory. Returns { scan, errorCount, warnCount }.
function runScan(root, opts) {
  const { pairs, unpaired, scannedDirs } = scanner.findPairs(root);
  const results = [];

  for (const pair of pairs) {
    let report;
    try {
      report = comparePair(pair.env, pair.example, opts);
    } catch (err) {
      // A single unreadable file shouldn't abort the whole scan.
      report = {
        findings: [
          {
            level: 'error',
            code: 'read-error',
            key: null,
            message: err.message,
            line: null,
          },
        ],
        summary: { error: 1, warn: 0, info: 0, total: 1 },
      };
    }

    // Security check: a populated .env that git wouldn't ignore is a leak
    // waiting to happen. Only flag files that actually hold values.
    if (opts.checkGit !== false && hasRealValues(pair.env)) {
      const { ignored, hasGitignore } = gitignore.isIgnored(pair.env, root);
      if (hasGitignore && !ignored) {
        report.findings.push({
          level: 'error',
          code: 'git-exposed',
          key: null,
          message: `"${path.basename(pair.env)}" is NOT covered by .gitignore — risk of committing secrets`,
          line: null,
        });
        report.summary = diff.summarize(report.findings);
      }
    }

    results.push({
      env: path.relative(root, pair.env) || pair.env,
      example: path.relative(root, pair.example) || pair.example,
      report,
    });
  }

  const scan = {
    root,
    scannedDirs,
    results,
    unpaired: unpaired.map((u) => ({
      file: path.relative(root, u.file) || u.file,
      kind: u.kind,
    })),
  };

  let errorCount = 0;
  let warnCount = 0;
  for (const r of results) {
    errorCount += r.report.summary.error;
    warnCount += r.report.summary.warn;
  }
  return { scan, errorCount, warnCount };
}

// Main async entry — returns an exit code.
async function run(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`error: ${err.message}\n\n`);
      printUsage();
      return 2;
    }
    throw err;
  }

  if (opts.help) {
    printUsage();
    return 0;
  }
  if (opts.version) {
    process.stdout.write(`envdiff ${VERSION}\n`);
    return 0;
  }

  // JSON output should never carry color codes.
  if (opts.color === false || opts.json) {
    colors.setEnabled(false);
  }

  // Whether to hold the window open at the end.
  const shouldPause =
    opts.pause === true ||
    (opts.pause === null && !opts.json && prompt.isInteractive());

  // No target at all + interactive terminal -> prompt for a folder.
  const noTarget =
    opts.scan === null && opts.env === null && opts.example === null;
  if (noTarget) {
    if (prompt.isInteractive()) {
      const def = process.cwd();
      const answer = await prompt.ask(
        `Folder to scan for .env files [${def}]: `
      );
      opts.scan = answer === '' ? def : answer;
    } else {
      // Non-interactive with no args: default to scanning the cwd.
      opts.scan = process.cwd();
    }
  }

  let exitCode = 0;
  try {
    if (opts.scan !== null) {
      const stat = safeStat(opts.scan);
      if (!stat) {
        throw new UsageError(`path not found: ${opts.scan}`);
      }
      const root = stat.isFile() ? path.dirname(opts.scan) : opts.scan;
      const { scan, errorCount, warnCount } = runScan(root, opts);

      const output = opts.json
        ? reporter.renderScanJson(scan)
        : reporter.renderScanPretty(scan);
      process.stdout.write(output + '\n');

      if (errorCount > 0) exitCode = 1;
      else if (opts.strict && warnCount > 0) exitCode = 1;
    } else {
      // Pair mode.
      const envPath = opts.env || '.env';
      const examplePath = opts.example || '.env.example';
      const report = comparePair(envPath, examplePath, opts);

      // Same exposure check scan mode does: a populated .env inside a git
      // repo that .gitignore doesn't cover is one commit away from public.
      if (opts.checkGit !== false && hasRealValues(envPath)) {
        const gitRoot = findGitRoot(path.dirname(path.resolve(envPath)));
        if (gitRoot) {
          const { ignored } = gitignore.isIgnored(
            path.resolve(envPath),
            gitRoot
          );
          if (!ignored) {
            report.findings.push({
              level: 'warn',
              code: 'git-exposed',
              key: null,
              message: `"${path.basename(envPath)}" is NOT covered by .gitignore — its values could be committed and made public`,
              line: null,
            });
            report.summary = diff.summarize(report.findings);
          }
        }
      }

      const paths = {
        env: path.relative(process.cwd(), envPath) || envPath,
        example: path.relative(process.cwd(), examplePath) || examplePath,
      };
      const output = opts.json
        ? reporter.renderJson(report, paths)
        : reporter.renderPretty(report, paths);
      process.stdout.write(output + '\n');

      if (report.summary.error > 0) exitCode = 1;
      else if (opts.strict && report.summary.warn > 0) exitCode = 1;
    }
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`error: ${err.message}\n`);
      exitCode = 2;
    } else {
      throw err;
    }
  }

  if (shouldPause) {
    await prompt.pause();
  }
  return exitCode;
}

// Only run when invoked directly (not when required by tests).
if (require.main === module) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      process.stderr.write(`fatal: ${err && err.stack ? err.stack : err}\n`);
      process.exit(2);
    }
  );
}

module.exports = { run, parseArgs, UsageError, runScan };
