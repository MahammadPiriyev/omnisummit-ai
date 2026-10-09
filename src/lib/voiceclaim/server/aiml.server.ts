import "@tanstack/react-start/server-only";
import { z } from "zod";
import { requireIntegration } from "./config.server";
import { classifyAimlResponse, classifyGeminiResponse, ProviderError } from "./errors.server";
import { retry, withDeadline } from "./retry.server";
import { logProviderStage } from "./logging.server";
import { ollamaCompletion, ollamaEmbeddings } from "./ollama.server";
import { geminiEmbeddings } from "./gemini.server";

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
    system: `${options.system}\n\nWrite all user-facing text in English (en-US). This includes normalized claims, context, summaries, explanations, translated evidence titles and excerpts, evidence gaps and recommendations. Translate non-English input into English while preserving its meaning, quantities, dates, scope and negation. Keep JSON keys, enum values, IDs and URLs unchanged. Search queries may use the source language. Preserve originalText and excerpt as exact source quotations; provide their English translations in the designated translation fields.`,
  };
  const config = requireIntegration("aiml");
  if (config.llmProvider === "ollama") return ollamaCompletion(options);
  const provider = config.llmProvider === "gemini" ? "gemini" : "aiml";
  const apiKey = provider === "gemini" ? config.geminiApiKey : config.aimlApiKey;
  const baseUrl =
    provider === "gemini"
      ? `${config.geminiBaseUrl.replace(/\/$/, "")}/openai`
      : config.aimlBaseUrl;
  if (!apiKey)
    throw new ProviderError(
      provider,
      `${provider.toUpperCase()}_NOT_CONFIGURED`,
      "The model service is not configured.",
    );

  let invalidOutputs = 0;
  return retry(
    async () => {
      const started = Date.now();
      const repair =
        invalidOutputs > 0
          ? "\nYour previous output was invalid. Return only JSON matching the schema exactly."
          : "";
      const response = await withDeadline(
        (signal) =>
          fetch(`${baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
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
        provider === "gemini" ? 60_000 : 35_000,
        options.signal,
      );
      if (!response.ok) {
        const error =
          provider === "gemini"
            ? classifyGeminiResponse(response)
            : await classifyAimlResponse(response);
        logProviderStage({
          provider,
          stage: "structured_completion",
          durationMs: Date.now() - started,
          errorCode: error.code,
        });
        throw error;
      }
      const body = (await response.json()) as CompletionResponse;
      const content = body.choices?.[0]?.message?.content;
      if (!content)
        throw new ProviderError(
          provider,
          `${provider.toUpperCase()}_EMPTY_OUTPUT`,
          "The model service returned no response.",
          true,
        );
      try {
        const parsed = options.output.parse(JSON.parse(content));
        logProviderStage({
          provider,
          stage: "structured_completion",
          durationMs: Date.now() - started,
          count: 1,
        });
        return parsed;
      } catch {
        invalidOutputs += 1;
        throw new ProviderError(
          provider,
          `${provider.toUpperCase()}_INVALID_OUTPUT`,
          "The model returned an invalid response format.",
          invalidOutputs < 2,
        );
      }
    },
    { attempts: provider === "gemini" ? 3 : 2, baseDelayMs: provider === "gemini" ? 1_000 : 350 },
  );
}

export async function createEmbeddings(texts: string[], signal?: AbortSignal) {
  const started = Date.now();
  const config = requireIntegration("aiml");
  if (config.llmProvider === "ollama") return ollamaEmbeddings(texts, signal);
  if (config.llmProvider === "gemini") return geminiEmbeddings(texts, signal);
  if (!config.aimlApiKey)
    throw new ProviderError("aiml", "AIML_NOT_CONFIGURED", "AI/ML API is not configured.");
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
      "Text embeddings do not match the request.",
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
