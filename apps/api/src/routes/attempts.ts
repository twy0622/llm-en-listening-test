import { Hono } from "hono";
import {
  StartAttemptRequestSchema,
  SubmitAttemptRequestSchema,
  type AttemptResult,
} from "@listening/shared";
import type { AppEnv } from "../env";
import { requireAttempt, requireAttemptOrDevice, requireDevice, assertOwner } from "../lib/auth";
import { ApiError, conflict, forbidden, notFound } from "../lib/errors";
import { enforceRateLimit, parseJsonBody } from "../lib/http";
import { loadAttemptReview, loadResult, requirePublishedTest, toPublicTest } from "../lib/exam";
import { gradeItems } from "../lib/grading";
import { newId, signToken, unixNow } from "../lib/tokens";

const router = new Hono<AppEnv>();

router.post("/", requireDevice, async (c) => {
  await enforceRateLimit(c, "attempt-start", 12, 60);
  const body = await parseJsonBody(c, StartAttemptRequestSchema);
  const content = await requirePublishedTest(c.env, body.testId);

  if (content.questions.length === 0) {
    throw conflict("This test has no questions yet");
  }

  const now = Date.now();
  const startedAt = new Date(now).toISOString();
  const deadlineAt = new Date(now + content.test.duration_sec * 1000).toISOString();
  const attemptId = newId("att");

  // Tidy up attempts that were abandoned long ago so history stays readable.
  await c.env.DB.prepare(
    "DELETE FROM attempts WHERE device_id = ? AND status = 'in_progress' AND deadline_at < ?",
  )
    .bind(c.get("deviceId"), new Date(now - 24 * 60 * 60 * 1000).toISOString())
    .run();

  await c.env.DB.prepare(
    `INSERT INTO attempts
       (id, test_id, device_id, started_at, deadline_at, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'in_progress', ?)`,
  )
    .bind(attemptId, content.test.id, c.get("deviceId"), startedAt, deadlineAt, startedAt)
    .run();

  const token = await signToken(c.env.ATTEMPT_SECRET, {
    k: "attempt",
    d: c.get("deviceId"),
    a: attemptId,
    // Long enough to review the result later; the exam deadline is enforced
    // separately when grades are written.
    exp: unixNow() + 30 * 24 * 60 * 60,
  });

  return c.json({
    attemptId,
    token,
    startedAt,
    deadlineAt,
    test: toPublicTest(content),
  });
});

router.post("/:id/submit", requireAttempt, async (c) => {
  await enforceRateLimit(c, "attempt-submit", 20, 60);
  const body = await parseJsonBody(c, SubmitAttemptRequestSchema);

  const review = await loadAttemptReview(c.env, c.req.param("id"));
  if (!review) throw notFound("Attempt not found");
  assertOwner(review.attempt.device_id, c.get("deviceId"));

  if (review.attempt.status === "submitted") {
    const existing = await loadResult(c.env, review.attempt.id);
    if (!existing) throw new ApiError(500, "Submitted attempt could not be loaded");
    return c.json(existing);
  }

  // The browser timer is a convenience; the deadline is enforced here so a
  // paused/offline tab cannot keep answering indefinitely. A short grace
  // window absorbs slow auto-submit requests.
  const deadlineMs = Date.parse(review.attempt.deadline_at);
  const deadlineGraceMs = 60_000;
  if (Number.isFinite(deadlineMs) && Date.now() > deadlineMs + deadlineGraceMs) {
    throw new ApiError(
      410,
      "The exam timer has expired. Start a new test from the home page.",
      "deadline_expired",
    );
  }

  const responseByQuestion = new Map<string, string>();
  for (const answer of body.answers) responseByQuestion.set(answer.questionId, answer.response);

  const transcriptByPassage = new Map(review.passages.map((p) => [p.id, p.transcript]));
  const items = review.questions.map((question) => ({
    question,
    response: responseByQuestion.get(question.id) ?? "",
    transcript: transcriptByPassage.get(question.passage_id) ?? "",
  }));

  const graded = await gradeItems(c.env, items);
  const now = new Date().toISOString();
  let score = 0;
  let maxScore = 0;
  const statements: D1PreparedStatement[] = [];

  for (const item of items) {
    const outcome = graded.get(item.question.id) ?? {
      awarded: 0,
      isCorrect: false,
      feedback: "Not graded",
      gradedBy: "exact" as const,
    };
    score += outcome.awarded;
    maxScore += item.question.points;
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO answers
           (id, attempt_id, question_id, response, is_correct, awarded, feedback, graded_by, graded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(attempt_id, question_id) DO UPDATE SET
           response = excluded.response,
           is_correct = excluded.is_correct,
           awarded = excluded.awarded,
           feedback = excluded.feedback,
           graded_by = excluded.graded_by,
           graded_at = excluded.graded_at`,
      ).bind(
        newId("ans"),
        review.attempt.id,
        item.question.id,
        item.response.slice(0, 3000),
        outcome.isCorrect ? 1 : 0,
        outcome.awarded,
        outcome.feedback,
        outcome.gradedBy,
        now,
      ),
    );
  }

  const started = Date.parse(review.attempt.started_at);
  const durationUsedSec = Math.max(0, Math.round((Date.now() - started) / 1000));

  statements.push(
    c.env.DB.prepare(
      `UPDATE attempts
          SET status = 'submitted', submitted_at = ?, score = ?, max_score = ?, duration_used_sec = ?
        WHERE id = ? AND status = 'in_progress'`,
    ).bind(now, score, maxScore, durationUsedSec, review.attempt.id),
  );

  await c.env.DB.batch(statements);

  const result: AttemptResult | null = await loadResult(c.env, review.attempt.id);
  if (!result) throw new ApiError(500, "The attempt was graded but could not be loaded");
  return c.json(result);
});

router.get("/:id", requireAttemptOrDevice, async (c) => {
  const review = await loadAttemptReview(c.env, c.req.param("id"));
  if (!review) throw notFound("Attempt not found");
  assertOwner(review.attempt.device_id, c.get("deviceId"));

  if (review.attempt.status === "submitted") {
    const result = await loadResult(c.env, review.attempt.id);
    if (!result) throw notFound("Result not found");
    return c.json(result);
  }

  return c.json({
    attemptId: review.attempt.id,
    status: "in_progress" as const,
    startedAt: review.attempt.started_at,
    deadlineAt: review.attempt.deadline_at,
  });
});

router.post("/:id/abandon", requireAttempt, async (c) => {
  const review = await loadAttemptReview(c.env, c.req.param("id"));
  if (!review) throw notFound("Attempt not found");
  assertOwner(review.attempt.device_id, c.get("deviceId"));
  if (review.attempt.status !== "in_progress") throw forbidden("Attempt already submitted");
  await c.env.DB.prepare("DELETE FROM attempts WHERE id = ?").bind(review.attempt.id).run();
  return c.json({ ok: true });
});

export default router;
