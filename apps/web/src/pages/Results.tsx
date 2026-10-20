import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { formatSeason, type AttemptResult, type PassageResult, type QuestionResult } from "@listening/shared";
import { getAttempt } from "../lib/api";
import { formatDate, formatDuration, percent, SKILL_LABELS } from "../lib/format";
import { ErrorPanel, LevelBadge, LoadingPanel, ScoreRing, SkillBars } from "../components/ui";
import {
  ArrowRightIcon,
  BookIcon,
  CheckIcon,
  HistoryIcon,
  XIcon,
} from "../components/icons";

export default function Results() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [inProgress, setInProgress] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!attemptId) return;
    let cancelled = false;
    setLoading(true);
    getAttempt(attemptId)
      .then((data) => {
        if (cancelled) return;
        if (data.status === "in_progress") setInProgress(true);
        else setResult(data);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attemptId]);

  if (loading) return <LoadingPanel label="Loading your result" />;
  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-16 sm:px-8">
        <ErrorPanel error={error} title="This result is not available" onRetry={() => window.location.reload()} />
      </div>
    );
  }

  if (inProgress) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-20 text-center sm:px-8">
        <p className="label text-accent">Attempt in progress</p>
        <h1 className="mt-3 text-4xl">The paper is still open.</h1>
        <p className="mx-auto mt-4 max-w-md text-sm leading-6 text-muted">
          This attempt has not been submitted yet. Your answers were saved on this device, so you
          can return to the paper and finish it.
        </p>
        <div className="mt-7 flex justify-center gap-3">
          <Link to="/exam" className="btn-primary">
            Return to exam
          </Link>
          <Link to="/" className="btn-secondary">
            Home
          </Link>
        </div>
      </div>
    );
  }

  if (!result) return null;

  const summary =
    result.percentage >= 85
      ? "A very strong ear. You caught the details and the intent."
      : result.percentage >= 70
        ? "A solid result. The main ideas landed; a few details slipped."
        : result.percentage >= 50
          ? "The gist is there. The review below shows where meaning broke down."
          : "Start with the transcript and replay each section. The patterns will surface.";

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-7">
        <div>
          <p className="label text-accent">Paper result · {formatDate(result.submittedAt)}</p>
          <h1 className="mt-2 text-4xl leading-tight sm:text-5xl">{result.title}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted">
            <LevelBadge level={result.level} />
            {result.season && <span>{formatSeason(result.season)}</span>}
            <span>{result.passages.length} sections</span>
            <span aria-hidden="true">·</span>
            <span>{result.maxScore} points</span>
            <span aria-hidden="true">·</span>
            <span>{formatDuration(result.durationUsedSec)} used</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Link to="/history" className="btn-secondary">
            <HistoryIcon className="h-4 w-4" />
            History
          </Link>
          <Link to="/exam" className="btn-primary">
            Next paper
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-[0.95fr_1.05fr]">
        <div className="card flex flex-col items-center justify-center border-t-2 border-t-accent p-7 text-center">
          <ScoreRing percentage={result.percentage} score={result.score} maxScore={result.maxScore} />
          <p className="mt-5 max-w-xs text-sm leading-6 text-ink-soft">{summary}</p>
          <p className="mt-3 text-[10px] uppercase tracking-[0.14em] text-muted">
            {result.score} of {result.maxScore} points · {percent(result.percentage)}
          </p>
        </div>

        <div className="card p-7">
          <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
            <div>
              <p className="label text-accent">Skill breakdown</p>
              <h2 className="mt-1 text-2xl">Where the meaning landed</h2>
            </div>
            <span className="font-serif text-2xl text-accent">{Math.round(result.percentage)}%</span>
          </div>
          <div className="mt-5">
            <SkillBars skills={result.skills} />
          </div>
        </div>
      </div>

      <div className="mt-12 flex items-end justify-between gap-4 border-b border-line pb-4">
        <div>
          <p className="label text-accent">Review</p>
          <h2 className="mt-1 text-3xl">The full tape, question by question.</h2>
        </div>
        <span className="hidden text-[10px] uppercase tracking-[0.12em] text-muted sm:block">
          Transcripts and keys released after submission
        </span>
      </div>

      <div className="mt-6 space-y-6">
        {result.passages.map((passage) => (
          <PassageReview key={passage.id} passage={passage} />
        ))}
      </div>

      <div className="mt-12 flex flex-col items-center justify-between gap-4 border-y-2 border-accent bg-white p-7 sm:flex-row">
        <div>
          <h2 className="text-2xl">Keep the momentum.</h2>
          <p className="mt-1 text-sm text-muted">
            Another paper is waiting in the curated bank — same rules, fresh material.
          </p>
        </div>
        <Link to="/exam" className="btn-accent">
          Start the next paper
          <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}

function PassageReview({ passage }: { passage: PassageResult }) {
  const correctCount = passage.questions.filter((question) => question.awarded >= question.points).length;
  return (
    <section className="card border-t-2 border-t-accent p-6 sm:p-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="label">
            Section {passage.position} · {passage.type === "monologue" ? "Monologue" : "Conversation"}
          </p>
          <h3 className="mt-1 text-2xl">{passage.topic}</h3>
        </div>
        <span className="pill">
          {correctCount} / {passage.questions.length} correct
        </span>
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <audio controls preload="metadata" src={passage.audioUrl} className="w-full sm:max-w-sm" />
        <span className="text-xs text-muted">Replay as often as you like — the exam is over.</span>
      </div>

      <details className="group mt-5 border border-line bg-paper/50" open>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
          <span className="flex items-center gap-2">
            <BookIcon className="h-4 w-4 text-muted" />
            Transcript
          </span>
          <span className="text-xs font-normal text-muted group-open:hidden">Show</span>
          <span className="hidden text-xs font-normal text-muted group-open:inline">Hide</span>
        </summary>
        <div className="border-t border-line px-5 py-5">
          <Transcript text={passage.transcript} type={passage.type} />
        </div>
      </details>

      <div className="mt-5 space-y-3">
        {passage.questions.map((question) => (
          <QuestionReview key={question.questionId} question={question} />
        ))}
      </div>
    </section>
  );
}

function Transcript({ text, type }: { text: string; type: PassageResult["type"] }) {
  const blocks = type === "dialogue" ? text.split(/\n+/) : text.split(/\n{2,}/);
  return (
    <div className="transcript">
      {blocks.map((block, index) => {
        const match = /^([AB]):\s*(.*)$/s.exec(block.trim());
        if (match) {
          return (
            <p key={index} className="mt-3 first:mt-0">
              <span className="mr-2 inline-flex h-6 w-6 items-center justify-center bg-ink text-[10px] font-semibold text-paper">
                {match[1]}
              </span>
              {match[2]}
            </p>
          );
        }
        return (
          <p key={index} className="mt-3 first:mt-0">
            {block.trim()}
          </p>
        );
      })}
    </div>
  );
}

function QuestionReview({ question }: { question: QuestionResult }) {
  const full = question.awarded >= question.points;
  const partial = !full && question.awarded > 0;

  return (
    <article className="border border-line border-l-2 border-l-accent bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="label">
          Question {question.position} · {SKILL_LABELS[question.skill] ?? question.skill}
        </p>
        <span
          className={`inline-flex items-center gap-1 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] ${
            full
              ? "bg-ok-soft text-ok"
              : partial
                ? "bg-gold-soft text-ink-soft"
                : "bg-danger-soft text-danger"
          }`}
        >
          {full ? <CheckIcon className="h-3 w-3" /> : <XIcon className="h-3 w-3" />}
          {full ? "Correct" : partial ? "Partial" : "Incorrect"} · {question.awarded}/{question.points}
        </span>
      </div>

      <p className="mt-2 font-serif text-lg leading-7">{question.prompt}</p>

      {question.type === "mcq" && question.choices && (
        <div className="mt-3 grid gap-1.5">
          {question.choices.map((choice) => {
            const isCorrect = choice.key === question.correct.key;
            const isChosen = choice.key === question.response;
            return (
              <div
                key={choice.key}
                className={`flex items-start gap-2 border px-3 py-2 text-sm ${
                  isCorrect
                    ? "border-ok/30 bg-ok-soft/70 text-ok"
                    : isChosen
                      ? "border-danger/30 bg-danger-soft/60 text-danger"
                      : "border-line bg-paper/40 text-muted"
                }`}
              >
                <span className="font-mono text-xs uppercase">{choice.key}</span>
                <span className="flex-1">{choice.text}</span>
                {isChosen && <span className="text-[10px] uppercase tracking-wide">your answer</span>}
                {isCorrect && <CheckIcon className="h-4 w-4 shrink-0" />}
              </div>
            );
          })}
        </div>
      )}

      {question.type === "gapfill" && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <AnswerBox label="Your answer" value={question.response || "No answer"} tone={full ? "ok" : "danger"} />
          <AnswerBox
            label="Accepted"
            value={question.correct.accepted?.join(" / ") ?? ""}
            tone="ok"
          />
        </div>
      )}

      {question.type === "subjective" && (
        <div className="mt-3 space-y-2">
          <AnswerBox label="Your answer" value={question.response || "No answer"} tone={full ? "ok" : partial ? "gold" : "danger"} />
          <AnswerBox label="Sample answer" value={question.correct.expected ?? ""} tone="neutral" />
          {question.feedback && (
            <p className="border border-line bg-paper px-3 py-2 text-xs leading-5 text-ink-soft">
              <span className="font-semibold">Feedback:</span> {question.feedback}
            </p>
          )}
        </div>
      )}

      <p className="mt-3 border-t border-line/70 pt-3 text-xs leading-5 text-muted">
        <span className="font-semibold text-ink-soft">Why:</span> {question.explanation}
      </p>
    </article>
  );
}

function AnswerBox({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "ok" | "danger" | "gold" | "neutral";
}) {
  const classes = {
    ok: "border-ok/25 bg-ok-soft/60 text-ok",
    danger: "border-danger/25 bg-danger-soft/60 text-danger",
    gold: "border-gold/30 bg-gold-soft/70 text-ink-soft",
    neutral: "border-line bg-paper/50 text-ink-soft",
  }[tone];
  return (
    <div className={`border px-3 py-2 ${classes}`}>
      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] opacity-70">{label}</p>
      <p className="mt-0.5 text-sm leading-6">{value}</p>
    </div>
  );
}
