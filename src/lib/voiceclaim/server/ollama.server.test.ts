import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("./config.server", () => ({
  getServerConfig: () => ({
    llmProvider: "ollama",
    ollamaBaseUrl: "http://127.0.0.1:11434",
    fastModel: "qwen3:1.7b",
    embeddingModel: "embeddinggemma",
  }),
  requireIntegration: () => ({ llmProvider: "ollama" }),
}));

import { structuredCompletion, createEmbeddings } from "./aiml.server";

const options = {
  system: "Extract factual claims",
  user: "Revenue rose by 42%.",
  output: z.object({ claims: z.array(z.string()) }),
  jsonSchema: {
    name: "claims",
    schema: {
      type: "object",
      required: ["claims"],
      properties: { claims: { type: "array", items: { type: "string" } } },
    },
  },
};

describe("local LLM routing", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("uses real local inference without an AI/ML key or paid endpoint", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        message: { content: JSON.stringify({ claims: ["Revenue rose by 42%."] }) },
        done_reason: "stop",
      }),
    );
    expect(await structuredCompletion(options)).toEqual({ claims: ["Revenue rose by 42%."] });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(init?.headers).not.toHaveProperty("Authorization");
    const body = JSON.parse(init?.body as string);
    expect(body).toMatchObject({
      model: "qwen3:1.7b",
      stream: false,
      think: false,
      format: options.jsonSchema.schema,
    });
    expect(body.messages[0].content).toContain("English (en-US)");
    expect(body.messages[0].content).toContain("Preserve originalText and excerpt");
    expect(options.system).toBe("Extract factual claims");
  });

  it("repairs invalid model output before accepting a result", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ message: { content: '{"claims":42}' } }))
      .mockResolvedValueOnce(Response.json({ message: { content: '{"claims":[]}' } }));
    expect(await structuredCompletion(options)).toEqual({ claims: [] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shares identical active work without caching completed answers", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return Response.json({ message: { content: '{"claims":[]}' } });
    });
    expect(
      await Promise.all([structuredCompletion(options), structuredCompletion(options)]),
    ).toEqual([{ claims: [] }, { claims: [] }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await structuredCompletion(options);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not share independently cancellable work", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json({ message: { content: '{"claims":[]}' } }));
    await Promise.all([
      structuredCompletion({ ...options, signal: new AbortController().signal }),
      structuredCompletion({ ...options, signal: new AbortController().signal }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("discourages repeated synthesis text without penalizing exact evidence quotes", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => Response.json({ message: { content: '{"claims":[]}' } }));
    await structuredCompletion({
      ...options,
      jsonSchema: { ...options.jsonSchema, name: "verification_synthesis" },
    });
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string).options.repeat_penalty).toBe(
      1.1,
    );
    await structuredCompletion({
      ...options,
      jsonSchema: { ...options.jsonSchema, name: "evidence_analysis" },
    });
    expect(JSON.parse(fetchMock.mock.calls[1]![1]!.body as string).options).not.toHaveProperty(
      "repeat_penalty",
    );
  });

  it("reports missing models without creating a fake verdict", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 404 }));
    await expect(structuredCompletion(options)).rejects.toMatchObject({
      code: "OLLAMA_MODEL_MISSING",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports an unavailable local runtime clearly", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("fetch failed"));
    await expect(structuredCompletion(options)).rejects.toMatchObject({
      code: "OLLAMA_UNAVAILABLE",
    });
  });

  it("distinguishes a slow CPU request from a stopped server", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("REQUEST_TIMEOUT"));
    await expect(structuredCompletion(options)).rejects.toMatchObject({ code: "OLLAMA_TIMEOUT" });
  });

  it("uses the local embedding model with validated 512-dimension vectors", async () => {
    const vector = Array.from({ length: 512 }, () => 0.01);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ embeddings: [vector] }));
    expect(await createEmbeddings(["A factual claim"])).toEqual([vector]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:11434/api/embed");
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string)).toMatchObject({
      model: "embeddinggemma",
      dimensions: 512,
    });
  });

  it("rejects embeddings with incompatible dimensions", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ embeddings: [[0.1, 0.2]] }));
    await expect(createEmbeddings(["A factual claim"])).rejects.toMatchObject({
      code: "OLLAMA_INVALID_EMBEDDINGS",
    });
  });
});
