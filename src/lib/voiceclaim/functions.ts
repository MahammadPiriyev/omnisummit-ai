import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  claimInputSchema,
  customContextSchema,
  sessionTokenSchema,
  settingsSchema,
  transcriptChunkSchema,
} from "./schemas";

async function noStore() {
  const { setResponseHeader } = await import("@tanstack/react-start/server");
  setResponseHeader("Cache-Control", "no-store, max-age=0");
  setResponseHeader("Pragma", "no-cache");
}

export const createAnonymousSession = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z.object({ requestedSessionId: z.string().min(1).max(100) }).parse(data),
  )
  .handler(async ({ data }) => {
    await noStore();
    const { issueAnonymousToken } = await import("./server/security.server");
    const { getServerConfig } = await import("./server/config.server");
    const config = getServerConfig();
    if (config.serviceMode === "live" && config.llmProvider === "ollama") {
      const { warmLocalModel } = await import("./server/ollama.server");
      void warmLocalModel();
    }
    return {
      sessionId: data.requestedSessionId,
      sessionToken: await issueAnonymousToken(data.requestedSessionId),
      expiresInSeconds: 6 * 60 * 60,
      serviceMode: config.serviceMode,
    };
  });

export const issueSpeechmaticsToken = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        sessionId: z.string().min(1).max(100),
        type: z.enum(["rt", "batch"]),
        sessionToken: sessionTokenSchema,
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await noStore();
    const { requireIntegration } = await import("./server/config.server");
    const { classifyProviderResponse, ProviderError } = await import("./server/errors.server");
    const { verifyAnonymousToken } = await import("./server/security.server");
    await verifyAnonymousToken(data.sessionToken, data.sessionId);
    const config = requireIntegration("speechmatics");
    if (!config.speechmaticsApiKey) {
      throw new ProviderError(
        "speechmatics",
        "SPEECHMATICS_NOT_CONFIGURED",
        "Speechmatics is not configured",
      );
    }
    const response = await fetch(
      `https://mp.speechmatics.com/v1/api_keys?type=${encodeURIComponent(data.type)}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.speechmaticsApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ttl: 60,
          ...(data.type === "batch" ? { client_ref: data.sessionId } : {}),
        }),
      },
    );
    if (!response.ok) throw classifyProviderResponse("speechmatics", response);
    const body = (await response.json()) as { key_value?: string };
    if (!body.key_value) {
      throw new ProviderError(
        "speechmatics",
        "SPEECHMATICS_TOKEN_INVALID",
        "Speechmatics returned no temporary key",
      );
    }
    return {
      token: body.key_value,
      expiresInSeconds: 60,
      endpoint: data.type === "rt" ? config.speechmaticsRealtimeUrl : config.speechmaticsBatchUrl,
    };
  });

export const extractClaims = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        chunk: transcriptChunkSchema,
        settings: settingsSchema,
        sessionToken: sessionTokenSchema,
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await noStore();
    const { structuredCompletion } = await import("./server/aiml.server");
    const { logProviderStage } = await import("./server/logging.server");
    const { deterministicPriority } = await import("./priority");
    const { verifyAnonymousToken } = await import("./server/security.server");
    await verifyAnonymousToken(data.sessionToken, data.chunk.sessionId);
    const output = z.object({
      classification: z.enum(["verifiable_fact", "opinion", "prediction", "context"]),
      requiresMoreContext: z.boolean(),
      claims: z
        .array(
          z.object({
            normalizedClaim: z.string().min(1).max(8_000),
            context: z.string().max(12_000),
          }),
        )
        .max(12),
    });
    const result = await structuredCompletion({
      system:
        "Classify the exact transcript chunk and decompose objectively verifiable compound statements into self-contained atomic claims. Preserve meaning, named entities, quantities, qualifiers, dates, and negation. Return no claims for pure opinion, prediction, or context. requiresMoreContext is true only if an incomplete fragment prevents reliable classification.",
      user: `Mode: ${data.settings.mode}\nForced after two windows: ${data.chunk.forced}\nExact transcript: ${data.chunk.text}`,
      output,
      jsonSchema: {
        name: "claim_extraction",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["classification", "requiresMoreContext", "claims"],
          properties: {
            classification: {
              enum: ["verifiable_fact", "opinion", "prediction", "context"],
            },
            requiresMoreContext: { type: "boolean" },
            claims: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["normalizedClaim", "context"],
                properties: {
                  normalizedClaim: { type: "string" },
                  context: { type: "string" },
                },
              },
            },
          },
        },
      },
    });
    logProviderStage({
      provider: (await import("./server/config.server")).getServerConfig().llmProvider,
      stage: `claim_extraction_${result.classification}`,
      durationMs: 0,
      count: result.claims.length,
    });
    return {
      ...result,
      originalText: data.chunk.text,
      claims: result.claims.map((claim) => ({
        ...claim,
        priority: deterministicPriority(claim.normalizedClaim, data.settings.mode),
      })),
    };
  });

export const verifyClaimStream = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        claim: claimInputSchema,
        settings: settingsSchema,
        customContext: customContextSchema,
        sessionToken: sessionTokenSchema,
      })
      .parse(data),
  )
  .handler(async function* ({ data }) {
    await noStore();
    const { publicError } = await import("./server/errors.server");
    const { runVerification } = await import("./server/pipeline.server");
    const { verifyAnonymousToken } = await import("./server/security.server");
    await verifyAnonymousToken(data.sessionToken, data.claim.sessionId);
    try {
      for await (const update of runVerification(data.claim, data.settings, data.customContext)) {
        yield update;
      }
    } catch (error) {
      yield { type: "error" as const, message: publicError(error) };
    }
  });

export const embedTexts = createServerFn({ method: "POST" })
  .validator((data: unknown) =>
    z
      .object({
        texts: z.array(z.string().min(1).max(8_000)).min(1).max(32),
        purpose: z.enum(["document", "query"]),
        sessionId: z.string().min(1).max(100),
        sessionToken: sessionTokenSchema,
      })
      .parse(data),
  )
  .handler(async ({ data }) => {
    await noStore();
    const { createEmbeddings } = await import("./server/aiml.server");
    const { verifyAnonymousToken } = await import("./server/security.server");
    await verifyAnonymousToken(data.sessionToken, data.sessionId);
    return { dimensions: 512, vectors: await createEmbeddings(data.texts) };
  });

export const getIntegrationHealth = createServerFn({ method: "GET" }).handler(async () => {
  await noStore();
  const { getServerConfig } = await import("./server/config.server");
  const config = getServerConfig();
  return {
    mode: config.serviceMode,
    ready:
      config.serviceMode === "mock" ||
      Boolean(
        config.speechmaticsApiKey &&
        config.brightDataToken &&
        (config.llmProvider === "ollama" ||
          (config.llmProvider === "gemini" ? config.geminiApiKey : config.aimlApiKey)),
      ),
    integrations: {
      speechmatics: Boolean(config.speechmaticsApiKey),
      brightData: Boolean(config.brightDataToken),
      aimlApi: Boolean(config.aimlApiKey),
      gemini: Boolean(config.geminiApiKey),
      localLlm: config.llmProvider === "ollama",
    },
    llmProvider: config.llmProvider,
    models: {
      extraction: config.fastModel,
      synthesis: config.synthesisModel,
      embeddings: config.embeddingModel,
    },
  };
});
