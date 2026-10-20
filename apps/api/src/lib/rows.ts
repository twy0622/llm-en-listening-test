export interface TestRow {
  id: string;
  title: string;
  level: string;
  accent: string;
  duration_sec: number;
  schema_version: number;
  status: "draft" | "published";
  season: string | null;
  archived_at: string | null;
  review_status: "pending" | "approved" | "rejected";
  review_score: number | null;
  review_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  published_at: string | null;
}

export interface PassageRow {
  id: string;
  test_id: string;
  position: number;
  type: "monologue" | "dialogue";
  topic: string;
  transcript: string;
  audio_key: string;
  audio_mime: string;
  audio_duration_sec: number;
  voice: string | null;
}

export interface QuestionRow {
  id: string;
  test_id: string;
  passage_id: string;
  position: number;
  type: "mcq" | "gapfill" | "subjective";
  prompt: string;
  choices_json: string | null;
  answer_json: string;
  explanation: string;
  skill: string;
  points: number;
}

export interface AttemptRow {
  id: string;
  test_id: string;
  device_id: string;
  started_at: string;
  deadline_at: string;
  submitted_at: string | null;
  status: "in_progress" | "submitted";
  score: number | null;
  max_score: number | null;
  duration_used_sec: number | null;
  created_at: string;
}

export interface AnswerRow {
  id: string;
  attempt_id: string;
  question_id: string;
  response: string | null;
  is_correct: number | null;
  awarded: number | null;
  feedback: string | null;
  graded_by: "exact" | "llm" | "heuristic";
  graded_at: string | null;
}
