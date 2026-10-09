import "@tanstack/react-start/server-only";
import type { ProviderName } from "./errors.server";

export function logProviderStage(event: {
  provider: ProviderName;
  stage: string;
  durationMs: number;
  count?: number | undefined;
  errorCode?: string | undefined;
  promptTokens?: number | undefined;
  outputTokens?: number | undefined;
  loadMs?: number | undefined;
  promptMs?: number | undefined;
  generationMs?: number | undefined;
}) {
  console.info(
    JSON.stringify({
      event: "voiceclaim_provider_stage",
      provider: event.provider,
      stage: event.stage,
      durationMs: Math.round(event.durationMs),
      ...(event.count === undefined ? {} : { count: event.count }),
      ...(event.errorCode ? { errorCode: event.errorCode } : {}),
      ...Object.fromEntries(
        (["promptTokens", "outputTokens", "loadMs", "promptMs", "generationMs"] as const)
          .filter((key) => event[key] !== undefined)
          .map((key) => [key, Math.round(event[key]!)]),
      ),
    }),
  );
}
