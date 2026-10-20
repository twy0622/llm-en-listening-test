import { useEffect, useRef, useState } from "react";
import { PlayIcon, VolumeIcon } from "./icons";
import { formatClock } from "../lib/format";

type Phase = "ready" | "playing" | "gap" | "done";

const WAVE = Array.from({ length: 34 }, (_, index) => 18 + ((index * 47) % 66));
const GAP_SECONDS = 30;
const MAX_PLAYS = 2;

export default function AudioPlayer({
  src,
  durationSec,
  label = "Recording",
}: {
  src: string;
  durationSec: number;
  label?: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const playsRef = useRef(0);
  const [plays, setPlays] = useState(0);
  const [phase, setPhase] = useState<Phase>("ready");
  const [gapLeft, setGapLeft] = useState(GAP_SECONDS);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  useEffect(() => {
    if (phase !== "gap") return;
    if (gapLeft <= 0) {
      setPhase("ready");
      return;
    }
    const timer = window.setTimeout(() => setGapLeft((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [phase, gapLeft]);

  async function handlePlay() {
    const element = audioRef.current;
    if (!element || phase === "playing" || phase === "gap" || playsRef.current >= MAX_PLAYS) {
      return;
    }
    element.currentTime = 0;
    try {
      await element.play();
      playsRef.current += 1;
      setPlays(playsRef.current);
      setPhase("playing");
      setError(null);
    } catch {
      setError("The audio could not start. Check your connection and try again.");
    }
  }

  function handleEnded() {
    setProgress(100);
    if (playsRef.current >= MAX_PLAYS) {
      setPhase("done");
      return;
    }
    setGapLeft(GAP_SECONDS);
    setPhase("gap");
  }

  const disabled = phase === "playing" || phase === "gap" || phase === "done";
  const buttonLabel =
    phase === "playing"
      ? "Playing…"
      : phase === "gap"
        ? `Break ${formatClock(gapLeft)}`
        : phase === "done"
          ? "Finished"
          : plays === 0
            ? "Play recording"
            : "Play again · 1 left";

  return (
    <div className="paper-panel px-6 py-6 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
          <VolumeIcon className="h-4 w-4" />
          {label}
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-muted">
          <span className="border border-line px-2 py-0.5">
            Play {plays} / {MAX_PLAYS}
          </span>
          <span className="tabular">{formatClock(durationSec)}</span>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-4 sm:gap-6">
        <button
          type="button"
          onClick={handlePlay}
          disabled={disabled}
          className="flex h-12 w-12 shrink-0 items-center justify-center border border-accent bg-accent text-white
            transition-colors hover:border-accent-ink hover:bg-accent-ink disabled:cursor-not-allowed
            disabled:border-line disabled:bg-paper-deep disabled:text-muted"
          aria-label={buttonLabel}
        >
          {phase === "playing" ? (
            <span className="flex h-5 items-end gap-1" aria-hidden="true">
              <span className="h-3 w-1 animate-bar-1 bg-current" />
              <span className="h-5 w-1 animate-bar-2 bg-current" />
              <span className="h-4 w-1 animate-bar-3 bg-current" />
            </span>
          ) : (
            <PlayIcon className="ml-0.5 h-5 w-5" />
          )}
        </button>

        <div className="min-w-0 flex-1">
          <div className="flex h-12 items-center gap-[3px]" aria-hidden="true">
            {WAVE.map((height, index) => (
              <span
                key={index}
                className={`w-1 shrink-0 transition-colors ${
                  (progress / 100) * WAVE.length > index ? "bg-accent" : "bg-line"
                }`}
                style={{
                  height: `${height}%`,
                  animation:
                    phase === "playing" && index % 3 === 0
                      ? `bar-${(index % 3) + 1} ${0.7 + (index % 5) * 0.12}s ease-in-out infinite`
                      : undefined,
                }}
              />
            ))}
          </div>
          <div className="mt-1 h-1 overflow-hidden bg-paper-deep">
            <div
              className="h-full bg-accent transition-[width] duration-200"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span aria-live="polite">
          {phase === "playing" && "Playing — listen carefully."}
          {phase === "gap" && `Short break. The second play unlocks in ${formatClock(gapLeft)}.`}
          {phase === "ready" && plays === 0 && "You will hear this recording twice."}
          {phase === "ready" && plays === 1 && "Second play unlocked."}
          {phase === "done" && "Recording finished. Answer the questions below."}
        </span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-muted/70">
          Seeking disabled · two plays
        </span>
      </div>

      {error && (
        <p className="mt-3 border border-danger/30 bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}

      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onEnded={handleEnded}
        onTimeUpdate={(event) => {
          const element = event.currentTarget;
          if (Number.isFinite(element.duration) && element.duration > 0) {
            setProgress(Math.min(100, (element.currentTime / element.duration) * 100));
          }
        }}
        onError={() => setError("The recording failed to load. Check your connection and reload the page.")}
      />
    </div>
  );
}
