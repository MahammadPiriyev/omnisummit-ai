import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AtomicClaim, SessionSettings } from "../types";
import type { VerificationUpdate } from "../services/types";

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("./config.server", () => ({ getServerConfig: () => ({ llmProvider: "ollama" }) }));
vi.mock("./aiml.server", () => ({
  structuredCompletion: vi.fn().mockResolvedValue({
    supporting: ["Paris official", "Eiffel Tower official"],
    contradictory: ["Paris correction", "Eiffel Tower correction"],
  }),
}));
vi.mock("./bright-data.server", () => ({
  searchWeb: vi.fn().mockResolvedValue([]),
  scrapePage: vi.fn(),
}));
import { structuredCompletion } from "./aiml.server";
import { searchWeb, scrapePage } from "./bright-data.server";
import { runVerification } from "./pipeline.server";

beforeEach(() => {
  vi.mocked(structuredCompletion)
    .mockReset()
    .mockResolvedValue({
      supporting: ["Paris official", "Eiffel Tower official"],
      contradictory: ["Paris correction", "Eiffel Tower correction"],
    });
  vi.mocked(searchWeb).mockReset().mockResolvedValue([]);
  vi.mocked(scrapePage).mockReset();
});

describe("source-free verification", () => {
  it("returns an English insufficient-evidence result without asking the model to invent an explanation", async () => {
    const claim = {
      normalizedClaim: "Eyfel qülləsi Parisdə yerləşir.",
      originalText: "Eyfel qülləsi Parisdə yerləşir.",
      mode: "general",
    } as AtomicClaim;
    const settings = { depth: "quick", sourceCount: 2 } as SessionSettings;
    const updates = [];
    for await (const update of runVerification(claim, settings, "")) updates.push(update);
    const result = updates.find((update) => update.type === "result");
    expect(result?.type === "result" && result.result.verdict).toBe("insufficient_evidence");
    expect(result?.type === "result" && result.result.summary).toBe(
      "No suitable evidence was found to verify this claim.",
    );
    expect(structuredCompletion).toHaveBeenCalledTimes(1);
    expect(updates.some((update) => update.type === "error")).toBe(false);
  });
});

const claim = {
  normalizedClaim: "Gəlir 2024-cü ildə 42 faiz artıb.",
  originalText: "Gəlir 2024-cü ildə 42 faiz artıb.",
  mode: "general",
} as AtomicClaim;
const settings = { depth: "quick", sourceCount: 2 } as SessionSettings;
const exactQuote = "Revenue increased by 42% in 2024.";

function sourceFixture(excerpt = exactQuote) {
  vi.mocked(searchWeb).mockResolvedValue([
    { title: "Report", url: "https://example.com/report", snippet: "Revenue" },
    { title: "Audit", url: "https://example.org/audit", snippet: "Revenue" },
  ]);
  vi.mocked(scrapePage).mockImplementation(async (hit, candidateId) => ({
    ...hit,
    candidateId,
    domain: new URL(hit.url).hostname,
    markdown: exactQuote,
    retrievedAt: "2026-10-09T00:00:00Z",
  }));
  vi.mocked(structuredCompletion).mockImplementation(async (options) => {
    if (options.jsonSchema.name === "verification_queries")
      return {
        supporting: ["company report", "company audit"],
        contradictory: ["company correction", "company revenue dispute"],
      };
    if (options.jsonSchema.name === "evidence_analysis") {
      const schema = options.jsonSchema.schema as {
        properties: {
          analyses: {
            maxItems: number;
            items: { properties: { candidateId: { enum: string[] } } };
          };
        };
      };
      expect(schema.properties.analyses.maxItems).toBe(2);
      expect(schema.properties.analyses.items.properties.candidateId.enum).toEqual([
        "candidate-1",
        "candidate-2",
      ]);
      return {
        analyses: ["candidate-1", "candidate-2"].map((candidateId) => ({
          candidateId,
          excerpt,
          translatedTitle: "Hesabat",
          translatedExcerpt: "Gəlir 2024-cü ildə 42 faiz artıb.",
          relation: "supports",
          authority: "high",
          category: "financial_filing",
          relevance: 1,
          directness: 1,
          freshness: 1,
          publishedAt: null,
          upstreamUrl: "https://example.net/original",
          materialDistortion: false,
        })),
      };
    }
    expect(options.jsonSchema.name).toBe("verification_synthesis");
    expect(options.user).toContain(exactQuote);
    return {
      summary: "Mənbələr artımı təsdiqləyir.",
      explanation: "Gəlir 2024-cü ildə 42 faiz artıb.",
      challengeSummary: "Əks sübut tapılmadı.",
      evidenceGaps: [],
      recommendedActions: [],
      allMaterialElementsCovered: true,
    };
  });
}

describe("bounded inference preserves evidence checks", () => {
  it("keeps all four searches, exact quotes, translation and upstream independence", async () => {
    sourceFixture();
    const updates = [];
    for await (const update of runVerification(claim, settings, "")) updates.push(update);
    expect(searchWeb).toHaveBeenCalledTimes(4);
    const evidence = updates.find((update) => update.type === "evidence");
    expect(evidence?.type).toBe("evidence");
    if (evidence?.type !== "evidence") throw new Error("Missing evidence");
    expect(evidence.items).toHaveLength(2);
    expect(evidence.items.map((item) => item.excerpt)).toEqual([exactQuote, exactQuote]);
    expect(evidence.items[0]?.translatedExcerpt).toContain("42 faiz");
    expect(evidence.items.map((item) => item.independent)).toEqual([true, false]);
    expect(updates.some((update) => update.type === "result")).toBe(true);
    expect(
      vi.mocked(structuredCompletion).mock.calls.map(([options]) => options.jsonSchema.name),
    ).toEqual(["verification_queries", "evidence_analysis", "verification_synthesis"]);
  });

  it("rejects translated or fabricated quotes and never synthesizes from them", async () => {
    sourceFixture("Gəlir 2024-cü ildə 42 faiz artıb.");
    const updates = [];
    for await (const update of runVerification(claim, settings, "")) updates.push(update);
    expect(updates.some((update) => update.type === "evidence")).toBe(false);
    const result = updates.find((update) => update.type === "result");
    expect(result?.type === "result" && result.result.verdict).toBe("insufficient_evidence");
    expect(structuredCompletion).toHaveBeenCalledTimes(2);
  });

  it("propagates provider failure rather than producing an evidence verdict", async () => {
    vi.mocked(structuredCompletion).mockRejectedValue(new Error("provider unavailable"));
    const updates: VerificationUpdate[] = [];
    await expect(
      (async () => {
        for await (const update of runVerification(claim, settings, "")) updates.push(update);
      })(),
    ).rejects.toThrow("provider unavailable");
    expect(updates.some((update) => update.type === "result")).toBe(false);
  });
});
