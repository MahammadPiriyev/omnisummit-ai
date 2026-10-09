import { it, vi, expect } from "vitest";
import fs from "node:fs";
vi.mock("@tanstack/react-start/server-only", () => ({}));
import { readMcpResponse } from "../src/lib/voiceclaim/server/mcp-response.server";
const bench = process.env["VOICECLAIM_BENCH"] === "true" ? it : it.skip;
bench(
  "compares whole-body and incremental reads on the same delayed-close SSE response",
  async () => {
    const makeResponse = () => {
      let closing: ReturnType<typeof setTimeout>;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode(
                'data: {"id":"bench","result":{"source":"exact result"}}\n\n',
              ),
            );
            closing = setTimeout(() => controller.close(), 300);
          },
          cancel() {
            clearTimeout(closing);
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    };
    const before = [],
      after = [];
    for (let index = 0; index < 3; index++) {
      let started = performance.now();
      const body = await makeResponse().text();
      const prior = JSON.parse(body.split("data:")[1]!.trim());
      before.push(performance.now() - started);
      started = performance.now();
      const optimized = await readMcpResponse(makeResponse(), "bench");
      after.push(performance.now() - started);
      expect(optimized).toEqual(prior);
    }
    fs.mkdirSync(".local-llm/benchmarks", { recursive: true });
    fs.writeFileSync(
      ".local-llm/benchmarks/network.json",
      JSON.stringify(
        {
          scope: "Controlled SSE response, 300ms delayed close; not an Internet-speed measurement",
          beforeMs: before,
          afterMs: after,
        },
        null,
        2,
      ),
    );
  },
);
