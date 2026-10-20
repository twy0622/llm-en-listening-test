# Deployment and operations

This is the complete path from a clean checkout to a working, content-backed
deployment on Cloudflare's free plan. Run the commands from the repository root
unless a step says otherwise.

## 0. Prerequisites

- Node 20+ (Node 22 tested) and npm 10+.
- A Cloudflare account with Workers, D1, R2, and Workers AI enabled.
- Wrangler 4 (`npx wrangler --version`).
- Python 3.11+ only if you are producing content. The deployed Worker does not
  run Python.
- For audio: enough disk for Kokoro/PyTorch and the generated MP3s. Nothing
  model-related is uploaded to the Worker.

```powershell
npm install
npx wrangler login
```

## 1. Create the resources

```powershell
npx wrangler d1 create all-ears
npx wrangler r2 bucket create all-ears-audio
```

The D1 command prints a `database_id`. Open `apps/api/wrangler.toml` and replace
the placeholder:

```toml
[[d1_databases]]
binding = "DB"
database_name = "all-ears"
database_id = "paste-the-real-uuid-here"
migrations_dir = "migrations"
```

R2 is already configured with `bucket_name = "all-ears-audio"`. If you use a
different bucket name, update the binding as well.

## 2. Build and migrate

```powershell
npm run build
npm run db:migrate
```

`npm run db:migrate` runs `wrangler d1 migrations apply all-ears --remote` from
`apps/api`. It will prompt for confirmation in an interactive terminal. For local
development use `npm run db:migrate:local` instead.

The schema creates `tests`, `passages`, `questions`, `attempts`, `answers`,
`topics`, and `rate_limits`. Migrations are forward-only; do not edit an applied
migration in place.

## 3. Secrets and origin

Generate two independent random values:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Set them as Worker secrets from `apps/api`:

```powershell
cd apps/api
npx wrangler secret put ATTEMPT_SECRET
npx wrangler secret put ADMIN_TOKEN
cd ../..
```

- `ATTEMPT_SECRET` signs device and attempt tokens. Changing it invalidates every
  existing device/attempt token.
- `ADMIN_TOKEN` authenticates `/api/admin/*` and the content factory's
  `publish` command.

Set `APP_ORIGIN` in `apps/api/wrangler.toml` to the origin users will visit. For
the first deploy you can leave the localhost value, deploy once, then update it:

```toml
[vars]
APP_ORIGIN = "https://all-ears.<your-subdomain>.workers.dev"
```

A comma-separated list is accepted. Localhost origins are always allowed by the
API's CORS helper, which is useful for Vite development but does not grant access
to any data by itself.

Optional variables:

| Variable | Default | Purpose |
|---|---|---|
| `OPENCODE_BASE_URL` | `https://opencode.ai` | Optional paid OpenCode-compatible endpoint |
| `OPENCODE_MODEL` | `deepseek-v4.1-flash-free` | Optional OpenCode model |
| `LLM_FALLBACK_MODEL` | `@cf/meta/llama-3.1-8b-instruct-fp8-fast` | Workers AI model for short-answer grading |

`OPENCODE_API_KEY`, if used, is a secret, not a `[vars]` entry. The deployed app
does not need any LLM key to serve or grade MCQs/gap-fill; Workers AI is tried
first and the heuristic is the final fallback.

## 4. Deploy

```powershell
npm run deploy
```

This builds the web app and runs `wrangler deploy` in `apps/api`. The Worker
serves the SPA and the API from one origin.

Verify:

```powershell
curl https://<worker-url>/api/health
```

Expected:

```json
{"ok":true,"service":"all-ears","time":"..."}
```

If you changed `APP_ORIGIN`, deploy once more after editing it.

### Custom domain

Add the domain under Cloudflare dashboard → Workers & Pages → `all-ears` →
Settings → Domains & Routes. Then update `APP_ORIGIN` to the custom origin and
redeploy. DNS and the TLS certificate are handled by Cloudflare.

## 5. Publish the first paper

A fresh deployment has no tests. Generate and publish at least one pack:

```powershell
cd pipeline
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"

Copy-Item .env.example .env
# edit .env: set CF_ACCOUNT_ID + CF_API_TOKEN, or GEMINI_API_KEY
listening generate --level B1 --accent mixed --count 1
listening validate out/<test-id>
listening publish out/<test-id> --api https://<worker-url> --token <ADMIN_TOKEN>
```

The publish command imports `test.json` and the MP3s. The Worker independently
validates the pack with Zod before writing D1 and R2. Then open the site and press
**Start a listening test**.

See [CONTENT.md](CONTENT.md) for provider setup, quality gates, and how to build a
larger bank.

## 6. Local development

```powershell
npm install
npm run build

cd apps/api
Copy-Item .dev.vars.example .dev.vars
npx wrangler d1 migrations apply all-ears --local
npx wrangler dev
```

`apps/api/.dev.vars` is gitignored. Use `npm run dev:web` in another terminal if
you want Vite hot reload on port 5173; it proxies `/api` to 8787. The Worker's
local D1 and R2 state is under `apps/api/.wrangler/`.

The local test flow does not require a Cloudflare account for D1/R2. It does
require a provider credential only when you use the content factory's LLM
generation.

## 7. Operating the bank

- Admin page: `https://<worker-url>/admin`. Paste the `ADMIN_TOKEN`; it is kept
  in session storage for the tab.
- `GET /api/admin/tests` lists papers, counts, and status.
- Publish/unpublish: `POST /api/admin/tests/:id/publish` with
  `{"published":true|false}`.
- Delete: `DELETE /api/admin/tests/:id`. A paper with attempts is protected.
- Import: `POST /api/admin/import` with a `TestPack` plus base64 audio. The
  factory's `publish` command is the normal client.
- Replace an existing paper: `--replace`, only when it has no attempts. A replace
  deletes the old passages/questions and their audio first; do not use it on a
  paper people are actively taking.

### Backups

```powershell
npx wrangler d1 export all-ears --remote --output all-ears-backup.sql
```

R2 has no automatic versioning in this setup. Keep the generated `pipeline/out`
packs (or a separate copy of the MP3s) if you need to restore audio. The
`.gitignore` excludes generated packs and audio by default.

### Logs

```powershell
cd apps/api
npx wrangler tail
```

Request logs include a `requestId`, path, status, and duration. Unhandled errors
log the stack; API errors return a structured `{error, message, requestId}` body.

### Cron cleanup

`wrangler.toml` schedules one daily run at 03:17 UTC. It deletes rate-limit rows
older than a day and abandoned in-progress attempts whose deadline is more than a
week old. Submitted attempts and answers are kept.

### Rollback

```powershell
cd apps/api
npx wrangler deployments list
npx wrangler rollback <deployment-id>
```

Rolling back code does **not** roll back D1 migrations or content. If a schema
change is involved, write a new forward migration. To pull a bad paper, first
unpublish it; deleting it is only possible if it has no attempts.

## Free-plan limits

These are design targets, not guarantees. Check the Cloudflare dashboard for
current limits.

| Resource | Free allowance | How this app uses it |
|---|---|---|
| Workers requests | 100,000/day | One request per page/API call; static assets are separate |
| Workers AI | 10,000 neurons/day | Short-answer grading only |
| D1 | 5 GB total | Text questions, attempts, answers; no audio |
| R2 | 10 GB storage | 64 kbps mono MP3; thousands of papers |
| Worker builds | 500/month | One build per deploy |

Workers AI is optional at runtime. If it is unavailable or the daily allowance is
exhausted, short answers use the deterministic keyword heuristic and the exam
continues. There is no runtime TTS and no always-on server.

## Troubleshooting

### `No published tests are available yet`

Expected on a fresh deployment. Generate a pack and publish it. Check
`/api/admin/tests` to confirm that the test status is `published`, not `draft`.

### Audio returns `404`

The public URL is `/api/audio/audio/<testId>/<passageId>.mp3`. The first `audio`
is the R2 key prefix, the second is the route prefix. Verify the R2 object exists
under the exact key and that the test ID in the key matches the pack. Re-publish
the pack if the key is wrong.

### `SELF_SIGNED_CERT_IN_CHAIN` while installing or calling the LLM

A corporate TLS-inspection proxy is presenting a root CA that Node/Python does
not trust.

- Do not disable certificate verification in application code.
- Point Node at the root CA with `NODE_EXTRA_CA_CERTS=C:\path\to\root-ca.pem`.
- Point npm at the same file with `npm config set cafile C:\path\to\root-ca.pem`.
- The Python factory calls `truststore.inject_into_ssl()` when `truststore` is
  installed, which uses the OS trust store. If the proxy still fails, set
  `SSL_CERT_FILE` to the corporate root CA before running the factory.

### `403 FreeTierError: free tier can only be used from within OpenCode`

Expected. OpenCode's free tier is intentionally limited to its own application.
Use Workers AI (`CF_ACCOUNT_ID` + `CF_API_TOKEN`) or Gemini (`GEMINI_API_KEY`) in
the content factory. The deployed Worker does not call OpenCode unless you set
`OPENCODE_API_KEY`.

### `No module named listening_pipeline`

Install the package in editable mode from `pipeline/`:

```powershell
python -m pip install -e ".[dev]"
```

For a one-off run without installing, set `$env:PYTHONPATH="src"` and use
`python -m listening_pipeline ...`.

### `No module named kokoro` or Kokoro model download is slow

Audio generation needs the full Kokoro dependency (including PyTorch). The first
run downloads the model; later runs reuse the local cache and the process-level
pipeline cache. Text-only commands (`topics`, validation of existing packs) do
not need Kokoro.

### `lameenc` unavailable

The factory writes a WAV fallback and records `audio/wav` in the pack. The Worker
accepts WAV and serves it with the correct MIME type; MP3 is strongly preferred
for R2 size and browser startup time.

### Import `413` or `409`

`413`: the base64 payload exceeds 30 MB or decoded audio exceeds 24 MB. Shorten
the passages or split the pack. `409`: the test ID already exists, or it has
attempts and cannot be replaced/deleted. Generate a new pack.

### Submission `410 deadline_expired`

The server deadline plus the 60-second network grace has passed. The answers
were not accepted. Start a new test from the home page. This is intentional: the
client clock and tab state are not trusted.
