import { useEffect, useRef } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  formatTimestamp,
  type StatementClassification,
  type TranscriptSegment,
} from "@/lib/voiceclaim/types";

const CLASS_LABEL: Record<StatementClassification, string> = {
  verifiable_fact: "Yoxlanacaq fakt",
  opinion: "Şəxsi fikir",
  prediction: "Proqnoz",
  context: "Əlavə məlumat",
};

const CLASS_STYLE: Record<StatementClassification, string> = {
  verifiable_fact: "text-live border-live/40",
  opinion: "text-muted-foreground border-border",
  prediction: "text-verdict-mixed border-verdict-mixed/40",
  context: "text-muted-foreground/70 border-border",
};

export function TranscriptPane({
  segments,
  claimedSegmentIds,
  onVerify,
  live,
}: {
  segments: TranscriptSegment[];
  claimedSegmentIds: Set<string>;
  onVerify?: (segmentId: string) => void;
  live: boolean;
}) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (live) endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [segments, live]);

  if (segments.length === 0) {
    return (
      <p className="px-5 py-8 text-sm text-muted-foreground">
        Danışıq gözlənilir. Tanınan sözlər burada görünəcək.
      </p>
    );
  }

  return (
    <div className="divide-y divide-border/70 px-5 sm:px-6">
      {segments.map((segment) => (
        <div
          key={segment.id}
          className="group grid grid-cols-[52px_minmax(0,1fr)] gap-3 py-5 sm:grid-cols-[64px_minmax(0,1fr)]"
        >
          <span className="tabular pt-0.5 text-[11px] text-muted-foreground">
            {formatTimestamp(segment.startMs)}
          </span>
          <div className="min-w-0">
            <div className="flex min-h-5 items-center gap-2">
              {segment.classification && !segment.interim && (
                <span
                  className={cn(
                    "rounded border px-2 py-0.5 text-[9px] font-semibold tracking-wide uppercase",
                    CLASS_STYLE[segment.classification],
                  )}
                >
                  {CLASS_LABEL[segment.classification]}
                </span>
              )}
              {onVerify && !segment.interim && (
                <button
                  type="button"
                  onClick={() => onVerify(segment.id)}
                  className="ml-auto inline-flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <Search className="size-3" />
                  {claimedSegmentIds.has(segment.id) ? "Yenidən yoxla" : "Bu fikri yoxla"}
                </button>
              )}
            </div>
            <p
              className={cn(
                "mt-2 text-[15px] leading-7",
                segment.interim ? "text-muted-foreground" : "text-foreground",
                claimedSegmentIds.has(segment.id) && "-ml-3 border-l-2 border-live pl-3",
              )}
            >
              {segment.text}
              {segment.interim && (
                <span className="ml-1 inline-block h-4 w-[2px] animate-pulse bg-live align-middle" />
              )}
            </p>
          </div>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
