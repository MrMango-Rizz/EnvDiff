'use strict';

// Rendering of a findings report to the terminal or JSON.
// Pure formatting: takes a report, returns a string.

const c = require('./colors');

const LEVEL_STYLE = {
  error: { label: 'ERROR', paint: c.red, glyph: 'x' },
  warn: { label: 'WARN', paint: c.yellow, glyph: '!' },
  info: { label: 'INFO', paint: c.blue, glyph: 'i' },
};

const CREDIT = 'Made By mango_magic123456 on Discord';

function creditLine() {
  return c.gray('  ' + CREDIT);
}

// Human-readable report. `paths` is { env, example } for the header.
function renderPretty(report, paths) {
  const lines = [];
  const { findings, summary } = report;

  lines.push('');
  lines.push(
    c.bold('envdiff') +
      c.gray(`  ${paths.env}  vs  ${paths.example}`)
  );
  lines.push('');

  if (findings.length === 0) {
    lines.push(c.green('  ✓ no problems found — env matches the example'));
    lines.push('');
    lines.push(creditLine());
    lines.push('');
    return lines.join('\n');
  }

  // Group findings by level for a stable, readable order.
  const order = ['error', 'warn', 'info'];
  for (const level of order) {
    const group = findings.filter((f) => f.level === level);
    if (group.length === 0) continue;
    const style = LEVEL_STYLE[level];
    for (const f of group) {
      const loc = f.line ? c.gray(`:${f.line}`) : '';
      lines.push(
        `  ${style.paint(style.glyph)} ${style.paint(style.label.padEnd(5))} ${f.message}${loc}`
      );
    }
  }

  lines.push('');
  lines.push(renderSummaryLine(summary));
  lines.push('');
  lines.push(creditLine());
  lines.push('');
  return lines.join('\n');
}

function renderSummaryLine(summary) {
  const parts = [];
  parts.push(
    summary.error > 0
      ? c.red(`${summary.error} error${summary.error === 1 ? '' : 's'}`)
      : c.gray('0 errors')
  );
  parts.push(
    summary.warn > 0
      ? c.yellow(`${summary.warn} warning${summary.warn === 1 ? '' : 's'}`)
      : c.gray('0 warnings')
  );
  if (summary.info > 0) {
    parts.push(c.blue(`${summary.info} info`));
  }
  return '  ' + parts.join(c.gray('  ·  '));
}

// Machine-readable JSON, suitable for CI consumption.
function renderJson(report, paths) {
  return JSON.stringify(
    {
      env: paths.env,
      example: paths.example,
      summary: report.summary,
      findings: report.findings,
    },
    null,
    2
  );
}

// --- scan (multi-file) rendering -------------------------------------------

// Render a whole directory scan. `scan` is:
//   { root, results: [{ env, example, report }], unpaired, scannedDirs }
// where env/example are display paths (relative to root).
function renderScanPretty(scan) {
  const lines = [];
  lines.push('');
  lines.push(c.bold('envdiff') + c.gray(`  scan of ${scan.root}`));
  lines.push(
    c.gray(
      `  ${scan.scannedDirs} director${scan.scannedDirs === 1 ? 'y' : 'ies'} scanned  ·  ` +
        `${scan.results.length} env file${scan.results.length === 1 ? '' : 's'} checked`
    )
  );
  lines.push('');

  const totals = { error: 0, warn: 0, info: 0 };

  if (scan.results.length === 0) {
    lines.push(c.yellow('  no .env / .env.example pairs found'));
  }

  for (const r of scan.results) {
    const s = r.report.summary;
    totals.error += s.error;
    totals.warn += s.warn;
    totals.info += s.info;

    const badge =
      s.error > 0
        ? c.red('✗')
        : s.warn > 0
          ? c.yellow('!')
          : c.green('✓');
    lines.push(
      `${badge} ${c.bold(r.env)} ${c.gray('vs ' + r.example)}  ${miniSummary(s)}`
    );

    // Indent each finding under its file.
    const order = ['error', 'warn', 'info'];
    for (const level of order) {
      const group = r.report.findings.filter((f) => f.level === level);
      const style = LEVEL_STYLE[level];
      for (const f of group) {
        const loc = f.line ? c.gray(`:${f.line}`) : '';
        lines.push(
          `    ${style.paint(style.glyph)} ${style.paint(
            style.label.padEnd(5)
          )} ${f.message}${loc}`
        );
      }
    }
    lines.push('');
  }

  // Files with no counterpart to compare against.
  if (scan.unpaired && scan.unpaired.length > 0) {
    lines.push(c.gray('  unpaired files (no comparison made):'));
    for (const u of scan.unpaired) {
      const why =
        u.kind === 'no-example'
          ? 'no example file in this folder'
          : 'example only, no real env file';
      lines.push(c.gray(`    · ${u.file}  (${why})`));
    }
    lines.push('');
  }

  lines.push(
    c.bold('total: ') +
      renderSummaryTotals(totals) +
      c.gray(`  across ${scan.results.length} file${scan.results.length === 1 ? '' : 's'}`)
  );
  lines.push('');
  lines.push(creditLine());
  lines.push('');
  return lines.join('\n');
}

function miniSummary(s) {
  const parts = [];
  if (s.error > 0) parts.push(c.red(`${s.error}E`));
  if (s.warn > 0) parts.push(c.yellow(`${s.warn}W`));
  if (s.info > 0) parts.push(c.blue(`${s.info}i`));
  if (parts.length === 0) return c.green('clean');
  return c.gray('[') + parts.join(' ') + c.gray(']');
}

function renderSummaryTotals(totals) {
  const parts = [];
  parts.push(
    totals.error > 0
      ? c.red(`${totals.error} error${totals.error === 1 ? '' : 's'}`)
      : c.gray('0 errors')
  );
  parts.push(
    totals.warn > 0
      ? c.yellow(`${totals.warn} warning${totals.warn === 1 ? '' : 's'}`)
      : c.gray('0 warnings')
  );
  if (totals.info > 0) parts.push(c.blue(`${totals.info} info`));
  return parts.join(c.gray('  ·  '));
}

function renderScanJson(scan) {
  const totals = { error: 0, warn: 0, info: 0 };
  for (const r of scan.results) {
    totals.error += r.report.summary.error;
    totals.warn += r.report.summary.warn;
    totals.info += r.report.summary.info;
  }
  return JSON.stringify(
    {
      root: scan.root,
      scannedDirs: scan.scannedDirs,
      filesChecked: scan.results.length,
      totals,
      results: scan.results.map((r) => ({
        env: r.env,
        example: r.example,
        summary: r.report.summary,
        findings: r.report.findings,
      })),
      unpaired: scan.unpaired,
    },
    null,
    2
  );
}

module.exports = {
  renderPretty,
  renderJson,
  renderScanPretty,
  renderScanJson,
};
