export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export interface AuthState {
  authenticated: boolean;
  mode: "local" | "supabase";
  warning?: string;
}
let sessionPromise: Promise<AuthState> | undefined;
export const initializeSession = () =>
  (sessionPromise ??= request<AuthState>("/auth/session", {
    method: "POST",
  }).catch((e) => {
    sessionPromise = undefined;
    throw e;
  }));
export const resetSession = () => {
  sessionPromise = undefined;
};
export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 240000);
  try {
    const response = await fetch("/api/v1" + path, {
      ...init,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...init.headers },
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail =
        typeof data.detail === "string"
          ? data.detail
          : Array.isArray(data.detail)
            ? data.detail.map((e: { msg: string }) => e.msg).join("; ")
            : "Request failed";
      throw new ApiError(detail, response.status);
    }
    return data as T;
  } catch (e) {
    if (e instanceof ApiError) throw e;
    throw new Error(
      e instanceof Error && e.name === "AbortError"
        ? "The request timed out. Check AI Activity before trying again."
        : "Cannot reach the backend. Start the API server and try again.",
    );
  } finally {
    window.clearTimeout(timeout);
  }
}
export async function creatorRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const session = await initializeSession();
  if (!session.authenticated)
    throw new ApiError("Sign in from AI Settings to manage quizzes.", 401);
  try {
    return await request<T>(path, init);
  } catch (e) {
    if (
      e instanceof ApiError &&
      e.status === 401 &&
      session.mode === "supabase"
    ) {
      await request("/auth/refresh", { method: "POST" });
      return request<T>(path, init);
    }
    throw e;
  }
}
export const post = (value: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(value),
});
