export interface Question {
  id: string;
  question: string;
  type: "single" | "multiple" | "boolean";
  options: string[];
  correct: number[];
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
  topic: string;
  source_quote: string;
}
export interface QuizSettings {
  time_limit_seconds: number;
  max_attempts: number;
  show_explanations: boolean;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  expires_at: string | null;
  access: "public" | "private";
  leaderboard: boolean;
}
export interface QuizDocument {
  id: string;
  title: string;
  questions: Question[];
  settings: QuizSettings;
  run_id?: string;
}
export interface QuizListItem {
  id: string;
  title: string;
  question_count: number;
  created: number;
  publications: { share_id: string; active: boolean; created: number }[];
}
export type PublicQuestion = Omit<
  Question,
  "correct" | "explanation" | "source_quote"
>;
export interface PublicQuiz {
  title: string;
  share_id: string;
  question_count: number;
  questions: PublicQuestion[];
  settings: QuizSettings;
}
export interface AttemptState extends PublicQuiz {
  attempt_id: string;
  deadline: number;
  server_time: number;
  result?: QuizResult;
}
export interface QuizResult {
  score: number;
  total: number;
  percentage: number;
  time_taken: number;
  timed_out: boolean;
  weak_topics: string[];
  recommendations: string[];
  feedback: {
    id: string;
    question: string;
    correct: boolean;
    selected: number[];
    topic: string;
    correct_answers?: string[];
    explanation?: string;
  }[];
}
export interface Analytics {
  started: number;
  total_attempts: number;
  average: number;
  highest: number;
  lowest: number;
  distribution: number[];
  questions: { label: string; correct: number; total: number }[];
  topics: { label: string; correct: number; total: number }[];
  recent: { name: string; percentage: number; submitted: number }[];
  offset: number;
  limit: number;
}
export interface AgentRun {
  id: string;
  workflow: string;
  status: string;
  elapsed: number;
  created: number;
  error?: string;
  steps: {
    agent: string;
    status: string;
    elapsed: number;
    provider?: string;
    model?: string;
    tokens?: number;
    cached?: boolean;
  }[];
}
export interface ProviderStatus {
  primary: string;
  fallback: string;
  providers: Record<string, string>;
  usage: { requests?: number; tokens?: number };
  recent_failures: { provider: string; status: number; at: number }[];
}
export interface RoomState {
  code: string;
  title: string;
  state: "lobby" | "playing" | "finished";
  round: number;
  total: number;
  deadline: number | null;
  server_time: number;
  is_host: boolean;
  joined: boolean;
  round_seconds: number;
  me?: string;
  participants?: {
    id: string;
    name: string;
    ready: boolean;
    connected: boolean;
    score: number;
  }[];
  question?: PublicQuestion;
  answered?: boolean;
}
