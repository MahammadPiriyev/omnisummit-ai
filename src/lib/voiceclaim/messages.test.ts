import { describe, expect, it } from "vitest";
import { localizedError } from "./messages";

describe("English diagnostics", () => {
  it("keeps actionable Gemini errors in English", () => {
    expect(localizedError("GEMINI_HTTP_503: upstream service error")).toContain(
      "temporarily unavailable",
    );
    expect(localizedError("GEMINI_HTTP_429: quota exhausted")).toContain("account quota");
    expect(localizedError("GEMINI_HTTP_403: access denied")).toContain("GEMINI_API_KEY");
  });
  it("keeps application diagnostics and uses English fallbacks for old untranslated errors", () => {
    expect(localizedError("The model returned an invalid response format.")).toBe(
      "The model returned an invalid response format.",
    );
    expect(localizedError("Yoxlama alınmadı")).toBe(
      "A technical error occurred during verification. Please try again.",
    );
    expect(localizedError()).toBe("Verification could not complete. Please try again.");
  });
});
