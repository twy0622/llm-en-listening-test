import type { PublicQuestion } from "@listening/shared";
import { SKILL_LABELS } from "../lib/format";

const TYPE_LABEL: Record<PublicQuestion["type"], string> = {
  mcq: "Multiple choice",
  gapfill: "Gap fill",
  subjective: "Short answer",
};

export default function QuestionCard({
  question,
  index,
  value,
  onChange,
}: {
  question: PublicQuestion;
  index: number;
  value: string;
  onChange: (value: string) => void;
}) {
  const inputId = `q-${question.id}`;
  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;

  return (
    <fieldset className="card border-l-2 border-l-accent p-6 sm:p-7">
      <legend className="sr-only">Question {index}</legend>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label text-accent">
          Question {index} · <span className="normal-case tracking-normal text-muted">{TYPE_LABEL[question.type]}</span>
        </span>
        <div className="flex items-center gap-2">
          <span className="pill">{SKILL_LABELS[question.skill] ?? question.skill}</span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
            {question.points} {question.points === 1 ? "point" : "points"}
          </span>
        </div>
      </div>

      <p id={`${inputId}-prompt`} className="mt-3 font-serif text-lg leading-7 text-ink">
        {question.prompt}
      </p>

      {question.type === "mcq" && question.choices && (
        <div className="mt-5 grid gap-2.5" role="radiogroup" aria-labelledby={`${inputId}-prompt`}>
          {question.choices.map((choice) => {
            const selected = value === choice.key;
            return (
              <label key={choice.key} className={`choice ${selected ? "border-accent bg-accent-soft/60" : ""}`}>
                <input
                  type="radio"
                  name={inputId}
                  value={choice.key}
                  checked={selected}
                  onChange={() => onChange(choice.key)}
                  className="sr-only"
                />
                <span className={`choice-key ${selected ? "border-accent bg-accent text-white" : ""}`}>
                  {choice.key}
                </span>
                <span className="pt-0.5 text-[15px] leading-6 text-ink-soft">{choice.text}</span>
              </label>
            );
          })}
        </div>
      )}

      {question.type === "gapfill" && (
        <div className="mt-5">
          <label htmlFor={inputId} className="label">
            Your answer
          </label>
          <input
            id={inputId}
            type="text"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            className="input mt-2"
            placeholder="Type the missing word or phrase"
            autoComplete="off"
            spellCheck={false}
            aria-describedby={`${inputId}-help`}
          />
          <p id={`${inputId}-help`} className="mt-2 text-xs text-muted">
            Write only the missing word or phrase, exactly as you hear it.
          </p>
        </div>
      )}

      {question.type === "subjective" && (
        <div className="mt-5">
          <label htmlFor={inputId} className="label">
            Your answer
          </label>
          <textarea
            id={inputId}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            rows={5}
            className="input mt-2 resize-y leading-7"
            placeholder="Explain the speaker's viewpoint in your own words…"
            aria-describedby={`${inputId}-help`}
          />
          <div id={`${inputId}-help`} className="mt-2 flex items-center justify-between text-xs text-muted">
            <span>Aim for 40–80 words. Use your own words.</span>
            <span className={wordCount > 120 ? "text-gold" : ""}>{wordCount} words</span>
          </div>
        </div>
      )}
    </fieldset>
  );
}
