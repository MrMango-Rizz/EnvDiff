'use strict';

// Test suite for envdiff. Run with: node test/run.js
// Requires no external dependencies.

const { suite, test, eq, ok, notOk, done } = require('./harness');

const parser = require('../src/parser');
const validators = require('../src/validators');
const diff = require('../src/diff');
const reporter = require('../src/reporter');
const colors = require('../src/colors');

// Colors off for deterministic string assertions.
colors.setEnabled(false);

// --- parser -----------------------------------------------------------------
suite('parser');

test('parses simple KEY=VALUE', () => {
  const r = parser.parse('FOO=bar\nBAZ=qux');
  eq(r.order, ['FOO', 'BAZ']);
  eq(r.entries.get('FOO').value, 'bar');
  eq(r.entries.get('BAZ').value, 'qux');
});

test('ignores comments and blank lines', () => {
  const r = parser.parse('# comment\n\nFOO=bar\n   \n# another');
  eq(r.order, ['FOO']);
});

test('strips export prefix', () => {
  const r = parser.parse('export FOO=bar');
  eq(r.entries.get('FOO').value, 'bar');
});

test('handles double-quoted values with escapes', () => {
  const r = parser.parse('FOO="a\\nb"');
  eq(r.entries.get('FOO').value, 'a\nb');
  ok(r.entries.get('FOO').quoted);
});

test('single quotes are literal', () => {
  const r = parser.parse("FOO='a\\nb'");
  eq(r.entries.get('FOO').value, 'a\\nb');
});

test('strips inline comments on unquoted values', () => {
  const r = parser.parse('FOO=bar # trailing');
  eq(r.entries.get('FOO').value, 'bar');
});

test('does not strip # inside quoted values', () => {
  const r = parser.parse('FOO="bar # not a comment"');
  eq(r.entries.get('FOO').value, 'bar # not a comment');
});

test('records duplicates, last value wins', () => {
  const r = parser.parse('FOO=one\nFOO=two');
  eq(r.entries.get('FOO').value, 'two');
  eq(r.duplicates.length, 1);
  eq(r.duplicates[0].key, 'FOO');
});

test('ignores invalid keys', () => {
  const r = parser.parse('123=bad\n=empty\nGOOD=ok');
  eq(r.order, ['GOOD']);
});

test('handles empty values', () => {
  const r = parser.parse('FOO=\nBAR= ');
  eq(r.entries.get('FOO').value, '');
  eq(r.entries.get('BAR').value, '');
});

test('handles = inside value', () => {
  const r = parser.parse('URL=postgres://u:p@h/db?x=1');
  eq(r.entries.get('URL').value, 'postgres://u:p@h/db?x=1');
});

// --- validators: types ------------------------------------------------------
suite('validators/types');

test('number validation', () => {
  ok(validators.validateType('42', 'number').ok);
  ok(validators.validateType('-3.14', 'number').ok);
  notOk(validators.validateType('abc', 'number').ok);
});

test('port validation', () => {
  ok(validators.validateType('8080', 'port').ok);
  notOk(validators.validateType('99999', 'port').ok);
  notOk(validators.validateType('0', 'port').ok);
});

test('url validation', () => {
  ok(validators.validateType('https://example.com', 'url').ok);
  notOk(validators.validateType('not a url', 'url').ok);
});

test('url accepts non-http connection schemes', () => {
  ok(validators.validateType('redis://localhost:6379/0', 'url').ok);
  ok(validators.validateType('postgres://u:p@h:5432/db', 'url').ok);
  ok(validators.validateType('amqp://broker:5672', 'url').ok);
  notOk(validators.validateType('localhost5432', 'url').ok);
});

test('httpurl is strict about http/https', () => {
  ok(validators.validateType('https://example.com', 'httpurl').ok);
  notOk(validators.validateType('redis://localhost:6379', 'httpurl').ok);
});

test('url accepts non-http connection schemes', () => {
  ok(validators.validateType('redis://localhost:6379/0', 'url').ok);
  ok(validators.validateType('postgres://u:p@h:5432/db', 'url').ok);
  ok(validators.validateType('amqp://broker:5672', 'url').ok);
  notOk(validators.validateType('localhost5432', 'url').ok);
});

test('httpurl stays strict to http/https', () => {
  ok(validators.validateType('http://x.io', 'httpurl').ok);
  notOk(validators.validateType('redis://localhost', 'httpurl').ok);
});

test('boolean validation', () => {
  ok(validators.validateType('true', 'boolean').ok);
  ok(validators.validateType('0', 'boolean').ok);
  notOk(validators.validateType('maybe', 'boolean').ok);
});

test('unknown type is flagged, not failed', () => {
  const r = validators.validateType('x', 'nonsense');
  ok(r.unknownType);
  ok(r.ok);
});

test('string and any types accept any value', () => {
  ok(validators.validateType('anything at all', 'string').ok);
  notOk(validators.validateType('anything at all', 'string').unknownType);
  ok(validators.validateType('42', 'any').ok);
  notOk(validators.validateType('42', 'any').unknownType);
});

test('infers type from key name', () => {
  eq(validators.inferTypeFromKey('SERVER_PORT'), 'port');
  eq(validators.inferTypeFromKey('DATABASE_URL'), 'url');
  eq(validators.inferTypeFromKey('ADMIN_EMAIL'), 'email');
  eq(validators.inferTypeFromKey('DEBUG'), 'boolean');
  eq(validators.inferTypeFromKey('MAX_RETRIES'), 'integer');
  eq(validators.inferTypeFromKey('RANDOM'), null);
});

test('parses type hints from comments', () => {
  eq(validators.parseHint('PORT=  # type: port').type, 'port');
  eq(validators.parseHint('X=  # type:boolean required').required, true);
  eq(validators.parseHint('X=  # optional').required, false);
  eq(validators.parseHint('X=noComment').type, undefined);
});

// --- validators: secrets ----------------------------------------------------
suite('validators/secrets');

test('detects AWS access key', () => {
  const d = validators.detectSecret('KEY', 'AKIAIOSFODNN7EXAMPLE');
  ok(d.isSecret);
});

test('detects GitHub token', () => {
  const d = validators.detectSecret('X', 'ghp_' + 'a'.repeat(36));
  ok(d.isSecret);
});

test('detects AI provider API keys', () => {
  const cases = [
    ['Anthropic API key', 'sk-ant-api03-' + 'a'.repeat(40)],
    ['OpenAI project key', 'sk-proj-' + 'a'.repeat(40)],
    ['OpenAI-style API key', 'sk-' + 'a1B2'.repeat(12)],
    ['OpenRouter API key', 'sk-or-v1-' + 'a'.repeat(40)],
    ['Hugging Face token', 'hf_' + 'a'.repeat(34)],
    ['Groq API key', 'gsk_' + 'a'.repeat(32)],
    ['xAI API key', 'xai-' + 'a'.repeat(32)],
    ['Replicate token', 'r8_' + 'a'.repeat(32)],
    ['Perplexity API key', 'pplx-' + 'a'.repeat(40)],
    ['Google API key', 'AIza' + 'a'.repeat(35)],
  ];
  for (const [name, value] of cases) {
    const d = validators.detectSecret('SOME_KEY', value);
    ok(d.isSecret, `${name} should be detected`);
    ok(d.reason.includes(name), `reason should name ${name}, got: ${d.reason}`);
  }
});

test('AI key prefixes do not misfire on benign values', () => {
  // Short sk- values (not key-shaped) should not match the OpenAI fallback.
  notOk(validators.detectSecret('MODE', 'sk-dark').isSecret);
});

test('detects secret-like key with real value', () => {
  const d = validators.detectSecret('API_SECRET', 'k3jf9sldkfj23lkdsf');
  ok(d.isSecret);
});

test('placeholder is not a secret', () => {
  notOk(validators.detectSecret('PASSWORD', 'changeme').isSecret);
  notOk(validators.detectSecret('PASSWORD', 'your-password-here').isSecret);
  notOk(validators.detectSecret('TOKEN', '').isSecret);
  notOk(validators.detectSecret('TOKEN', 'xxxxxxxx').isSecret);
});

test('high-entropy generic value flagged', () => {
  const d = validators.detectSecret('THING', 'aB3xK9pQ7mR2vN5wL8zT1yU4');
  ok(d.isSecret);
});

test('low-entropy short value not flagged', () => {
  notOk(validators.detectSecret('NAME', 'john').isSecret);
});

test('bare connection URL is not a secret', () => {
  notOk(validators.detectSecret('CACHE_URL', 'redis://localhost:6379/0').isSecret);
  notOk(validators.detectSecret('AMQP_URL', 'amqp://broker:5672/vhost').isSecret);
});

test('connection URL with embedded credentials is a secret', () => {
  const d = validators.detectSecret('DATABASE_URL', 'postgres://user:s3cretpw@db:5432/app');
  ok(d.isSecret);
});

// --- diff engine ------------------------------------------------------------
suite('diff');

function reportFor(envText, exampleText, opts) {
  return diff.compare(parser.parse(envText), parser.parse(exampleText), opts);
}

test('clean env produces no findings', () => {
  const r = reportFor('FOO=bar\nBAZ=qux', 'FOO=\nBAZ=');
  eq(r.summary.total, 0);
});

test('missing key is an error', () => {
  const r = reportFor('FOO=bar', 'FOO=\nBAZ=');
  const f = r.findings.find((x) => x.code === 'missing');
  ok(f);
  eq(f.key, 'BAZ');
  eq(f.level, 'error');
});

test('optional missing key is a warning', () => {
  const r = reportFor('FOO=bar', 'FOO=\nBAZ=  # optional');
  const f = r.findings.find((x) => x.code === 'missing' && x.key === 'BAZ');
  eq(f.level, 'warn');
});

test('extra key is a warning', () => {
  const r = reportFor('FOO=bar\nEXTRA=1', 'FOO=');
  const f = r.findings.find((x) => x.code === 'extra');
  ok(f);
  eq(f.key, 'EXTRA');
});

test('empty value is a warning', () => {
  const r = reportFor('FOO=', 'FOO=');
  const f = r.findings.find((x) => x.code === 'empty');
  ok(f);
});

test('type mismatch via hint is an error', () => {
  const r = reportFor('PORT=notaport', 'PORT=  # type: port');
  const f = r.findings.find((x) => x.code === 'type');
  ok(f);
  eq(f.level, 'error');
});

test('type inferred from key name', () => {
  const r = reportFor('DATABASE_URL=nonsense', 'DATABASE_URL=');
  const f = r.findings.find((x) => x.code === 'type');
  ok(f);
});

test('duplicate key is a warning', () => {
  const r = reportFor('FOO=1\nFOO=2', 'FOO=');
  const f = r.findings.find((x) => x.code === 'duplicate');
  ok(f);
});

test('real secret in example is an error', () => {
  const r = reportFor('KEY=AKIAIOSFODNN7EXAMPLE', 'KEY=AKIAIOSFODNN7EXAMPLE');
  const f = r.findings.find((x) => x.code === 'secret-in-example');
  ok(f);
  eq(f.level, 'error');
});

test('checkSecrets:false disables secret findings', () => {
  const r = reportFor('API_SECRET=realvalue123456', 'API_SECRET=', {
    checkSecrets: false,
  });
  notOk(r.findings.find((x) => x.code === 'secret'));
});

test('checkTypes:false disables type findings', () => {
  const r = reportFor('PORT=bad', 'PORT=  # type: port', { checkTypes: false });
  notOk(r.findings.find((x) => x.code === 'type'));
});

test('flags a value left identical to the example placeholder', () => {
  const r = reportFor('API_KEY=your-key-here', 'API_KEY=your-key-here');
  const f = r.findings.find((x) => x.code === 'placeholder');
  ok(f);
  eq(f.level, 'warn');
});

test('flags an angle-bracket template marker as unfilled', () => {
  const r = reportFor('DB_HOST=<your-db-host>', 'DB_HOST=');
  ok(r.findings.find((x) => x.code === 'placeholder'));
});

test('does not flag a genuinely filled value as placeholder', () => {
  const r = reportFor('DB_HOST=db.internal.prod', 'DB_HOST=localhost');
  notOk(r.findings.find((x) => x.code === 'placeholder'));
});

// --- reporter ---------------------------------------------------------------
suite('reporter');

test('pretty output reports clean state', () => {
  const r = reportFor('FOO=bar', 'FOO=');
  const out = reporter.renderPretty(r, { env: '.env', example: '.env.example' });
  ok(out.includes('no problems found'));
});

test('json output is valid and structured', () => {
  const r = reportFor('FOO=bar', 'FOO=\nBAZ=');
  const out = reporter.renderJson(r, { env: '.env', example: '.env.example' });
  const parsed = JSON.parse(out);
  eq(parsed.summary.error, 1);
  ok(Array.isArray(parsed.findings));
});

// --- scanner ----------------------------------------------------------------
const scanner = require('../src/scanner');

suite('scanner');

test('recognizes env-like names', () => {
  ok(scanner.isEnvLikeName('.env'));
  ok(scanner.isEnvLikeName('.env.local'));
  ok(scanner.isEnvLikeName('.env.production'));
  ok(scanner.isEnvLikeName('app.env'));
  notOk(scanner.isEnvLikeName('config.json'));
  notOk(scanner.isEnvLikeName('README.md'));
});

test('recognizes example names', () => {
  ok(scanner.isExampleName('.env.example'));
  ok(scanner.isExampleName('.env.sample'));
  ok(scanner.isExampleName('.env.template'));
  ok(scanner.isExampleName('.env.dist'));
  notOk(scanner.isExampleName('.env'));
  notOk(scanner.isExampleName('.env.local'));
});

test('picks the best example file', () => {
  eq(scanner.pickExample(['.env.sample', '.env.example']), '.env.example');
  eq(scanner.pickExample(['.env.sample']), '.env.sample');
  eq(scanner.pickExample([]), null);
});

test('finds real env/example pairs in the examples dir', () => {
  const path = require('path');
  const root = path.join(__dirname, '..', 'examples');
  const { pairs } = scanner.findPairs(root);
  // Each demo dir has a .env + .env.example -> at least 2 pairs.
  ok(pairs.length >= 2, `expected >=2 pairs, got ${pairs.length}`);
  for (const p of pairs) {
    ok(p.env.endsWith('.env'), `env path: ${p.env}`);
    ok(p.example.endsWith('.example'), `example path: ${p.example}`);
  }
});

test('skips ignored directories', () => {
  ok(scanner.IGNORED_DIRS.has('node_modules'));
  ok(scanner.IGNORED_DIRS.has('.git'));
});

// --- gitignore --------------------------------------------------------------
const gitignore = require('../src/gitignore');

suite('gitignore');

test('exact .env pattern matches', () => {
  const { re } = gitignore.patternToRegExp('.env');
  ok(re.test('.env'));
  ok(re.test('sub/.env'));
  notOk(re.test('.env.example'));
});

test('wildcard .env* matches variants but not example at any depth', () => {
  const { re } = gitignore.patternToRegExp('.env*');
  ok(re.test('.env'));
  ok(re.test('.env.local'));
  ok(re.test('config/.env.production'));
});

test('negation flag is parsed', () => {
  const { neg } = gitignore.patternToRegExp('!.env.example');
  ok(neg);
});

test('anchored pattern only matches at root', () => {
  const { re } = gitignore.patternToRegExp('/.env');
  ok(re.test('.env'));
  notOk(re.test('sub/.env'));
});

done();
