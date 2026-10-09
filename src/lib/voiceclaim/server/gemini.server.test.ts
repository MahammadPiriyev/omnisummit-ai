import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const config = vi.hoisted(() => ({
  llmProvider: "gemini",
  geminiApiKey: "test-gemini-key",
  geminiBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
  fastModel: "gemini-3.5-flash",
  embeddingModel: "gemini-embedding-001",
  aimlApiKey: "unused-aiml-key",
}));
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("./config.server", () => ({
  requireIntegration: () => config,
  getServerConfig: () => config,
}));
import { structuredCompletion, createEmbeddings } from "./aiml.server";

const options = {
  system: "Extract factual claims. Preserve exact excerpts.",
  user: "Gəlir 42 faiz artıb.",
  output: z.object({ claim: z.string() }),
  jsonSchema: {
    name: "claims",
    schema: {
      type: "object",
      required: ["claim"],
      additionalProperties: false,
      properties: { claim: { type: "string" } },
    },
  },
};
const validResponse = () =>
  Response.json({ choices: [{ message: { content: '{"claim":"Gəlir 42 faiz artıb."}' } }] });

describe("Gemini provider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    config.geminiApiKey = "test-gemini-key";
  });

  it("routes structured output directly to Google with the Gemini key and Azerbaijani instructions", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => validResponse());
    expect(await structuredCompletion(options)).toEqual({ claim: "Gəlir 42 faiz artıb." });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-gemini-key" });
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe("gemini-3.5-flash");
    expect(body.response_format.json_schema.schema).toEqual(options.jsonSchema.schema);
    expect(body.messages[0].content).toContain("Azerbaijani (az-AZ)");
    expect(body.messages[0].content).toContain("Preserve originalText and excerpt");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never falls back to Ollama or AI/ML when the Gemini key is missing", async () => {
    config.geminiApiKey = "";
    const fetchMock = vi.spyOn(globalThis, "fetch");
    await expect(structuredCompletion(options)).rejects.toMatchObject({
      code: "GEMINI_NOT_CONFIGURED",
    });
    await expect(createEmbeddings(["claim"])).rejects.toMatchObject({
      code: "GEMINI_NOT_CONFIGURED",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("repairs malformed output once and validates with Zod", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"claim":42}' } }] }))
      .mockResolvedValueOnce(validResponse());
    expect(await structuredCompletion(options)).toEqual({ claim: "Gəlir 42 faiz artıb." });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports access failure without an evidence verdict or retry", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 403 }));
    await expect(structuredCompletion(options)).rejects.toMatchObject({
      code: "GEMINI_HTTP_403",
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries temporary 503 failures without falsely claiming invalid model output", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(null, { status: 503, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(new Response(null, { status: 503, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(validResponse());
    expect(await structuredCompletion(options)).toEqual({ claim: "Gəlir 42 faiz artıb." });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls) {
      expect(JSON.parse(init!.body as string).messages[1].content).toBe(options.user);
    }
  });

  it("caps persistent 503 retries and returns an Azerbaijani service error", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(
        async () => new Response(null, { status: 503, headers: { "retry-after": "0" } }),
      );
    await expect(structuredCompletion(options)).rejects.toMatchObject({
      code: "GEMINI_HTTP_503",
      message: expect.stringContaining("müvəqqəti əlçatan deyil"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("still repairs malformed output only once", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        Response.json({ choices: [{ message: { content: '{"claim":42}' } }] }),
      );
    await expect(structuredCompletion(options)).rejects.toMatchObject({
      code: "GEMINI_INVALID_OUTPUT",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses native batch embeddings in input order and requests 512 dimensions", async () => {
    const first = Array.from({ length: 512 }, () => 0.1);
    const second = Array.from({ length: 512 }, () => 0.2);
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ embeddings: [{ values: first }, { values: second }] }));
    expect(await createEmbeddings(["first", "second"])).toEqual([first, second]);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents",
    );
    expect(init?.headers).toMatchObject({ "x-goog-api-key": "test-gemini-key" });
    expect(JSON.parse(init!.body as string).requests).toEqual(
      ["first", "second"].map((text) => ({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text }] },
        outputDimensionality: 512,
      })),
    );
  });

  it("rejects incompatible vectors", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ embeddings: [{ values: [0.1] }] }),
    );
    await expect(createEmbeddings(["claim"])).rejects.toMatchObject({
      code: "GEMINI_INVALID_EMBEDDINGS",
    });
  });
});
