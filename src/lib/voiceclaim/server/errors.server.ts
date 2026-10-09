import "@tanstack/react-start/server-only";
import { localizedError } from "../messages";

export type ProviderName = "speechmatics" | "brightdata" | "aiml" | "ollama" | "voiceclaim";

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
    `${provider} xidmətinə sorğu alınmadı (${response.status}).`,
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
      "AI/ML API açarı qəbul edilmədi. .env faylındakı AIMLAPI_KEY dəyişənini yoxlayın.",
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
      "AI/ML API balans və ya ödəniş səbəbindən sorğunu rədd etdi. https://aimlapi.com/app/billing/ səhifəsində hesabınızı yoxlayın.",
      false,
      response.status,
    );
  }
  return new ProviderError(
    "aiml",
    error.code,
    "AI/ML API girişə icazə vermədi. Hesabın balansını, açarı və model icazələrini yoxlayın.",
    false,
    response.status,
  );
}

export function publicError(error: unknown) {
  if (error instanceof ProviderError) return `${error.code}: ${localizedError(error.message)}`;
  if (error instanceof Error && /NOT_CONFIGURED/.test(error.message))
    return `${error.message}: ${localizedError(error.message)}`;
  return "VERIFICATION_ERROR: Yoxlama tamamlanmadı.";
}
