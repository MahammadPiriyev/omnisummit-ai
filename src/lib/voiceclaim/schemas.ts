import { z } from "zod";
import type { EvidenceItem } from "./types";

export const verificationModeSchema = z.enum(["general", "investor", "academic", "custom"]);
export const verificationDepthSchema = z.enum(["quick", "deep"]);
export const intervalPresetSchema = z.enum(["fast", "balanced", "long"]);

export const settingsSchema = z.object({
  mode: verificationModeSchema,
  depth: verificationDepthSchema,
  intervalPreset: intervalPresetSchema,
  sourceCount: z.number().int().min(2).max(8),
  concurrency: z.number().int().min(1).max(4),
});

export const transcriptChunkSchema = z.object({
  id: z.string().min(1).max(100),
  sessionId: z.string().min(1).max(100),
  sourceSegmentIds: z.array(z.string().min(1).max(100)).min(1).max(100),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string().min(1).max(30_000),
  intervalWindows: z.number().int().min(1).max(2),
  forced: z.boolean(),
});

export const customContextSchema = z.string().max(12_000).default("");

export const claimInputSchema = z.object({
  id: z.string().min(1).max(150),
  sessionId: z.string().min(1).max(100),
  sourceSegmentIds: z.array(z.string().min(1).max(100)).min(1).max(100),
  originalText: z.string().min(1).max(30_000),
  normalizedClaim: z.string().min(1).max(8_000),
  context: z.string().max(12_000),
  timestampMs: z.number().int().nonnegative(),
  mode: verificationModeSchema,
  depth: verificationDepthSchema,
  state: z.enum([
    "DETECTED",
    "QUEUED",
    "RESEARCHING",
    "CHALLENGING",
    "SYNTHESIZING",
    "COMPLETED",
    "INSUFFICIENT_EVIDENCE",
    "VERIFICATION_ERROR",
  ]),
  priority: z.number().min(0).max(100),
  manual: z.boolean(),
  evidence: z.array(z.custom<EvidenceItem>()).max(100),
});

export const sessionTokenSchema = z.string().min(20).max(4096);
