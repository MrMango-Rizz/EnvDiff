'use strict';

// Minimal, dependency-free ANSI color helpers.
// Colors auto-disable when output is not a TTY, when NO_COLOR is set,
// or when --no-color was passed (handled by the CLI via setEnabled).

let enabled =
  process.stdout.isTTY === true &&
  !('NO_COLOR' in process.env) &&
  process.env.TERM !== 'dumb';

function setEnabled(value) {
  enabled = Boolean(value);
}

function isEnabled() {
  return enabled;
}

function wrap(code) {
  return (text) => (enabled ? `\x1b[${code}m${text}\x1b[0m` : String(text));
}

module.exports = {
  setEnabled,
  isEnabled,
  red: wrap('31'),
  green: wrap('32'),
  yellow: wrap('33'),
  blue: wrap('34'),
  magenta: wrap('35'),
  cyan: wrap('36'),
  gray: wrap('90'),
  bold: wrap('1'),
  dim: wrap('2'),
};
