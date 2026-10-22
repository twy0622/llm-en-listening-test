# All Ears

A free, single-place English listening practice library. Each paper has a
monologue and a conversation, ten questions, a ten-minute timer, and two plays of
each recording with a thirty-second break between them.

The browser app, API, item bank, and audio all live on one Cloudflare Worker:
React + Vite on the front, Hono on the back, D1 for the bank and history, R2 for
MP3s, and Workers AI for the only optional model call — ambiguous short answers.
Papers are written, narrated, checked, and reviewed offline in a Python factory,
then imported through an admin endpoint. There are no accounts, no per-request
text-to-speech, and no server to keep warm.

> **No content ships in this repository.** A new deployment is intentionally
> empty. Generate, review, and publish at least one paper with the content
> factory before learners arrive; the exam page tells the operator what to do
> until then.

## How the bank works

- Papers are pre-generated and reused across learners. They are not invented at
  request time.
- A device is not shown a paper it has already submitted while another paper is
  available. When the shelf is exhausted, it can serve a repeat rather than an
  empty screen.
- Every imported pack belongs to a quarterly season (`YYYY-Q1..Q4`) or to the
  evergreen core. Selection prefers the current season, so the front of the
  library changes four times a year without deleting old courses.
- Old papers are **archived, not deleted**. Archived papers leave the learner
  rotation, but existing attempts, scores, transcripts, and audio replay remain.
- A pack can carry an offline `review.json` verdict. Publishing with
  `--require-review` refuses to release a pack that has not been approved by
  that offline editorial review.
- Answers stay server-side. A learner cannot inspect keys, explanations, or
  transcripts before submitting.

## What is implemented

- Two-section papers: one monologue and one dialogue, five questions each
  (2 MCQ, 2 gap-fill, 1 short answer).
- Ten-minute server-checked deadline, with a 60-second network grace window.
- Audio is played twice with a 30-second gap. The gate is client-side; the
  server enforces the overall deadline and never exposes answers early.
- Answers, explanations, rubrics, and transcripts stay in D1 until submission.
- Anonymous, HMAC-signed device and attempt tokens. Device identity survives a
  browser restart; attempts are resumable and idempotent.
- Exact grading for MCQ and gap-fill. Short answers are triaged deterministically
  first; Workers AI is only called for genuinely ambiguous answers, with a keyword
  fallback.
- Results with transcripts, answer keys, per-question feedback, and a skill
  profile. History and a simple recommended level come from the same data.
- Seasonal selection, archive/restore, and review status on the admin page.
- Two independent pack validators: Pydantic in the factory and Zod in the Worker.
- Topic engine with structured scenario cards and SHA-256 fingerprints so the
  factory does not repeat situations.
- Offline Kokoro narration with one cached pipeline per language, encoded to
  64 kbps mono MP3.
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

To get a reviewed paper into the local bank:

```powershell
cd pipeline
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
Copy-Item .env.example .env        # add a Workers AI or Gemini credential
listening generate --level B1 --accent mixed --count 1
listening validate out/<test-id>
listening review out/<test-id>
listening publish out/<test-id> --require-review --api http://localhost:8787 --token dev-admin-token
```

Then reload the home page and press **Begin a listening paper**.

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

### About the model providers

OpenCode's hosted free tier is deliberately app-only. In testing it returns
`403 FreeTierError` to external scripts and Workers, so bearing part of the app
does **not** depend on it. The runtime grading chain is:

1. deterministic triage for clear/gap-fill/short answers and earlier full/zero short answers,
   exact grading is done. Clear short answers are marked without a model,
2. Workers AI (free in-account allowance) for genuinely ambiguous short answers,
2. Workers AI (free in-account allowance) for genuinely ambiguous short answers,
3. OpenCode, only if `OPENCODE_API_KEY` is configured,
4. a deterministic keyword heuristic.

The offline writer uses Workers AI REST or Gemini. The offline reviewer should use
a different model family from the writer, so the second set of eyes is genuinely
different. OpenCode remains an opt-in last resort for accounts with a usable
paid key. The app still grades MCQs and gap-fill without any LLM, and falls back
to the heuristic for short answers if Workers AI is unavailable.

## Tests

```powershell
npm run typecheck
npm test
npm run build

cd pipeline
python -m pytest -q
```

The Worker tests cover answer normalisation, exact grading, short-answer
triage (including the promise that clear answers never call a model), season
boundaries, the promise that the pre-submission payload leaks no answers or
transcripts, and paper selection. Selection tests run the real SQL against an
in-memory SQLite database and cover unseen-paper preference, current-season
preference, the cross-level fallback, archived/draft exclusion, and the
exhaustion repeat. The Python tests cover scenario uniqueness, dialogue parsing,
pack validation, prompt rendering, provider request shaping, JSON extraction,
the offline review verdict, and the publish review gate.

A GitHub Actions workflow runs the same typecheck, unit tests, SPA build, Worker
bundle dry run, and Python tests on every push and pull request.

## Free-plan notes

- Workers: 100,000 requests/day.
- Workers AI: 10,000 neurons/day (grading only; content generation is offline).
- D1: 5 GB total, with a single primary database.
- R2: 10 GB storage; audio is immutable and cached for a year. 500 papers at
  ~4 minutes/passage and 64 kbps is about 2 GB, so audio does not need proactive
  deletion until far beyond the initial bank.
- 500 Worker builds/month; a single deploy is one build.

Workers AI is best-effort. Short-answer grading can fall back to the keyword
heuristic, so the exam remains usable when the daily allowance is exhausted.
There is no SLA on free model output quality; publish only packs that pass the
factory's validators and offline review.

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
- A paper with attempts cannot be deleted. Archive it instead so history and
  audio replay keep working.
- Play-count enforcement is a study affordance, not proctoring. A determined
  learner can reset local state or create another device. This is not suitable
  for high-stakes certification.

## Deliberate V1 limits

- No accounts, roles, classes, or cross-device history.
- No adaptive item selection or spaced repetition yet; the level recommendation
  is a simple rolling score heuristic.
- No teacher dashboard or PDF/CSV export yet. The admin endpoints are the
  machine interface.
- No human-signed sign-off workflow in the UI; the review verdict is produced
  offline and lines in `review.json`, while the admin page can archive/unpublish.
- Content is pre-generated. The Worker cannot run Torch or Kokoro.
- The bank is empty until an operator publishes packs.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Deployment and operations](docs/DEPLOYMENT.md)
- [Content factory](docs/CONTENT.md)

## License and credits

The application code is provided as-is for personal/educational use. Kokoro-82M
is used only by the offline content factory; see its model card for licensing.
