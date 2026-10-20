import type { Level, Skill } from "@listening/shared";

export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  return `${minutes} min`;
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function formatRelativeDays(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return formatDate(iso);
}

export const LEVEL_LABELS: Record<Level, string> = {
  A2: "A2 · Elementary",
  B1: "B1 · Intermediate",
  B2: "B2 · Upper intermediate",
  C1: "C1 · Advanced",
};

export const SKILL_LABELS: Record<Skill, string> = {
  gist: "Main idea",
  detail: "Detail",
  inference: "Inference",
  attitude: "Attitude",
  vocabulary: "Vocabulary",
  function: "Function",
  organization: "Structure",
};

export function scoreTone(percentage: number): "ok" | "accent" | "gold" | "danger" {
  if (percentage >= 80) return "ok";
  if (percentage >= 65) return "accent";
  if (percentage >= 50) return "gold";
  return "danger";
}

export function percent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${Math.round(value)}%`;
}

export function uid(size = 8): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, size);
}
