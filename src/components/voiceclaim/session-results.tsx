import { VERDICT_LABELS, type Session } from "@/lib/voiceclaim/types";
import { localizedError } from "@/lib/voiceclaim/messages";

export function SessionResults({ session }: { session: Session }) {
  const results = session.claims.filter(
    (claim) => claim.result && claim.state !== "VERIFICATION_ERROR",
  );
  const failed = session.claims.filter((claim) => claim.state === "VERIFICATION_ERROR");
  const extractionErrors = session.extractionErrors ?? [];
  return (
    <section
      className="editorial-card rounded-xl p-5"
      aria-label="Sessiyanın nəticələri"
      aria-live="polite"
    >
      <h2 className="font-display text-lg font-semibold">Sessiyanın nəticələri</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {results.length} nəticə · {failed.length} uğursuz yoxlama
        {extractionErrors.length > 0 && ` · ${extractionErrors.length} fakt ayırma xətası`}
      </p>
      {results.length > 0 && (
        <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs">
          {Object.entries(VERDICT_LABELS).map(([verdict, label]) => {
            const count = results.filter((claim) => claim.result?.verdict === verdict).length;
            return count ? (
              <div key={verdict} className="flex gap-2">
                <dt>{label}</dt>
                <dd className="font-semibold">{count}</dd>
              </div>
            ) : null;
          })}
        </dl>
      )}
      {(failed.length > 0 || extractionErrors.length > 0) && (
        <div className="mt-4 rounded-lg border border-verdict-error/40 bg-verdict-error/10 p-3 text-sm">
          <p className="font-semibold">
            {results.length === 0 ? "Yoxlama tamamlanmadı" : "Bəzi yoxlamalar tamamlanmadı"}
          </p>
          <p className="mt-1 text-muted-foreground">
            Texniki xəta olan yoxlamalarda sübutlar üzrə nəticə çıxarılmayıb.
            {failed.length > 0 && " Ətraflı məlumat üçün aşağıdakı faktı açın."}
          </p>
          {extractionErrors.length > 0 && (
            <div className="mt-2">
              <p>
                Danışığın {extractionErrors.length} hissəsində faktları ayırmaq mümkün olmadı.
                Xidmətin xətasını aradan qaldırdıqdan sonra yeni sessiya başlayın.
              </p>
              {[...new Set(extractionErrors)].map((error) => (
                <p key={error} className="mt-1 break-words text-xs">
                  {localizedError(error)}
                </p>
              ))}
            </div>
          )}
          {[...failed.map((claim) => claim.error ?? ""), ...extractionErrors].some((error) =>
            /AIML_(BILLING_REQUIRED|HTTP_403)/.test(error),
          ) && (
            <p className="mt-2">
              AI/ML API girişə icazə vermədi. Hesabın{" "}
              <a
                href="https://aimlapi.com/app/billing/"
                target="_blank"
                rel="noreferrer"
                className="font-semibold underline"
              >
                balansını və ödəniş ayarlarını
              </a>{" "}
              yoxlayın və ya pulsuz lokal modeldən istifadə edin.
            </p>
          )}
        </div>
      )}
      {session.claims.length === 0 && extractionErrors.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">
          Bu sessiyada yoxlanacaq fakt tapılmadı.
        </p>
      )}
      {session.claims.length > 0 && (
        <p className="mt-3 text-xs text-muted-foreground">
          Sübutları və izahı görmək üçün faktı seçin.
        </p>
      )}
    </section>
  );
}
