'use strict';

// Value validators and heuristics for envdiff.
//
// Two independent concerns:
//   1. Type inference / validation — given an expected type hint, does the
//      value look valid? Hints can come from the key name or an explicit
//      schema comment in .env.example (e.g. `PORT=  # type: number`).
//   2. Secret detection — does a value look like a real committed secret
//      that should not live in a checked-in file?

const TYPE_CHECKERS = {
  // Explicit "no constraint" types — valid hints that accept any value.
  // Declaring `# type: string` still documents intent and marks the key
  // as part of the schema without triggering unknown-type noise.
  string: () => true,
  any: () => true,
  number: (v) => /^-?\d+(\.\d+)?$/.test(v.trim()),
  integer: (v) => /^-?\d+$/.test(v.trim()),
  boolean: (v) => /^(true|false|0|1|yes|no)$/i.test(v.trim()),
  // Accepts any well-formed URL with a scheme://host shape. This covers
  // http(s) as well as the connection URLs common in env files
  // (postgres://, mysql://, redis://, amqp://, mongodb://, etc.).
  url: (v) => {
    const s = v.trim();
    try {
      const u = new URL(s);
      // Require a scheme and a `//` authority so bare strings like
      // "localhost5432" don't slip through as e.g. a "localhost5432:" scheme.
      return u.protocol.length > 1 && /^[a-z][a-z0-9+.-]*:\/\//i.test(s);
    } catch {
      return false;
    }
  },
  // Strictly http/https, for keys that must be web URLs.
  httpurl: (v) => {
    try {
      const u = new URL(v.trim());
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
      return false;
    }
  },
  email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
  port: (v) => {
    if (!/^\d+$/.test(v.trim())) return false;
    const n = Number(v.trim());
    return n >= 1 && n <= 65535;
  },
  json: (v) => {
    try {
      JSON.parse(v);
      return true;
    } catch {
      return false;
    }
  },
};

// Infer an expected type from the key name when no explicit hint is given.
function inferTypeFromKey(key) {
  const k = key.toUpperCase();
  if (/(^|_)PORT$/.test(k)) return 'port';
  if (/(^|_)(URL|URI|ENDPOINT)$/.test(k) || k.endsWith('_URL')) return 'url';
  if (/(^|_)EMAIL$/.test(k)) return 'email';
  if (/(^|_)(ENABLED|DISABLED|DEBUG|VERBOSE)$/.test(k)) return 'boolean';
  if (/(^|_)(COUNT|SIZE|LIMIT|MAX|MIN|TIMEOUT|INTERVAL|RETRIES)$/.test(k))
    return 'integer';
  return null;
}

// Parse an explicit type hint from a trailing comment on the example line,
// e.g. `PORT=8080  # type: port` or `FLAG=  # type:boolean required`.
function parseHint(rawLine) {
  if (typeof rawLine !== 'string') return {};
  const commentMatch = rawLine.match(/#\s*(.*)$/);
  if (!commentMatch) return {};
  const comment = commentMatch[1];

  const hint = {};
  const typeMatch = comment.match(/type\s*:\s*([A-Za-z]+)/i);
  if (typeMatch) hint.type = typeMatch[1].toLowerCase();
  if (/\brequired\b/i.test(comment)) hint.required = true;
  if (/\boptional\b/i.test(comment)) hint.required = false;
  return hint;
}

function validateType(value, type) {
  const checker = TYPE_CHECKERS[type];
  if (!checker) return { ok: true, unknownType: true };
  return { ok: checker(value), unknownType: false };
}

// --- Secret detection -------------------------------------------------------

const SECRET_KEY_HINTS =
  /(SECRET|TOKEN|PASSWORD|PASSWD|PWD|API[_-]?KEY|PRIVATE[_-]?KEY|ACCESS[_-]?KEY|CREDENTIAL|AUTH)/i;

// High-signal value patterns for well-known credential formats.
// Order matters: more specific prefixes (sk-ant-, sk-proj-, sk-or-) must be
// listed before the generic OpenAI-style `sk-` fallback.
const SECRET_VALUE_PATTERNS = [
  { name: 'AWS access key id', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'GitHub token', re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { name: 'GitHub PAT (fine-grained)', re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Stripe secret key', re: /\bsk_(live|test)_[A-Za-z0-9]{16,}\b/ },
  // AI provider keys. Google AI / Gemini keys share the AIza prefix below.
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'OpenRouter API key', re: /\bsk-or-(?:v1-)?[A-Za-z0-9_-]{20,}\b/ },
  { name: 'OpenAI project key', re: /\bsk-proj-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'OpenAI-style API key', re: /\bsk-[A-Za-z0-9]{32,}\b/ },
  { name: 'Hugging Face token', re: /\bhf_[A-Za-z0-9]{30,}\b/ },
  { name: 'Groq API key', re: /\bgsk_[A-Za-z0-9]{20,}\b/ },
  { name: 'xAI API key', re: /\bxai-[A-Za-z0-9]{20,}\b/ },
  { name: 'Replicate token', re: /\br8_[A-Za-z0-9]{30,}\b/ },
  { name: 'Perplexity API key', re: /\bpplx-[A-Za-z0-9]{30,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
];

// Placeholder values that are clearly NOT real secrets.
const PLACEHOLDER_RE =
  /^(|x+|your[-_ ]?.*|changeme|change[-_ ]?me|placeholder|todo|tbd|xxx+|<.*>|\.\.\.|example.*|dummy|test|secret|password|token|abc123|123456)$/i;

function looksLikePlaceholder(value) {
  const v = value.trim();
  if (v === '') return true;
  if (PLACEHOLDER_RE.test(v)) return true;
  // Repeated single char (aaaa, ****) => placeholder.
  if (/^(.)\1{3,}$/.test(v)) return true;
  return false;
}

// Shannon entropy in bits per character — high entropy suggests a real key.
function shannonEntropy(str) {
  if (str.length === 0) return 0;
  const freq = new Map();
  for (const ch of str) freq.set(ch, (freq.get(ch) || 0) + 1);
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

// Returns { isSecret, reason } for a key/value pair.
function detectSecret(key, value) {
  const v = String(value);

  // Explicit high-signal formats always win, even if the key looks benign.
  for (const pat of SECRET_VALUE_PATTERNS) {
    if (pat.re.test(v)) {
      return { isSecret: true, reason: `looks like a ${pat.name}` };
    }
  }

  if (looksLikePlaceholder(v)) {
    return { isSecret: false, reason: null };
  }

  const keyLooksSecret = SECRET_KEY_HINTS.test(key);
  if (keyLooksSecret) {
    // A secret-ish key with a non-placeholder, non-trivial value.
    if (v.length >= 8) {
      return {
        isSecret: true,
        reason: 'secret-like key has a concrete value',
      };
    }
  }

  // A connection URL without embedded credentials is not itself a secret
  // (e.g. redis://localhost:6379/0). But userinfo in the authority
  // (scheme://user:pass@host) means real credentials — let that fall through.
  const urlMatch = v.match(/^[a-z][a-z0-9+.-]*:\/\/([^/\s]*)/i);
  if (urlMatch) {
    const authority = urlMatch[1];
    const hasCredentials = authority.includes('@');
    if (hasCredentials) {
      return { isSecret: true, reason: 'connection URL with embedded credentials' };
    }
    return { isSecret: false, reason: null };
  }

  // Generic high-entropy long string (e.g. a random API token).
  if (v.length >= 20 && shannonEntropy(v) >= 4.0 && !/\s/.test(v)) {
    return { isSecret: true, reason: 'high-entropy value' };
  }

  return { isSecret: false, reason: null };
}

module.exports = {
  TYPE_CHECKERS,
  inferTypeFromKey,
  parseHint,
  validateType,
  detectSecret,
  looksLikePlaceholder,
  shannonEntropy,
};
