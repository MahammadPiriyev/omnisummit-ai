import "@tanstack/react-start/server-only";
import { getServerConfig } from "./config.server";
import { ProviderError } from "./errors.server";

interface TokenPayload {
  sid: string;
  iat: number;
  exp: number;
  nonce: string;
}

const encoder = new TextEncoder();

function b64url(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => (binary += String.fromCharCode(byte)));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decode(value: string) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function key() {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(getServerConfig().signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function issueAnonymousToken(sessionId: string) {
  const now = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    sid: sessionId,
    iat: now,
    exp: now + 6 * 60 * 60,
    nonce: crypto.randomUUID(),
  };
  const body = b64url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign("HMAC", await key(), encoder.encode(body));
  return `${body}.${b64url(new Uint8Array(signature))}`;
}

export async function verifyAnonymousToken(token: string, expectedSessionId?: string) {
  const [body, signature] = token.split(".");
  if (!body || !signature)
    throw new ProviderError("voiceclaim", "INVALID_SESSION", "Invalid session token");
  const valid = await crypto.subtle.verify(
    "HMAC",
    await key(),
    decode(signature),
    encoder.encode(body),
  );
  if (!valid) throw new ProviderError("voiceclaim", "INVALID_SESSION", "Invalid session token");
  const payload = JSON.parse(new TextDecoder().decode(decode(body))) as TokenPayload;
  if (
    payload.exp < Math.floor(Date.now() / 1000) ||
    (expectedSessionId && payload.sid !== expectedSessionId)
  ) {
    throw new ProviderError("voiceclaim", "EXPIRED_SESSION", "Session expired");
  }
  return payload;
}
