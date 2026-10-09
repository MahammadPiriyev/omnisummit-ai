import { describe, expect, it, vi } from "vitest";
vi.mock("@tanstack/react-start/server-only", () => ({}));
import { readMcpResponse } from "./mcp-response.server";

function sse(parts: string[], close = true) {
  const cancelled = vi.fn();
  const stream = new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(new TextEncoder().encode(part));
      if (close) controller.close();
    },
    cancel: cancelled,
  });
  return {
    response: new Response(stream, { headers: { "content-type": "text/event-stream" } }),
    cancelled,
  };
}

describe("MCP response streaming", () => {
  it("returns the matching response without waiting for an open stream to close", async () => {
    const { response, cancelled } = sse(
      [
        'data: {"method":"notifications/progress"}\n\n',
        'data: {"id":"other","result":"wrong"}\n\n',
        'data: {"id":"request","result":"doğru"}\n\n',
      ],
      false,
    );
    expect(await readMcpResponse(response, "request")).toEqual({ id: "request", result: "doğru" });
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
  it("supports split frames, CRLF and multiline data", async () => {
    const { response } = sse([
      'event: message\r\ndata: {"id":"re',
      'quest",\r\ndata: "result":42}\r',
      "\n\r\n",
    ]);
    expect(await readMcpResponse(response, "request")).toEqual({ id: "request", result: 42 });
  });
  it("preserves provider errors rather than treating them as evidence", async () => {
    const { response } = sse([
      'data: {"id":"request","error":{"code":-32603,"message":"error"}}\n\n',
    ]);
    expect((await readMcpResponse(response, "request")).error?.code).toBe(-32603);
  });
  it("does not accept unrelated notifications as a completed request", async () => {
    const { response } = sse(['data: {"method":"notifications/progress"}\n\n']);
    await expect(readMcpResponse(response, "request")).rejects.toMatchObject({
      code: "BRIGHTDATA_EMPTY_STREAM",
    });
  });
  it("supports ordinary JSON responses", async () => {
    expect(
      await readMcpResponse(Response.json({ id: "request", result: { a: 1 } }), "request"),
    ).toEqual({ id: "request", result: { a: 1 } });
  });
});
