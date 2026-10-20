import { z } from "zod";

/* -------------------------------------------------------------------------- */
/*  Primitives                                                                */
/* -------------------------------------------------------------------------- */

export const LEVELS = ["A2", "B1", "B2", "C1"] as const;
export const LevelSchema = z.enum(LEVELS);
export type Level = z.infer<typeof LevelSchema>;

export const ACCENTS = ["us", "uk", "mixed"] as const;
export const AccentSchema = z.enum(ACCENTS);
export type Accent = z.infer<typeof AccentSchema>;

export const PassageTypeSchema = z.enum(["monologue", "dialogue"]);
export type PassageType = z.infer<typeof PassageTypeSchema>;

/** A paper belongs to a quarterly publishing season, or to the evergreen core. */
export const SeasonSchema = z
  .string()
  .regex(/^(evergreen|\d{4}-Q[1-4])$/, "season must be evergreen or YYYY-Q1..Q4");
export type Season = z.infer<typeof SeasonSchema>;

export const ReviewStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const PackReviewSchema = z.object({
  status: ReviewStatusSchema,
  score: z.number().min(0).max(100).optional(),
  judge: z.string().min(1).max(160).optional(),
  reviewedAt: z.string().datetime().optional(),
  notes: z.string().max(4000).optional(),
});
export type PackReview = z.infer<typeof PackReviewSchema>;

export const QuestionTypeSchema = z.enum(["mcq", "gapfill", "subjective"]);
export type QuestionType = z.infer<typeof QuestionTypeSchema>;

export const SkillSchema = z.enum([
  "gist",
  "detail",
  "inference",
  "attitude",
  "vocabulary",
  "function",
  "organization",
]);
export type Skill = z.infer<typeof SkillSchema>;

const ChoiceKeySchema = z.enum(["a", "b", "c", "d"]);
export type ChoiceKey = z.infer<typeof ChoiceKeySchema>;

export const ChoiceSchema = z.object({
  key: ChoiceKeySchema,
  text: z.string().min(1).max(240),
});
export type Choice = z.infer<typeof ChoiceSchema>;

/* -------------------------------------------------------------------------- */
/*  Topic cards: the deterministic seed for a passage                         */
/* -------------------------------------------------------------------------- */

export const TopicCardSchema = z.object({
  id: z.string().min(4),
  kind: PassageTypeSchema,
  domain: z.string().min(2),
  relationship: z.string().min(2),
  setting: z.string().min(2),
  goalA: z.string().min(2),
  goalB: z.string().min(2),
  obstacle: z.string().min(2),
  stakes: z.string().min(2),
  register: z.string().min(2),
  level: LevelSchema,
  /** Concrete details the writer must use: names, numbers, props. */
  details: z.array(z.string().min(1)).min(1).max(8),
});
export type TopicCard = z.infer<typeof TopicCardSchema>;

/* -------------------------------------------------------------------------- */
/*  Content factory output (contains answers; never send to the browser)      */
/* -------------------------------------------------------------------------- */

const QuestionBase = {
  id: z.string().min(3).max(64),
  position: z.number().int().min(1).max(20),
  prompt: z.string().min(5).max(600),
  explanation: z.string().min(3).max(800),
  skill: SkillSchema,
  points: z.number().positive().max(5).default(1),
};

const McqQuestionSchema = z.object({
  ...QuestionBase,
  type: z.literal("mcq"),
  choices: z.array(ChoiceSchema).length(4),
  answer: z.object({ key: ChoiceKeySchema }),
});

const GapfillQuestionSchema = z.object({
  ...QuestionBase,
  type: z.literal("gapfill"),
  answer: z.object({
    accepted: z.array(z.string().min(1).max(120)).min(1).max(8),
  }),
});

const SubjectiveQuestionSchema = z.object({
  ...QuestionBase,
  type: z.literal("subjective"),
  answer: z.object({
    expected: z.string().min(10).max(1200),
    rubric: z.array(z.string().min(2).max(240)).min(1).max(8),
  }),
});

export const QuestionPackSchema = z
  .discriminatedUnion("type", [
    McqQuestionSchema,
    GapfillQuestionSchema,
    SubjectiveQuestionSchema,
  ])
  .superRefine((q, ctx) => {
    if (q.type === "mcq") {
      const keys = new Set(q.choices.map((c) => c.key));
      if (keys.size !== 4) {
        ctx.addIssue({ code: "custom", message: "MCQ choices must have unique keys a-d" });
      }
      const texts = new Set(q.choices.map((c) => c.text.trim().toLowerCase()));
      if (texts.size !== 4) {
        ctx.addIssue({ code: "custom", message: "MCQ choices must be distinct" });
      }
      if (!keys.has(q.answer.key)) {
        ctx.addIssue({ code: "custom", message: "MCQ answer key is not one of the choices" });
      }
    } else if (q.type === "gapfill" && !/_{3,}/.test(q.prompt)) {
      ctx.addIssue({ code: "custom", message: "Gap-fill prompt must contain a blank (___)" });
    }
  });
export type QuestionPack = z.infer<typeof QuestionPackSchema>;

export const AudioRefSchema = z.object({
  key: z
    .string()
    .min(5)
    .max(200)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9/_.-]*\.(mp3|wav|ogg)$/, "invalid audio key"),
  mime: z.enum(["audio/mpeg", "audio/wav", "audio/ogg"]),
  durationSec: z.number().positive().max(1800),
});
export type AudioRef = z.infer<typeof AudioRefSchema>;

export const PassagePackSchema = z.object({
  id: z.string().min(3).max(64),
  position: z.number().int().min(1).max(8),
  type: PassageTypeSchema,
  topic: z.string().min(3).max(300),
  transcript: z.string().min(80).max(12000),
  audio: AudioRefSchema,
  topicCard: TopicCardSchema.optional(),
  questions: z.array(QuestionPackSchema).min(1).max(12),
});
export type PassagePack = z.infer<typeof PassagePackSchema>;

export const TestPackSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().min(5).max(80),
    title: z.string().min(3).max(160),
    level: LevelSchema,
    accent: AccentSchema,
    durationSec: z.number().int().min(120).max(3600),
    createdAt: z.string().datetime(),
    season: SeasonSchema.optional(),
    review: PackReviewSchema.optional(),
    passages: z.array(PassagePackSchema).min(1).max(4),
  })
  .superRefine((pack, ctx) => {
    if (new Set(pack.passages.map((p) => p.id)).size !== pack.passages.length) {
      ctx.addIssue({ code: "custom", message: "passage ids must be unique" });
    }
    if (new Set(pack.passages.map((p) => p.position)).size !== pack.passages.length) {
      ctx.addIssue({ code: "custom", message: "passage positions must be unique" });
    }
    const ids = pack.passages.flatMap((p) => p.questions.map((q) => q.id));
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "question ids must be unique across the pack" });
    }
    const positions = pack.passages.map((p) => p.position).sort((a, b) => a - b);
    if (positions.some((p, i) => p !== i + 1)) {
      ctx.addIssue({ code: "custom", message: "passage positions must be contiguous from 1" });
    }
  });
export type TestPack = z.infer<typeof TestPackSchema>;

/* -------------------------------------------------------------------------- */
/*  Wire formats (safe to send before submission: no answers, no transcript)  */
/* -------------------------------------------------------------------------- */

export const PublicQuestionSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  type: QuestionTypeSchema,
  prompt: z.string(),
  choices: z.array(ChoiceSchema).optional(),
  skill: SkillSchema,
  points: z.number(),
});
export type PublicQuestion = z.infer<typeof PublicQuestionSchema>;

export const PublicPassageSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  type: PassageTypeSchema,
  topic: z.string(),
  audioUrl: z.string(),
  audioDurationSec: z.number(),
  questions: z.array(PublicQuestionSchema),
});
export type PublicPassage = z.infer<typeof PublicPassageSchema>;

export const PublicTestSchema = z.object({
  id: z.string(),
  title: z.string(),
  level: LevelSchema,
  accent: AccentSchema,
  durationSec: z.number().int(),
  season: SeasonSchema.nullable().optional(),
  passages: z.array(PublicPassageSchema),
});
export type PublicTest = z.infer<typeof PublicTestSchema>;

/* -------------------------------------------------------------------------- */
/*  Attempts                                                                  */
/* -------------------------------------------------------------------------- */

export const StartAttemptRequestSchema = z.object({
  testId: z.string().min(1),
});
export type StartAttemptRequest = z.infer<typeof StartAttemptRequestSchema>;

export const StartAttemptResponseSchema = z.object({
  attemptId: z.string(),
  token: z.string(),
  startedAt: z.string(),
  deadlineAt: z.string(),
  test: PublicTestSchema,
});
export type StartAttemptResponse = z.infer<typeof StartAttemptResponseSchema>;

export const AnswerInputSchema = z.object({
  questionId: z.string(),
  response: z.string().max(4000),
});
export type AnswerInput = z.infer<typeof AnswerInputSchema>;

export const SubmitAttemptRequestSchema = z.object({
  answers: z.array(AnswerInputSchema).max(200),
});
export type SubmitAttemptRequest = z.infer<typeof SubmitAttemptRequestSchema>;

export const CorrectAnswerSchema = z.object({
  kind: QuestionTypeSchema,
  key: ChoiceKeySchema.optional(),
  text: z.string().optional(),
  accepted: z.array(z.string()).optional(),
  expected: z.string().optional(),
  rubric: z.array(z.string()).optional(),
});
export type CorrectAnswer = z.infer<typeof CorrectAnswerSchema>;

export const QuestionResultSchema = z.object({
  questionId: z.string(),
  position: z.number().int(),
  type: QuestionTypeSchema,
  prompt: z.string(),
  choices: z.array(ChoiceSchema).optional(),
  skill: SkillSchema,
  response: z.string(),
  correct: CorrectAnswerSchema,
  awarded: z.number(),
  points: z.number(),
  explanation: z.string(),
  feedback: z.string().nullable(),
  gradedBy: z.enum(["exact", "llm", "heuristic"]),
});
export type QuestionResult = z.infer<typeof QuestionResultSchema>;

export const PassageResultSchema = z.object({
  id: z.string(),
  position: z.number().int(),
  type: PassageTypeSchema,
  topic: z.string(),
  transcript: z.string(),
  audioUrl: z.string(),
  questions: z.array(QuestionResultSchema),
});
export type PassageResult = z.infer<typeof PassageResultSchema>;

export const SkillScoreSchema = z.object({
  skill: SkillSchema,
  awarded: z.number(),
  points: z.number(),
  percentage: z.number(),
});
export type SkillScore = z.infer<typeof SkillScoreSchema>;

export const AttemptResultSchema = z.object({
  attemptId: z.string(),
  testId: z.string(),
  title: z.string(),
  level: LevelSchema,
  status: z.literal("submitted"),
  season: SeasonSchema.nullable().optional(),
  score: z.number(),
  maxScore: z.number(),
  percentage: z.number(),
  startedAt: z.string(),
  submittedAt: z.string(),
  durationUsedSec: z.number().int(),
  skills: z.array(SkillScoreSchema),
  passages: z.array(PassageResultSchema),
});
export type AttemptResult = z.infer<typeof AttemptResultSchema>;

export const InProgressAttemptSchema = z.object({
  attemptId: z.string(),
  status: z.literal("in_progress"),
  startedAt: z.string(),
  deadlineAt: z.string(),
});
export type InProgressAttempt = z.infer<typeof InProgressAttemptSchema>;

/* -------------------------------------------------------------------------- */
/*  History                                                                   */
/* -------------------------------------------------------------------------- */

export const HistoryItemSchema = z.object({
  attemptId: z.string(),
  testId: z.string(),
  title: z.string(),
  level: LevelSchema,
  startedAt: z.string(),
  submittedAt: z.string().nullable(),
  status: z.enum(["in_progress", "submitted"]),
  score: z.number().nullable(),
  maxScore: z.number().nullable(),
  percentage: z.number().nullable(),
});
export type HistoryItem = z.infer<typeof HistoryItemSchema>;

export const HistoryResponseSchema = z.object({
  deviceId: z.string(),
  attempts: z.array(HistoryItemSchema),
  stats: z.object({
    totalAttempts: z.number().int(),
    averagePercentage: z.number().nullable(),
    bestPercentage: z.number().nullable(),
    lastFiveAverage: z.number().nullable(),
  }),
  skills: z.array(SkillScoreSchema),
  recommendedLevel: LevelSchema,
});
export type HistoryResponse = z.infer<typeof HistoryResponseSchema>;

/* -------------------------------------------------------------------------- */
/*  Admin import                                                              */
/* -------------------------------------------------------------------------- */

export const AudioUploadSchema = z.object({
  key: z.string().min(5).max(200),
  mime: z.enum(["audio/mpeg", "audio/wav", "audio/ogg"]),
  dataBase64: z.string().min(16),
});
export type AudioUpload = z.infer<typeof AudioUploadSchema>;

export const ImportRequestSchema = z.object({
  test: TestPackSchema,
  audio: z.array(AudioUploadSchema).min(1).max(8),
  publish: z.boolean().default(false),
  replace: z.boolean().default(false),
});
export type ImportRequest = z.infer<typeof ImportRequestSchema>;

export const AdminTestSchema = z.object({
  id: z.string(),
  title: z.string(),
  level: LevelSchema,
  accent: AccentSchema,
  status: z.enum(["draft", "published"]),
  season: SeasonSchema.nullable().optional(),
  archivedAt: z.string().nullable().optional(),
  reviewStatus: ReviewStatusSchema.optional(),
  reviewScore: z.number().nullable().optional(),
  passages: z.number().int(),
  questions: z.number().int(),
  attempts: z.number().int(),
  createdAt: z.string(),
});
export type AdminTest = z.infer<typeof AdminTestSchema>;

/* -------------------------------------------------------------------------- */
/*  Answer normalisation (shared by the API and mirrored in Python)            */
/* -------------------------------------------------------------------------- */

/**
 * Gap-fill answers should not fail on case, punctuation, curly quotes,
 * en/em dashes, or repeated whitespace. Article and inflection tolerance is
 * intentionally NOT applied: the item writer should list accepted variants.
 */
export function normalizeAnswer(input: string): string {
  return input
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2010-\u2015]/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[^\p{L}\p{N}'\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isGapfillCorrect(response: string, accepted: string[]): boolean {
  const normalized = normalizeAnswer(response);
  if (!normalized) return false;
  return accepted.some((candidate) => normalizeAnswer(candidate) === normalized);
}
