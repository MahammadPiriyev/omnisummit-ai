/** Keep provider diagnostics useful without displaying untranslated external messages. */
export function localizedError(message?: string) {
  if (!message) return "Yoxlama tamamlanmadı. Yenidən cəhd edin.";
  const code = message.match(/^[A-Z][A-Z0-9_]+(?=:|$)/)?.[0];
  if (code === "AIML_BILLING_REQUIRED")
    return "AI/ML API hesabında balans və ya ödəniş problemi var. Lokal modeldən istifadə edin və ya hesabın balansını yoxlayın.";
  if (code === "AIML_HTTP_403")
    return "AI/ML API girişə icazə vermədi. Hesab və model icazələrini yoxlayın.";
  if (code === "OLLAMA_UNAVAILABLE")
    return "Lokal modelə qoşulmaq mümkün olmadı. Ollama xidmətini başladın.";
  if (code?.includes("NOT_CONFIGURED"))
    return "Xidmətin ayarları tamamlanmayıb. .env faylını yoxlayın.";
  if (code?.includes("TIMEOUT")) return "Xidmət vaxtında cavab vermədi. Yenidən cəhd edin.";
  if (/[əƏıİğĞşŞçÇöÖüÜ]/.test(message)) return message.replace(/^[A-Z0-9_]+:\s*/, "");
  return "Yoxlama zamanı texniki xəta baş verdi. Yenidən cəhd edin.";
}
