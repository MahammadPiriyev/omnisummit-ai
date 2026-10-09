import "@tanstack/react-start/server-only";
import { requireIntegration } from "./config.server";
import { classifyGeminiResponse, ProviderError } from "./errors.server";
import { retry, withDeadline } from "./retry.server";
import { logProviderStage } from "./logging.server";

/** Native embedding endpoint explicitly requests the application's 512 dimensions. */
export async function geminiEmbeddings(texts: string[], signal?: AbortSignal) {
  const config = requireIntegration("aiml");
  if (!config.geminiApiKey)
    throw new ProviderError("gemini", "GEMINI_NOT_CONFIGURED", "Gemini API açarı əlavə edilməyib.");
  if (!texts.length) return [];
  const started = Date.now();
  const model = config.embeddingModel.replace(/^models\//, "");
  const vectors = await retry(async () => {
    const response = await withDeadline(
      async (deadline) => {
        const result = await fetch(
          `${config.geminiBaseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(model)}:batchEmbedContents`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": config.geminiApiKey! },
            body: JSON.stringify({
              requests: texts.map((text) => ({
                model: `models/${model}`,
                content: { parts: [{ text }] },
                outputDimensionality: 512,
              })),
            }),
            signal: deadline,
          },
        );
        if (!result.ok) throw classifyGeminiResponse(result);
        return (await result.json()) as { embeddings?: Array<{ values?: number[] }> };
      },
      30_000,
      signal,
    );
    const values = (response.embeddings ?? []).map((item) => item.values ?? []);
    if (
      values.length !== texts.length ||
      values.some(
        (vector) => vector.length !== 512 || vector.some((value) => !Number.isFinite(value)),
      )
    )
      throw new ProviderError(
        "gemini",
        "GEMINI_INVALID_EMBEDDINGS",
        "Gemini mətn vektorlarını uyğun formatda qaytarmadı.",
      );
    return values;
  });
  logProviderStage({
    provider: "gemini",
    stage: "embeddings",
    durationMs: Date.now() - started,
    count: texts.length,
  });
  return vectors;
}
