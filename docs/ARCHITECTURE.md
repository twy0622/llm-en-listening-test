# Architecture

## Shape

One Cloudflare Worker serves both the built React SPA and `/api/*`. There is no
separate API host, no container, no database proxy, and no runtime text-to-speech.

```text
                         ┌─────────────────────────────────────────────┐
  browser ──────────────▶│ Cloudflare Worker: all-ears                 │
                         │                                             │
                         │  [assets]  apps/web/dist  (React SPA)       │
                         │  /api/*    Hono routes                      │
                         │                                             │
                         │  D1: tests, passages, questions, attempts,  │
                         │      answers, topics, rate_limits           │
                         │  R2: audio/<testId>/<passageId>.mp3         │
                         │  Workers AI: short-answer grading           │
                         └───────────────────┬─────────────────────────┘
                                             │
                   offline content factory   │   admin import (HMAC token)
                   Python + Kokoro ──────────┘   pack JSON + base64 audio
```

The static assets are configured in `apps/api/wrangler.toml` with
`not_found_handling = "single-page-application"` and
`run_worker_first = ["/api/*"]`. Non-API routes fall through to the SPA, so
`/exam`, `/results/:id`, `/history`, and `/admin` survive a refresh.

## Runtime request flow

### 1. Identity

`POST /api/device` issues a signed token with claims `{k:"device", d, exp}`.
The browser stores it in `localStorage`. No account, cookie, or email is needed.
The signature is HMAC-SHA-256 over a base64url payload with
`ATTEMPT_SECRET`.

`POST /api/tests/next` picks a published paper at the requested level (or the
device's recommended level). A small-bank fallback serves any published paper if
the requested/recommended level has none. The response contains only the public
test shape: no transcript, answer, explanation, rubric, or gap-fill variant.

`POST /api/attempts` creates the attempt, signs an attempt token
`{k:"attempt", d, a, exp}`, and returns the public test again. The deadline is
`started_at + duration_sec` and is stored in D1. The token is bound to both the
device and the attempt; a token for attempt A cannot be used on attempt B.

### 2. Exam

The client renders one passage at a time, keeping both sections mounted so the
audio player state survives navigation. Each recording may be started twice with
a 30-second gap; this is a study rule enforced client-side. Answers are kept in
React state and mirrored into `localStorage` under the attempt ID. The server
does not receive partial answers.

The countdown is computed from the server-issued `deadlineAt`. If the deadline
passes while the tab is open, the client auto-submits. The server independently
rejects a submission more than 60 seconds after the stored deadline, so closing
the tab does not buy extra time.

### 3. Submission and grading

`POST /api/attempts/:id/submit`:

1. Verifies the attempt token and device ownership.
2. Returns the existing result if the attempt is already submitted (idempotent).
3. Enforces the deadline plus grace.
4. Builds grading items from the **server's** question rows, ignoring unknown
   question IDs sent by the client.
5. Grades MCQs by key or exact answer text, gap-fill answers through the shared
   normaliser, and short answers through the LLM chain with a keyword fallback.
6. Writes one `answers` row per question and flips the attempt to `submitted` in
   a D1 batch.
7. Returns the full review payload: transcript, choices, correct answer,
   explanation, awarded points, feedback, and grading source.

`GET /api/attempts/:id` accepts either the attempt token or the device token, so
history remains reviewable after a browser restart. A different device receives
`403`.

### 4. History and recommendations

`GET /api/history` returns the device's attempts, aggregate stats, skill totals,
and a recommended level. The recommendation is intentionally simple: start at
B1, move up after a strong recent score, move down after a weak one. It is not a
CEFR assessment.

## Data model

| Table | Purpose | Notable constraints |
|---|---|---|
| `tests` | Paper metadata and publication state | `status` is `draft` or `published` |
| `passages` | Transcript, audio key, MIME, duration | unique `(test_id, position)` |
| `questions` | Prompt, choices JSON, answer JSON, skill, points | answer is server-only |
| `attempts` | Device, test, start, deadline, score | one row per exam session |
| `answers` | Response, awarded points, feedback, grader | unique `(attempt_id, question_id)` |
| `topics` | Imported scenario cards and fingerprints | unique fingerprint |
| `rate_limits` | Fixed-window counters | keyed by route + IP hash |

The D1 schema lives in `apps/api/migrations/0001_init.sql`. Migrations are
forward-only. A test with attempts cannot be deleted or replaced; this preserves
review links and foreign-key integrity.

## Answer-exposure invariants

The public payload is deliberately a separate shape from the pack:

- `toPublicTest()` in `apps/api/src/lib/exam.ts` builds every passage and
  question by hand. It never spreads a database row.
- `PublicQuestionSchema` has no `answer`, `explanation`, `skill` is allowed, and
  `choices` contain keys/text only.
- `apps/api/src/lib/exam.test.ts` serialises a public payload and fails if it
  contains `SECRET`, `answer`, `explanation`, or `transcript`.
- The full result shape is only produced after `status = 'submitted'`.
- Audio keys are not secret in the same way, but they are only disclosed after an
  attempt starts and are unguessable (`audio/<random test>/<random passage>.mp3`).

## Grading chain

```text
MCQ       ── exact key or normalised answer text ──▶ 1 or 0
gap-fill  ── normalise(case, punctuation, quotes) ──▶ accepted or 0
short     ── Workers AI JSON score ──▶ 1 / 0.5 / 0
              │ failure or no binding
              └── keyword coverage heuristic ──▶ 1 / 0.5 / 0
```

Only short answers ever call an LLM. That keeps grading fast and cheap, and means
the app remains usable with no model access at all.

The LLM prompt wraps the passage, question, expected answer, rubric, and learner
response in separate tags and explicitly says the learner response is untrusted.
The parser accepts fenced JSON and extracts the first object. A malformed model
response falls back to the heuristic instead of failing the submission.

## Offline content factory

See [CONTENT.md](CONTENT.md) for commands. The pipeline is:

```text
domain templates
      │
      ▼
structured topic card ── SHA-256 fingerprint ── topics.jsonl
      │
      ▼
writer prompt ── Workers AI / Gemini / OpenCode ── JSON passage + 5 questions
      │
      ▼
Pydantic model ── semantic validators (word counts, blanks, answers, banned topics)
      │
      ▼
Kokoro (cached pipeline) ── PCM 24 kHz ── lameenc ── 64 kbps MP3
      │
      ▼
test.json + audio/ ── `listening publish` ── Worker import
      │
      ▼
Zod TestPackSchema ── D1 batch + R2 objects ── published
```

The Worker re-validates every imported pack with the shared Zod contract. The
Python models and the Zod schemas are intentionally duplicated so a bug in one
gate does not silently ship bad content.

## Deployment topology and cost

- One Worker (`all-ears`) with static assets, D1, R2, and AI bindings.
- One D1 database and one R2 bucket per environment.
- A daily cron at 03:17 UTC deletes rate-limit rows older than a day and
  abandoned in-progress attempts older than a week.
- Audio is written once with `cache-control: public, max-age=31536000, immutable`
  and served with byte-range support.
- No request path runs Torch, Kokoro, ffmpeg, or a long-lived process.

Free allowances are documented in [DEPLOYMENT.md](DEPLOYMENT.md). The design
targets $0 for a personal/classroom deployment, but free tiers have quotas and no
SLA. Workers AI exhaustion degrades only short-answer grading.

## Failure modes

| Symptom | Likely cause | Response |
|---|---|---|
| `No published tests are available yet` | Empty bank or only drafts | Generate and publish a pack |
| Audio `404` | Wrong key prefix or missing R2 object | Re-publish; check `audio/<testId>/` |
| Submission `410 deadline_expired` | More than 60 s past the server deadline | Start a new attempt |
| Short answers graded `heuristic` | Workers AI unavailable or returned bad JSON | Expected fallback; no data loss |
| `403` on a result | Different device token | Use the original browser profile |
| Import `409` | Test exists / has attempts | Use a new pack or a draft without attempts |
| Import `413` | Base64 payload/audio too large | Shorten audio or split the pack |

## Why these choices

- **Single Worker instead of separate API + static host:** one origin, one
  deploy, no CORS in production, no cold server.
- **D1/R2 instead of KV:** relational attempts/answers and large immutable audio
  objects are the natural fit; KV has different consistency and size economics.
- **Pre-generated audio:** Workers cannot run Kokoro/Torch; request-time TTS
  would also be slow and fragile.
- **No accounts in V1:** signed device tokens remove signup friction while still
  protecting attempts and history. Accounts can be added later without changing
  the answer-exposure model.
- **Structured topic cards:** a static topic list quickly becomes repetitive.
  Domain templates plus fingerprints give a large, coherent scenario space.
- **Two validators:** the factory catches quality problems early; the Worker
  enforces the wire contract regardless of how a pack was produced.
