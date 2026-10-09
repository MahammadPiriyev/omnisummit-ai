/** Keep provider diagnostics useful without displaying untranslated external messages. */
export function localizedError(message?: string) {
  if (!message) return "Verification could not complete. Please try again.";
  const code = message.match(/^[A-Z][A-Z0-9_]+(?=:|$)/)?.[0];
  if (code === "AIML_BILLING_REQUIRED")
    return "AI/ML API has a balance or billing issue. Use a local model or check your account balance.";
  if (code === "AIML_HTTP_403")
    return "AI/ML API denied access. Check your account and model permissions.";
  if (code === "OLLAMA_UNAVAILABLE")
    return "Unable to connect to the local model. Start the Ollama service.";
  if (code?.includes("NOT_CONFIGURED"))
    return "The service is not configured. Check your .env file.";
  if (code?.includes("TIMEOUT")) return "The service did not respond in time. Please try again.";
  if (code === "GEMINI_HTTP_503")
    return "The Gemini model is overloaded or temporarily unavailable. Please try again shortly.";
  if (code === "GEMINI_HTTP_429")
    return "Gemini rate limit or account quota exceeded. Try again later and check your account limits.";
  if (code === "GEMINI_HTTP_401" || code === "GEMINI_HTTP_403")
    return "Gemini rejected the API key or access permissions. Check GEMINI_API_KEY in your .env file.";
  if (
    /[a-z]/i.test(message) &&
    !/[\u0259\u018F\u0131\u0130\u011F\u011E\u015F\u015E\u00E7\u00C7\u00F6\u00D6\u00FC\u00DC]/.test(
      message,
    )
  )
    return message.replace(/^[A-Z0-9_]+:\s*/, "");
  return "A technical error occurred during verification. Please try again.";
}
