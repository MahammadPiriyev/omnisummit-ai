import assert from "node:assert/strict";
import { serverFnFetcher } from "../node_modules/@tanstack/start-client-core/dist/esm/client-rpc/serverFnFetcher.js";
import { runWithStartContext } from "@tanstack/start-storage-context";

// Exercise the actual running application's server functions, not mocked inference.
const origin = process.env.VOICECLAIM_SMOKE_URL ?? "http://localhost:3000";
const expectedProvider =
  process.argv.find((value) => value.startsWith("--provider="))?.split("=")[1] ?? "ollama";
const moduleResponse = await fetch(`${origin}/src/lib/voiceclaim/functions.ts`);
assert(moduleResponse.ok, "Development server is not running");
const source = await moduleResponse.text();
async function call(name, method, data) {
  const match = source.match(
    new RegExp(`export const ${name} = [\\s\\S]*?createClientRpc\\("([^"\\n]+)"\\)`),
  );
  assert(match, `Server function ${name} was not found`);
  const value = await runWithStartContext({ startOptions: {} }, () =>
    serverFnFetcher(
      `${origin}/_serverFn/${match[1]}`,
      [{ method, data, headers: { Origin: origin, "Sec-Fetch-Site": "same-origin" } }],
      fetch,
    ),
  );
  if (value.error) throw value.error;
  return value.result;
}
const health = await call("getIntegrationHealth", "GET");
console.log("Active LLM provider:", health.llmProvider, "models:", health.models);
assert.equal(
  health.llmProvider,
  expectedProvider,
  "The running app has not loaded .env; restart Vite",
);
if (process.argv.includes("--health")) process.exit(0);
const sessionId = `local-llm-smoke-${crypto.randomUUID()}`;
const session = await call("createAnonymousSession", "POST", { requestedSessionId: sessionId });
if (process.argv.includes("--embeddings-only")) {
  const embeddings = await call("embedTexts", "POST", {
    texts: ["The Eiffel Tower is in Paris."],
    purpose: "document",
    sessionId,
    sessionToken: session.sessionToken,
  });
  assert.equal(embeddings.vectors.length, 1);
  assert.equal(embeddings.vectors[0].length, 512);
  console.log("Real local embeddings passed: 512 dimensions");
  process.exit(0);
}
const settings = {
  mode: "general",
  depth: "quick",
  intervalPreset: "balanced",
  sourceCount: 2,
  concurrency: 1,
};
const text = "Eyfel qülləsi Fransanın Paris şəhərində yerləşir.";
const extraction = await call("extractClaims", "POST", {
  chunk: {
    id: "smoke-chunk",
    sessionId,
    sourceSegmentIds: ["smoke-segment"],
    startMs: 0,
    endMs: 3000,
    text,
    intervalWindows: 1,
    forced: true,
  },
  settings,
  sessionToken: session.sessionToken,
});
assert.equal(extraction.classification, "verifiable_fact");
assert(extraction.claims.length > 0, "Local model did not extract the factual statement");
assert(/Paris/i.test(extraction.claims[0].normalizedClaim));
assert(
  /located|is in|stands|situated/i.test(extraction.claims[0].normalizedClaim),
  "Expected English claim output",
);
console.log(
  "Real local extraction passed:",
  extraction.claims.map((claim) => claim.normalizedClaim),
);
if (process.argv.includes("--extract-only")) process.exit(0);
const extracted = extraction.claims[0];
const response = await call("verifyClaimStream", "POST", {
  claim: {
    id: "local-smoke-claim",
    sessionId,
    sourceSegmentIds: ["smoke-segment"],
    originalText: text,
    normalizedClaim: extracted.normalizedClaim,
    context: extracted.context,
    timestampMs: 0,
    mode: "general",
    depth: "quick",
    state: "DETECTED",
    priority: 90,
    manual: false,
    evidence: [],
  },
  settings,
  customContext: "",
  sessionToken: session.sessionToken,
});
assert(
  response && typeof response[Symbol.asyncIterator] === "function",
  "Verification did not return a stream",
);
let result;
let evidenceCount = 0;
for await (const update of response) {
  if (update.type === "error") throw new Error(update.message);
  if (update.type === "stage") console.log("Verification stage:", update.state);
  if (update.type === "evidence") evidenceCount += update.items.length;
  if (update.type === "result") result = update.result;
}
assert(result, "Verification finished without a result");
assert(evidenceCount > 0, "Verification returned no accepted source evidence");
assert(
  !/[əƏıİğĞşŞçÇöÖüÜ]/.test(
    [
      result.summary,
      result.explanation,
      result.challengeSummary,
      ...result.evidenceGaps,
      ...result.recommendedActions,
    ].join(" "),
  ),
  "Expected English verification output",
);
console.log("Real sourced verification passed:", {
  verdict: result.verdict,
  evidenceCount,
  summary: result.summary,
});
