import MaterialLibrary from "./MaterialLibrary";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import type { LectureData } from "../../types";
import type {
  QuizDocument,
  QuizListItem,
  Question,
  Analytics,
  AgentRun,
  ProviderStatus,
} from "../../quizTypes";
import {
  creatorRequest,
  initializeSession,
  resetSession,
  request,
  post,
  AuthState,
} from "../../services/api";
import {
  button,
  secondary,
  CopyLink,
  ErrorNotice,
  Modal,
  QuestionInput,
} from "./Shared";

type Tab = "quizzes" | "materials" | "activity" | "planner" | "settings";
const defaults = {
  time_limit_seconds: 600,
  max_attempts: 3,
  show_explanations: true,
  shuffle_questions: true,
  shuffle_options: true,
  expires_at: null,
  access: "public" as const,
  leaderboard: false,
};
const blankQuestion = (): Question => ({
  id: crypto.randomUUID(),
  question: "",
  type: "single",
  options: ["", ""],
  correct: [0],
  explanation: "",
  difficulty: "medium",
  topic: "General",
  source_quote: "",
});
export default function QuizStudio({
  lectures,
  initialLecture,
  onLibrary,
  onImport,
}: {
  lectures: LectureData[];
  initialLecture?: string;
  onLibrary: () => void;
  onImport: (lecture: LectureData) => void;
}) {
  const [tab, setTab] = useState<Tab>("quizzes");
  const [sourceId, setSourceId] = useState(
    initialLecture || lectures[0]?.id || "",
  );
  const [sourceKind, setSourceKind] = useState("transcript");
  const [count, setCount] = useState(10);
  const [difficulty, setDifficulty] = useState("mixed");
  const [questionType, setQuestionType] = useState("single");
  const [quizzes, setQuizzes] = useState<QuizListItem[]>([]);
  const [draft, setDraft] = useState<QuizDocument | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(true);
  const [share, setShare] = useState<{ url: string; invite?: string } | null>(
    null,
  );
  const [preview, setPreview] = useState(false);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [analyticsId, setAnalyticsId] = useState("");
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [providers, setProviders] = useState<ProviderStatus | null>(null);
  const [auth, setAuth] = useState<AuthState | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [plan, setPlan] = useState("");
  const [planQuiz, setPlanQuiz] = useState("");
  const [savedPlans, setSavedPlans] = useState<
    { id: string; content: string; created: number }[]
  >([]);
  useEffect(() => {
    if (tab === "planner" && auth?.authenticated)
      void creatorRequest<{ id: string; content: string; created: number }[]>(
        "/study-plans",
      )
        .then(setSavedPlans)
        .catch(() => {});
  }, [tab, auth?.authenticated]);
  const autoStarted = useRef(false);
  const sourceLecture = lectures.find((l) => l.id === sourceId);
  const source =
    sourceKind === "notes"
      ? sourceLecture?.studyNotes
      : sourceKind === "summary"
        ? sourceLecture?.summary
          ? JSON.stringify(sourceLecture.summary)
          : ""
        : sourceLecture?.transcriptText;
  const refresh = useCallback(async () => {
    const [list, status, activity] = await Promise.all([
      creatorRequest<QuizListItem[]>("/quizzes"),
      creatorRequest<ProviderStatus>("/ai/providers"),
      creatorRequest<AgentRun[]>("/agents/runs"),
    ]);
    setQuizzes(list);
    setProviders(status);
    setRuns(activity);
  }, []);
  const action = useCallback(async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    let active = true;
    void initializeSession()
      .then(async (s) => {
        if (!active) return;
        setAuth(s);
        if (s.authenticated) await refresh();
        else setTab("settings");
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (tab !== "activity" || !auth?.authenticated) return;
    const timer = window.setInterval(() => {
      void creatorRequest<AgentRun[]>("/agents/runs")
        .then(setRuns)
        .catch(() => {});
    }, 3000);
    return () => window.clearInterval(timer);
  }, [tab, auth?.authenticated]);
  async function create() {
    if (!source) {
      setError("Choose study material with text first.");
      return;
    }
    await action(async () => {
      const d = await creatorRequest<QuizDocument>(
        "/quizzes/generate",
        post({
          source,
          title: sourceLecture?.title || "Knowledge check",
          count,
          difficulty,
          question_type: questionType,
        }),
      );
      setDraft(d);
      await refresh();
      setNotice(
        "Quiz created and independently reviewed against source material. Review it before publishing.",
      );
    });
  }
  useEffect(() => {
    if (
      initialLecture &&
      !loading &&
      auth?.authenticated &&
      !autoStarted.current
    ) {
      autoStarted.current = true;
      void create();
    }
  }, [initialLecture, loading, auth?.authenticated]);
  function updateQuestion(index: number, partial: Partial<Question>) {
    setDraft((d) =>
      d
        ? {
            ...d,
            questions: d.questions.map((q, i) =>
              i === index ? { ...q, ...partial } : q,
            ),
          }
        : d,
    );
  }
  async function saveDraft() {
    if (!draft) throw new Error("No quiz selected");
    const payload = {
      title: draft.title,
      questions: draft.questions,
      settings: draft.settings,
    };
    const saved = await creatorRequest<QuizDocument>(
      draft.id ? "/quizzes/" + draft.id : "/quizzes",
      { method: draft.id ? "PATCH" : "POST", body: JSON.stringify(payload) },
    );
    setDraft(saved);
    await refresh();
    return saved;
  }
  async function showAnalytics(id: string, offset = 0) {
    setAnalyticsId(id);
    setAnalytics(
      await creatorRequest<Analytics>(
        `/quizzes/${id}/analytics?offset=${offset}&limit=20`,
      ),
    );
  }
  function sourcePicker() {
    return (
      <div className="q-source-fields">
        <label>
          Study material
          <select
            aria-label="Study material"
            value={sourceId}
            onChange={(e) => setSourceId(e.target.value)}
          >
            <option value="">Select material</option>
            {lectures.map((l) => (
              <option value={l.id} key={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Use content from
          <select
            value={sourceKind}
            onChange={(e) => setSourceKind(e.target.value)}
          >
            <option value="transcript">Original text / transcript</option>
            <option value="notes" disabled={!sourceLecture?.studyNotes}>
              Study notes
            </option>
            <option value="summary" disabled={!sourceLecture?.summary}>
              Summary
            </option>
          </select>
        </label>
      </div>
    );
  }
  return (
    <div className="q-studio">
      <header className="q-studio-header">
        <div>
          <span className="q-eyebrow">
            BRIEFLY AI 2.0 / YOUR LEARNING SPACE
          </span>
          <h1>Better together.</h1>
          <p className="q-muted">
            Turn what you learn into a challenge worth sharing.
          </p>
        </div>
        <button className={secondary} onClick={onLibrary}>
          ← Study library
        </button>
      </header>
      <nav className="q-tabs" aria-label="Quiz studio">
        {(
          ["quizzes", "materials", "activity", "planner", "settings"] as Tab[]
        ).map((t) => (
          <button
            key={t}
            className={tab === t ? "active" : ""}
            onClick={() => setTab(t)}
          >
            {
              {
                quizzes: "Quiz Studio",
                materials: "Cloud Library",
                activity: "AI Activity",
                planner: "Study Planner",
                settings: "AI Settings",
              }[t]
            }
          </button>
        ))}
      </nav>
      <ErrorNotice error={error} />
      {notice && (
        <div className="q-notice" role="status">
          {notice}
        </div>
      )}
      {loading ? (
        <div className="q-card q-skeleton" role="status">
          Connecting to your learning space…
        </div>
      ) : (
        <>
          {tab === "quizzes" && (
            <div className="q-stack">
              {!draft ? (
                <>
                  <section className="q-hero">
                    <div>
                      <span className="q-eyebrow">
                        FROM UNDERSTANDING TO CONFIDENCE
                      </span>
                      <h2>
                        Your next challenge
                        <br />
                        starts with a question.
                      </h2>
                      <p>
                        Create a quiz from your study materials. Share it with
                        friends.
                        <br className="q-desktop" /> See what sticks, and what
                        to revisit.
                      </p>
                    </div>
                    <div className="q-orbit" aria-hidden="true">
                      <span>✦</span>
                      <small>LEARN ↗</small>
                      <b>10</b>
                      <em>new ways to grow</em>
                    </div>
                  </section>
                  <section className="q-card">
                    <div className="q-row q-between">
                      <h2>Create your next quiz</h2>
                      <span className="q-pill">
                        10 questions · mixed difficulty
                      </span>
                    </div>
                    {sourcePicker()}
                    <details className="q-advanced">
                      <summary>
                        Customize question count, difficulty and type
                      </summary>
                      <div className="q-grid three">
                        <label>
                          Questions
                          <input
                            type="number"
                            min={1}
                            max={30}
                            value={count}
                            onChange={(e) => setCount(Number(e.target.value))}
                          />
                        </label>
                        <label>
                          Difficulty
                          <select
                            value={difficulty}
                            onChange={(e) => setDifficulty(e.target.value)}
                          >
                            {["mixed", "easy", "medium", "hard"].map((d) => (
                              <option key={d}>{d}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Question type
                          <select
                            value={questionType}
                            onChange={(e) => setQuestionType(e.target.value)}
                          >
                            <option value="single">Single answer</option>
                            <option value="multiple">Multiple answers</option>
                            <option value="boolean">True / false</option>
                            <option value="mixed">Mixed types</option>
                          </select>
                        </label>
                      </div>
                    </details>
                    <div className="q-row q-wrap">
                      <button
                        className={button}
                        disabled={busy || !source || count < 1 || count > 30}
                        onClick={() => void create()}
                      >
                        {busy
                          ? "Retrieving → generating → verifying…"
                          : "✦ Create Quiz"}
                      </button>
                      <button
                        className={secondary}
                        disabled={busy}
                        onClick={() =>
                          setDraft({
                            id: "",
                            title: "Untitled quiz",
                            settings: { ...defaults },
                            questions: [blankQuestion()],
                          })
                        }
                      >
                        Write my own
                      </button>
                      {sourceLecture?.quiz?.length > 0 && (
                        <button
                          className={secondary}
                          disabled={busy}
                          onClick={() => {
                            const qs = sourceLecture.quiz;
                            if (
                              qs.some(
                                (q) => !q.options.includes(q.correctAnswer),
                              )
                            ) {
                              setError(
                                "An existing answer does not match its options. Correct it in the original material first.",
                              );
                              return;
                            }
                            setDraft({
                              id: "",
                              title: sourceLecture.title,
                              settings: { ...defaults },
                              questions: qs.map((q) => ({
                                ...blankQuestion(),
                                question: q.question,
                                options: q.options,
                                correct: [q.options.indexOf(q.correctAnswer)],
                                explanation: q.explanation,
                              })),
                            });
                          }}
                        >
                          Use existing practice quiz
                        </button>
                      )}
                    </div>
                    <p className="q-muted q-small">
                      Only the selected source is sent for generation. Your
                      local library stays in your browser.
                    </p>
                  </section>
                  <section>
                    <div className="q-row q-between">
                      <h2>
                        Your quizzes{" "}
                        <span className="q-muted">{quizzes.length}</span>
                      </h2>
                      <button
                        className={secondary}
                        disabled={busy}
                        onClick={() => void action(refresh)}
                      >
                        Refresh
                      </button>
                    </div>
                    {quizzes.length === 0 ? (
                      <div className="q-card q-empty">
                        <h3>A fresh page for your next breakthrough.</h3>
                        <p>
                          Create your first quiz above, or write your own
                          without an AI key.
                        </p>
                      </div>
                    ) : (
                      <div className="q-grid">
                        {quizzes.map((q) => (
                          <article className="q-card q-quiz-tile" key={q.id}>
                            <span className="q-eyebrow">
                              {q.publications.some((v) => v.active)
                                ? "PUBLISHED"
                                : "DRAFT"}
                            </span>
                            <h3>{q.title}</h3>
                            <p className="q-muted">
                              {q.question_count} questions ·{" "}
                              {new Date(q.created * 1000).toLocaleDateString()}
                            </p>
                            <div className="q-row q-wrap">
                              <button
                                className={secondary}
                                disabled={busy}
                                onClick={() =>
                                  void action(async () =>
                                    setDraft(
                                      await creatorRequest("/quizzes/" + q.id),
                                    ),
                                  )
                                }
                              >
                                Edit
                              </button>
                              <button
                                className={secondary}
                                disabled={busy}
                                onClick={() =>
                                  void action(() => showAnalytics(q.id))
                                }
                              >
                                Analytics
                              </button>
                              {q.publications.find((v) => v.active) && (
                                <>
                                  <button
                                    className={secondary}
                                    onClick={() =>
                                      setShare({
                                        url:
                                          location.origin +
                                          "/quiz/" +
                                          q.publications.find((v) => v.active)!
                                            .share_id,
                                      })
                                    }
                                  >
                                    Share
                                  </button>
                                  <button
                                    className={button}
                                    disabled={busy}
                                    onClick={() =>
                                      void action(async () => {
                                        const r = await creatorRequest<{
                                          url: string;
                                        }>(
                                          "/quiz-rooms",
                                          post({
                                            share_id: q.publications.find(
                                              (v) => v.active,
                                            )!.share_id,
                                          }),
                                        );
                                        location.assign(r.url);
                                      })
                                    }
                                  >
                                    Start Quiz Battle
                                  </button>
                                  <button
                                    className={secondary}
                                    disabled={busy}
                                    onClick={() =>
                                      void action(async () => {
                                        await creatorRequest(
                                          "/quizzes/" + q.id + "/unpublish",
                                          { method: "POST" },
                                        );
                                        await refresh();
                                        setNotice(
                                          "All published links for this quiz have been disabled. Attempt history is preserved.",
                                        );
                                      })
                                    }
                                  >
                                    Unpublish
                                  </button>
                                </>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                  </section>
                </>
              ) : (
                <section className="q-stack">
                  <div className="q-card">
                    <div className="q-row q-between">
                      <h2>Make it your own.</h2>
                      <button
                        className={secondary}
                        disabled={busy}
                        onClick={() => {
                          if (
                            confirm(
                              "Leave editor? Unsaved changes will be lost.",
                            )
                          )
                            setDraft(null);
                        }}
                      >
                        Close editor
                      </button>
                    </div>
                    <label>
                      Quiz title
                      <input
                        value={draft.title}
                        maxLength={160}
                        onChange={(e) =>
                          setDraft({ ...draft, title: e.target.value })
                        }
                      />
                    </label>
                    <div className="q-grid three">
                      <label>
                        Time limit (minutes)
                        <input
                          type="number"
                          min={0.5}
                          max={240}
                          step={0.5}
                          value={draft.settings.time_limit_seconds / 60}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              settings: {
                                ...draft.settings,
                                time_limit_seconds: Math.round(
                                  Number(e.target.value) * 60,
                                ),
                              },
                            })
                          }
                        />
                      </label>
                      <label>
                        Attempts per browser
                        <input
                          type="number"
                          min={1}
                          max={20}
                          value={draft.settings.max_attempts}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              settings: {
                                ...draft.settings,
                                max_attempts: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                      <label>
                        Access
                        <select
                          value={draft.settings.access}
                          onChange={(e) =>
                            setDraft({
                              ...draft,
                              settings: {
                                ...draft.settings,
                                access: e.target.value as "public" | "private",
                              },
                            })
                          }
                        >
                          <option value="public">Public link</option>
                          <option value="private">
                            Invitation code required
                          </option>
                        </select>
                      </label>
                    </div>
                    <label>
                      Expiration (optional, your local time)
                      <input
                        type="datetime-local"
                        value={
                          draft.settings.expires_at
                            ? new Date(
                                new Date(draft.settings.expires_at).getTime() -
                                  new Date().getTimezoneOffset() * 60000,
                              )
                                .toISOString()
                                .slice(0, 16)
                            : ""
                        }
                        onChange={(e) =>
                          setDraft({
                            ...draft,
                            settings: {
                              ...draft.settings,
                              expires_at: e.target.value
                                ? new Date(e.target.value).toISOString()
                                : null,
                            },
                          })
                        }
                      />
                    </label>
                    <div className="q-row q-wrap">
                      {(
                        [
                          "shuffle_questions",
                          "shuffle_options",
                          "show_explanations",
                          "leaderboard",
                        ] as const
                      ).map((k) => (
                        <label className="q-check" key={k}>
                          <input
                            type="checkbox"
                            checked={draft.settings[k]}
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                settings: {
                                  ...draft.settings,
                                  [k]: e.target.checked,
                                },
                              })
                            }
                          />
                          {
                            {
                              shuffle_questions: "Shuffle questions",
                              shuffle_options: "Shuffle options",
                              show_explanations: "Explain after submission",
                              leaderboard: "Public leaderboard",
                            }[k]
                          }
                        </label>
                      ))}
                    </div>
                    <details className="q-advanced">
                      <summary>Source for question regeneration</summary>
                      {sourcePicker()}
                    </details>
                  </div>
                  {draft.questions.map((q, i) => (
                    <article className="q-card q-stack" key={q.id}>
                      <div className="q-row q-between">
                        <span className="q-eyebrow">QUESTION {i + 1}</span>
                        <div className="q-row">
                          <button
                            aria-label={"Move question " + (i + 1) + " up"}
                            className={secondary}
                            disabled={i === 0 || busy}
                            onClick={() => {
                              const questions = [...draft.questions];
                              [questions[i - 1], questions[i]] = [
                                questions[i],
                                questions[i - 1],
                              ];
                              setDraft({ ...draft, questions });
                            }}
                          >
                            ↑
                          </button>
                          <button
                            aria-label={"Move question " + (i + 1) + " down"}
                            className={secondary}
                            disabled={i === draft.questions.length - 1 || busy}
                            onClick={() => {
                              const questions = [...draft.questions];
                              [questions[i + 1], questions[i]] = [
                                questions[i],
                                questions[i + 1],
                              ];
                              setDraft({ ...draft, questions });
                            }}
                          >
                            ↓
                          </button>
                          <button
                            className={secondary}
                            disabled={busy || !source}
                            onClick={() =>
                              void action(async () => {
                                const r = await creatorRequest<{
                                  result: QuizDocument;
                                }>(
                                  "/agents/quiz",
                                  post({
                                    source,
                                    count: 1,
                                    title: draft.title,
                                    difficulty: q.difficulty,
                                    question_type: q.type,
                                    exclude: draft.questions.map(
                                      (v) => v.question,
                                    ),
                                  }),
                                );
                                updateQuestion(i, {
                                  ...r.result.questions[0],
                                  id: q.id,
                                });
                                setNotice(
                                  "Question regenerated. Review its answer before saving.",
                                );
                              })
                            }
                          >
                            Regenerate
                          </button>
                          <button
                            className={secondary}
                            disabled={draft.questions.length <= 1 || busy}
                            onClick={() =>
                              setDraft({
                                ...draft,
                                questions: draft.questions.filter(
                                  (_, n) => n !== i,
                                ),
                              })
                            }
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                      <label>
                        Question
                        <textarea
                          value={q.question}
                          onChange={(e) =>
                            updateQuestion(i, { question: e.target.value })
                          }
                        />
                      </label>
                      <div className="q-grid three">
                        <label>
                          Type
                          <select
                            value={q.type}
                            onChange={(e) => {
                              const type = e.target.value as Question["type"];
                              updateQuestion(i, {
                                type,
                                options:
                                  type === "boolean"
                                    ? ["True", "False"]
                                    : q.options,
                                correct: [0],
                              });
                            }}
                          >
                            <option value="single">Single answer</option>
                            <option value="multiple">Multiple answers</option>
                            <option value="boolean">True / false</option>
                          </select>
                        </label>
                        <label>
                          Difficulty
                          <select
                            value={q.difficulty}
                            onChange={(e) =>
                              updateQuestion(i, {
                                difficulty: e.target
                                  .value as Question["difficulty"],
                              })
                            }
                          >
                            {["easy", "medium", "hard"].map((d) => (
                              <option key={d}>{d}</option>
                            ))}
                          </select>
                        </label>
                        <label>
                          Topic
                          <input
                            value={q.topic}
                            onChange={(e) =>
                              updateQuestion(i, { topic: e.target.value })
                            }
                          />
                        </label>
                      </div>
                      <p className="q-muted">
                        Mark the correct answer
                        {q.type === "multiple" ? "s" : ""} using the controls
                        beside the options.
                      </p>
                      {q.options.map((o, n) => (
                        <div className="q-option-editor" key={n}>
                          <input
                            aria-label={
                              "Correct option " +
                              (n + 1) +
                              " for question " +
                              (i + 1)
                            }
                            type={q.type === "multiple" ? "checkbox" : "radio"}
                            name={"correct-" + q.id}
                            checked={q.correct.includes(n)}
                            onChange={() =>
                              updateQuestion(i, {
                                correct:
                                  q.type === "multiple"
                                    ? q.correct.includes(n)
                                      ? q.correct.filter((v) => v !== n)
                                      : [...q.correct, n]
                                    : [n],
                              })
                            }
                          />
                          <input
                            aria-label={
                              "Option " + (n + 1) + " for question " + (i + 1)
                            }
                            value={o}
                            disabled={q.type === "boolean"}
                            onChange={(e) =>
                              updateQuestion(i, {
                                options: q.options.map((v, k) =>
                                  k === n ? e.target.value : v,
                                ),
                              })
                            }
                          />
                          {q.type !== "boolean" && q.options.length > 2 && (
                            <button
                              aria-label={"Remove option " + (n + 1)}
                              className={secondary}
                              onClick={() =>
                                updateQuestion(i, {
                                  options: q.options.filter((_, k) => k !== n),
                                  correct: q.correct
                                    .filter((v) => v !== n)
                                    .map((v) => (v > n ? v - 1 : v)),
                                })
                              }
                            >
                              ×
                            </button>
                          )}
                        </div>
                      ))}
                      {q.type !== "boolean" && q.options.length < 6 && (
                        <button
                          className={secondary}
                          onClick={() =>
                            updateQuestion(i, { options: [...q.options, ""] })
                          }
                        >
                          Add option
                        </button>
                      )}
                      <label>
                        Explanation
                        <textarea
                          value={q.explanation}
                          onChange={(e) =>
                            updateQuestion(i, { explanation: e.target.value })
                          }
                        />
                      </label>
                      {q.source_quote && (
                        <blockquote className="q-source-quote">
                          Source: {q.source_quote}
                        </blockquote>
                      )}
                    </article>
                  ))}
                  <div className="q-card q-row q-wrap q-sticky">
                    <button
                      className={secondary}
                      disabled={busy || draft.questions.length >= 50}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          questions: [...draft.questions, blankQuestion()],
                        })
                      }
                    >
                      Add question
                    </button>
                    <button
                      className={secondary}
                      disabled={busy}
                      onClick={() => setPreview(true)}
                    >
                      Preview
                    </button>
                    <button
                      className={secondary}
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          await saveDraft();
                          setNotice("Draft saved.");
                        })
                      }
                    >
                      Save draft
                    </button>
                    <button
                      className={button}
                      disabled={busy}
                      onClick={() =>
                        void action(async () => {
                          const saved = await saveDraft();
                          setShare(
                            await creatorRequest(
                              "/quizzes/" + saved.id + "/publish",
                              { method: "POST" },
                            ),
                          );
                          await refresh();
                        })
                      }
                    >
                      {busy ? "Working…" : "Publish & Share →"}
                    </button>
                  </div>
                </section>
              )}
            </div>
          )}
          {tab === "materials" && (
            <MaterialLibrary lectures={lectures} onImport={onImport} />
          )}
          {tab === "activity" && (
            <section className="q-stack">
              <div>
                <h2>See your learning take shape.</h2>
                <p className="q-muted">
                  Real workflow steps, provider choices and validation outcomes.
                  Updates every three seconds.
                </p>
              </div>
              {runs.length === 0 ? (
                <div className="q-card q-empty">
                  Create study content to see its workflow here.
                </div>
              ) : (
                runs.map((r) => (
                  <article className="q-card" key={r.id}>
                    <div className="q-row q-between">
                      <h3>{r.workflow}</h3>
                      <span className="q-pill">
                        {r.status} · {r.elapsed.toFixed(1)}s
                      </span>
                    </div>
                    {r.error && <ErrorNotice error={r.error} />}
                    <div className="q-agent-path">
                      {r.steps.map((s, i) => (
                        <div key={i}>
                          <span
                            className={
                              s.status === "failed" ? "q-bad" : "q-good"
                            }
                          >
                            {s.status === "failed"
                              ? "!"
                              : s.status === "needs_revision"
                                ? "↻"
                                : "✓"}
                          </span>
                          <strong>
                            {s.agent}
                            {s.status === "needs_revision"
                              ? " · correcting"
                              : ""}
                          </strong>
                          <small>
                            {s.elapsed.toFixed(1)}s
                            {s.provider ? " · " + s.provider : ""}
                            {s.tokens ? " · " + s.tokens + " tokens" : ""}
                            {s.cached ? " · cached" : ""}
                          </small>
                        </div>
                      ))}
                    </div>
                  </article>
                ))
              )}
            </section>
          )}
          {tab === "planner" && (
            <section className="q-card q-stack">
              <span className="q-eyebrow">A LITTLE PROGRESS, EVERY DAY</span>
              <h2>Study with a direction.</h2>
              <p className="q-muted">
                Build a seven-day revision plan from real quiz performance.
              </p>
              <label>
                Quiz performance
                <select
                  value={planQuiz}
                  onChange={(e) => setPlanQuiz(e.target.value)}
                >
                  <option value="">Choose a quiz</option>
                  {quizzes.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.title}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className={button}
                disabled={busy || !planQuiz}
                onClick={() =>
                  void action(async () => {
                    const stats = await creatorRequest<Analytics>(
                      "/quizzes/" + planQuiz + "/analytics",
                    );
                    if (!stats.total_attempts)
                      throw new Error(
                        "Complete at least one attempt before generating a performance-based plan.",
                      );
                    const r = await creatorRequest<{ result: string }>(
                      "/agents/run",
                      post({
                        task: "planner",
                        source: JSON.stringify({
                          attempts: stats.total_attempts,
                          average: stats.average,
                          topics: stats.topics,
                          questions: stats.questions,
                        }),
                        context: "",
                      }),
                    );
                    setPlan(r.result);
                    await refresh();
                  })
                }
              >
                {busy ? "Creating your plan…" : "✦ Generate study plan"}
              </button>
              {savedPlans.length > 0 && (
                <div>
                  <h3>Saved plans</h3>
                  <div className="q-row q-wrap">
                    {savedPlans.map((p) => (
                      <button
                        className={secondary}
                        key={p.id}
                        onClick={() => setPlan(p.content)}
                      >
                        {new Date(p.created * 1000).toLocaleString()}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {plan && (
                <div
                  className="prose dark:prose-invert"
                  dangerouslySetInnerHTML={{
                    __html: DOMPurify.sanitize(
                      marked.parse(plan, { async: false }) as string,
                    ),
                  }}
                />
              )}
            </section>
          )}
          {tab === "settings" && (
            <section className="q-stack">
              <div className="q-card q-stack">
                <h2>Your AI, clearly configured.</h2>
                <p className="q-muted">
                  API credentials stay on the backend. Configure providers in
                  the server environment.
                </p>
                {auth?.mode === "local" ? (
                  <div className="q-notice">
                    Local development identity · {auth.warning}
                  </div>
                ) : (
                  <>
                    <p>
                      {auth?.authenticated
                        ? "Signed in with Supabase."
                        : "Sign in with an existing Supabase account."}
                    </p>
                    {!auth?.authenticated && (
                      <form
                        className="q-stack"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void action(async () => {
                            await request(
                              "/auth/login",
                              post({ email, password }),
                            );
                            setPassword("");
                            resetSession();
                            setAuth(await initializeSession());
                            await refresh();
                            setNotice("Signed in.");
                          });
                        }}
                      >
                        <label>
                          Email
                          <input
                            type="email"
                            autoComplete="username"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                          />
                        </label>
                        <label>
                          Password
                          <input
                            type="password"
                            autoComplete="current-password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                          />
                        </label>
                        <button disabled={busy} className={button}>
                          Sign in
                        </button>
                        <button
                          type="button"
                          disabled={busy || !email || password.length < 8}
                          className={secondary}
                          onClick={() =>
                            void action(async () => {
                              const result = await request<{
                                authenticated: boolean;
                                message: string;
                              }>("/auth/signup", post({ email, password }));
                              setPassword("");
                              setNotice(result.message);
                              if (result.authenticated) {
                                resetSession();
                                setAuth(await initializeSession());
                                await refresh();
                              }
                            })
                          }
                        >
                          Create account
                        </button>
                      </form>
                    )}
                    {auth?.authenticated && (
                      <button
                        className={secondary}
                        onClick={() =>
                          void action(async () => {
                            await request("/auth/logout", { method: "POST" });
                            resetSession();
                            setAuth({ authenticated: false, mode: "supabase" });
                            setQuizzes([]);
                            setRuns([]);
                            setProviders(null);
                          })
                        }
                      >
                        Sign out
                      </button>
                    )}
                  </>
                )}
                {providers && (
                  <>
                    <div className="q-metrics">
                      <div>
                        <strong>{providers.primary}</strong>
                        <span>primary provider</span>
                      </div>
                      <div>
                        <strong>{providers.fallback}</strong>
                        <span>fallback provider</span>
                      </div>
                      <div>
                        <strong>{providers.usage.tokens || 0}</strong>
                        <span>tokens this process</span>
                      </div>
                    </div>
                    {Object.entries(providers.providers).length ? (
                      Object.entries(providers.providers).map(([p, m]) => (
                        <div className="q-row q-between" key={p}>
                          <strong>{p}</strong>
                          <code>{m}</code>
                          <span className="q-good">Configured</span>
                        </div>
                      ))
                    ) : (
                      <ErrorNotice error="No AI providers configured. Add GROQ_API_KEY or GEMINI_API_KEY to the backend environment." />
                    )}
                    <p className="q-muted">
                      Configured means a key is present. Connectivity is
                      confirmed only when an AI request succeeds. Fallback
                      applies to rate limits and server failures; authentication
                      errors require configuration fixes.
                    </p>
                    {providers.recent_failures.map((f, i) => (
                      <p key={i}>
                        {f.provider}: HTTP {f.status} ·{" "}
                        {new Date(f.at * 1000).toLocaleTimeString()}
                      </p>
                    ))}
                  </>
                )}
                <button
                  className={secondary}
                  disabled={busy}
                  onClick={() =>
                    void action(async () => {
                      resetSession();
                      setAuth(await initializeSession());
                      await refresh();
                    })
                  }
                >
                  Reconnect / refresh status
                </button>
              </div>
            </section>
          )}
        </>
      )}
      {share && (
        <Modal title="Ready to share." onClose={() => setShare(null)}>
          <p>
            Anyone with this link can open the quiz on a device that can reach
            your server.
          </p>
          <CopyLink value={share.url} />
          {share.invite && (
            <div className="q-notice">
              <strong>Private invitation code</strong>
              <p>
                <code>{share.invite}</code>
              </p>
              <p>
                Share this separately with invited players. It is shown only
                when published.
              </p>
            </div>
          )}
          <p className="q-muted">
            For private quizzes, send recipients the invitation code saved at
            publication. Edits create a new snapshot only when you publish
            again.
          </p>
          <a
            className={secondary}
            target="_blank"
            rel="noreferrer"
            href={share.url}
          >
            Open quiz ↗
          </a>
        </Modal>
      )}
      {preview && draft && (
        <Modal title="Participant preview" onClose={() => setPreview(false)}>
          <h3>{draft.title}</h3>
          {draft.questions.map((q, i) => (
            <QuestionInput
              key={q.id}
              question={q}
              index={i}
              selected={[]}
              onChange={() => {}}
              disabled
            />
          ))}
        </Modal>
      )}
      {analytics && (
        <Modal title="Quiz analytics" onClose={() => setAnalytics(null)}>
          <div className="q-metrics">
            <div>
              <strong>{analytics.total_attempts}</strong>
              <span>completed / {analytics.started} started</span>
            </div>
            <div>
              <strong>{analytics.average}%</strong>
              <span>average score</span>
            </div>
            <div>
              <strong>{analytics.highest}%</strong>
              <span>highest · lowest {analytics.lowest}%</span>
            </div>
          </div>
          <h3>Score distribution</h3>
          <div
            className="q-chart"
            role="img"
            aria-label={
              "Score distribution: " + analytics.distribution.join(", ")
            }
          >
            {analytics.distribution.map((v, i) => (
              <div key={i}>
                <span>{v}</span>
                <div
                  style={{
                    height:
                      20 +
                      (100 * v) / Math.max(1, ...analytics.distribution) +
                      "px",
                  }}
                />
                <small>
                  {i * 20}–{i === 4 ? 100 : i * 20 + 19}%
                </small>
              </div>
            ))}
          </div>
          <h3>Topics to revisit</h3>
          {[...analytics.topics]
            .sort((a, b) => a.correct / a.total - b.correct / b.total)
            .map((t) => (
              <div className="q-accuracy" key={t.label}>
                <span>{t.label}</span>
                <progress max={t.total} value={t.correct} />
                <b>{Math.round((100 * t.correct) / t.total)}%</b>
              </div>
            ))}
          <details>
            <summary>Question accuracy, hardest first</summary>
            {[...analytics.questions]
              .sort((a, b) => a.correct / a.total - b.correct / b.total)
              .map((q, i) => (
                <p key={i}>
                  {Math.round((100 * q.correct) / q.total)}% · {q.label}
                </p>
              ))}
          </details>
          <h3>Recent attempts</h3>
          {analytics.recent.map((a, i) => (
            <div className="q-row q-between" key={i}>
              <span>{a.name}</span>
              <strong>{a.percentage}%</strong>
              <span className="q-muted">
                {new Date(a.submitted * 1000).toLocaleString()}
              </span>
            </div>
          ))}
          {!analytics.total_attempts && (
            <p className="q-muted">
              No completed attempts yet. Share a published quiz to get started.
            </p>
          )}
          <div className="q-row">
            <button
              className={secondary}
              disabled={busy || analytics.offset === 0}
              onClick={() =>
                void action(() =>
                  showAnalytics(
                    analyticsId,
                    Math.max(0, analytics.offset - 20),
                  ),
                )
              }
            >
              Previous
            </button>
            <button
              className={secondary}
              disabled={
                busy || analytics.offset + 20 >= analytics.total_attempts
              }
              onClick={() =>
                void action(() =>
                  showAnalytics(analyticsId, analytics.offset + 20),
                )
              }
            >
              Next
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
