import "@tanstack/react-start/server-only";
import { z } from "zod";

const configSchema = z.object({
  serviceMode: z.enum(["live", "mock"]),
  signingSecret: z.string().min(32),
  speechmaticsApiKey: z.string().optional(),
  speechmaticsRealtimeUrl: z.string().url(),
  speechmaticsBatchUrl: z.string().url(),
  brightDataToken: z.string().optional(),
  brightDataMcpUrl: z.string().url(),
  aimlApiKey: z.string().optional(),
  aimlBaseUrl: z.string().url(),
  llmProvider: z.enum(["aiml", "ollama", "gemini"]),
  geminiApiKey: z.string().optional(),
  geminiBaseUrl: z.string().url(),
  ollamaBaseUrl: z.string().url(),
  fastModel: z.string().min(1),
  synthesisModel: z.string().min(1),
  embeddingModel: z.string().min(1),
});

export type ServerConfig = z.infer<typeof configSchema>;

let cached: ServerConfig | undefined;

function env(name: string) {
  return process.env[name]?.trim() || undefined;
}

export function getServerConfig(): ServerConfig {
  if (cached) return cached;
  const serviceMode = env("VOICECLAIM_SERVICE_MODE") ?? "live";
  const llmProvider = env("VOICECLAIM_LLM_PROVIDER") ?? "aiml";
  const developmentSecret = "voiceclaim-local-development-secret-change-me";
  if (process.env["NODE_ENV"] === "production" && !env("VOICECLAIM_SESSION_SIGNING_SECRET")) {
    throw new Error("VOICECLAIM_SESSION_SIGNING_SECRET is required in production");
  }
  cached = configSchema.parse({
    serviceMode,
    signingSecret: env("VOICECLAIM_SESSION_SIGNING_SECRET") ?? developmentSecret,
    speechmaticsApiKey: env("SPEECHMATICS_API_KEY"),
    speechmaticsRealtimeUrl:
      env("SPEECHMATICS_REALTIME_URL") ?? "wss://global.rt.speechmatics.com/v2",
    speechmaticsBatchUrl: env("SPEECHMATICS_BATCH_URL") ?? "https://asr.api.speechmatics.com",
    brightDataToken: env("BRIGHTDATA_API_TOKEN"),
    brightDataMcpUrl: env("BRIGHTDATA_MCP_URL") ?? "https://mcp.brightdata.com/mcp",
    aimlApiKey: env("AIMLAPI_KEY"),
    aimlBaseUrl: env("AIMLAPI_BASE_URL") ?? "https://api.aimlapi.com/v1",
    llmProvider,
    geminiApiKey: env("GEMINI_API_KEY"),
    geminiBaseUrl: env("GEMINI_BASE_URL") ?? "https://generativelanguage.googleapis.com/v1beta",
    ollamaBaseUrl: env("OLLAMA_BASE_URL") ?? "http://127.0.0.1:11434",
    fastModel:
      env("VOICECLAIM_FAST_MODEL") ??
      (llmProvider === "ollama"
        ? "qwen3:1.7b"
        : llmProvider === "gemini"
          ? "gemini-3.5-flash"
          : "openai/gpt-4.1-mini-2025-04-14"),
    synthesisModel:
      env("VOICECLAIM_SYNTHESIS_MODEL") ??
      (llmProvider === "ollama"
        ? "qwen3:1.7b"
        : llmProvider === "gemini"
          ? "gemini-3.5-flash"
          : "openai/gpt-4.1-2025-04-14"),
    embeddingModel:
      env("VOICECLAIM_EMBEDDING_MODEL") ??
      (llmProvider === "ollama"
        ? "embeddinggemma"
        : llmProvider === "gemini"
          ? "gemini-embedding-001"
          : "text-embedding-3-small"),
  });
  return cached;
}

export function requireIntegration(name: "speechmatics" | "brightdata" | "aiml") {
  const config = getServerConfig();
  if (config.serviceMode === "mock") return config;
  const configured =
    name === "speechmatics"
      ? config.speechmaticsApiKey
      : name === "brightdata"
        ? config.brightDataToken
        : config.llmProvider === "ollama" ||
          (config.llmProvider === "gemini" ? config.geminiApiKey : config.aimlApiKey);
  if (!configured)
    throw new Error(
      `${name === "aiml" && config.llmProvider === "gemini" ? "GEMINI" : name.toUpperCase()}_NOT_CONFIGURED`,
    );
  return config;
}
