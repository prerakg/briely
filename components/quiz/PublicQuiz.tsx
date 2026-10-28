import React, { useCallback, useEffect, useRef, useState } from "react";
import { request, post } from "../../services/api";
import type {
  PublicQuiz as Quiz,
  AttemptState,
  QuizResult,
} from "../../quizTypes";
import {
  button,
  secondary,
  ErrorNotice,
  QuestionInput,
  ResultView,
  useClock,
  ThemeToggle,
} from "./Shared";

export default function PublicQuiz({ shareId }: { shareId: string }) {
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [attempt, setAttempt] = useState<AttemptState | null>(null);
  const [result, setResult] = useState<QuizResult | null>(null);
  const [leaders, setLeaders] = useState<
    { name: string; percentage: number }[]
  >([]);
  useEffect(() => {
    if (result && quiz?.settings.leaderboard)
      void request<{ name: string; percentage: number }[]>(
        "/shared-quizzes/" + shareId + "/leaderboard",
        { headers: { "X-Invite-Code": invite } },
      )
        .then(setLeaders)
        .catch(() => {});
  }, [result, quiz?.settings.leaderboard, shareId]);
  const [name, setName] = useState("");
  const [invite, setInvite] = useState("");
  const [answers, setAnswers] = useState<Record<string, number[]>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const submitting = useRef(false);
  const now = useClock(attempt?.server_time);
  const key = "briefly_attempt_" + shareId;
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const saved = sessionStorage.getItem(key);
      if (saved) {
        const a = await request<AttemptState>("/attempts/" + saved);
        setAttempt(a);
        if (a.result) setResult(a.result);
        else setQuiz(a);
      } else
        setQuiz(
          await request<Quiz>("/shared-quizzes/" + shareId, {
            headers: { "X-Invite-Code": invite },
          }),
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [shareId, invite, key]);
  useEffect(() => {
    void load();
  }, [shareId]);
  useEffect(() => {
    const saved = sessionStorage.getItem(key + "_answers");
    if (saved) {
      try {
        setAnswers(JSON.parse(saved));
      } catch {}
    }
  }, [key]);
  const submit = useCallback(async () => {
    if (!attempt || submitting.current || result) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      setResult(
        await request<QuizResult>(
          "/attempts/" + attempt.attempt_id + "/submit",
          post({ answers }),
        ),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }, [attempt, answers, result]);
  const autoSubmitted = useRef(false);
  useEffect(() => {
    if (
      attempt &&
      !result &&
      now >= attempt.deadline &&
      !autoSubmitted.current
    ) {
      autoSubmitted.current = true;
      void submit();
    }
  }, [now, attempt, result, submit]);
  async function start() {
    setBusy(true);
    setError("");
    try {
      const a = await request<AttemptState>(
        "/shared-quizzes/" + shareId + "/attempts",
        post({ name, invite }),
      );
      setAttempt(a);
      setQuiz(a);
      sessionStorage.setItem(key, a.attempt_id);
      autoSubmitted.current = false;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const remaining = attempt
    ? Math.max(0, Math.ceil(attempt.deadline - now))
    : 0;
  return (
    <div className="q-public">
      <header className="q-public-header">
        <a href="/" className="q-brand">
          ✦ Briefly <span>AI 2.0</span>
        </a>
        <span className="q-muted">Learn. Challenge. Grow.</span>
        <ThemeToggle />
      </header>
      <main className="q-public-main">
        <ErrorNotice error={error} />
        {loading ? (
          <p role="status">Loading your quiz…</p>
        ) : result ? (
          <>
            <ResultView result={result} />
            {leaders.length > 0 && (
              <section className="q-card">
                <h2>Public leaderboard</h2>
                {leaders.map((p, i) => (
                  <div className="q-row q-between" key={i}>
                    <span>
                      {i + 1}. {p.name}
                    </span>
                    <strong>{p.percentage}%</strong>
                  </div>
                ))}
              </section>
            )}
            <div className="q-row">
              <button
                className={button}
                onClick={() => {
                  sessionStorage.removeItem(key);
                  sessionStorage.removeItem(key + "_answers");
                  setAttempt(null);
                  setResult(null);
                  setAnswers({});
                  autoSubmitted.current = false;
                  void load();
                }}
              >
                Try again
              </button>
              <a className={secondary} href="/">
                Back to study library
              </a>
            </div>
          </>
        ) : !attempt ? (
          <div className="q-card q-welcome">
            <span className="q-eyebrow">
              A LITTLE CHALLENGE. A LOT OF LEARNING.
            </span>
            <h1>{quiz?.title || "Your shared quiz"}</h1>
            {quiz ? (
              <>
                <div className="q-metrics">
                  <div>
                    <strong>{quiz.question_count}</strong>
                    <span>questions</span>
                  </div>
                  <div>
                    <strong>
                      {Math.round(quiz.settings.time_limit_seconds / 60)}
                    </strong>
                    <span>minutes</span>
                  </div>
                  <div>
                    <strong>{quiz.settings.max_attempts}</strong>
                    <span>attempts / browser</span>
                  </div>
                </div>
                <p>Your answers are graded securely after submission.</p>
                <p className="q-muted">
                  Guest attempt limits apply to this browser session, not a
                  verified person.{" "}
                  {quiz.settings.leaderboard
                    ? "Your display name and score appear on the public leaderboard."
                    : "Your name and score are visible to the quiz creator."}
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void start();
                  }}
                  className="q-stack"
                >
                  <label>
                    Your display name
                    <input
                      required
                      maxLength={60}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="How should we call you?"
                    />
                  </label>
                  <button disabled={busy || !name.trim()} className={button}>
                    {busy ? "Starting…" : "Start Quiz →"}
                  </button>
                </form>
              </>
            ) : (
              <form
                className="q-stack"
                onSubmit={(e) => {
                  e.preventDefault();
                  void load();
                }}
              >
                <label>
                  Invitation code (for private quizzes)
                  <input
                    value={invite}
                    onChange={(e) => setInvite(e.target.value)}
                    maxLength={100}
                  />
                </label>
                <button className={button}>Open quiz</button>
              </form>
            )}
          </div>
        ) : (
          <div className="q-stack">
            <div className="q-card q-row q-between q-sticky">
              <div>
                <span className="q-eyebrow">KNOWLEDGE CHECK</span>
                <h2>{quiz?.title}</h2>
                <span className="q-muted">
                  {Object.values(answers).filter((a) => a.length).length} of{" "}
                  {attempt.questions.length} answered
                </span>
              </div>
              <strong
                aria-label="Time remaining"
                className={remaining < 30 ? "q-bad" : "q-timer"}
              >
                {Math.floor(remaining / 60)}:
                {String(remaining % 60).padStart(2, "0")}
              </strong>
            </div>
            {attempt.questions.map((q, i) => (
              <QuestionInput
                key={q.id}
                index={i}
                question={q}
                selected={answers[q.id] || []}
                disabled={busy || remaining === 0}
                onChange={(a) => {
                  const next = { ...answers, [q.id]: a };
                  setAnswers(next);
                  sessionStorage.setItem(
                    key + "_answers",
                    JSON.stringify(next),
                  );
                }}
              />
            ))}
            <button
              className={button}
              disabled={busy}
              onClick={() => void submit()}
            >
              {busy ? "Submitting…" : "Submit answers"}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
