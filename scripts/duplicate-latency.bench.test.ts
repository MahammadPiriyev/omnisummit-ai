import { it, expect, vi } from "vitest";
import fs from "node:fs";
import { parseEnv } from "node:util";
import { z } from "zod";

vi.mock("@tanstack/react-start/server-only", () => ({}));
const bench = process.env["VOICECLAIM_BENCH"] === "true" ? it : it.skip;

bench(
  "measures identical concurrent local requests with and without sharing",
  async () => {
    Object.assign(process.env, parseEnv(fs.readFileSync(".env", "utf8")));
    const { structuredCompletion } = await import("../src/lib/voiceclaim/server/aiml.server");
    const text = "Eyfel qülləsi Parisdə yerləşir.";
    const options = {
      system:
        "Classify the transcript as a verifiable fact or opinion. Preserve its exact wording.",
      user: text,
      output: z.object({
        classification: z.enum(["verifiable_fact", "opinion"]),
        claim: z.literal(text),
      }),
      jsonSchema: {
        name: "duplicate_benchmark",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["classification", "claim"],
          properties: {
            classification: { enum: ["verifiable_fact", "opinion"] },
            claim: { type: "string", enum: [text] },
          },
        },
      },
    };
    // Warm-up excluded from both sides. Each round uses the same model and settings.
    await structuredCompletion(options);
    const realFetch = globalThis.fetch;
    let providerCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      if (String(input).endsWith("/api/chat")) providerCalls++;
      return realFetch(input, init);
    });
    const measurements = [];
    try {
      for (let round = 0; round < 2; round++) {
        for (const sharing of round === 0 ? [false, true] : [true, false]) {
          const start = performance.now();
          const count = providerCalls;
          const responses = await Promise.all(
            [0, 1].map(async () => ({
              result: await structuredCompletion({
                ...options,
                // Independent, never-aborted signals bypass coalescing, emulating
                // the previous two-provider-call behavior without modifying inference.
                ...(sharing ? {} : { signal: new AbortController().signal }),
              }),
              ms: performance.now() - start,
            })),
          );
          expect(responses.map((response) => response.result)).toEqual([
            { classification: "verifiable_fact", claim: text },
            { classification: "verifiable_fact", claim: text },
          ]);
          expect(providerCalls - count).toBe(sharing ? 1 : 2);
          measurements.push({
            round: round + 1,
            sharing,
            totalMs: performance.now() - start,
            responseMs: responses.map((response) => response.ms),
            providerCalls: providerCalls - count,
          });
          console.log("DUPLICATE_BENCH", measurements.at(-1));
        }
      }
    } finally {
      vi.restoreAllMocks();
      fs.mkdirSync(".local-llm/benchmarks", { recursive: true });
      fs.writeFileSync(
        ".local-llm/benchmarks/duplicate.json",
        JSON.stringify(
          {
            scope:
              "Two identical concurrent real local LLM requests; warm model; alternating order; not a full verification measurement",
            measurements,
          },
          null,
          2,
        ),
      );
    }
  },
  300_000,
);
