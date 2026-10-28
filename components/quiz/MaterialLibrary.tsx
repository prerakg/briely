import React, { useEffect, useState } from "react";
import { creatorRequest, post } from "../../services/api";
import type { LectureData } from "../../types";
import { button, secondary, ErrorNotice } from "./Shared";
interface Material {
  id: string;
  title: string;
  created: number;
  characters: number;
  source?: string;
}
export default function MaterialLibrary({
  lectures,
  onImport,
}: {
  lectures: LectureData[];
  onImport: (lecture: LectureData) => void;
}) {
  const [rows, setRows] = useState<Material[]>([]);
  const [sourceId, setSourceId] = useState(lectures[0]?.id || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  async function load() {
    setRows(await creatorRequest("/materials"));
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, []);
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
  return (
    <section className="q-stack">
      <ErrorNotice error={error} />
      {notice && (
        <p role="status" className="q-notice">
          {notice}
        </p>
      )}
      <div className="q-card q-stack">
        <span className="q-eyebrow">YOUR LIBRARY, YOUR CHOICE</span>
        <h2>Bring a source across devices.</h2>
        <p className="q-muted">
          Your study library stays local by default. Saving here uploads only
          the selected title and source text to your private backend library.
          Existing notes and local files stay in your browser.
        </p>
        <label>
          Local study material
          <select
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
        <button
          className={button}
          disabled={busy || !sourceId}
          onClick={() =>
            void act(async () => {
              const lecture = lectures.find((l) => l.id === sourceId)!;
              await creatorRequest(
                "/materials",
                post({ title: lecture.title, source: lecture.transcriptText }),
              );
              await load();
              setNotice(
                "Selected source saved to your private backend library.",
              );
            })
          }
        >
          Save selected source to backend
        </button>
      </div>
      <div className="q-grid">
        {rows.map((m) => (
          <article className="q-card" key={m.id}>
            <h3>{m.title}</h3>
            <p className="q-muted">
              {m.characters.toLocaleString()} characters ·{" "}
              {new Date(m.created * 1000).toLocaleDateString()}
            </p>
            <button
              className={secondary}
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const source = await creatorRequest<Material>(
                    "/materials/" + m.id,
                  );
                  onImport({
                    id: "cloud_" + m.id,
                    title: m.title,
                    date: new Date(m.created * 1000).toISOString(),
                    duration: 0,
                    transcriptText: source.source!,
                    sessions: [],
                    chunks: [],
                    tags: ["Imported source"],
                  });
                  setNotice("Source copied to your local study library.");
                })
              }
            >
              Study locally
            </button>
          </article>
        ))}
      </div>
      {!rows.length && (
        <p className="q-muted">
          No uploaded sources. Your private local library remains available in
          Study Library.
        </p>
      )}
    </section>
  );
}
