import { AlertTriangle } from "lucide-react";
import { localizedError } from "@/lib/voiceclaim/messages";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  CLAIM_STAGE_LABELS,
  MODE_LABELS,
  formatTimestamp,
  isTerminal,
  type AtomicClaim,
} from "@/lib/voiceclaim/types";
import { ConfidenceMeter } from "./confidence";
import { EvidenceCard } from "./evidence-card";
import { StageRail } from "./stage-rail";
import { VerdictBadge } from "./verdict";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-[11px] tracking-[0.16em] text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

export function ClaimDetailPanel({
  claim,
  open,
  onOpenChange,
}: {
  claim?: AtomicClaim | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        {claim && (
          <>
            <SheetHeader className="border-b">
              <div className="flex items-center gap-3 text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                <span className="tabular">{formatTimestamp(claim.timestampMs)}</span>
                <span>{MODE_LABELS[claim.mode]}</span>
                <span>{claim.depth === "deep" ? "Deep verification" : "Quick verification"}</span>
              </div>
              <SheetTitle className="font-display text-lg leading-snug">
                {claim.normalizedClaim}
              </SheetTitle>
              <VerdictBadge verdict={claim.result?.verdict} state={claim.state} className="w-fit" />
            </SheetHeader>

            <div className="space-y-8 p-6">
              <Section title="Original statement">
                <p className="rounded-lg border-l-2 border-live bg-surface p-4 text-sm leading-relaxed italic">
                  "{claim.originalText}"
                </p>
              </Section>

              {!isTerminal(claim.state) && (
                <Section title={CLAIM_STAGE_LABELS[claim.state]}>
                  <StageRail state={claim.state} />
                  <p className="text-xs text-muted-foreground">
                    Evidence appears here as it is found. The final result is still being prepared.
                  </p>
                </Section>
              )}

              {claim.state === "VERIFICATION_ERROR" && (
                <div className="flex gap-3 rounded-lg border border-verdict-error/40 bg-verdict-error/10 p-4 text-sm leading-relaxed">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0 text-verdict-error" />
                  <div>
                    <p className="font-semibold">Verification could not complete</p>
                    <p className="mt-1 text-muted-foreground">{localizedError(claim.error)}</p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      No evidence verdict was reached because of a technical error.
                    </p>
                  </div>
                </div>
              )}

              {claim.result && claim.state !== "VERIFICATION_ERROR" && (
                <Section title="Evidence confidence">
                  <ConfidenceMeter confidence={claim.result.confidence} />
                </Section>
              )}

              {claim.evidence.some((e) => e.relation === "supports") && (
                <Section title="Supporting evidence">
                  <div className="space-y-3">
                    {claim.evidence
                      .filter((e) => e.relation === "supports")
                      .map((item) => (
                        <EvidenceCard key={item.id} item={item} />
                      ))}
                  </div>
                </Section>
              )}

              {claim.evidence.some((e) => e.relation === "contradicts") && (
                <Section title="Contradicting evidence">
                  <div className="space-y-3">
                    {claim.evidence
                      .filter((e) => e.relation === "contradicts")
                      .map((item) => (
                        <EvidenceCard key={item.id} item={item} />
                      ))}
                  </div>
                </Section>
              )}

              {claim.evidence.some((e) => e.relation === "contextual") && (
                <Section title="Context">
                  <div className="space-y-3">
                    {claim.evidence
                      .filter((e) => e.relation === "contextual")
                      .map((item) => (
                        <EvidenceCard key={item.id} item={item} />
                      ))}
                  </div>
                </Section>
              )}

              {claim.result && claim.state !== "VERIFICATION_ERROR" && (
                <>
                  <Section title="Counterevidence summary">
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {claim.result.challengeSummary}
                    </p>
                  </Section>

                  <Section title="Explanation">
                    <p className="text-sm leading-relaxed">{claim.result.explanation}</p>
                  </Section>

                  {claim.result.evidenceGaps.length > 0 && (
                    <Section title="Evidence gaps">
                      <ul className="space-y-2">
                        {claim.result.evidenceGaps.map((gap) => (
                          <li
                            key={gap}
                            className="flex gap-2 text-sm leading-relaxed text-muted-foreground"
                          >
                            <span className="mt-2 size-1 shrink-0 rounded-full bg-muted-foreground" />
                            {gap}
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}

                  {claim.result.recommendedActions.length > 0 && (
                    <Section title="Next steps">
                      <ul className="space-y-2">
                        {claim.result.recommendedActions.map((action) => (
                          <li
                            key={action}
                            className="rounded-lg border bg-surface p-3 text-sm leading-relaxed"
                          >
                            {action}
                          </li>
                        ))}
                      </ul>
                    </Section>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
