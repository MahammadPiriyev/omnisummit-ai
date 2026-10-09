import "@tanstack/react-start/server-only";
import { z } from "zod";
import { requireIntegration } from "./config.server";
import { classifyAimlResponse, ProviderError } from "./errors.server";
import { retry, withDeadline } from "./retry.server";
import { logProviderStage } from "./logging.server";
import { ollamaCompletion, ollamaEmbeddings } from "./ollama.server";

interface JsonSchemaFormat {
  name: string;
  schema: Record<string, unknown>;
}

interface CompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

export async function structuredCompletion<T>(options: {
  system: string;
  user: string;
  output: z.ZodType<T>;
  jsonSchema: JsonSchemaFormat;
  model?: string;
  signal?: AbortSignal;
}) {
  options = {
    ...options,
    system: `${options.system}\n\nWrite all user-facing text in Azerbaijani (az-AZ), using the Latin alphabet. This includes normalized claims, context, summaries, explanations, evidence gaps and recommendations. Do not answer in English or Turkish. Keep JSON keys, enum values, IDs and URLs unchanged. Search queries may use the source language. Preserve originalText and excerpt as exact source quotations; provide their Azerbaijani translations in the designated translation fields.`,
  };
  const config = requireIntegration("aiml");
  if (config.llmProvider === "ollama") return ollamaCompletion(options);
  if (!config.aimlApiKey)
    throw new ProviderError("aiml", "AIML_NOT_CONFIGURED", "AI/ML API ayarları tamamlanmayıb.");

  return retry(
    async (attempt) => {
      const started = Date.now();
      const repair =
        attempt > 1
          ? "\nYour previous output was invalid. Return only JSON matching the schema exactly."
          : "";
      const response = await withDeadline(
        (signal) =>
          fetch(`${config.aimlBaseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.aimlApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: options.model ?? config.fastModel,
              temperature: 0,
              messages: [
                { role: "system", content: options.system },
                { role: "user", content: `${options.user}${repair}` },
              ],
              response_format: {
                type: "json_schema",
                json_schema: {
                  name: options.jsonSchema.name,
                  strict: true,
                  schema: options.jsonSchema.schema,
                },
              },
            }),
            signal,
          }),
        35_000,
        options.signal,
      );
      if (!response.ok) {
        const error = await classifyAimlResponse(response);
        logProviderStage({
          provider: "aiml",
          stage: "structured_completion",
          durationMs: Date.now() - started,
          errorCode: error.code,
        });
        throw error;
      }
      const body = (await response.json()) as CompletionResponse;
      const content = body.choices?.[0]?.message?.content;
      if (!content)
        throw new ProviderError("aiml", "AIML_EMPTY_OUTPUT", "AI/ML API cavab qaytarmadı.", true);
      try {
        const parsed = options.output.parse(JSON.parse(content));
        logProviderStage({
          provider: "aiml",
          stage: "structured_completion",
          durationMs: Date.now() - started,
          count: 1,
        });
        return parsed;
      } catch {
        throw new ProviderError(
          "aiml",
          "AIML_INVALID_OUTPUT",
          "AI/ML API cavabının formatı düzgün deyil.",
          true,
        );
      }
    },
    { attempts: 2 },
  );
}

export async function createEmbeddings(texts: string[], signal?: AbortSignal) {
  const started = Date.now();
  const config = requireIntegration("aiml");
  if (config.llmProvider === "ollama") return ollamaEmbeddings(texts, signal);
  if (!config.aimlApiKey)
    throw new ProviderError("aiml", "AIML_NOT_CONFIGURED", "AI/ML API ayarları tamamlanmayıb.");
  const response = await retry(() =>
    withDeadline(
      (deadlineSignal) =>
        fetch(`${config.aimlBaseUrl}/embeddings`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${config.aimlApiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: config.embeddingModel,
            input: texts,
            dimensions: 512,
          }),
          signal: deadlineSignal,
        }),
      30_000,
      signal,
    ),
  );
  if (!response.ok) throw await classifyAimlResponse(response);
  const body = (await response.json()) as { data?: Array<{ index: number; embedding: number[] }> };
  const vectors = [...(body.data ?? [])]
    .sort((a, b) => a.index - b.index)
    .map((item) => item.embedding);
  if (vectors.length !== texts.length || vectors.some((vector) => vector.length !== 512)) {
    throw new ProviderError(
      "aiml",
      "AIML_INVALID_EMBEDDINGS",
      "Mətn vektorları sorğuya uyğun deyil.",
    );
  }
  logProviderStage({
    provider: "aiml",
    stage: "embeddings",
    durationMs: Date.now() - started,
    count: texts.length,
  });
  return vectors;
}
