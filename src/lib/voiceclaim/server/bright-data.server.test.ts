import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tanstack/react-start/server-only", () => ({}));
vi.mock("./config.server", () => ({
  requireIntegration: () => ({
    brightDataToken: "test-token",
    brightDataMcpUrl: "https://mcp.example.com/mcp",
  }),
}));

function mockMcp(failStatus?: number) {
  let calls = 0;
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    const data = JSON.parse(init!.body as string);
    if (data.method === "initialize")
      return Response.json(
        { id: data.id, result: {} },
        { headers: { "mcp-session-id": "session-test" } },
      );
    if (data.method === "notifications/initialized") return new Response(null, { status: 202 });
    if (data.method === "tools/list")
      return Response.json({
        id: data.id,
        result: { tools: [{ name: "search_engine" }, { name: "scrape_as_markdown" }] },
      });
    calls++;
    if (failStatus && calls === 1) return new Response(null, { status: failStatus });
    await new Promise((resolve) => setTimeout(resolve, 5));
    return Response.json({
      id: data.id,
      result: {
        content: [
          {
            type: "text",
            text:
              data.params.name === "search_engine"
                ? JSON.stringify({
                    organic: [
                      { title: "Report", link: "https://example.com/report", snippet: "Revenue" },
                    ],
                  })
                : "# Report\nRevenue increased by 42 percent.",
          },
        ],
      },
    });
  });
  return {
    fetchMock,
    count: (method: string) =>
      fetchMock.mock.calls.filter(([, init]) => JSON.parse(init!.body as string).method === method)
        .length,
  };
}

describe("Bright Data request reuse", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });
  it("shares concurrent identical searches and refreshes after completion", async () => {
    const { count } = mockMcp();
    const { searchWeb } = await import("./bright-data.server");
    const [a, b] = await Promise.all([searchWeb("exact query"), searchWeb("exact query")]);
    expect(a).toEqual(b);
    expect(count("initialize")).toBe(1);
    expect(count("tools/call")).toBe(1);
    await searchWeb("exact query");
    expect(count("tools/call")).toBe(2);
  });
  it("keeps a healthy session across transient gateway errors", async () => {
    const { count } = mockMcp(503);
    const { searchWeb } = await import("./bright-data.server");
    expect((await searchWeb("query")).length).toBe(1);
    expect(count("initialize")).toBe(1);
    expect(count("tools/call")).toBe(2);
  });
  it("reopens an expired session on 404 and retries the request", async () => {
    const { count } = mockMcp(404);
    const { searchWeb } = await import("./bright-data.server");
    expect((await searchWeb("query")).length).toBe(1);
    expect(count("initialize")).toBe(2);
  });
  it("shares page retrieval while preserving each candidate's identity", async () => {
    const { count } = mockMcp();
    const { scrapePage } = await import("./bright-data.server");
    const hit = { title: "Report", url: "https://example.com/report", snippet: "Revenue" };
    const [a, b] = await Promise.all([
      scrapePage(hit, "candidate-a"),
      scrapePage(hit, "candidate-b"),
    ]);
    expect(a.candidateId).toBe("candidate-a");
    expect(b.candidateId).toBe("candidate-b");
    expect(a.markdown).toBe(b.markdown);
    expect(count("tools/call")).toBe(1);
  });
});
