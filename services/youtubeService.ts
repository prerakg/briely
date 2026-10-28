import { TranscriptChunk } from "../types";
import { creatorRequest } from "./api";

export interface TranscriptOption {
  languageCode: string;
  languageName?: string;
  text: string;
  chunks: TranscriptChunk[];
}

export interface YoutubeVideoResult {
  videoId: string;
  title: string;
  transcripts: TranscriptOption[];
}

function extractVideoId(input: string): string | null {
  try {
    const value = input.trim();
    const url = new URL(
      /^https?:\/\//i.test(value) ? value : `https://${value}`,
    );
    if (!["http:", "https:"].includes(url.protocol)) return null;
    const host = url.hostname.toLowerCase();
    const parts = url.pathname.split("/").filter(Boolean);
    let id: string | null = null;
    if (host === "youtu.be" || host === "www.youtu.be") id = parts[0];
    else if (
      [
        "youtube.com",
        "www.youtube.com",
        "m.youtube.com",
        "music.youtube.com",
        "youtube-nocookie.com",
        "www.youtube-nocookie.com",
      ].includes(host)
    ) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else if (["shorts", "live", "embed", "v"].includes(parts[0]))
        id = parts[1];
    }
    return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

function parseTimestamp(value: string): number | null {
  const match = value.trim().match(/^(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{1,3})$/);
  if (!match || Number(match[2]) > 59 || Number(match[3]) > 59) return null;
  return (
    Number(match[1] || 0) * 3600 +
    Number(match[2]) * 60 +
    Number(match[3]) +
    Number(match[4].padEnd(3, "0")) / 1000
  );
}

function cleanCaption(value: string): string {
  const decoder = document.createElement("textarea");
  decoder.innerHTML = value.replace(/<[^>]*>/g, "");
  return decoder.value.replace(/\s+/g, " ").trim();
}

function parseCaptions(subtitle: unknown): TranscriptChunk[] {
  if (Array.isArray(subtitle)) {
    return subtitle
      .flatMap((item) => {
        if (
          !item ||
          typeof item.text !== "string" ||
          !["number", "string"].includes(typeof item.start) ||
          String(item.start).trim() === ""
        )
          return [];
        const timestamp = Number(item.start);
        const text = cleanCaption(item.text);
        return Number.isFinite(timestamp) && timestamp >= 0 && text
          ? [{ timestamp, text }]
          : [];
      })
      .sort((a, b) => a.timestamp - b.timestamp);
  }
  if (typeof subtitle !== "string") return [];
  const chunks: TranscriptChunk[] = [];
  const blocks = subtitle
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/);
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const timing = lines.findIndex((line) => line.includes("-->"));
    if (timing < 0) continue;
    const timestamp = parseTimestamp(lines[timing].split("-->")[0]);
    const text = cleanCaption(lines.slice(timing + 1).join(" "));
    if (timestamp !== null && text) chunks.push({ timestamp, text });
  }
  return chunks.sort((a, b) => a.timestamp - b.timestamp);
}

async function fetchVideoTitle(videoId: string): Promise<string> {
  const fallback = `YouTube Video ${videoId}`;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch(
      `https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`,
      { signal: controller.signal },
    );
    if (!response.ok) return fallback;
    const data = await response.json();
    return typeof data.title === "string" && data.title.trim()
      ? data.title.trim()
      : fallback;
  } catch {
    return fallback;
  } finally {
    window.clearTimeout(timeout);
  }
}

export async function getYoutubeTranscript(
  videoId: string,
  language: string,
): Promise<TranscriptOption> {
  const data = await creatorRequest<unknown>(
    `/youtube/${videoId}?language=${encodeURIComponent(language)}`,
  );
  if (!Array.isArray(data))
    throw new Error(
      "The transcript provider returned an invalid response. Please try again.",
    );
  const item = data.find((item) => item && item.languageCode === language);
  const chunks = parseCaptions(item?.subtitle);
  const text = chunks
    .map((chunk) => chunk.text)
    .filter((line, index, lines) => index === 0 || line !== lines[index - 1])
    .join(" ");
  if (!text)
    throw new Error(
      "No usable captions found for this language. Please select another language.",
    );
  return { languageCode: language, text, chunks };
}

export async function getYoutubeVideoDetails(
  url: string,
): Promise<YoutubeVideoResult> {
  const videoId = extractVideoId(url);
  if (!videoId)
    throw new Error(
      "Enter a valid YouTube video URL (watch, Shorts, live, or youtu.be).",
    );
  const [title, data] = await Promise.all([
    fetchVideoTitle(videoId),
    creatorRequest<unknown>(`/youtube/${videoId}/languages`),
  ]);
  if (!Array.isArray(data))
    throw new Error(
      "The transcript provider returned an invalid response. Please try again.",
    );
  const transcripts: TranscriptOption[] = data.flatMap((item) =>
    item &&
    typeof item.languageCode === "string" &&
    /^[A-Za-z0-9_-]{1,35}$/.test(item.languageCode)
      ? [
          {
            languageCode: item.languageCode,
            languageName:
              typeof item.languageName === "string"
                ? item.languageName
                : undefined,
            text: "",
            chunks: [],
          },
        ]
      : [],
  );
  if (!transcripts.length)
    throw new Error(
      "No usable captions found for this video. Try a video with captions enabled.",
    );
  const index = Math.max(
    0,
    transcripts.findIndex((track) => track.languageCode.startsWith("en")),
  );
  transcripts[index] = {
    ...transcripts[index],
    ...(await getYoutubeTranscript(videoId, transcripts[index].languageCode)),
  };
  return { videoId, title, transcripts };
}
