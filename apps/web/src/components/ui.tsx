import type { Level, SkillScore } from "@listening/shared";
import { LEVEL_LABELS, SKILL_LABELS, scoreTone } from "../lib/format";

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      role="status"
      aria-label="Loading"
    />
  );
}

export function LoadingPanel({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-24 text-muted">
      <Spinner className="h-7 w-7 text-accent" />
      <p className="text-[11px] uppercase tracking-[0.16em]">{label}…</p>
    </div>
  );
}

export function ErrorPanel({
  error,
  title = "Something went wrong",
  onRetry,
}: {
  error: unknown;
  title?: string;
  onRetry?: () => void;
}) {
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown error";
  return (
    <div className="card mx-auto max-w-xl p-8 text-center">
      <div className="mx-auto flex h-11 w-11 items-center justify-center border border-danger/30 bg-danger-soft font-serif text-xl text-danger">
        !
      </div>
      <h2 className="mt-4 text-2xl">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-muted">{message}</p>
      <div className="mt-6 flex justify-center gap-3">
        {onRetry && (
          <button type="button" className="btn-primary" onClick={onRetry}>
            Try again
          </button>
        )}
        <a href="/" className="btn-secondary">
          Back home
        </a>
      </div>
    </div>
  );
}

export function LevelBadge({ level, className = "" }: { level: Level; className?: string }) {
  const tone: Record<Level, string> = {
    A2: "border-ok/30 bg-ok-soft text-ok",
    B1: "border-accent/30 bg-accent-soft text-accent-ink",
    B2: "border-gold/35 bg-gold-soft text-ink-soft",
    C1: "border-ink/25 bg-paper-deep text-ink",
  };
  return (
    <span
      className={`inline-flex items-center border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] ${tone[level]} ${className}`}
      title={LEVEL_LABELS[level]}
    >
      {level}
    </span>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="card-flat border-t-2 border-t-accent p-5">
      <p className="label">{label}</p>
      <p className="stat-value mt-2">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function ScoreRing({
  percentage,
  score,
  maxScore,
}: {
  percentage: number;
  score: number;
  maxScore: number;
}) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, percentage));
  const offset = circumference - (clamped / 100) * circumference;
  const tone = scoreTone(clamped);
  const stroke = {
    ok: "stroke-ok",
    accent: "stroke-accent",
    gold: "stroke-gold",
    danger: "stroke-danger",
  }[tone];
  const text = {
    ok: "text-ok",
    accent: "text-accent",
    gold: "text-gold",
    danger: "text-danger",
  }[tone];

  return (
    <div className="relative inline-flex h-40 w-40 items-center justify-center">
      <svg viewBox="0 0 128 128" className="h-40 w-40 -rotate-90">
        <circle cx="64" cy="64" r={radius} className="fill-none stroke-line" strokeWidth="6" />
        <circle
          cx="64"
          cy="64"
          r={radius}
          className={`fill-none ${stroke} transition-[stroke-dashoffset] duration-700 ease-out`}
          strokeWidth="6"
          strokeLinecap="butt"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-serif text-4xl ${text}`}>{Math.round(clamped)}%</span>
        <span className="mt-0.5 text-xs text-muted">
          {score} / {maxScore} points
        </span>
      </div>
    </div>
  );
}

export function SkillBars({ skills }: { skills: SkillScore[] }) {
  if (skills.length === 0) {
    return <p className="text-sm text-muted">No skill data yet. Finish a test to see the breakdown.</p>;
  }
  return (
    <div className="space-y-4">
      {skills.map((skill) => {
        const tone = scoreTone(skill.percentage);
        const bar = { ok: "bg-ok", accent: "bg-accent", gold: "bg-gold", danger: "bg-danger" }[tone];
        return (
          <div key={skill.skill}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm text-ink-soft">{SKILL_LABELS[skill.skill] ?? skill.skill}</span>
              <span className="font-mono text-xs text-muted">{Math.round(skill.percentage)}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden bg-paper-deep">
              <div
                className={`h-full ${bar} transition-[width] duration-700`}
                style={{ width: `${Math.max(2, skill.percentage)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
