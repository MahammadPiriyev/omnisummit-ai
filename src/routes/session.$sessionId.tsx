import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate, useParams } from "@tanstack/react-router";
import { CheckCircle2, LoaderCircle, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ClaimCard } from "@/components/voiceclaim/claim-card";
import { ClaimDetailPanel } from "@/components/voiceclaim/claim-detail";
import { SessionResults } from "@/components/voiceclaim/session-results";
import { TranscriptPane } from "@/components/voiceclaim/transcript-pane";
import { SCENARIOS, getScenarioForMode } from "@/lib/voiceclaim/data/scenarios";
import { SessionEngine } from "@/lib/voiceclaim/engine/session-engine";
import { DEFAULT_SETTINGS, loadSettings, localHistory, takeLaunch } from "@/lib/voiceclaim/history";
import { assetRepository } from "@/lib/voiceclaim/storage";
import { toast } from "sonner";
import {
  MODE_LABELS,
  formatTimestamp,
  isTerminal,
  matchesFilter,
  type ClaimFilter,
  type Session,
} from "@/lib/voiceclaim/types";

export const Route = createFileRoute("/session/$sessionId")({
  head: () => ({
    meta: [
      { title: "Canlı sessiya — Fakt Yoxla" },
      {
        name: "description",
        content: "Danışığın mətnini və faktların yoxlama nəticələrini izləyin.",
      },
      { property: "og:title", content: "Canlı sessiya — Fakt Yoxla" },
      {
        property: "og:description",
        content: "Canlı danışıq zamanı faktların mənbələrlə yoxlanması.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SessionPage,
});

const FILTERS: { id: ClaimFilter; label: string }[] = [
  { id: "all", label: "Hamısı" },
  { id: "supported", label: "Təsdiqlənir" },
  { id: "questionable", label: "Mübahisəli" },
  { id: "contradicted", label: "Təkzib edilir" },
  { id: "insufficient", label: "Yetərsiz sübut" },
];

function SessionPage() {
  const { sessionId } = useParams({ from: "/session/$sessionId" });
  const navigate = useNavigate();
  const engineRef = useRef<SessionEngine | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [filter, setFilter] = useState<ClaimFilter>("all");
  const [openClaimId, setOpenClaimId] = useState<string | null>(null);

  useEffect(() => {
    let engine: SessionEngine | undefined;
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      const saved = await localHistory.get(sessionId);
      if (cancelled) return;
      if (saved) {
        setSession(saved);
        return;
      }
      const launch = takeLaunch(sessionId);
      if (!launch) {
        toast.error("Bu sessiyanı davam etdirmək mümkün deyil. Yeni sessiya başlayın.");
        await navigate({ to: "/" });
        return;
      }
      const settings = launch.settings ?? loadSettings() ?? DEFAULT_SETTINGS;
      const scenario =
        SCENARIOS.find((item) => item.id === launch.scenarioId) ??
        getScenarioForMode(settings.mode);
      const mediaAsset = launch.mediaAssetId
        ? await assetRepository.get(launch.mediaAssetId)
        : undefined;
      const corpusAssets = await assetRepository.list(sessionId, "corpus");
      if (cancelled) return;
      engine = new SessionEngine({
        sessionId,
        title: launch.title ?? scenario.title,
        source: launch.source ?? "microphone",
        scenario,
        settings,
        speed: launch.speed ?? 1,
        serviceMode: launch.serviceMode,
        sessionToken: launch.sessionToken,
        mediaFile: mediaAsset?.file,
        customFiles: corpusAssets.map((asset) => asset.file),
        customSources: corpusAssets.flatMap((asset) => (asset.source ? [asset.source] : [])),
      });
      engineRef.current = engine;
      unsubscribe = engine.subscribe(setSession);
      engine.start();
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
      engine?.dispose();
      engineRef.current = null;
    };
  }, [navigate, sessionId]);

  useEffect(() => {
    if (session?.status === "completed") void localHistory.save(session);
  }, [session]);
  const claimedSegmentIds = useMemo(
    () => new Set(session?.claims.flatMap((claim) => claim.sourceSegmentIds) ?? []),
    [session?.claims],
  );
  if (!session) return null;
  const visible = session.claims.filter((claim) => matchesFilter(claim, filter));
  const active = session.claims.filter((claim) => !isTerminal(claim.state)).length;
  const openClaim = session.claims.find((claim) => claim.id === openClaimId);
  const live = session.status !== "completed" && session.status !== "error";
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">
            {session.status === "completed" ? "Yoxlamanın nəticəsi" : "Faktların yoxlanması"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {MODE_LABELS[session.settings.mode]} · {formatTimestamp(session.durationMs)} · {active}{" "}
            fakt yoxlanılır
          </p>
        </div>
        {live ? (
          <Button
            disabled={session.status === "processing"}
            onClick={() => void engineRef.current?.finish()}
          >
            <Square className="size-4" />
            {session.status === "processing" ? "Tamamlanır…" : "Sessiyanı bitir"}
          </Button>
        ) : (
          <Button variant="outline" onClick={() => void navigate({ to: "/" })}>
            Yeni yoxlama
          </Button>
        )}
      </header>
      {session.progress && (
        <div role="status" className="editorial-card mb-6 rounded-xl p-4">
          <p className="flex items-center gap-2 font-medium">
            {session.status === "completed" ? (
              <CheckCircle2 className="size-4 text-verdict-supported" />
            ) : (
              <LoaderCircle className={cn("size-4", live && "animate-spin")} />
            )}
            {session.progress.label}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{session.progress.detail}</p>
          {typeof session.progress.percent === "number" && (
            <progress
              className="mt-3 h-2 w-full accent-primary"
              value={session.progress.percent}
              max={100}
              aria-label="Yoxlamanın gedişi"
            />
          )}
        </div>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <section className="min-w-0 space-y-4">
          <h2 className="text-lg font-semibold">
            Nəticələr{" "}
            <span className="text-sm font-normal text-muted-foreground">
              ({session.claims.length} fakt)
            </span>
          </h2>
          {session.status === "completed" && <SessionResults session={session} />}
          {session.claims.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {FILTERS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setFilter(item.id)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-sm",
                    filter === item.id
                      ? "border-primary bg-primary text-primary-foreground"
                      : "hover:bg-secondary",
                  )}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
          {visible.length === 0 ? (
            <div className="editorial-card rounded-xl p-8 text-center text-sm text-muted-foreground">
              {session.claims.length === 0
                ? live
                  ? "Danışmağa başla. Yoxlanacaq faktlar burada görünəcək."
                  : "Bu sessiyada yoxlanacaq fakt tapılmadı."
                : "Bu seçimə uyğun fakt yoxdur."}
            </div>
          ) : (
            visible.map((claim) => (
              <ClaimCard
                key={claim.id}
                claim={claim}
                onOpen={() => setOpenClaimId(claim.id)}
                {...(engineRef.current
                  ? { onRetry: () => engineRef.current?.retry(claim.id) }
                  : {})}
              />
            ))
          )}
        </section>
        <details open className="editorial-card min-w-0 rounded-xl">
          <summary className="cursor-pointer border-b px-5 py-4 font-semibold">
            Danışığın mətni
          </summary>
          <div className="max-h-[70vh] overflow-y-auto">
            <TranscriptPane
              segments={session.segments}
              claimedSegmentIds={claimedSegmentIds}
              live={live}
              {...(engineRef.current
                ? { onVerify: (id: string) => void engineRef.current?.verifySegmentManually(id) }
                : {})}
            />
          </div>
        </details>
      </div>
      <ClaimDetailPanel
        claim={openClaim}
        open={Boolean(openClaim)}
        onOpenChange={(open) => {
          if (!open) setOpenClaimId(null);
        }}
      />
    </main>
  );
}
