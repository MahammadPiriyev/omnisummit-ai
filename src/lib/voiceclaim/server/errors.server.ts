import "@tanstack/react-start/server-only";
import { localizedError } from "../messages";

export type ProviderName =
  "speechmatics" | "brightdata" | "aiml" | "ollama" | "gemini" | "voiceclaim";

export function classifyGeminiResponse(response: Response) {
  const error = classifyProviderResponse("gemini", response);
  const message =
    response.status === 401 || response.status === 403
      ? "Gemini rejected the API key or access permissions. Check GEMINI_API_KEY in your .env file."
      : response.status === 429
        ? "Gemini rate limit or account quota exceeded. Try again later and check your account limits."
        : response.status === 503
          ? "The Gemini model is overloaded or temporarily unavailable. Please try again shortly."
          : response.status === 404
            ? "The selected Gemini model was not found. Check the model name in .env and your account access."
            : error.message;
  return new ProviderError(
    "gemini",
    error.code,
    message,
    error.retryable,
    error.status,
    error.retryAfterMs,
  );
}

export class ProviderError extends Error {
  constructor(
    readonly provider: ProviderName,
    readonly code: string,
    message: string,
    readonly retryable = false,
    readonly status?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export function classifyProviderResponse(provider: ProviderName, response: Response) {
  const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
  const retryAfter = response.headers.get("retry-after");
  const retryAfterMs = retryAfter
    ? Number.isFinite(Number(retryAfter))
      ? Number(retryAfter) * 1_000
      : Math.max(0, Date.parse(retryAfter) - Date.now())
    : undefined;
  return new ProviderError(
    provider,
    `${provider.toUpperCase()}_HTTP_${response.status}`,
    `${provider} request failed (${response.status}).`,
    retryable,
    response.status,
    retryAfterMs,
  );
}

export async function classifyAimlResponse(response: Response) {
  const error = classifyProviderResponse("aiml", response);
  if (response.status === 401) {
    return new ProviderError(
      "aiml",
      error.code,
      "AI/ML API rejected the API key. Check AIMLAPI_KEY in your .env file.",
      false,
      response.status,
    );
  }
  if (response.status !== 403) return error;

  // Use only known error categories; provider bodies can contain sensitive request data.
  let message = "";
  try {
    const body = (await response.json()) as {
      message?: unknown;
      error?: { message?: unknown };
    } | null;
    const value = body?.message ?? body?.error?.message;
    if (typeof value === "string") message = value;
  } catch {
    // Non-JSON gateway errors still receive actionable access guidance.
  }
  if (/\b(credits?|balance|funds|billing|payment|subscription)\b/i.test(message)) {
    return new ProviderError(
      "aiml",
      "AIML_BILLING_REQUIRED",
      "AI/ML API blocked the request because of account credits or billing. Check your account at https://aimlapi.com/app/billing/.",
      false,
      response.status,
    );
  }
  return new ProviderError(
    "aiml",
    error.code,
    "AI/ML API denied access. Check your account balance, API key, and model permissions.",
    false,
    response.status,
  );
}

export function publicError(error: unknown) {
  if (error instanceof ProviderError) return `${error.code}: ${localizedError(error.message)}`;
  if (error instanceof Error && /NOT_CONFIGURED/.test(error.message))
    return `${error.message}: ${localizedError(error.message)}`;
  return "VERIFICATION_ERROR: Verification could not complete.";
}
