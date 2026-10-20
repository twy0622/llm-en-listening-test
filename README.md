# All Ears

A free, single-place English listening exam. Each paper has a monologue and a
conversation, ten questions, a ten-minute timer, and two plays of each recording
with a thirty-second break between them.

The browser app, API, exam bank, and audio all live on one Cloudflare Worker:
React + Vite on the front, Hono on the back, D1 for the bank and history, R2 for
MP3s, and Workers AI for optional short-answer grading. Content is generated and
narrated offline with a Python factory, then imported through an admin endpoint.
There are no accounts, no per-request text-to-speech, and no server to keep
warm.

> **No content ships in this repository.** A new deployment is intentionally
> empty. Generate and publish at least one paper with the content factory before
> learners arrive; the exam page tells the operator what to do until then.

## What is implemented

- Two-section exam papers: one monologue and one dialogue, five questions each
  (2 MCQ, 2 gap-fill, 1 short answer).
- Ten-minute server-checked deadline, with a 60-second network grace window.
- Audio is played twice with a 30-second gap. The gate is client-side; the
  server enforces the overall deadline and never exposes answers early.
- Answers, explanations, rubrics, and transcripts stay in D1 until submission.
- Anonymous, HMAC-signed device and attempt tokens. Device identity survives a
  browser restart; attempts are resumable and idempotent.
- Exact grading for MCQ and gap-fill; Workers AI + deterministic keyword
  fallback for short answers.
- Results with transcripts, answer keys, per-question feedback, and a skill
  profile. History and a simple recommended level come from the same data.
- Two independent pack validators: Pydantic in the factory and Zod in the Worker.
- Topic engine with structured scenario cards and SHA-256 fingerprints so the
  factory does not repeat situations.
- Offline Kokoro narration with one cached pipeline per language, encoded to
  64 kbps mono MP3.
- Admin page for listing, publishing, unpublishing, and deleting papers.
- D1 rate limiting and a daily cron cleanup.

## Repository layout

```text
apps/
  api/                 Cloudflare Worker (Hono, D1, R2, Workers AI)
    migrations/        D1 schema
    src/lib/           tokens, auth, exam loading, grading, LLM chain
    src/routes/        device, tests, attempts, history, admin, audio
  web/                 React 19 + Vite + Tailwind SPA
packages/
  shared/              Zod wire contract shared by browser, Worker, and docs
pipeline/              Python content factory (Pydantic, Kokoro, lameenc)
docs/                  Architecture, deployment, and content-factory notes
```

## Local development

Requirements: Node 20+ (Node 22 tested), npm 10+, Python 3.11+ for the content
factory, and a Cloudflare account for deployment.

```powershell
npm install
npm run build                      # build apps/web/dist for the Worker

cd apps/api
Copy-Item .dev.vars.example .dev.vars
npx wrangler d1 migrations apply all-ears --local
npx wrangler dev                   # http://localhost:8787
```

For a faster frontend loop, leave the Worker running and start Vite in another
terminal:

```powershell
npm run dev:web                    # http://localhost:5173, /api proxied to 8787
```

Open `http://localhost:8787` (or `http://localhost:5173`). The exam page will say
that no papers are available until you import one. The local D1 and R2 state is
under `apps/api/.wrangler/` and is gitignored.

To get a paper into the local bank, follow [docs/CONTENT.md](docs/CONTENT.md).
The short version is:

```powershell
cd pipeline
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
Copy-Item .env.example .env       # add a Workers AI or Gemini credential
listening generate --level B1 --accent mixed --count 1
listening publish out/<test-id> --api http://localhost:8787 --token dev-admin-token
```

Then reload the home page and press **Start a listening test**.

## Deployment

The full walkthrough is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). In brief:

```powershell
npx wrangler login
npx wrangler d1 create all-ears        # copy database_id into apps/api/wrangler.toml
npx wrangler r2 bucket create all-ears-audio
npm run build
npm run db:migrate                     # remote D1 migration
cd apps/api
npx wrangler secret put ATTEMPT_SECRET
npx wrangler secret put ADMIN_TOKEN
npx wrangler deploy
```

Set `APP_ORIGIN` in `apps/api/wrangler.toml` to the deployed origin (for example
`https://all-ears.example.workers.dev`) before the final deploy. Publish content
to the deployed Worker with `listening publish ... --api https://<worker-url>` and
the same `ADMIN_TOKEN`.

### About the LLM providers

OpenCode's hosted free tier is deliberately app-only. In testing it returns
`403 FreeTierError` to external scripts and Workers, so the deployed app does
**not** depend on it. The runtime grading chain is:

1. Workers AI (free in-account allowance),
2. OpenCode, only if `OPENCODE_API_KEY` is configured,
3. a deterministic keyword heuristic.

The offline factory uses Workers AI REST or Gemini. Set one of those in
`pipeline/.env`; OpenCode remains an opt-in last resort for accounts with a
usable paid key. The app still grades MCQs and gap-fill without any LLM, and
falls back to the heuristic for short answers if Workers AI is unavailable.

## Tests

```powershell
npm run typecheck
npm test
npm run build

cd pipeline
python -m pytest -q
```

The Worker tests cover answer normalisation, exact grading, and the promise that
the pre-submission payload leaks no answers or transcripts. The Python tests
cover scenario uniqueness, dialogue parsing, pack validation, prompt rendering,
provider request shaping, and JSON extraction.

## Free-plan notes

- Workers: 100,000 requests/day.
- Workers AI: 10,000 neurons/day (grading only; content generation is offline).
- D1: 5 GB total, with a single primary database.
- R2: 10 GB storage; audio is immutable and cached for a year.
- 500 Worker builds/month; a single deploy is one build.

Workers AI is best-effort. Short-answer grading can fall back to the keyword
heuristic, so the exam remains usable when the daily allowance is exhausted.
There is no SLA on free model output quality; publish only packs that pass the
factory's validators.

## Security and integrity

- Device and attempt tokens are HMAC-SHA-256 signed and expire (2 years and 30
  days respectively). Attempt tokens are bound to one attempt and one device.
- Answers and transcripts are stored server-side and omitted from the public
  exam payload. A test rejects any accidental leak.
- The server checks the attempt deadline when grades are written. A short grace
  window avoids losing an auto-submit on a slow connection.
- D1-backed fixed-window rate limits cover device issuance and attempt
  start/submit. Admin routes use a constant-time token comparison.
- Audio keys must live under `audio/<testId>/`; admin imports cap the payload
  and decoded audio size.
- Play-count enforcement is a study affordance, not proctoring. A determined
  learner can reset local state or create another device. This is not suitable
  for high-stakes certification.

## Deliberate V1 limits

- No accounts, roles, classes, or cross-device history.
- No adaptive item selection or spaced repetition yet; the level recommendation
  is a simple rolling score heuristic.
- No teacher dashboard or PDF/CSV export yet. The admin endpoints are the
  machine interface.
- Content is pre-generated. The Worker cannot run Torch or Kokoro.
- The bank is empty until an operator publishes packs.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Deployment and operations](docs/DEPLOYMENT.md)
- [Content factory](docs/CONTENT.md)

## License and credits

The application code is provided as-is for personal/educational use. Kokoro-82M
is used only by the offline content factory; see its model card for licensing.
