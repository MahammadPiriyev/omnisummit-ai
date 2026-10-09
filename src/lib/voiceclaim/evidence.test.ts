import { describe, expect, it } from "vitest";
import {
  aggregateStrength,
  canonicalizeUrl,
  computeEvidenceConfidence,
  determineVerdict,
  excerptAppearsInSource,
  isPrivateHost,
  type ScoredEvidence,
} from "./server/evidence";

const base: ScoredEvidence = {
  id: "candidate-1",
  title: "Primary report",
  domain: "example.gov",
  url: "https://example.gov/report",
  category: "government",
  excerpt: "The measured result was 42 percent in 2025.",
  relation: "supports",
  retrievedAt: "2026-08-10T00:00:00.000Z",
  authority: "high",
  independent: true,
  relevance: 1,
  directness: 1,
  freshnessScore: 1,
};

describe("evidence provenance", () => {
  it("canonicalizes tracking URLs and blocks private targets", () => {
    expect(canonicalizeUrl("HTTPS://Example.COM/report/?utm_source=x&gclid=y#part")).toBe(
      "https://example.com/report",
    );
    expect(() => canonicalizeUrl("http://127.0.0.1/private")).toThrow("PRIVATE_NETWORK_URL");
    expect(isPrivateHost("192.168.1.2")).toBe(true);
  });

  it("accepts only normalized exact excerpts", () => {
    expect(
      excerptAppearsInSource(
        "The measured result was 42 percent in 2025.",
        "Report\n\nThe   measured result was 42 percent in 2025. End.",
      ),
    ).toBe(true);
    expect(
      excerptAppearsInSource("A plausible but invented excerpt long enough.", base.excerpt),
    ).toBe(false);
  });

  it("matches visible wording across Markdown formatting without accepting paraphrases", () => {
    expect(
      excerptAppearsInSource(
        "Medicare has the authority to negotiate prices for certain drugs.",
        "## Policy\n\n**Medicare** has the authority to [negotiate prices](https://example.gov) for certain drugs.",
      ),
    ).toBe(true);
    expect(
      excerptAppearsInSource(
        "Medicare may bargain over the cost of selected medicines.",
        "Medicare has the authority to negotiate prices for certain drugs.",
      ),
    ).toBe(false);
  });

  it("discounts duplicates by excluding them from independent aggregation", () => {
    const duplicate = { ...base, id: "candidate-2", independent: false };
    expect(aggregateStrength([base, duplicate], "supports")).toBeCloseTo(0.9, 5);
  });
});

describe("deterministic verdicts", () => {
  it.each([
    [
      {
        support: 0.9,
        contradiction: 0.1,
        allMaterialElementsCovered: true,
        materialDistortion: false,
      },
      "supported",
    ],
    [
      {
        support: 0.7,
        contradiction: 0.2,
        allMaterialElementsCovered: false,
        materialDistortion: false,
      },
      "mostly_supported",
    ],
    [
      {
        support: 0.55,
        contradiction: 0.55,
        allMaterialElementsCovered: false,
        materialDistortion: false,
      },
      "mixed",
    ],
    [
      {
        support: 0.2,
        contradiction: 0.75,
        allMaterialElementsCovered: false,
        materialDistortion: false,
      },
      "contradicted",
    ],
    [
      {
        support: 0.9,
        contradiction: 0.05,
        allMaterialElementsCovered: true,
        materialDistortion: true,
      },
      "misleading",
    ],
    [
      {
        support: 0.4,
        contradiction: 0.1,
        allMaterialElementsCovered: false,
        materialDistortion: false,
      },
      "insufficient_evidence",
    ],
  ] as const)("maps evidence thresholds", (input, expected) => {
    expect(determineVerdict(input)).toBe(expected);
  });

  it("computes confidence in code and caps it at 95", () => {
    const confidence = computeEvidenceConfidence({
      verdict: "supported",
      support: 1,
      contradiction: 0,
      evidence: [base],
      materialGapCount: 0,
      successfulQueries: 4,
      requestedQueries: 4,
    });
    expect(confidence.score).toBe(95);
    expect(confidence.evidenceStrength).toBe("high");
  });
});
