// Compatibility adapter: existing study tools now use authenticated, server-side AI.
import {
  Flashcard,
  QuizQuestion,
  SummaryData,
  ChatMessage,
  TranscriptChunk,
} from "../types";
import { creatorRequest, post } from "./api";
import type { QuizDocument } from "../quizTypes";
async function generate<T>(
  task: string,
  source: string,
  context = "",
): Promise<T> {
  return (
    await creatorRequest<{ result: T }>(
      "/ai/generate",
      post({ task, source, context }),
    )
  ).result;
}
export const generateSummary = (source: string) =>
  generate<SummaryData>("summary", source);
export const expandSummary = (source: string, current: SummaryData) =>
  generate<SummaryData>(
    "summary",
    source,
    "Expand this summary with additional source-grounded detail: " +
      JSON.stringify(current).slice(0, 8000),
  );
export const generateFlashcards = (source: string) =>
  generate<Flashcard[]>("flashcards", source);
export const generateMoreFlashcards = (source: string, cards: Flashcard[]) =>
  generate<Flashcard[]>(
    "flashcards",
    source,
    "Generate new cards; avoid these fronts: " +
      cards
        .map((c) => c.front)
        .join("; ")
        .slice(0, 8000),
  );
const legacyQuestions = (draft: QuizDocument): QuizQuestion[] =>
  draft.questions.map((q) => ({
    question: q.question,
    options: q.options,
    correctAnswer: q.options[q.correct[0]],
    explanation: q.explanation,
  }));
export const generateQuiz = async (source: string) =>
  legacyQuestions(
    (
      await creatorRequest<{ result: QuizDocument }>(
        "/ai/generate",
        post({ task: "quiz", source }),
      )
    ).result,
  );
export const generateMoreQuiz = async (
  source: string,
  existing: QuizQuestion[],
) =>
  legacyQuestions(
    (
      await creatorRequest<{ result: QuizDocument }>(
        "/agents/quiz",
        post({ source, count: 5, exclude: existing.map((q) => q.question) }),
      )
    ).result,
  );
export const generateStudyNotes = (source: string) =>
  generate<string>("notes", source);
export const generateMoreNotes = (source: string, notes: string) =>
  generate<string>(
    "notes",
    source,
    "Return expanded complete notes incorporating these notes: " +
      notes.slice(0, 9000),
  );
export const generateMindMap = (source: string) =>
  generate<string>("mindmap", source);
export async function groupTranscriptByTopic(
  chunks: TranscriptChunk[],
): Promise<TranscriptChunk[]> {
  const boundaries = (
    await generate<{ timestamp: number; topic: string }[]>(
      "topics",
      JSON.stringify(chunks),
    )
  ).sort((a, b) => a.timestamp - b.timestamp);
  const result: TranscriptChunk[] = [];
  for (const chunk of chunks) {
    const boundary = boundaries
      .filter((b) => b.timestamp <= chunk.timestamp)
      .at(-1);
    const topic = boundary?.topic || "Introduction";
    if (result.at(-1)?.topic === topic)
      result[result.length - 1].text += " " + chunk.text;
    else result.push({ ...chunk, topic });
  }
  return result;
}
export interface LectureChat {
  sendMessage(input: { message: string }): Promise<{ text: string }>;
}
export function createLectureChat(
  source: string,
  history: ChatMessage[] = [],
): LectureChat {
  let recent = history.slice(-10);
  return {
    async sendMessage({ message }) {
      const text = await generate<string>(
        "tutor",
        source,
        JSON.stringify([...recent, { role: "user", text: message }]).slice(
          -12000,
        ),
      );
      recent = [
        ...recent,
        { role: "user", text: message },
        { role: "model", text },
      ].slice(-10) as ChatMessage[];
      return { text };
    },
  };
}
export async function extractTextFromImage(file: File): Promise<string> {
  if (file.size > 6000000)
    throw new Error("Please use an image smaller than 6 MB.");
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Cannot read image"));
    reader.readAsDataURL(file);
  });
  return (
    await creatorRequest<{ text: string }>(
      "/ai/image",
      post({ data, mimeType: file.type }),
    )
  ).text;
}
