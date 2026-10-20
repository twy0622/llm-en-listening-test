import { Hono } from "hono";
import { z } from "zod";
import { ImportRequestSchema, seasonForDate, type AdminTest } from "@listening/shared";
import type { AppEnv } from "../env";
import { requireAdmin } from "../lib/auth";
import { ApiError, badRequest, conflict, notFound } from "../lib/errors";
import { parseJsonBody } from "../lib/http";
import { sha256Hex } from "../lib/tokens";

const router = new Hono<AppEnv>();

const MAX_IMPORT_BYTES = 30 * 1024 * 1024;
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

const PublishSchema = z.object({ published: z.boolean() });
const ArchiveSchema = z.object({ archived: z.boolean() });

router.get("/tests", requireAdmin, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.title, t.level, t.accent, t.status, t.season,
            t.archived_at AS archivedAt, t.review_status AS reviewStatus,
            t.review_score AS reviewScore, t.created_at AS createdAt,
            (SELECT COUNT(*) FROM passages p WHERE p.test_id = t.id) AS passages,
            (SELECT COUNT(*) FROM questions q WHERE q.test_id = t.id) AS questions,
            (SELECT COUNT(*) FROM attempts a WHERE a.test_id = t.id) AS attempts
       FROM tests t
      ORDER BY t.created_at DESC
      LIMIT 200`,
  ).all<AdminTest>();

  return c.json({ tests: rows.results });
});

router.get("/topics", requireAdmin, async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, kind, domain, level, status, created_at AS createdAt
       FROM topics ORDER BY created_at DESC LIMIT 200`,
  ).all();
  return c.json({ topics: rows.results });
});

router.post("/import", requireAdmin, async (c) => {
  const declared = Number(c.req.header("content-length") ?? "0");
  if (declared > MAX_IMPORT_BYTES) {
    throw new ApiError(413, "Import payload is too large", "payload_too_large");
  }

  const body = await parseJsonBody(c, ImportRequestSchema);
  const { test: pack, audio } = body;

  if (body.publish && pack.review && pack.review.status !== "approved") {
    throw conflict("This pack has not passed editorial review; import it as a draft or review it first");
  }

  const audioByKey = new Map(audio.map((entry) => [entry.key, entry]));
  if (audioByKey.size !== audio.length) throw badRequest("Duplicate audio keys");

  const expectedKeys = new Set(pack.passages.map((passage) => passage.audio.key));
  if (expectedKeys.size !== audio.length) {
    throw badRequest("Audio uploads must match the pack's passage audio keys exactly");
  }

  let estimatedBytes = 0;
  for (const passage of pack.passages) {
    const upload = audioByKey.get(passage.audio.key);
    if (!upload) throw badRequest(`Missing audio for passage ${passage.id}`);
    if (upload.mime !== passage.audio.mime) {
      throw badRequest(`Audio MIME mismatch for ${passage.id}`);
    }
    if (!passage.audio.key.startsWith(`audio/${pack.id}/`) || passage.audio.key.includes("..")) {
      throw badRequest("Audio keys must live under audio/<testId>/");
    }
    estimatedBytes += Math.floor((upload.dataBase64.length * 3) / 4);
  }
  if (estimatedBytes > MAX_AUDIO_BYTES) {
    throw new ApiError(413, "Audio is too large (max 24 MB decoded)", "payload_too_large");
  }

  const existing = await c.env.DB.prepare("SELECT id FROM tests WHERE id = ?")
    .bind(pack.id)
    .first<{ id: string }>();

  if (existing) {
    if (!body.replace) throw conflict(`Test ${pack.id} already exists`);
    const attempts = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM attempts WHERE test_id = ?")
      .bind(pack.id)
      .first<{ count: number }>();
    if ((attempts?.count ?? 0) > 0) {
      throw conflict("Refusing to replace a test that already has attempts");
    }
    const oldAudio = await c.env.DB.prepare("SELECT audio_key AS key FROM passages WHERE test_id = ?")
      .bind(pack.id)
      .all<{ key: string }>();
    await c.env.DB.prepare("DELETE FROM tests WHERE id = ?").bind(pack.id).run();
    await Promise.all(oldAudio.results.map((row) => c.env.AUDIO.delete(row.key)));
  }

  const uploaded: string[] = [];
  try {
    for (const upload of audio) {
      const bytes = decodeBase64(upload.dataBase64);
      await c.env.AUDIO.put(upload.key, bytes, {
        httpMetadata: {
          contentType: upload.mime,
          cacheControl: "public, max-age=31536000, immutable",
        },
      });
      uploaded.push(upload.key);
    }

    const now = new Date().toISOString();
    const statements: D1PreparedStatement[] = [];
    const status = body.publish ? "published" : "draft";
    const review = pack.review;
    const reviewStatus = review?.status ?? "approved";

    statements.push(
      c.env.DB.prepare(
        `INSERT INTO tests
           (id, title, level, accent, duration_sec, schema_version, status, season,
            review_status, review_score, review_notes, reviewed_at, created_at, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        pack.id,
        pack.title,
        pack.level,
        pack.accent,
        pack.durationSec,
        pack.schemaVersion,
        status,
        pack.season ?? seasonForDate(),
        reviewStatus,
        review?.score ?? null,
        review?.notes ?? null,
        review?.reviewedAt ?? null,
        pack.createdAt,
        body.publish ? now : null,
      ),
    );

    for (const passage of pack.passages) {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO passages
             (id, test_id, position, type, topic, transcript, audio_key, audio_mime, audio_duration_sec, voice)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          passage.id,
          pack.id,
          passage.position,
          passage.type,
          passage.topic,
          passage.transcript,
          passage.audio.key,
          passage.audio.mime,
          passage.audio.durationSec,
          null,
        ),
      );

      for (const question of passage.questions) {
        statements.push(
          c.env.DB.prepare(
            `INSERT INTO questions
               (id, test_id, passage_id, position, type, prompt, choices_json, answer_json,
                explanation, skill, points)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            question.id,
            pack.id,
            passage.id,
            question.position,
            question.type,
            question.prompt,
            question.type === "mcq" ? JSON.stringify(question.choices) : null,
            JSON.stringify(question.answer),
            question.explanation,
            question.skill,
            question.points,
          ),
        );
      }

      if (passage.topicCard) {
        const card = passage.topicCard;
        const fingerprint = await sha256Hex(
          [card.domain, card.relationship, card.setting, card.goalA, card.goalB, card.obstacle].join("|"),
        );
        statements.push(
          c.env.DB.prepare(
            `INSERT OR IGNORE INTO topics
               (id, kind, domain, fingerprint, card_json, level, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, 'approved', ?)`,
          ).bind(card.id, card.kind, card.domain, fingerprint, JSON.stringify(card), card.level, now),
        );
      }
    }

    await c.env.DB.batch(statements);

    return c.json({
      ok: true,
      testId: pack.id,
      status,
      passages: pack.passages.length,
      questions: pack.passages.reduce((sum, passage) => sum + passage.questions.length, 0),
      audioFiles: uploaded.length,
    });
  } catch (error) {
    // Do not leave orphaned audio if the D1 write failed.
    await Promise.all(uploaded.map((key) => c.env.AUDIO.delete(key).catch(() => undefined)));
    throw error;
  }
});

router.post("/tests/:id/publish", requireAdmin, async (c) => {
  const body = await parseJsonBody(c, PublishSchema);
  const result = await c.env.DB.prepare(
    "UPDATE tests SET status = ?, published_at = ? WHERE id = ?",
  )
    .bind(body.published ? "published" : "draft", body.published ? new Date().toISOString() : null, c.req.param("id"))
    .run();

  if (!result.meta.changes) throw notFound("Test not found");
  return c.json({ ok: true, published: body.published });
});

router.post("/tests/:id/archive", requireAdmin, async (c) => {
  const body = await parseJsonBody(c, ArchiveSchema);
  const result = await c.env.DB.prepare(
    "UPDATE tests SET archived_at = ? WHERE id = ?",
  )
    .bind(body.archived ? new Date().toISOString() : null, c.req.param("id"))
    .run();

  if (!result.meta.changes) throw notFound("Test not found");
  return c.json({ ok: true, archived: body.archived });
});

router.delete("/tests/:id", requireAdmin, async (c) => {
  const testId = c.req.param("id");
  const attempts = await c.env.DB.prepare("SELECT COUNT(*) AS count FROM attempts WHERE test_id = ?")
    .bind(testId)
    .first<{ count: number }>();
  if ((attempts?.count ?? 0) > 0) {
    throw conflict("Refusing to delete a test that has attempts");
  }
  const audio = await c.env.DB.prepare("SELECT audio_key AS key FROM passages WHERE test_id = ?")
    .bind(testId)
    .all<{ key: string }>();
  const result = await c.env.DB.prepare("DELETE FROM tests WHERE id = ?").bind(testId).run();
  if (!result.meta.changes) throw notFound("Test not found");
  await Promise.all(audio.results.map((row) => c.env.AUDIO.delete(row.key)));
  return c.json({ ok: true });
});

export default router;
