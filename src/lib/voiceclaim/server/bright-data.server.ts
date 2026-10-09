import "@tanstack/react-start/server-only";
import { requireIntegration } from "./config.server";
import { canonicalizeUrl } from "./evidence";
import { ProviderError } from "./errors.server";
import { retry, withDeadline } from "./retry.server";
import { logProviderStage } from "./logging.server";
import { parseSearchHits } from "../bright-data-parser";
import { readMcpResponse, type JsonRpcResponse } from "./mcp-response.server";

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export interface RetrievedPage extends SearchHit {
  candidateId: string;
  domain: string;
  markdown: string;
  retrievedAt: string;
}

function resultText(result: { content?: Array<{ type: string; text?: string }> }) {
  return (result.content ?? [])
    .filter((item) => item.type === "text")
    .map((item) => item.text ?? "")
    .join("\n")
    .trim();
}

interface McpSession {
  id: string;
  lastUsedAt: number;
  tools: Set<string>;
}

// Reuse a remote MCP session for the short lifetime of a verification request.
// This prevents several simultaneous claims from opening a fresh connection for
// every single search, which otherwise overwhelms the remote handshake endpoint.
const sessions = new Map<string, Promise<McpSession>>();
const SESSION_TTL_MS = 4 * 60_000;

function classifyTransportFailure(error: unknown) {
  const details = [
    error instanceof Error ? error.message : "",
    error && typeof error === "object" && "cause" in error
      ? String((error as { cause?: unknown }).cause ?? "")
      : "",
  ].join(" ");
  if (/ENOTFOUND|EAI_AGAIN|No such host is known|DNS/i.test(details)) {
    return new ProviderError(
      "brightdata",
      "BRIGHTDATA_NETWORK_UNREACHABLE",
      "Bright Data could not be reached. Check DNS, firewall, or network access to mcp.brightdata.com.",
      true,
    );
  }
  if (/AbortError|REQUEST_TIMEOUT|timed out/i.test(details)) {
    return new ProviderError(
      "brightdata",
      "BRIGHTDATA_TIMEOUT",
      "Bright Data MCP did not respond before the request deadline",
      true,
    );
  }
  return new ProviderError(
    "brightdata",
    "BRIGHTDATA_MCP_ERROR",
    "Bright Data MCP request failed",
    true,
  );
}

async function mcpRequest(
  endpoint: URL,
  payload: Record<string, unknown>,
  timeoutMs: number,
  sessionId?: string,
) {
  return withDeadline(async (signal) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
        ...(sessionId ? { "MCP-Protocol-Version": "2025-06-18" } : {}),
      },
      body: JSON.stringify(payload),
      signal,
    });
    if (!response.ok) {
      throw new ProviderError(
        "brightdata",
        `BRIGHTDATA_HTTP_${response.status}`,
        `Bright Data MCP request failed (${response.status})`,
        response.status === 408 || response.status === 429 || response.status >= 500,
        response.status,
      );
    }
    if (response.status === 202 || response.status === 204) {
      return { response: {} as JsonRpcResponse, sessionId: sessionId ?? "" };
    }
    const message = await readMcpResponse(response, payload["id"]);
    if (message.error) {
      throw new ProviderError(
        "brightdata",
        `BRIGHTDATA_RPC_${message.error.code}`,
        message.error.message,
        message.error.code === -32603,
      );
    }
    return {
      response: message,
      sessionId: response.headers.get("mcp-session-id") ?? sessionId ?? "",
    };
  }, timeoutMs);
}

async function openSession(endpoint: URL) {
  const key = endpoint.toString();
  const existing = sessions.get(key);
  if (existing) {
    const session = await existing;
    if (Date.now() - session.lastUsedAt < SESSION_TTL_MS) return session;
    sessions.delete(key);
  }

  const opening = (async (): Promise<McpSession> => {
    const initialized = await mcpRequest(
      endpoint,
      {
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "voiceclaim-auditor", version: "1.0.0" },
        },
      },
      35_000,
    );
    if (!initialized.sessionId) {
      throw new ProviderError(
        "brightdata",
        "BRIGHTDATA_SESSION_MISSING",
        "Bright Data did not return an MCP session identifier",
        true,
      );
    }
    await mcpRequest(
      endpoint,
      { jsonrpc: "2.0", method: "notifications/initialized", params: {} },
      10_000,
      initialized.sessionId,
    );
    const listed = await mcpRequest(
      endpoint,
      {
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "tools/list",
        params: {},
      },
      15_000,
      initialized.sessionId,
    );
    const tools = new Set(
      ((listed.response.result as { tools?: Array<{ name?: string }> } | undefined)?.tools ?? [])
        .map((tool) => tool.name)
        .filter((name): name is string => Boolean(name)),
    );
    return { id: initialized.sessionId, lastUsedAt: Date.now(), tools };
  })();
  sessions.set(key, opening);
  try {
    return await opening;
  } catch (error) {
    sessions.delete(key);
    throw error;
  }
}

async function callTool(
  name: "search_engine" | "scrape_as_markdown",
  args: Record<string, unknown>,
) {
  const started = Date.now();
  const config = requireIntegration("brightdata");
  if (!config.brightDataToken) {
    throw new ProviderError(
      "brightdata",
      "BRIGHTDATA_NOT_CONFIGURED",
      "Bright Data is not configured",
    );
  }
  const endpoint = new URL(config.brightDataMcpUrl);
  endpoint.searchParams.set("token", config.brightDataToken);
  let session: McpSession | undefined;
  try {
    session = await openSession(endpoint);
    if (!session.tools.has(name)) {
      throw new ProviderError(
        "brightdata",
        "BRIGHTDATA_TOOL_UNAVAILABLE",
        `Bright Data MCP does not expose the required ${name} tool`,
        false,
      );
    }
    const called = await mcpRequest(
      endpoint,
      {
        jsonrpc: "2.0",
        id: crypto.randomUUID(),
        method: "tools/call",
        params: { name, arguments: args },
      },
      name === "search_engine" ? 45_000 : 60_000,
      session.id,
    );
    session.lastUsedAt = Date.now();
    const result = called.response.result as {
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    if (result.isError)
      throw new ProviderError("brightdata", "BRIGHTDATA_TOOL_ERROR", `${name} failed`, true);
    const text = resultText(result);
    if (!text)
      throw new ProviderError(
        "brightdata",
        "BRIGHTDATA_EMPTY_RESULT",
        `${name} returned no content`,
        true,
      );
    logProviderStage({
      provider: "brightdata",
      stage: name,
      durationMs: Date.now() - started,
      count: 1,
    });
    return text;
  } catch (error) {
    const classified = error instanceof ProviderError ? error : classifyTransportFailure(error);
    // A transient tool/DNS/gateway failure does not invalidate a healthy MCP session.
    if (session && (classified.status === 404 || classified.status === 410)) {
      const cached = sessions.get(endpoint.toString());
      if (cached && (await cached).id === session.id) sessions.delete(endpoint.toString());
      throw new ProviderError(
        classified.provider,
        classified.code,
        classified.message,
        true,
        classified.status,
      );
    }
    logProviderStage({
      provider: "brightdata",
      stage: name,
      durationMs: Date.now() - started,
      errorCode: classified.code,
    });
    throw classified;
  }
}

const pendingSearches = new Map<string, Promise<SearchHit[]>>();
const pendingPages = new Map<string, Promise<string>>();

function inFlight<T>(pending: Map<string, Promise<T>>, key: string, work: () => Promise<T>) {
  const existing = pending.get(key);
  if (existing) return existing;
  const result = work().finally(() => {
    if (pending.get(key) === result) pending.delete(key);
  });
  pending.set(key, result);
  return result;
}

export function searchWeb(query: string) {
  const config = requireIntegration("brightdata");
  const key = JSON.stringify([config.brightDataMcpUrl, config.brightDataToken, query]);
  return inFlight(pendingSearches, key, async () => {
    const text = await retry(() => callTool("search_engine", { query, engine: "google" }));
    return parseSearchHits(text);
  });
}

export async function scrapePage(hit: SearchHit, candidateId: string): Promise<RetrievedPage> {
  const url = canonicalizeUrl(hit.url);
  const config = requireIntegration("brightdata");
  const key = JSON.stringify([config.brightDataMcpUrl, config.brightDataToken, url]);
  const markdown = await inFlight(pendingPages, key, () =>
    retry(() => callTool("scrape_as_markdown", { url })),
  );
  const parsed = new URL(url);
  return {
    ...hit,
    url,
    candidateId,
    domain: parsed.hostname.replace(/^www\./, ""),
    markdown: markdown.slice(0, 80_000),
    retrievedAt: new Date().toISOString(),
  };
}
