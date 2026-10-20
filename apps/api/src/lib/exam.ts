import {
  LEVELS,
  LevelSchema,
  type AttemptResult,
  type Choice,
  type CorrectAnswer,
  type Level,
  type PassageResult,
  type PublicPassage,
  type PublicTest,
  type QuestionResult,
  type SkillScore,
} from "@listening/shared";
import type { Env } from "../env";
import { notFound } from "./errors";
import type { AnswerRow, AttemptRow, PassageRow, QuestionRow, TestRow } from "./rows";

export interface TestContent {
  test: TestRow;
  passages: PassageRow[];
  questions: QuestionRow[];
}

export interface AttemptReview {
  attempt: AttemptRow;
  test: TestRow;
  passages: PassageRow[];
  questions: QuestionRow[];
  answers: AnswerRow[];
}

export async function loadTestContent(env: Env, testId: string): Promise<TestContent | null> {
  const test = await env.DB.prepare("SELECT * FROM tests WHERE id = ?")
    .bind(testId)
    .first<TestRow>();
  if (!test) return null;

  const [passages, questions] = await Promise.all([
    env.DB.prepare("SELECT * FROM passages WHERE test_id = ? ORDER BY position")
      .bind(testId)
      .all<PassageRow>(),
    env.DB.prepare("SELECT * FROM questions WHERE test_id = ? ORDER BY passage_id, position")
      .bind(testId)
      .all<QuestionRow>(),
  ]);

  return { test, passages: passages.results, questions: questions.results };
}

export async function loadAttemptReview(env: Env, attemptId: string): Promise<AttemptReview | null> {
  const attempt = await env.DB.prepare("SELECT * FROM attempts WHERE id = ?")
    .bind(attemptId)
    .first<AttemptRow>();
  if (!attempt) return null;

  const [test, passages, questions, answers] = await Promise.all([
    env.DB.prepare("SELECT * FROM tests WHERE id = ?").bind(attempt.test_id).first<TestRow>(),
    env.DB.prepare("SELECT * FROM passages WHERE test_id = ? ORDER BY position")
      .bind(attempt.test_id)
      .all<PassageRow>(),
    env.DB.prepare("SELECT * FROM questions WHERE test_id = ? ORDER BY passage_id, position")
      .bind(attempt.test_id)
      .all<QuestionRow>(),
    env.DB.prepare("SELECT * FROM answers WHERE attempt_id = ?")
      .bind(attemptId)
      .all<AnswerRow>(),
  ]);

  if (!test) return null;
  return {
    attempt,
    test,
    passages: passages.results,
    questions: questions.results,
    answers: answers.results,
  };
}

function parseChoices(question: QuestionRow): Choice[] {
  if (!question.choices_json) return [];
  try {
    const parsed = JSON.parse(question.choices_json) as Choice[];
    return parsed.sort((a, b) => a.key.localeCompare(b.key));
  } catch {
    return [];
  }
}

export function toPublicTest(content: TestContent): PublicTest {
  const questionsByPassage = new Map<string, QuestionRow[]>();
  for (const question of content.questions) {
    const list = questionsByPassage.get(question.passage_id) ?? [];
    list.push(question);
    questionsByPassage.set(question.passage_id, list);
  }

  const passages: PublicPassage[] = [...content.passages]
    .sort((a, b) => a.position - b.position)
    .map((passage) => ({
      id: passage.id,
      position: passage.position,
      type: passage.type,
      topic: passage.topic,
      audioUrl: `/api/audio/${passage.audio_key}`,
      audioDurationSec: passage.audio_duration_sec,
      questions: (questionsByPassage.get(passage.id) ?? [])
        .sort((a, b) => a.position - b.position)
        .map((question) => ({
          id: question.id,
          position: question.position,
          type: question.type,
          prompt: question.prompt,
          choices: question.type === "mcq" ? parseChoices(question) : undefined,
          skill: question.skill as PublicPassage["questions"][number]["skill"],
          points: question.points,
        })),
    }));

  return {
    id: content.test.id,
    title: content.test.title,
    level: LevelSchema.parse(content.test.level),
    accent: content.test.accent as PublicTest["accent"],
    durationSec: content.test.duration_sec,
    season: content.test.season as PublicTest["season"],
    passages,
  };
}

export function correctAnswerFor(question: QuestionRow): CorrectAnswer {
  let answer: Record<string, unknown> = {};
  try {
    answer = JSON.parse(question.answer_json) as Record<string, unknown>;
  } catch {
    answer = {};
  }

  if (question.type === "mcq") {
    const key = typeof answer.key === "string" ? answer.key : "";
    const choice = parseChoices(question).find((entry) => entry.key === key);
    return { kind: "mcq", key: key as CorrectAnswer["key"], text: choice?.text };
  }
  if (question.type === "gapfill") {
    return {
      kind: "gapfill",
      accepted: Array.isArray(answer.accepted)
        ? answer.accepted.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
  }
  return {
    kind: "subjective",
    expected: typeof answer.expected === "string" ? answer.expected : "",
    rubric: Array.isArray(answer.rubric)
      ? answer.rubric.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

export function buildResult(review: AttemptReview): AttemptResult {
  const answers = new Map(review.answers.map((answer) => [answer.question_id, answer]));
  const questionsByPassage = new Map<string, QuestionRow[]>();
  for (const question of review.questions) {
    const list = questionsByPassage.get(question.passage_id) ?? [];
    list.push(question);
    questionsByPassage.set(question.passage_id, list);
  }

  const skillTotals = new Map<string, { awarded: number; points: number }>();
  let score = 0;
  let maxScore = 0;

  const passages: PassageResult[] = [...review.passages]
    .sort((a, b) => a.position - b.position)
    .map((passage) => {
      const questions: QuestionResult[] = (questionsByPassage.get(passage.id) ?? [])
        .sort((a, b) => a.position - b.position)
        .map((question) => {
          const answer = answers.get(question.id);
          const awarded = answer?.awarded ?? 0;
          const points = question.points;
          score += awarded;
          maxScore += points;

          const totals = skillTotals.get(question.skill) ?? { awarded: 0, points: 0 };
          totals.awarded += awarded;
          totals.points += points;
          skillTotals.set(question.skill, totals);

          return {
            questionId: question.id,
            position: question.position,
            type: question.type,
            prompt: question.prompt,
            choices: question.type === "mcq" ? parseChoices(question) : undefined,
            skill: question.skill as QuestionResult["skill"],
            response: answer?.response ?? "",
            correct: correctAnswerFor(question),
            awarded: round(awarded),
            points,
            explanation: question.explanation,
            feedback: answer?.feedback ?? null,
            gradedBy: answer?.graded_by ?? "exact",
          };
        });

      return {
        id: passage.id,
        position: passage.position,
        type: passage.type,
        topic: passage.topic,
        transcript: passage.transcript,
        audioUrl: `/api/audio/${passage.audio_key}`,
        questions,
      };
    });

  const skills: SkillScore[] = [...skillTotals.entries()]
    .map(([skill, totals]) => ({
      skill: skill as SkillScore["skill"],
      awarded: round(totals.awarded),
      points: round(totals.points),
      percentage: totals.points === 0 ? 0 : round((totals.awarded / totals.points) * 100, 1),
    }))
    .sort((a, b) => a.skill.localeCompare(b.skill));

  const started = Date.parse(review.attempt.started_at);
  const submitted = Date.parse(review.attempt.submitted_at ?? new Date().toISOString());

  return {
    attemptId: review.attempt.id,
    testId: review.test.id,
    title: review.test.title,
    level: LevelSchema.parse(review.test.level),
    status: "submitted",
    season: review.test.season as AttemptResult["season"],
    score: round(score),
    maxScore: round(maxScore),
    percentage: maxScore === 0 ? 0 : round((score / maxScore) * 100, 1),
    startedAt: review.attempt.started_at,
    submittedAt: review.attempt.submitted_at ?? new Date().toISOString(),
    durationUsedSec: Math.max(0, Math.round((submitted - started) / 1000)),
    skills,
    passages,
  };
}

export async function loadResult(env: Env, attemptId: string): Promise<AttemptResult | null> {
  const review = await loadAttemptReview(env, attemptId);
  if (!review || review.attempt.status !== "submitted") return null;
  return buildResult(review);
}

export async function requirePublishedTest(env: Env, testId: string): Promise<TestContent> {
  const content = await loadTestContent(env, testId);
  if (!content || content.test.status !== "published" || content.test.archived_at) {
    throw notFound("Test not found");
  }
  return content;
}

const NEXT_LEVEL: Record<Level, Level> = { A2: "B1", B1: "B2", B2: "C1", C1: "C1" };
const PREVIOUS_LEVEL: Record<Level, Level> = { A2: "A2", B1: "A2", B2: "B1", C1: "B2" };

export async function recommendLevel(env: Env, deviceId: string): Promise<Level> {
  const recent = await env.DB.prepare(
    `SELECT t.level, a.score, a.max_score
       FROM attempts a JOIN tests t ON t.id = a.test_id
      WHERE a.device_id = ? AND a.status = 'submitted' AND a.max_score > 0
      ORDER BY a.started_at DESC LIMIT 5`,
  )
    .bind(deviceId)
    .all<{ level: string; score: number; max_score: number }>();

  if (recent.results.length === 0) return "B1";
  const average =
    recent.results.reduce((sum, row) => sum + row.score / row.max_score, 0) / recent.results.length;
  const latest = LevelSchema.catch("B1").parse(recent.results[0]?.level);
  if (average >= 0.85) return NEXT_LEVEL[latest];
  if (average <= 0.55) return PREVIOUS_LEVEL[latest];
  return latest;
}

export async function skillTotalsForDevice(env: Env, deviceId: string): Promise<SkillScore[]> {
  const rows = await env.DB.prepare(
    `SELECT q.skill AS skill, SUM(ans.awarded) AS awarded, SUM(q.points) AS points
       FROM answers ans
       JOIN questions q ON q.id = ans.question_id
       JOIN attempts a ON a.id = ans.attempt_id
      WHERE a.device_id = ? AND a.status = 'submitted'
      GROUP BY q.skill`,
  )
    .bind(deviceId)
    .all<{ skill: string; awarded: number; points: number }>();

  return rows.results
    .map((row) => ({
      skill: row.skill as SkillScore["skill"],
      awarded: round(row.awarded ?? 0),
      points: round(row.points ?? 0),
      percentage: row.points ? round(((row.awarded ?? 0) / row.points) * 100, 1) : 0,
    }))
    .sort((a, b) => a.skill.localeCompare(b.skill));
}

export const levelOrder = LEVELS;
