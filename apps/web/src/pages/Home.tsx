import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { formatSeason, seasonForDate, type HistoryResponse, type Level } from "@listening/shared";
import { getHistory } from "../lib/api";
import { formatClock, formatDuration, percent } from "../lib/format";
import {
  clearActiveAttempt,
  getActiveAttempt,
  getPreferredLevel,
  isExpired,
  setPreferredLevel,
  type ActiveAttempt,
} from "../lib/storage";
import { LevelBadge, Spinner } from "../components/ui";
import {
  ArrowRightIcon,
  BookIcon,
  ChartIcon,
  ClockIcon,
  HeadphonesIcon,
  ShieldIcon,
  TrophyIcon,
} from "../components/icons";

const LEVEL_OPTIONS: Array<{ value: Level | "auto"; label: string }> = [
  { value: "auto", label: "Auto" },
  { value: "A2", label: "A2" },
  { value: "B1", label: "B1" },
  { value: "B2", label: "B2" },
  { value: "C1", label: "C1" },
];

export default function Home() {
  const navigate = useNavigate();
  const [level, setLevel] = useState<Level | "auto">(getPreferredLevel());
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [active, setActive] = useState<ActiveAttempt | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);

  useEffect(() => {
    const attempt = getActiveAttempt();
    if (attempt && !isExpired(attempt.deadlineAt)) {
      setActive(attempt);
    } else if (attempt) {
      clearActiveAttempt();
    }

    let cancelled = false;
    getHistory()
      .then((data) => {
        if (!cancelled) setHistory(data);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function chooseLevel(value: Level | "auto") {
    setLevel(value);
    setPreferredLevel(value);
  }

  function start() {
    setPreferredLevel(level);
    navigate("/exam");
  }

  const effectiveLevel = level === "auto" ? history?.recommendedLevel ?? "B1" : level;
  const totalAttempts = history?.stats.totalAttempts ?? 0;

  return (
    <div>
      <section className="border-b border-line bg-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-14 pt-12 sm:px-8 sm:pt-16 lg:grid-cols-[1.02fr_0.98fr]">
          <div>
            <div className="flex items-center gap-3">
              <span className="h-px w-9 bg-accent" aria-hidden="true" />
              <span className="label text-accent">
                English listening · {formatSeason(seasonForDate())} series
              </span>
            </div>

            <h1 className="exam-heading mt-5 text-balance text-5xl sm:text-6xl">
              The listening paper,
              <br />
              done properly.
            </h1>

            <p className="mt-6 max-w-xl text-pretty text-[17px] leading-8 text-muted">
              A curated library of exam-style papers: one monologue, one conversation, a real
              clock, and two plays only. Every answer is marked and explained afterwards.
            </p>

            <div className="mt-8 border border-line bg-paper">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
                <div>
                  <p className="label">Choose your level</p>
                  <p className="mt-1 text-xs text-muted">
                    Auto uses your last five papers
                    {history ? ` · ${history.recommendedLevel} recommended` : ""}.
                  </p>
                </div>
                <div className="flex flex-wrap gap-px bg-line" role="group" aria-label="Paper level">
                  {LEVEL_OPTIONS.map((option) => {
                    const selected = level === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => chooseLevel(option.value)}
                        className={`min-w-[54px] px-3 py-2 text-[11px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                          selected
                            ? "bg-accent text-white"
                            : "bg-white text-muted hover:bg-paper-deep hover:text-ink"
                        }`}
                        aria-pressed={selected}
                      >
                        {option.label}
                        {option.value === "auto" && level === "auto" ? ` · ${effectiveLevel}` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="p-4">
                <button type="button" onClick={start} className="btn-accent w-full py-3">
                  {active ? "Resume your paper" : "Begin a listening paper"}
                  <ArrowRightIcon className="h-4 w-4" />
                </button>
                <p className="mt-3 text-center text-[10px] uppercase tracking-[0.14em] text-muted">
                  No account · about 10 minutes · answers held on the server
                </p>
              </div>
            </div>

            {active && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-l-2 border-accent bg-accent-soft/60 px-4 py-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-accent-ink">
                    Paper in progress
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {active.test.title} ·{" "}
                    {formatClock(Math.max(0, (Date.parse(active.deadlineAt) - Date.now()) / 1000))}{" "}
                    left
                  </p>
                </div>
                <Link to="/exam" className="btn-primary px-4 py-2">
                  Resume
                </Link>
              </div>
            )}
          </div>

          <HeroPaper />
        </div>
      </section>

      {totalAttempts > 0 && history && (
        <section className="mx-auto max-w-6xl px-5 pt-10 sm:px-8">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MiniStat
              label="Papers completed"
              value={String(history.stats.totalAttempts)}
              icon={<BookIcon className="h-4 w-4" />}
            />
            <MiniStat
              label="Average score"
              value={percent(history.stats.averagePercentage)}
              icon={<ChartIcon className="h-4 w-4" />}
            />
            <MiniStat
              label="Personal best"
              value={percent(history.stats.bestPercentage)}
              icon={<TrophyIcon className="h-4 w-4" />}
            />
            <MiniStat
              label="Last five"
              value={percent(history.stats.lastFiveAverage)}
              icon={<ClockIcon className="h-4 w-4" />}
            />
          </div>
        </section>
      )}

      <section className="border-b border-line bg-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="label text-accent">The format</p>
            <h2 className="mt-3 text-4xl leading-tight">A paper that behaves like the real thing.</h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-muted">
              Two sections and ten questions. The recording unlocks twice, with a thirty-second
              break. The clock starts when you do, and the answer key does not leave the server
              until you submit.
            </p>
          </div>

          <div className="grid gap-px border border-line bg-line sm:grid-cols-2">
            <Feature
              icon={<HeadphonesIcon className="h-5 w-5" />}
              title="Two passages, two voices"
              body="A personal monologue and a turning-point conversation, pitched at your level."
            />
            <Feature
              icon={<ClockIcon className="h-5 w-5" />}
              title="Timed, two plays only"
              body="No scrubbing, no pause. A short break, then one more listen."
            />
            <Feature
              icon={<ChartIcon className="h-5 w-5" />}
              title="Skills, not just a score"
              body="See whether you missed a detail, an inference, or the speaker's attitude."
            />
            <Feature
              icon={<ShieldIcon className="h-5 w-5" />}
              title="Answers stay server-side"
              body="Question keys are never sent to the browser before you submit."
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="label text-accent">The library</p>
            <h2 className="mt-3 text-4xl leading-tight">A bank, not a slot machine.</h2>
            <p className="mt-4 max-w-md text-sm leading-6 text-muted">
              Papers are written and narrated offline, checked against a fixed answer key, and
              reviewed before they enter the bank. New seasonal papers are added each quarter; old
              papers remain in your history.
            </p>
            {loadingHistory && (
              <p className="mt-6 flex items-center gap-2 text-xs text-muted">
                <Spinner /> Loading your history…
              </p>
            )}
            {history && history.attempts.length > 0 && (
              <div className="mt-6 border border-line bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-medium">Recommended next</p>
                  <LevelBadge level={history.recommendedLevel} />
                </div>
                <p className="mt-1 text-xs text-muted">
                  Based on your recent accuracy. You can override the level above.
                </p>
                <Link
                  to="/history"
                  className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-accent hover:underline"
                >
                  View all papers <ArrowRightIcon className="h-3.5 w-3.5" />
                </Link>
              </div>
            )}
          </div>

          <ol className="divide-y divide-line border-y border-line">
            {[
              ["01", "Pick a level", "Auto reads your last five scores; or choose A2 through C1 yourself."],
              ["02", "Listen twice", "One monologue, one dialogue. Thirty seconds between plays, then the questions stay open."],
              ["03", "Submit", "Multiple choice and gap-fill are marked exactly; short answers are judged against a rubric."],
              ["04", "Review the tape", "Read the transcript, replay the audio, and see exactly where the meaning slipped."],
            ].map(([number, title, body]) => (
              <li key={number} className="flex gap-5 py-5">
                <span className="font-mono text-[11px] text-accent">{number}</span>
                <div>
                  <h3 className="text-lg">{title}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-y-2 border-accent bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-5 py-10 sm:flex-row sm:items-center sm:px-8">
          <div>
            <p className="label text-accent">Ready when you are</p>
            <h2 className="mt-2 text-3xl sm:text-4xl">Ten minutes. Two listens. One clear picture.</h2>
            <p className="mt-2 text-xs uppercase tracking-[0.12em] text-muted">
              {formatDuration(600)} · 2 sections · 10 questions · full review
            </p>
          </div>
          <button type="button" onClick={start} className="btn-accent shrink-0">
            {active ? "Resume paper" : "Start a paper"}
            <ArrowRightIcon className="h-4 w-4" />
          </button>
        </div>
      </section>
    </div>
  );
}

function MiniStat({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="card-flat flex items-center justify-between gap-3 border-t-2 border-t-accent p-5">
      <div>
        <p className="label">{label}</p>
        <p className="mt-1 font-serif text-2xl">{value}</p>
      </div>
      <span className="flex h-8 w-8 items-center justify-center border border-line text-accent">
        {icon}
      </span>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="bg-white p-5">
      <span className="flex h-9 w-9 items-center justify-center bg-accent-soft text-accent">{icon}</span>
      <h3 className="mt-3 text-lg">{title}</h3>
      <p className="mt-1 text-sm leading-6 text-muted">{body}</p>
    </div>
  );
}

function HeroPaper() {
  return (
    <div className="mx-auto w-full max-w-md">
      <div className="border border-line bg-white shadow-card">
        <div className="h-2 bg-accent" aria-hidden="true" />
        <div className="p-6">
          <div className="flex items-center justify-between gap-3">
            <span className="label text-accent">Paper 1 · Listening</span>
            <LevelBadge level="B2" />
          </div>

          <div className="mt-4 grid grid-cols-3 border-y border-line py-3 text-center">
            <PaperFact label="Time" value="10 min" />
            <PaperFact label="Sections" value="2" />
            <PaperFact label="Questions" value="10" />
          </div>

          <div className="mt-5">
            <p className="label">Section 1 · Monologue</p>
            <div className="mt-2 flex items-center gap-3 border border-line bg-paper px-3 py-2.5">
              <span className="flex h-8 w-8 items-center justify-center bg-accent text-white">
                <HeadphonesIcon className="h-4 w-4" />
              </span>
              <div className="flex h-7 flex-1 items-end gap-[3px]" aria-hidden="true">
                {[34, 58, 78, 44, 70, 88, 50, 64, 38, 74, 84, 46, 60, 76, 42, 68].map(
                  (height, index) => (
                    <span
                      key={index}
                      className={`w-1 ${index < 9 ? "bg-accent" : "bg-line"}`}
                      style={{ height: `${height}%` }}
                    />
                  ),
                )}
              </div>
              <span className="font-mono text-[10px] text-muted">00:00</span>
            </div>
          </div>

          <div className="mt-5">
            <p className="label text-accent">Question 1 · Detail</p>
            <p className="mt-1 font-serif text-[15px] leading-6">
              Why did the speaker change their morning routine?
            </p>
            <div className="mt-2 space-y-px bg-line">
              {["They moved to a new city", "They wanted more quiet time", "A friend recommended it"].map(
                (option, index) => (
                  <div
                    key={option}
                    className={`flex items-center gap-2 px-3 py-2 text-xs ${
                      index === 1 ? "bg-accent-soft text-accent-ink" : "bg-white text-muted"
                    }`}
                  >
                    <span className="flex h-4 w-4 items-center justify-center border border-current font-mono text-[9px] uppercase">
                      {String.fromCharCode(97 + index)}
                    </span>
                    {option}
                  </div>
                ),
              )}
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between border-t border-line pt-3 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted">
            <span>Two recordings · 30-second break</span>
            <span className="text-accent">Answers withheld</span>
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-[9px] uppercase tracking-[0.18em] text-muted">
        Specimen paper · not a live examination
      </p>
    </div>
  );
}

function PaperFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-line last:border-r-0">
      <p className="text-[9px] uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className="mt-0.5 font-serif text-sm text-ink">{value}</p>
    </div>
  );
}
