import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start/server-only", () => ({}));

import { classifyAimlResponse, publicError } from "./errors.server";
import { retry } from "./retry.server";

describe("AI/ML provider errors", () => {
  it.each([
    { message: "You've run out of credits. Please top up your balance." },
    { error: { message: "Get AI/ML Subscription to use API" } },
  ])("reports billing failures without retrying or exposing the body", async (body) => {
    const error = await classifyAimlResponse(Response.json(body, { status: 403 }));
    expect(error.code).toBe("AIML_BILLING_REQUIRED");
    expect(error.status).toBe(403);
    expect(publicError(error)).toContain("https://aimlapi.com/app/billing/");
    const operation = vi.fn().mockRejectedValue(error);
    await expect(retry(operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it.each([
    Response.json({ message: "Private request text and secret-key" }, { status: 403 }),
    new Response("<html>Forbidden</html>", { status: 403 }),
    Response.json(null, { status: 403 }),
  ])("handles unknown or non-JSON access failures safely", async (response) => {
    const error = await classifyAimlResponse(response);
    expect(error.code).toBe("AIML_HTTP_403");
    expect(error.retryable).toBe(false);
    expect(publicError(error)).toContain("model permissions");
    expect(publicError(error)).not.toMatch(/Private request|secret-key|<html>/);
  });

  it("distinguishes rejected keys from billing failures", async () => {
    const error = await classifyAimlResponse(new Response(null, { status: 401 }));
    expect(error.code).toBe("AIML_HTTP_401");
    expect(error.message).toContain("AIMLAPI_KEY");
    expect(error.retryable).toBe(false);
  });

  it("preserves retry hints for transient errors", async () => {
    const error = await classifyAimlResponse(
      new Response(null, { status: 429, headers: { "retry-after": "2" } }),
    );
    expect(error.code).toBe("AIML_HTTP_429");
    expect(error.retryable).toBe(true);
    expect(error.retryAfterMs).toBe(2000);
  });
});
