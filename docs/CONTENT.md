# Content factory

The Worker never generates content and never runs text-to-speech. A Python
factory writes a paper, narrates it with Kokoro, validates the result, runs an
offline editorial review, and imports it through the Worker's admin API. That
keeps request latency and memory predictable and lets the curated bank grow
while the app is offline.

## 1. Install

From `pipeline/`:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
```

The full install includes Kokoro, PyTorch, `numpy`, `lameenc`, and `soundfile`.
The first audio run downloads the Kokoro model; subsequent runs reuse the local
cache. If you only want to inspect topic cards or validate an existing pack, the
text-only commands still work without invoking Kokoro.

Verify:

```powershell
listening --help
python -m pytest -q
```

If the `listening` entry point is not on `PATH` (for example, you deliberately
did not install the package), use:

```powershell
$env:PYTHONPATH="src"
python -m listening_pipeline --help
```

## 2. Configure a writer model

Copy `pipeline/.env.example` to `pipeline/.env` and choose **one** provider group.
The factory tries providers in this order: Workers AI REST, Gemini, then OpenCode
(only when a key is set).

### Workers AI (recommended)

1. In the Cloudflare dashboard, copy the account ID from the Workers overview.
2. Create an API token at **My Profile → API Tokens → Create Token**.
3. Grant the token **Workers AI: Read** (the account-scoped template).
4. Fill in:

```dotenv
CF_ACCOUNT_ID=your-account-id
CF_API_TOKEN=your-workers-ai-read-token
CF_AI_MODEL=@cf/meta/llama-3.1-8b-instruct-fp8-fast
```

This uses the same Workers AI allowance as the deployed Worker, but generation is
done offline and does not consume request-path latency.

### Gemini

Create a key in Google AI Studio and set:

```dotenv
GEMINI_API_KEY=your-key
GEMINI_MODEL=gemini-3-flash
```

The model name is configurable because Google's model IDs change. Use a current
text model that supports JSON output. The factory sends
`responseMimeType: application/json` and parses the candidate parts.

### OpenCode

OpenCode's free tier is intentionally restricted to its own application and
returns `403 FreeTierError` to external clients. The factory therefore does not
use it unless you explicitly set a key for a paid/usable endpoint:

```dotenv
OPENCODE_BASE_URL=https://opencode.ai
OPENCODE_MODEL=deepseek-v4.1-flash-free
OPENCODE_API_KEY=your-key
```

If no provider is configured, the CLI exits with a clear error rather than
producing an unvalidated paper.

## 3. Inspect the scenario engine

```powershell
listening topics --kind both --level B1 --count 5 --seed 42
```

This prints structured cards, not prose. A card contains a domain, relationship,
setting, two goals, an obstacle, stakes, register, level, and concrete details
(names, times, objects, places). The writer model must use those specifics.

To remember cards across runs:

```powershell
listening topics --kind both --level B1 --count 5 --remember
```

`--remember` appends fingerprints to `out/topics.jsonl` (or `--store <path>`).
The generator also reads that file and refuses to reuse an existing scenario
fingerprint. Fingerprints include kind, level, domain, relationship, setting,
both goals, and the obstacle, so a repeat is detectable.

The domain pool is deliberately ordinary and non-sensational: workplace,
housing, travel, education, retail, health administration, transport, community,
family/friends, tech support, money/admin, hobbies, environment, and hospitality.
The validator also rejects a set of sensitive terms.

## 4. Generate

```powershell
listening generate --level B1 --accent mixed --count 1
```

Options:

| Option | Meaning |
|---|---|
| `--level` | `A2`, `B1`, `B2`, or `C1` |
| `--accent` | `us`, `uk`, or `mixed` |
| `--season` | Publishing season; default is the current UTC quarter (`YYYY-Qn`); `evergreen` is also accepted |
| `--seed` | Base seed for scenario sampling and voice choice |
| `--count` | Number of two-section papers |
| `--out` | Output root (default `out/`) |
| `--publish` | Import each pack after generation |
| `--draft` | Import as a draft instead of published |
| `--require-review` | Only publish if an approved `review.json` is present |
| `--replace` | Replace an existing paper with no attempts |
| `--api`, `--token` | Override the admin endpoint/token |

A paper always has:

- one monologue (first person, 3–5 paragraphs, 330–500 words depending on level),
- one dialogue (two speakers, 10–16 alternating turns, 250–450 words),
- five questions per passage, in this fixed blueprint:
  1. MCQ (detail),
  2. gap-fill (vocabulary),
  3. MCQ (inference or attitude),
  4. gap-fill (detail),
  5. short answer (inference/attitude).

The output directory is `out/<testId>/`:

```text
out/test_ab12cd34ef56/
  test.json              validated pack (contains answers; do not serve)
  audio/
    p_...mp3             one file per passage
```

The pack records its season in `test.json`. A pack without a season is treated
as the current season on import, so existing packs remain importable.

If a pack fails final validation, the factory writes `rejected.json` in the same
directory and leaves the audio for inspection. Fix the prompt, model, or scenario
and regenerate; do not import a rejected pack.

## 5. Validate

```powershell
listening validate out/<test-id>
```

`validate` re-loads `test.json` and runs the pack-level checks. It prints warnings
and returns a non-zero exit code on errors. The Worker repeats validation with the
shared Zod schema on import, so a pack cannot bypass the wire contract even if it
was made by another tool.

### Quality gates

The writer is retried up to three times with the validator's error list. The
important gates are:

- Word-count band for the level and passage type.
- Monologue: 3–5 paragraphs, first person, no speaker labels, one voice gender.
- Dialogue: exactly A/B turns, alternating, 10–16 turns, turn length limits.
- Exactly five questions in the blueprint order, at least three distinct skills.
- MCQ: four unique choices with keys a–d, answer key present, no
  all/none-of-the-above, distinct after normalisation, not conspicuously long.
- Gap-fill: prompt contains `___`, answer appears verbatim in the transcript,
  answer is not printed elsewhere in the prompt, 1–4 words, no duplicate variants.
- Short answer: expected answer is 2–4 sentences, 2–4 rubric criteria, no outside
  knowledge required.
- Markdown, emoji, AI/exam meta-language, and the banned-topic list are rejected.
- Audio key lives under `audio/<testId>/`, duration is under 15 minutes.
- Passage topic and audio key are unique within the pack; question IDs are
  globally unique inside the pack.

Warnings (for example, a very dense A2 passage or every MCQ answer on the same
key) do not block import but should be reviewed before publishing a large batch.

## 6. Offline editorial review

Validation checks form. Review checks whether the paper is actually right. The
reviewer is a second model pass that may use a different provider/model from the
writer (change provider settings in `pipeline/.env`, or run the review elsewhere).

```powershell
listening review out/<test-id>
```

The command writes `review.json` next to `test.json`:

```json
{
  "status": "approved",
  "score": 87,
  "judge": "workers-ai @cf/meta/llama-3.3-70b-instruct-fp8-fast",
  "reviewedAt": "2026-10-20T09:14:11.000Z",
  "notes": "Supported by the transcript; two minor wording notes..."
}
```

Rules used by the reviewer:

- It audits answer keys against the transcript, level fit, natural speech, item
  quality, distractor plausibility, and sensitive/dated subject matter.
- A verdict is approved only when the judge approves, the score reaches
  `--min-score` (default 80), and no blocker remains.
- Do not approve a pack because it is convenient. Rejected packs stay in `out/`
  for inspection; regenerate or repair them.

`publish --require-review` refuses to release a pack unless `review.json` says
`approved`. The Worker also rejects a direct publish import whose embedded
review is not approved. A draft can still be imported for inspection.

## 7. Narration

The factory uses Kokoro-82M through one cached `KPipeline` per language code:

- `a` = American English, `b` = British English.
- American voices: `af_heart`, `af_bella`, `af_nicole`, `af_sarah`,
  `am_michael`, `am_adam`, `am_onyx`.
- British voices: `bf_emma`, `bf_isabella`, `bm_george`, `bm_lewis`.
- A monologue uses the gender requested by the writer.
- A dialogue alternates a male and a female voice and keeps one accent for the
  whole passage. `mixed` chooses an accent for the passage, not a new accent on
  every turn.
- Speaking speed is level-aware: A2 0.93, B1 0.98, B2 1.02, C1 1.06.
- Short silences are inserted between paragraphs and speaker turns.
- The PCM stream is 24 kHz mono. `lameenc` encodes 64 kbps MP3; if `lameenc` is
  missing, the factory writes a WAV fallback and records the correct MIME type.

The pipeline is cached in-process. Do not construct a new pipeline per passage;
that was a major source of slow generation in the original app.

## 8. Publish

Start the Worker locally (or use the deployed URL), then:

```powershell
listening publish out/<test-id> --require-review --api http://localhost:8787 --token dev-admin-token
```

For the deployed Worker:

```powershell
listening publish out/<test-id> --require-review --api https://<worker-url> --token <ADMIN_TOKEN>
```

The command base64-encodes each MP3 and posts the pack plus audio to
`/api/admin/import`. The Worker:

1. validates the pack against the shared Zod contract,
2. refuses a direct published import whose review status is not approved,
3. checks that every passage has exactly one upload and that keys/MIMEs match,
4. checks keys are under `audio/<testId>/`,
5. caps the request and decoded audio size,
6. writes audio to R2 and the bank rows to D1,
7. returns the test ID, status, question count, and audio-file count.

A published pack becomes eligible for `/api/tests/next`. A draft is only visible
through `/api/admin/tests`; use the admin page or `publish` without `--draft` to
release it.

### Bulk generation

```powershell
listening generate --level B1 --accent mixed --count 10
listening review out/<test-id>
listening publish out/<test-id> --require-review --api https://<worker-url> --token <ADMIN_TOKEN>
```

For a large batch, generate first, then review and publish only the approved packs.
Each paper gets a new random ID. `--replace` only makes sense for a fixed pack
you are re-importing; generated IDs are new, so it is normally unnecessary.

## 9. Seasonal bank lifecycle

The bank is evergreen first, seasonal second. A season is a quarter, written as
`YYYY-Q1` through `YYYY-Q4`. The season is a publishing marker, not a fixture on
the paper itself: never put a visible seasonal reference in a transcript or
question. Papers should sound contemporary without naming a calendar year, a
news event, or a product version that will age badly.

The normal cycle is:

1. Add papers for the new quarter with `generate --season 2027-Q1` (or just use
   the default current quarter).
2. Validate and review them; publish with `--require-review`.
3. Let the current season's papers come first in selection.
4. At the end of the quarter, archive papers rather than deleting them:
   `POST /api/admin/tests/:id/archive` with `{"archived":true}`, or use the admin
   page's **Archive** button.
5. Restoring is the same endpoint with `{"archived":false}`.

Archived papers:

- do not appear in `/api/tests/next` for new attempts;
- remain readable through existing history/results so learners can review what
  they took;
- keep their audio in R2; deleting audio would break those result pages;
- are protected from deletion after their first attempt.


## 10. Bank-building advice

- Aim for a lot of good papers, not a flood of mediocre ones. A first bank of
  about 100 approved papers spreads well across A2–C1 and stays reusable across
  users; grow toward 500 over later seasons.
- Keep the per-level variety reasonable before expanding overall volume.
- Keep a single `out/topics.jsonl` for a given bank so fingerprints accumulate.
- Do not publish a batch until you have listened to at least a sample of the MP3s
  and checked that names, numbers, and gap-fill answers are audible.
- Do not rely on one writer to review its own work. Use a reviewer pass from a
  different model family when possible, and keep the sample-check yourself.
- Vary accents across the bank, but keep each passage internally consistent.
- The short-answer rubric is the most model-sensitive item. If a pack's rubric
  rewards outside knowledge or personal opinion, regenerate it rather than
  accepting a low-quality item.
- Keep the generated `out/` directory as the source of truth for re-imports and
  backups; it is gitignored by default.
- Treat a seasonal paper as replaceable. Archive it at the end of its cycle and
  add fresh scenarios; do not hide old content and forget to replace it.

## 11. Troubleshooting

### The model returns prose, not JSON

The factory tolerates fenced JSON and extracts the first object. If the model
still fails, it retries with the previous output and the validator's error list.
Lower the temperature only as a last resort; the prompts rely on a little
variation to avoid formulaic papers. A model that repeatedly fails the same gate
is usually too small for the item-writing task; use a stronger Workers AI model
or a current Gemini model.

### A gap-fill answer is marked missing

The answer must appear verbatim in the transcript (case and punctuation are
normalised, but inflection is not). Write the accepted variants explicitly. Do
not rely on stemming.

### A dialogue has a duplicate goal

The topic engine samples different goals for the two speakers. If a generated
dialogue still reads as two people pursuing the same objective, the writer
ignored the card; regenerate. The validator checks form, not dramatic coherence.

### Audio is silent or clipped

Check the Kokoro install and the voice name, then generate one passage with
`--verbose`. The factory logs word counts and output filenames. A WAV fallback is
valid but larger; install `lameenc` for production.

### The reviewer rejects too much

Start by looking at the actual issues in `review.json`, not the number. If the
majority are minor style notes, adjust `--min-score` slightly or regenerate only
the affected passage. If the reviewer flags answer keys, level fit, or implausible
speech, treat that as a writing problem rather than a review bug.

### A pack cannot be published even though review.json exists

`publish --require-review` checks for `approved` and the score threshold. A
rejected/out-of-date `review.json` must be regenerated after the pack is fixed;
`listening review out/<test-id>` overwrites it.

### Generation is slow

The first call downloads Kokoro and loads Torch. Later calls reuse the pipeline
and are much faster. A two-passage paper also makes two writer calls (plus
retries) and two TTS passes; that is expected offline work.
