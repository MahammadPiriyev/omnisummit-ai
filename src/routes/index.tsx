import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { FileUp, LoaderCircle, Mic, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  stashLaunch,
} from "@/lib/voiceclaim/history";
import { getScenarioForMode } from "@/lib/voiceclaim/data/scenarios";
import { createAnonymousSession } from "@/lib/voiceclaim/functions";
import { assetRepository } from "@/lib/voiceclaim/storage";
import {
  INTERVAL_SECONDS,
  MODE_LABELS,
  type IntervalPreset,
  type SessionSettings,
  type VerificationDepth,
  type VerificationMode,
} from "@/lib/voiceclaim/types";
import { toast } from "sonner";
import { localizedError } from "@/lib/voiceclaim/messages";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Proofy — Verify spoken claims" },
      {
        name: "description",
        content: "Check spoken claims against reliable sources.",
      },
      {
        property: "og:title",
        content: "Proofy — Verify spoken claims",
      },
      {
        property: "og:description",
        content: "Detect and verify factual claims during live speech.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

const MODES: VerificationMode[] = ["general", "investor", "academic", "custom"];
const MODE_BLURB: Record<VerificationMode, string> = {
  general: "Reliable sources for everyday topics.",
  investor: "Official reports for business and financial claims.",
  academic: "Research and papers for scientific claims.",
  custom: "Check your documents alongside web sources.",
};

const INTERVALS: IntervalPreset[] = ["fast", "balanced", "long"];

function Segmented<T extends string>({
  value,
  options,
  onChange,
  labels,
}: {
  value: T;
  options: readonly T[];
  onChange: (value: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <div className="grid w-full auto-cols-fr grid-flow-col rounded-lg border bg-background/70 p-1">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          className={cn(
            "cursor-pointer rounded-md px-3 py-2 text-xs font-semibold transition-all",
            value === option
              ? "bg-card text-foreground shadow-sm ring-1 ring-border"
              : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
          )}
        >
          {labels[option]}
        </button>
      ))}
    </div>
  );
}

function Landing() {
  const navigate = useNavigate();
  const [settings, setSettings] = useState<SessionSettings>(
    typeof window === "undefined" ? DEFAULT_SETTINGS : loadSettings(),
  );
  const [corpus, setCorpus] = useState<File[]>([]);
  const [launching, setLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState<string | null>(null);

  const patch = (next: Partial<SessionSettings>) => {
    const merged = { ...settings, ...next };
    setSettings(merged);
    saveSettings(merged);
  };

  const launch = async (
    source: "microphone" | "audio_upload" | "video_upload",
    label: string,
    mediaFile?: File,
  ) => {
    if (launching) return;
    setLaunching(true);
    setLaunchStatus(source === "microphone" ? "Preparing session…" : "Preparing recording…");
    const sessionId = `s-${Date.now().toString(36)}`;
    try {
      const anonymous = await createAnonymousSession({ data: { requestedSessionId: sessionId } });
      const scenario = getScenarioForMode(settings.mode);
      if (corpus.length) setLaunchStatus("Saving source documents…");
      const storedCorpus = corpus.length
        ? await assetRepository.storeCorpus(sessionId, corpus)
        : [];
      if (mediaFile) setLaunchStatus("Preparing recording…");
      const mediaAssetId = mediaFile
        ? await assetRepository.storeMedia(sessionId, mediaFile)
        : undefined;
      stashLaunch({
        sessionId,
        title: label,
        source,
        scenarioId: scenario.id,
        settings,
        speed: source === "microphone" ? 1 : 1.8,
        serviceMode: anonymous.serviceMode,
        sessionToken: anonymous.sessionToken,
        mediaAssetId,
        customAssetIds: storedCorpus.map((asset) => asset.id),
      });
      setLaunchStatus("Opening verification…");
      await navigate({ to: "/session/$sessionId", params: { sessionId } });
    } catch (error) {
      toast.error(localizedError(error instanceof Error ? error.message : undefined));
      await assetRepository.deleteSession(sessionId).catch(() => undefined);
    } finally {
      setLaunching(false);
      setLaunchStatus(null);
    }
  };

  const onUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const isVideo = file.type.includes("mp4") || file.name.endsWith(".mp4");
    void launch(isVideo ? "video_upload" : "audio_upload", file.name, file);
  };

  const onCorpus = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    if (files.length > 5 || files.reduce((sum, file) => sum + file.size, 0) > 25 * 1024 * 1024) {
      toast.error("Select up to 5 source files with a combined size of 25 MB or less.");
      return;
    }
    setCorpus(files);
    patch({ mode: "custom" });
    toast.success(`${files.length} source files added`);
  };

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10 sm:py-16">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-semibold sm:text-4xl">Verify spoken claims</h1>
        <p className="mx-auto mt-3 max-w-xl text-base text-muted-foreground">
          Speak or upload a recording. Compare claims with sources and see the results.
        </p>
      </div>
      <section className="editorial-card rounded-2xl p-6 sm:p-8">
        <h2 className="mb-4 text-lg font-semibold">How would you like to start?</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <Button
            className="h-16 gap-3 text-base"
            disabled={launching}
            onClick={() => void launch("microphone", "Live session")}
          >
            <Mic className="size-5" /> Start speaking
          </Button>
          <label
            className={cn(
              "flex h-16 cursor-pointer items-center justify-center gap-3 rounded-lg border text-base font-semibold hover:bg-secondary focus-within:ring-2 focus-within:ring-primary",
              launching && "pointer-events-none opacity-50",
            )}
          >
            <Upload className="size-5" /> Upload audio or video
            <input
              type="file"
              accept="audio/*,video/mp4"
              className="sr-only"
              onChange={onUpload}
              disabled={launching}
              aria-label="Choose an audio or MP4 file"
            />
          </label>
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Only the audio in videos is checked. Results remain available after the session ends.
        </p>
        {launchStatus && (
          <p
            role="status"
            className="mt-4 flex items-center gap-2 rounded-lg bg-secondary p-3 text-sm"
          >
            <LoaderCircle className="size-4 animate-spin" />
            {launchStatus}
          </p>
        )}
        <details className="mt-7 border-t pt-5">
          <summary className="cursor-pointer text-sm font-semibold">Verification options</summary>
          <div className="mt-5 space-y-5">
            <div>
              <h3 className="mb-2 text-sm font-medium">Topic</h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {MODES.map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => patch({ mode })}
                    className={cn(
                      "rounded-lg border px-3 py-3 text-sm",
                      settings.mode === mode
                        ? "border-primary bg-primary/5 font-semibold"
                        : "hover:bg-secondary",
                    )}
                  >
                    {MODE_LABELS[mode]}
                  </button>
                ))}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{MODE_BLURB[settings.mode]}</p>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">Verification depth</h3>
              <Segmented<VerificationDepth>
                value={settings.depth}
                options={["quick", "deep"]}
                onChange={(depth) => patch({ depth })}
                labels={{ quick: "Quick", deep: "Deep" }}
              />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">Claim check interval</h3>
              <Segmented<IntervalPreset>
                value={settings.intervalPreset}
                options={INTERVALS}
                onChange={(intervalPreset) => patch({ intervalPreset })}
                labels={{
                  fast: "Fast · " + INTERVAL_SECONDS.fast + " sec",
                  balanced: "Balanced · " + INTERVAL_SECONDS.balanced + " sec",
                  long: "Long · " + INTERVAL_SECONDS.long + " sec",
                }}
              />
            </div>
            <div>
              <div className="mb-3 flex justify-between text-sm">
                <span>Source count</span>
                <strong>{settings.sourceCount}</strong>
              </div>
              <Slider
                value={[settings.sourceCount]}
                min={2}
                max={8}
                step={1}
                onValueChange={([value]) => patch({ sourceCount: value ?? 3 })}
                aria-label="Source count"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-2 rounded-md text-sm font-semibold focus-within:ring-2 focus-within:ring-primary">
              <FileUp className="size-4" /> Add your sources (PDF, TXT, CSV)
              <input
                type="file"
                multiple
                accept=".pdf,.txt,.csv"
                className="sr-only"
                onChange={onCorpus}
                aria-label="Choose source documents"
              />
            </label>
            {corpus.length > 0 && (
              <ul className="space-y-1 text-sm text-muted-foreground">
                {corpus.map((file) => (
                  <li key={file.name}>{file.name}</li>
                ))}
              </ul>
            )}
          </div>
        </details>
      </section>
      <ol className="mt-7 grid gap-4 text-sm text-muted-foreground sm:grid-cols-3">
        {[
          "Speak or choose a file",
          "Claims are checked against sources",
          "See the verdict and explanation",
        ].map((step, index) => (
          <li key={step} className="flex items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-foreground">
              {index + 1}
            </span>
            {step}
          </li>
        ))}
      </ol>
    </main>
  );
}
