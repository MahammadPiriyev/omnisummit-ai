import { it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { z } from "zod";

vi.mock("@tanstack/react-start/server-only", () => ({}));
// Fixed synthetic source documents isolate inference time from Internet variability.
vi.mock("../src/lib/voiceclaim/server/bright-data.server", () => ({
  searchWeb: async () => [
    {
      title: "Example Company annual report 2024",
      url: "https://example.com/report",
      snippet: "Revenue rose 42%.",
    },
    {
      title: "Example Company audited results",
      url: "https://example.org/results",
      snippet: "Revenue rose 42%.",
    },
  ],
  scrapePage: async (hit: object, candidateId: string) => ({
    ...hit,
    candidateId,
    domain: candidateId.endsWith("1") ? "example.com" : "example.org",
    markdown:
      "# Example Company annual report 2024\nThe company's revenue was USD 142 million in 2024, compared with USD 100 million in 2023. Revenue increased by 42% year on year. These figures cover the entire company, not an individual business segment. The independent audit confirmed both amounts.\nThe company reports revenue on a consolidated basis. The accounting period ended on 31 December 2024. Expenses are reported separately and are not included in revenue. No changes in accounting policy affected comparability between the two years.",
    retrievedAt: "2026-10-09T00:00:00.000Z",
  }),
}));

const bench = process.env["VOICECLAIM_BENCH"] === "true" ? it : it.skip;
bench(
  "measures real local inference with identical fixed sources",
  async () => {
    Object.assign(process.env, parseEnv(fs.readFileSync(".env", "utf8")));
    const { runVerification } = await import("../src/lib/voiceclaim/server/pipeline.server");
    const { structuredCompletion } = await import("../src/lib/voiceclaim/server/aiml.server");
    const realFetch = globalThis.fetch;
    const calls: object[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const start = performance.now();
      const response = await realFetch(input, init);
      if (String(input).includes("/api/chat") && response.ok) {
        const metrics = await response.clone().json();
        const request = JSON.parse(init!.body as string);
        calls.push({
          ms: performance.now() - start,
          promptTokens: metrics.prompt_eval_count,
          outputTokens: metrics.eval_count,
          loadMs: metrics.load_duration / 1e6,
          promptMs: metrics.prompt_eval_duration / 1e6,
          generationMs: metrics.eval_duration / 1e6,
          context: request.options.num_ctx,
          response: JSON.parse(metrics.message.content),
        });
      }
      return response;
    });
    const tag = process.env["VOICECLAIM_BENCH_TAG"] ?? "run";
    const cases = [];
    const extractionStart = performance.now();
    const extraction = await structuredCompletion({
      system:
        "Classify the exact transcript chunk and decompose objectively verifiable compound statements into self-contained atomic claims. Preserve meaning, named entities, quantities, qualifiers, dates, and negation. Return no claims for pure opinion, prediction, or context. requiresMoreContext is true only if an incomplete fragment prevents reliable classification.",
      user: "Mode: general\nForced after two windows: true\nExact transcript: Nümunə şirkətinin gəliri 2024-cü ildə 42 faiz artıb.",
      output: z.object({
        classification: z.string(),
        requiresMoreContext: z.boolean(),
        claims: z.array(z.object({ normalizedClaim: z.string(), context: z.string() })),
      }),
      jsonSchema: {
        name: "claim_extraction",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["classification", "requiresMoreContext", "claims"],
          properties: {
            classification: { enum: ["verifiable_fact", "opinion", "prediction", "context"] },
            requiresMoreContext: { type: "boolean" },
            claims: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["normalizedClaim", "context"],
                properties: { normalizedClaim: { type: "string" }, context: { type: "string" } },
              },
            },
          },
        },
      },
    });
    cases.push({ name: "extraction", ms: performance.now() - extractionStart, extraction });
    const repetitions = Number(process.env["VOICECLAIM_BENCH_REPEATS"] ?? 2);
    for (let index = 0; index < repetitions; index++) {
      const start = performance.now();
      const stages: object[] = [];
      const updates = [];
      const text = "Nümunə şirkətinin gəliri 2024-cü ildə 42 faiz artıb.";
      try {
        for await (const update of runVerification(
          {
            id: "benchmark-claim",
            sessionId: "benchmark-session",
            sourceSegmentIds: ["segment-1"],
            originalText: text,
            normalizedClaim: text,
            context: "2024-cü il üzrə bütün şirkətin illik gəliri.",
            timestampMs: 0,
            mode: "general",
            depth: "quick",
            state: "DETECTED",
            priority: 90,
            manual: false,
            evidence: [],
          },
          {
            mode: "general",
            depth: "quick",
            intervalPreset: "balanced",
            sourceCount: 2,
            concurrency: 1,
          },
          "",
        )) {
          stages.push({
            type: update.type,
            ...(update.type === "stage" ? { stage: update.state } : {}),
            elapsedMs: performance.now() - start,
          });
          updates.push(update);
        }
        cases.push({
          name: `verification-${index + 1}`,
          ms: performance.now() - start,
          stages,
          updates,
        });
      } catch (error) {
        cases.push({
          name: `verification-${index + 1}`,
          ms: performance.now() - start,
          stages,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
      console.log("BENCH_PROGRESS", tag, index + 1, Math.round(performance.now() - start));
      fs.mkdirSync(".local-llm/benchmarks", { recursive: true });
      fs.writeFileSync(
        path.join(".local-llm/benchmarks", `${tag}.json`),
        JSON.stringify(
          {
            tag,
            model: "qwen3:1.7b",
            sourceMode: "fixed synthetic documents; real local LLM; no Internet time",
            cases,
            calls,
          },
          null,
          2,
        ),
      );
    }
    vi.restoreAllMocks();
  },
  1_200_000,
);
