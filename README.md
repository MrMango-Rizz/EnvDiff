<p align="center">
  <img src="assets/logo.png" alt="envdiff" width="180">
</p>

# EnvDiff

You clone a repo. You copy .env.example to .env. Three days later the app crashes in a way that takes an hour to trace back to a missing variable, a port set to 70000, or a DEBUG=sometimes someone typed at 2am.

.env.example was supposed to prevent this — but nothing ever checks your .env against it. envdiff does.

$ envdiff
envdiff  .env  vs  .env.example
  x ERROR missing key "SERVER_PORT" (defined in example)
  x ERROR "DATABASE_URL" = "localhost5432" is not a valid url:8
  x ERROR "ADMIN_EMAIL" = "admin(at)example.com" is not a valid email:11
  x ERROR "DEBUG" = "sometimes" is not a valid boolean:14
  ! WARN  key "MAX_RETRIES" is empty:17
  ! WARN  duplicate definition of "NODE_ENV" (last value wins):29
  ! WARN  "STRIPE_SECRET_KEY" still holds the example value "your-stripe-key-here" — looks unfilled:23
  ! WARN  "AWS_ACCESS_KEY_ID" looks like a AWS access key id:20
  ! WARN  extra key "LEGACY_FLAG" (not in example):32
  4 errors  ·  5 warnings
Highlights
Zero runtime dependencies. One npm install brings in nothing else. Also ships as a single standalone .exe — no Node.js needed at all.
Understands real .env syntax. Quotes, escapes, export prefixes, inline comments, = inside values, duplicates.
Type-aware. Validates ports, URLs, emails, booleans, integers, JSON — from explicit hints in your example file or inferred from key names.
Secret detection. Recognizes AWS keys, GitHub/Slack tokens, Stripe keys, JWTs, private key blocks, high-entropy strings — and AI provider keys (OpenAI, Anthropic, Google/Gemini, OpenRouter, Hugging Face, Groq, xAI, Replicate, Perplexity).
Leak prevention. Warns when a populated .env isn't covered by .gitignore — i.e. one git add . away from being public. Flags real secrets in .env.example as errors, because only placeholders belong there.
Whole-project scans. envdiff --scan . walks your tree, pairs up every .env/.env.example, and checks them all.
CI-ready. Meaningful exit codes, --json output, --strict mode.
Friendly when double-clicked. Run the .exe with no arguments and it prompts for a folder and holds the window open — no flash-and-vanish.
Install
Standalone binary (Windows, no Node.js required):

Grab envdiff.exe from the latest release and put it on your PATH — or just double-click it.

With npm (any platform with Node ≥ 16):

npm install -g envdiff
# or run without installing:
npx envdiff
Usage
envdiff                        interactive: prompts for a folder to scan
envdiff --scan <dir>           scan a directory tree for env pairs
envdiff <env-file> <example>   compare two specific files
Option	Description
-s, --scan <dir>	scan a directory recursively for .env / .env.example pairs
-e, --env <path>	path to the real env file (default: .env)
-x, --example <path>	path to the reference file (default: .env.example)
--json	output findings as JSON (for CI and tooling)
--strict	treat warnings as errors (non-zero exit)
--no-secrets	skip secret detection
--no-types	skip type validation
--no-git	skip the .gitignore exposure check
--no-color	disable ANSI colors
--no-pause	don't wait for a keypress before exiting
-h, --help / -v, --version	help / version
Exit codes: 0 clean · 1 errors found (or warnings with --strict) · 2 usage error.

What it checks
Check	Level	Catches
Missing keys	error¹	Keys the example defines that your .env lacks
Type mismatches	error	PORT=70000, DEBUG=sometimes, malformed URLs/emails
Secrets in .env.example	error	Real credentials where only placeholders belong
Not gitignored	error² / warn	A populated .env that git would happily commit
Secrets in .env	warn	Known key formats + high-entropy values, so you can confirm they're safe
Unfilled placeholders	warn	Values still equal to the example, or <your-key-here> markers
Empty values	warn	Keys present but blank
Duplicate keys	warn	Same key defined twice (last one silently wins)
Extra keys	warn	Keys in .env the example doesn't know about
¹ downgraded to a warning if the example marks the key # optional · ² error in scan mode, warning in pair mode

Type hints
Annotate your .env.example with trailing comments — they double as documentation:

NODE_ENV=            # type: string
SERVER_PORT=         # type: port required
DATABASE_URL=        # type: url required
ADMIN_EMAIL=         # type: email
DEBUG=               # type: boolean optional
MAX_RETRIES=         # type: integer
Supported types: number · integer · boolean · url · httpurl · email · port · json · string · any

No hint? envdiff infers sensible types from key names: *_PORT must be a valid port, *_URL a URL, *_EMAIL an email, DEBUG/*_ENABLED a boolean, *_RETRIES/*_TIMEOUT/MAX_* an integer.

required makes a missing key an error (the default); optional downgrades it to a warning.

CI
envdiff is built to be a gate. JSON out, exit codes in:

# .github/workflows/env.yml
- name: Check env files
  run: npx envdiff --scan . --strict --json
Or as a pre-commit hook, so a real secret never even makes it into a commit:

# .git/hooks/pre-commit
npx envdiff --strict --no-pause || exit 1
FAQ
Why not just use dotenv? dotenv loads env files; it doesn't validate them. envdiff is the linter that runs before your app does — no code changes, no schema files, no runtime library.

Why are there fake secrets in examples/? The examples/ folder contains deliberately broken .env files used as demo fixtures and test data. Every "secret" in them is fake (the AWS key is Amazon's official documentation example). If your scanner flags them — that's envdiff's whole job, working as intended.

Why is the .exe ~55 MB? It bundles the Node.js runtime so it runs on machines with nothing installed. The npm package itself is a few kilobytes with zero dependencies.

Does it send my env values anywhere? No. envdiff is fully offline — it reads files, prints findings, exits. Nothing leaves your machine.

Development
npm test              # run the test suite — zero-dependency, 58 cases
npm install           # only needed to rebuild the binary (@yao-pkg/pkg)
npm run build:exe     # produce dist/envdiff.exe
The codebase is small and readable: a parser, a validator/secret-detector, a diff engine, a reporter, and a scanner — each a single dependency-free module under src/.

Found a credential format or a check that's missing? Issues and PRs welcome.

License
MIT

Made By mango_magic123456 on Discord
