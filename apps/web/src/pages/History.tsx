import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { HistoryResponse } from "@listening/shared";
import { getHistory } from "../lib/api";
import { formatRelativeDays, percent } from "../lib/format";
import { ErrorPanel, LevelBadge, LoadingPanel, SkillBars, StatCard } from "../components/ui";
import { ArrowRightIcon, ChartIcon, HeadphonesIcon, HistoryIcon, TrophyIcon } from "../components/icons";

export default function History() {
  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    getHistory()
      .then(setHistory)
      .catch(setError)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) return <LoadingPanel label="Loading your history" />;
  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-5 py-16 sm:px-8">
        <ErrorPanel error={error} title="History could not be loaded" onRetry={load} />
      </div>
    );
  }
  if (!history) return null;

  const hasAttempts = history.attempts.length > 0;

  return (
    <div className="mx-auto max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label text-accent">Your progress</p>
          <h1 className="mt-2 text-4xl sm:text-5xl">Your listening record.</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted">
            Every paper and every skill on this device. No account, no email — the history is tied
            to a signed local identity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <LevelBadge level={history.recommendedLevel} />
          <Link to="/exam" className="btn-primary">
            <HeadphonesIcon className="h-4 w-4" />
            New paper
          </Link>
        </div>
      </div>

      {!hasAttempts ? (
        <div className="card mt-10 flex flex-col items-center border-t-2 border-t-accent px-6 py-16 text-center">
          <span className="flex h-12 w-12 items-center justify-center border border-line bg-accent-soft text-accent">
            <HistoryIcon className="h-6 w-6" />
          </span>
          <h2 className="mt-4 text-2xl">Nothing on the tape yet.</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted">
            Take your first listening paper and this page will fill with scores, skill trends, and
            a level recommendation.
          </p>
          <Link to="/exam" className="btn-accent mt-6">
            Start a paper
            <ArrowRightIcon className="h-4 w-4" />
          </Link>
        </div>
      ) : (
        <>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Completed" value={String(history.stats.totalAttempts)} hint="submitted attempts" />
            <StatCard label="Average" value={percent(history.stats.averagePercentage)} hint="all submitted" />
            <StatCard label="Best" value={percent(history.stats.bestPercentage)} hint="personal record" />
            <StatCard label="Last five" value={percent(history.stats.lastFiveAverage)} hint="recent form" />
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="card border-t-2 border-t-accent p-6">
              <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
                <div>
                  <p className="label text-accent">Attempts</p>
                  <h2 className="mt-1 text-2xl">Recent papers</h2>
                </div>
                <ChartIcon className="h-5 w-5 text-muted" />
              </div>

              <div className="mt-4 divide-y divide-line/70">
                {history.attempts.map((attempt) => (
                  <Link
                    key={attempt.attemptId}
                    to={attempt.status === "submitted" ? `/results/${attempt.attemptId}` : "/exam"}
                    className="group flex items-center gap-4 py-3.5 transition hover:opacity-80"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{attempt.title}</p>
                        <LevelBadge level={attempt.level} />
                        {attempt.status === "in_progress" && (
                          <span className="bg-gold-soft px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.1em] text-ink-soft">
                            In progress
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 text-xs text-muted">
                        {formatRelativeDays(attempt.startedAt)}
                      </p>
                    </div>

                    {attempt.status === "submitted" ? (
                      <div className="flex items-center gap-3">
                        <div className="hidden h-1.5 w-24 overflow-hidden bg-paper-deep sm:block">
                          <div
                            className="h-full bg-accent"
                            style={{ width: `${Math.max(2, attempt.percentage ?? 0)}%` }}
                          />
                        </div>
                        <span className="w-12 text-right font-mono text-sm">
                          {percent(attempt.percentage)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs font-medium text-accent">Resume</span>
                    )}
                  </Link>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="card p-6">
                <div className="flex items-center justify-between gap-3 border-b border-line pb-4">
                  <div>
                    <p className="label text-accent">Skills</p>
                    <h2 className="mt-1 text-2xl">Across all papers</h2>
                  </div>
                  <TrophyIcon className="h-5 w-5 text-accent" />
                </div>
                <div className="mt-5">
                  <SkillBars skills={history.skills} />
                </div>
              </div>

              <div className="border border-line border-l-2 border-l-accent bg-white p-5">
                <p className="label text-accent">Recommended level</p>
                <p className="mt-1 font-serif text-2xl">{history.recommendedLevel}</p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Based on your last five submissions. Scores above 85% move you up; below 55% move
                  you down.
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
