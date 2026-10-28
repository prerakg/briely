import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  creatorRequest,
  initializeSession,
  request,
  post,
} from "../../services/api";
import type { RoomState } from "../../quizTypes";
import {
  button,
  secondary,
  CopyLink,
  ErrorNotice,
  QuestionInput,
  useClock,
  ThemeToggle,
} from "./Shared";

export default function Battle({ code }: { code: string }) {
  const [room, setRoom] = useState<RoomState | null>(null);
  const [name, setName] = useState("");
  const [invite, setInvite] = useState("");
  const [selected, setSelected] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [reconnect, setReconnect] = useState(0);
  const [joinCode, setJoinCode] = useState(code);
  const now = useClock(room?.server_time);
  const round = useRef(-1);
  const load = useCallback(async () => {
    try {
      const r = await request<RoomState>(
        "/quiz-rooms/" + encodeURIComponent(code),
      );
      setRoom(r);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [code]);
  useEffect(() => {
    if (code)
      void initializeSession()
        .catch(() => {})
        .finally(load);
  }, [code, load]);
  useEffect(() => {
    if (room && room.round !== round.current) {
      round.current = room.round;
      setSelected([]);
    }
  }, [room?.round]);
  useEffect(() => {
    if (!room?.joined || room.state === "finished") return;
    let stopped = false;
    let retry: number | undefined;
    const socket = new WebSocket(
      (location.protocol === "https:" ? "wss://" : "ws://") +
        location.host +
        "/api/v1/quiz-rooms/" +
        encodeURIComponent(code) +
        "/events",
    );
    socket.onopen = () => {
      setConnected(true);
      setError("");
    };
    socket.onmessage = (event) => {
      try {
        setRoom(JSON.parse(event.data));
      } catch {
        setError("Received invalid battle state. Reconnect to continue.");
      }
    };
    socket.onclose = () => {
      setConnected(false);
      if (!stopped)
        retry = window.setTimeout(() => setReconnect((n) => n + 1), 3000);
    };
    socket.onerror = () => setConnected(false);
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      socket.close();
    };
  }, [code, room?.joined, room?.state, reconnect]);
  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const remaining = room?.deadline
    ? Math.max(0, Math.ceil(room.deadline - now))
    : 0;
  const me = room?.participants?.find((p) => p.id === room.me);
  return (
    <div className="q-public">
      <header className="q-public-header">
        <a className="q-brand" href="/">
          ✦ Briefly <span>QUIZ BATTLES</span>
        </a>
        <a className={secondary} href="/">
          Study library
        </a>
        <ThemeToggle />
      </header>
      <main className="q-public-main">
        <ErrorNotice error={error} />
        {!code ? (
          <div className="q-card q-stack">
            <h1>Join the challenge.</h1>
            <form
              className="q-stack"
              onSubmit={(e) => {
                e.preventDefault();
                location.assign(
                  "/battle/" +
                    encodeURIComponent(joinCode.trim().toUpperCase()),
                );
              }}
            >
              <label>
                Room code
                <input
                  required
                  value={joinCode}
                  maxLength={12}
                  onChange={(e) => setJoinCode(e.target.value)}
                  placeholder="Enter room code"
                />
              </label>
              <button className={button}>Find room →</button>
            </form>
          </div>
        ) : !room ? (
          <div className="q-card">
            <p role="status">Finding your battle room…</p>
            <button className={secondary} onClick={() => void load()}>
              Retry
            </button>
          </div>
        ) : (
          <div className="q-stack">
            <section className="q-card">
              <div className="q-row q-between">
                <div>
                  <span className="q-eyebrow">
                    {room.state === "lobby"
                      ? "THE LOBBY IS OPEN"
                      : room.state === "finished"
                        ? "THE FINAL STANDINGS"
                        : "YOU’RE IN THE GAME"}
                  </span>
                  <h1>{room.title}</h1>
                </div>
                <strong className="q-room-code">{room.code}</strong>
              </div>
              <p className="q-muted">
                {room.total} questions · {room.round_seconds}s per round ·{" "}
                {room.joined
                  ? connected
                    ? "Live connection"
                    : "Reconnecting…"
                  : "Join to see the players"}
              </p>
              {room.state === "lobby" && (
                <CopyLink value={location.origin + "/battle/" + code} />
              )}
            </section>
            {!room.joined ? (
              <section className="q-card">
                <h2>Ready to put your knowledge to the test?</h2>
                <form
                  className="q-stack"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void act(async () => {
                      await request(
                        "/quiz-rooms/" + code + "/join",
                        post({ name, invite }),
                      );
                      await load();
                    });
                  }}
                >
                  <label>
                    Display name
                    <input
                      required
                      maxLength={60}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <label>
                    Invitation code (private quizzes only)
                    <input
                      maxLength={100}
                      value={invite}
                      onChange={(e) => setInvite(e.target.value)}
                    />
                  </label>
                  <button
                    className={button}
                    disabled={busy || !name.trim() || room.state !== "lobby"}
                  >
                    Join Battle →
                  </button>
                </form>
                <p className="q-muted">
                  Your display name and score are visible to everyone in this
                  room.
                </p>
              </section>
            ) : (
              <>
                {room.state === "lobby" ? (
                  <section className="q-card q-stack">
                    <h2>A good challenge needs good company.</h2>
                    <p className="q-muted">
                      Everyone marks ready. The host starts when at least two
                      players are ready.
                    </p>
                    <div className="q-row q-wrap">
                      <button
                        className={button}
                        disabled={busy}
                        onClick={() =>
                          void act(async () => {
                            await request(
                              "/quiz-rooms/" + code + "/ready",
                              post({ ready: !me?.ready }),
                            );
                            await load();
                          })
                        }
                      >
                        {me?.ready ? "Cancel ready" : "I’m ready"}
                      </button>
                      {room.is_host && (
                        <button
                          className={button}
                          disabled={
                            busy ||
                            (room.participants?.length || 0) < 2 ||
                            !room.participants?.every((p) => p.ready)
                          }
                          onClick={() =>
                            void act(async () => {
                              await creatorRequest(
                                "/quiz-rooms/" + code + "/start",
                                { method: "POST" },
                              );
                              await load();
                            })
                          }
                        >
                          Start Battle →
                        </button>
                      )}
                    </div>
                  </section>
                ) : room.state === "playing" && room.question ? (
                  <section className="q-stack">
                    <div className="q-row q-between">
                      <h2>
                        Round {room.round + 1} / {room.total}
                      </h2>
                      <strong className="q-timer">{remaining}s</strong>
                    </div>
                    <QuestionInput
                      index={room.round}
                      question={room.question}
                      selected={selected}
                      onChange={setSelected}
                      disabled={busy || room.answered || remaining === 0}
                    />
                    <button
                      className={button}
                      disabled={
                        busy ||
                        room.answered ||
                        !selected.length ||
                        remaining === 0
                      }
                      onClick={() =>
                        void act(async () => {
                          await request(
                            "/quiz-rooms/" + code + "/answers",
                            post({ round: room.round, answer: selected }),
                          );
                          await load();
                        })
                      }
                    >
                      {room.answered
                        ? "Answer locked. Next round starts automatically."
                        : "Lock in answer"}
                    </button>
                  </section>
                ) : (
                  <section className="q-card q-result">
                    <span className="q-eyebrow">
                      EVERY CHALLENGE IS A STEP FORWARD
                    </span>
                    <h2>
                      {room.participants?.[0]?.name || "Everyone"} takes the top
                      spot.
                    </h2>
                    <p>Keep learning. Your next personal best is waiting.</p>
                    <a className={button} href="/">
                      Back to learning →
                    </a>
                  </section>
                )}
                <section className="q-card">
                  <h2>
                    {room.state === "lobby" ? "In the room" : "Leaderboard"}
                  </h2>
                  <div className="q-leaderboard">
                    {room.participants?.map((p, i) => (
                      <div
                        key={p.id}
                        className={p.id === room.me ? "is-me" : ""}
                      >
                        <strong>{i + 1}</strong>
                        <span>
                          {p.name}
                          {p.id === room.me ? " (you)" : ""}
                          <small>
                            {room.state === "lobby"
                              ? p.ready
                                ? "Ready"
                                : "Getting ready"
                              : p.connected
                                ? "Connected"
                                : "Reconnecting"}
                          </small>
                        </span>
                        <b>
                          {room.state === "lobby"
                            ? p.ready
                              ? "✓"
                              : "…"
                            : p.score}
                        </b>
                      </div>
                    ))}
                  </div>
                  <p className="q-muted">
                    Scores update after each round closes. Each correct answer
                    earns 1,000 points.
                  </p>
                </section>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
