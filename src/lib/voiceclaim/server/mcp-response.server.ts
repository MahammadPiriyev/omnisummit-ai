import "@tanstack/react-start/server-only";
import { ProviderError } from "./errors.server";

export interface JsonRpcResponse {
  id?: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Stop as soon as this request's response arrives, even if the SSE connection stays open. */
export async function readMcpResponse(
  response: Response,
  requestId: unknown,
): Promise<JsonRpcResponse> {
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    return (await response.json()) as JsonRpcResponse;
  const reader = response.body?.getReader();
  if (!reader) throw emptyResponse();
  const decoder = new TextDecoder();
  let buffer = "";
  const parse = (frame: string) => {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    const message = JSON.parse(data) as JsonRpcResponse;
    if (message.id === requestId && ("result" in message || "error" in message)) return message;
    return undefined;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let separator: RegExpExecArray | null;
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator[0].length);
        const result = parse(frame);
        if (result) return result;
      }
      if (done) {
        const result = parse(buffer);
        if (result) return result;
        throw emptyResponse();
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

function emptyResponse() {
  return new ProviderError(
    "brightdata",
    "BRIGHTDATA_EMPTY_STREAM",
    "Mənbə xidməti sorğuya uyğun cavab qaytarmadı.",
    true,
  );
}
