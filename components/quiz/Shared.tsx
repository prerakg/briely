import React, { useEffect, useRef, useState } from "react";
import type { PublicQuestion, QuizResult } from "../../quizTypes";
export const button = "q-button";
export const secondary = "q-button q-secondary";
export function ErrorNotice({ error }: { error: string }) {
  return error ? (
    <div className="q-error" role="alert">
      {error}
    </div>
  ) : null;
}
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog ref={ref} className="q-modal" aria-label={title} onCancel={onClose}>
      <div className="q-row q-between">
        <h2>{title}</h2>
        <button
          className={secondary}
          onClick={onClose}
          aria-label="Close dialog"
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function QuestionInput({
  question,
  selected,
  onChange,
  disabled = false,
  index,
}: {
  question: PublicQuestion;
  selected: number[];
  onChange: (value: number[]) => void;
  disabled?: boolean;
  index: number;
}) {
  return (
    <fieldset className="q-card q-question" disabled={disabled}>
      <legend>
        <span className="q-eyebrow">
          QUESTION {index + 1} ·{" "}
          {question.type === "multiple"
            ? "SELECT ALL THAT APPLY"
            : "SELECT ONE"}
        </span>
        <h3>{question.question}</h3>
      </legend>
      <div className="q-options">
        {question.options.map((option, i) => (
          <label
            key={i}
            className={"q-option " + (selected.includes(i) ? "selected" : "")}
          >
            <input
              type={question.type === "multiple" ? "checkbox" : "radio"}
              name={"question-" + question.id}
              checked={selected.includes(i)}
              onChange={() =>
                onChange(
                  question.type === "multiple"
                    ? selected.includes(i)
                      ? selected.filter((v) => v !== i)
                      : [...selected, i]
                    : [i],
                )
              }
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
      <span className="q-muted">
        {question.topic} · {question.difficulty}
      </span>
    </fieldset>
  );
}
export function ResultView({ result }: { result: QuizResult }) {
  return (
    <div className="q-stack">
      <div className="q-card q-result">
        <span className="q-eyebrow">YOUR RESULTS</span>
        <div className="q-score">
          {result.percentage}
          <small>%</small>
        </div>
        <h2>
          {result.score} of {result.total} correct
        </h2>
        <p>
          {result.time_taken}s · {result.total - result.score} incorrect or
          unanswered
        </p>
        {result.timed_out && (
          <p className="q-error">
            Time expired before submission. This attempt received no credit.
          </p>
        )}
      </div>
      {result.weak_topics.length > 0 && (
        <div className="q-card">
          <h3>Focus your next study session</h3>
          {result.recommendations.map((r, i) => (
            <p key={i}>{r}</p>
          ))}
          <p className="q-muted">
            These revision suggestions follow your scores. A creator can
            generate an AI study plan in Study Planner.
          </p>
        </div>
      )}
      {result.feedback.map((f, i) => (
        <article key={f.id} className="q-card">
          <span className={f.correct ? "q-good" : "q-bad"}>
            {f.correct ? "Correct" : "Review"} · Question {i + 1}
          </span>
          <h3>{f.question}</h3>
          {f.correct_answers && (
            <p>
              <strong>Answer:</strong> {f.correct_answers.join(", ")}
            </p>
          )}
          {f.explanation && <p>{f.explanation}</p>}
        </article>
      ))}
    </div>
  );
}
export function CopyLink({ value }: { value: string }) {
  const [message, setMessage] = useState("");
  return (
    <div className="q-stack">
      <input
        aria-label="Shareable link"
        readOnly
        value={value}
        onFocus={(e) => e.target.select()}
      />
      <button
        className={button}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setMessage("Copied to clipboard");
          } catch {
            setMessage("Select the link above and copy it manually.");
          }
        }}
      >
        Copy link
      </button>
      <span role="status" className="q-muted">
        {message}
      </span>
    </div>
  );
}
export function useClock(serverTime?: number) {
  const [now, setNow] = useState(Date.now() / 1000);
  const offset = useRef(0);
  useEffect(() => {
    if (serverTime) offset.current = serverTime - Date.now() / 1000;
  }, [serverTime]);
  useEffect(() => {
    const timer = window.setInterval(
      () => setNow(Date.now() / 1000 + offset.current),
      500,
    );
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function ThemeToggle() {
  const [dark, setDark] = useState(() =>
    document.documentElement.classList.contains("dark"),
  );
  return (
    <button
      className={secondary}
      aria-label="Toggle color theme"
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.classList.toggle("dark", next);
        localStorage.setItem("briefly_dark_mode", JSON.stringify(next));
      }}
    >
      {dark ? "☀ Light" : "☾ Dark"}
    </button>
  );
}
