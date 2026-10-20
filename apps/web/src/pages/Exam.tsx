import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatSeason } from "@listening/shared";
import AudioPlayer from "../components/AudioPlayer";
import QuestionCard from "../components/QuestionCard";
import { ErrorPanel, LevelBadge, LoadingPanel, Spinner } from "../components/ui";
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ClockIcon, XIcon } from "../components/icons";
import { ApiClientError, getNextTest, startAttempt, submitAttempt } from "../lib/api";
import { formatClock } from "../lib/format";
import {
  clearActiveAttempt,
  clearDraft,
  getActiveAttempt,
  getDraft,
  getPreferredLevel,
  isExpired,
  saveDraft,
  setActiveAttempt,
  type ActiveAttempt,
} from "../lib/storage";
import { useCountdown } from "../lib/useCountdown";

export default function Exam() {
  const navigate = useNavigate();
  const [active, setActive] = useState<ActiveAttempt | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [section, setSection] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showReview, setShowReview] = useState(false);
  const startedRef = useRef(false);
  const submittedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const existing = getActiveAttempt();
    if (existing && !isExpired(existing.deadlineAt)) {
      setActive(existing);
      setAnswers(getDraft(existing.attemptId));
      setLoading(false);
      return;
    }
    if (existing) clearActiveAttempt();

    void (async () => {
      try {
        const { test } = await getNextTest(getPreferredLevel());
        const attempt = await startAttempt(test.id);
        const next: ActiveAttempt = {
          attemptId: attempt.attemptId,
          token: attempt.token,
          startedAt: attempt.startedAt,
          deadlineAt: attempt.deadlineAt,
          test: attempt.test,
        };
        setActiveAttempt(next);
        setActive(next);
        setAnswers({});
      } catch (cause) {
        setError(cause);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (active) saveDraft(active.attemptId, answers);
  }, [active, answers]);

  useEffect(() => {
    if (!active) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [active]);

  const remaining = useCountdown(active?.deadlineAt);

  const handleSubmit = useCallback(
    async (auto = false) => {
      if (!active || submittedRef.current) return;
      submittedRef.current = true;
      setSubmitting(true);
      setSubmitError(null);
      setShowReview(false);
      try {
        const result = await submitAttempt(active.attemptId, active.token, answers);
        clearActiveAttempt();
        clearDraft(active.attemptId);
        navigate(`/results/${result.attemptId}`, { replace: true });
      } catch (cause) {
        submittedRef.current = false;
        if (cause instanceof ApiClientError && cause.code === "deadline_expired") {
          clearActiveAttempt();
          clearDraft(active.attemptId);
          navigate("/", { replace: true });
          return;
        }
        setSubmitError(
          cause instanceof Error
            ? `${cause.message}${auto ? " Your answers are saved locally — submit again before closing this page." : ""}`
            : "Submission failed. Please try again.",
        );
        setSubmitting(false);
      }
    },
    [active, answers, navigate],
  );

  useEffect(() => {
    // `remaining` is briefly 0 on the first render after an attempt is set,
    // before useCountdown's effect recalculates it. Check the real deadline
    // too, otherwise a fresh exam auto-submits immediately.
    const deadlinePassed = active ? Date.parse(active.deadlineAt) <= Date.now() : false;
    if (active && deadlinePassed && remaining === 0 && !submittedRef.current) {
      void handleSubmit(true);
    }
  }, [active, remaining, handleSubmit]);

  if (loading) return <LoadingPanel label="Preparing your paper" />;
  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-16 sm:px-8">
        <ErrorPanel
          error={error}
          title="No paper could be prepared"
          onRetry={() => window.location.reload()}
        />
        <div className="mx-auto mt-6 max-w-xl text-center text-xs leading-6 text-muted">
          If you operate this site, publish at least one paper first: generate the pack offline,
          review it, then import it with <code className="border border-line bg-white px-1.5 py-0.5">listening publish</code>.
        </div>
      </div>
    );
  }
  if (!active) return null;

  const passages = active.test.passages;
  const current = passages[Math.min(section, passages.length - 1)];
  if (!current) return null;
  const questions = passages.flatMap((passage) => passage.questions);
  const answered = questions.filter((question) => (answers[question.id] ?? "").trim().length > 0).length;
  const unanswered = questions.length - answered;
  const isLast = section === passages.length - 1;
  const timerTone =
    remaining <= 60 ? "text-danger" : remaining <= 300 ? "text-gold" : "text-ink";
  const progress = ((section + 1) / passages.length) * 100;

  function goTo(index: number) {
    setSection(index);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <div className="pb-24">
      <div className="sticky top-[72px] z-20 border-b border-line bg-white">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <LevelBadge level={active.test.level} />
              <span className="truncate text-xs text-muted">{active.test.title}</span>
              {active.test.season && (
                <span className="hidden text-[9px] uppercase tracking-[0.14em] text-muted sm:inline">
                  {formatSeason(active.test.season)}
                </span>
              )}
            </div>
          </div>
          <div
            className={`flex items-center gap-1.5 border border-line bg-paper px-3 py-1.5 font-mono text-sm tabular ${timerTone}`}
            role="timer"
            aria-live={remaining <= 60 ? "assertive" : "off"}
          >
            <ClockIcon className="h-4 w-4" />
            {formatClock(remaining)}
          </div>
        </div>
        <div className="mx-auto max-w-3xl px-5 pb-2 sm:px-8">
          <div className="h-1 overflow-hidden bg-line/70">
            <div
              className="h-full bg-accent transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-3xl px-5 pt-8 sm:px-8">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
          <div>
            <p className="label text-accent">
              Section {section + 1} of {passages.length} ·{" "}
              {current.type === "monologue" ? "Monologue" : "Conversation"}
            </p>
            <h1 className="mt-2 text-3xl leading-tight sm:text-4xl">{current.topic}</h1>
          </div>
          <span className="pill">
            {answered} of {questions.length} answered
          </span>
        </div>

        <p className="mt-4 max-w-2xl text-sm leading-6 text-muted">
          {current.type === "monologue"
            ? "One speaker, speaking naturally. The questions below stay visible while the audio plays."
            : "Two speakers, one conversation. Listen for the decision they reach, not just the facts."}{" "}
          You will hear this recording twice, with a short break between plays.
        </p>

        <div className="mt-6 space-y-14">
          {passages.map((passage, index) => (
            <section key={passage.id} hidden={index !== section} aria-label={`Section ${passage.position}`}>
              <AudioPlayer
                src={passage.audioUrl}
                durationSec={passage.audioDurationSec}
                label={`Section ${passage.position} · ${
                  passage.type === "monologue" ? "Monologue" : "Dialogue"
                }`}
              />

              <div className="mt-8 space-y-4">
                {passage.questions.map((question) => (
                  <QuestionCard
                    key={question.id}
                    question={question}
                    index={question.position}
                    value={answers[question.id] ?? ""}
                    onChange={(value) =>
                      setAnswers((previous) => ({ ...previous, [question.id]: value }))
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => goTo(Math.max(0, section - 1))}
            disabled={section === 0}
          >
            <ArrowLeftIcon className="h-4 w-4" />
            Previous
          </button>

          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost" onClick={() => setShowReview(true)}>
              Review answers
            </button>
            {!isLast ? (
              <button type="button" className="btn-primary" onClick={() => goTo(section + 1)}>
                Next section
                <ArrowRightIcon className="h-4 w-4" />
              </button>
            ) : (
              <button type="button" className="btn-accent" onClick={() => setShowReview(true)}>
                Finish test
                <CheckIcon className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {submitError && (
          <div className="mt-6 border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger">
            {submitError}{" "}
            <button
              type="button"
              className="font-semibold underline underline-offset-2"
              onClick={() => void handleSubmit(false)}
            >
              Retry submission
            </button>
          </div>
        )}
      </div>

      {showReview && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-ink/55 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="review-title"
            className="card w-full max-w-lg p-6 sm:p-7"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="label text-accent">Before you submit</p>
                <h2 id="review-title" className="mt-1 text-2xl">
                  {unanswered === 0 ? "All questions answered" : `${unanswered} unanswered`}
                </h2>
              </div>
              <button
                type="button"
                className="border border-transparent p-2 text-muted hover:border-line hover:text-ink"
                onClick={() => setShowReview(false)}
                aria-label="Close"
              >
                <XIcon className="h-5 w-5" />
              </button>
            </div>

            {unanswered > 0 ? (
              <>
                <p className="mt-2 text-sm leading-6 text-muted">
                  Unanswered questions score zero. You can go back and complete them, or submit now.
                </p>
                <ul className="mt-4 max-h-56 space-y-2 overflow-auto pr-1">
                  {passages.map((passage) => {
                    const missing = passage.questions.filter(
                      (question) => !(answers[question.id] ?? "").trim(),
                    );
                    if (missing.length === 0) return null;
                    return (
                      <li key={passage.id} className="border border-line bg-paper px-3 py-2 text-sm">
                        <span className="font-medium">
                          Section {passage.position} · {passage.topic}
                        </span>
                        <span className="ml-2 text-xs text-muted">
                          Q{missing.map((question) => question.position).join(", Q")}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </>
            ) : (
              <p className="mt-2 text-sm leading-6 text-muted">
                Multiple choice and gap-fill are marked instantly. Short answers are graded against
                a rubric by the server. You cannot change answers after submitting.
              </p>
            )}

            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn-secondary" onClick={() => setShowReview(false)}>
                Keep working
              </button>
              <button
                type="button"
                className="btn-accent"
                onClick={() => void handleSubmit(false)}
                disabled={submitting}
              >
                {submitting ? <Spinner /> : <CheckIcon className="h-4 w-4" />}
                Submit now
              </button>
            </div>
          </div>
        </div>
      )}

      {submitting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-paper/95 px-6">
          <div className="text-center">
            <Spinner className="mx-auto h-9 w-9 text-accent" />
            <h2 className="mt-5 text-2xl">Marking your answers</h2>
            <p className="mt-2 text-sm text-muted">
              Multiple choice is instant. Short answers take a moment.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
