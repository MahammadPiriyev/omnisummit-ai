import { ExternalLink, Link2Off } from "lucide-react";
import { cn } from "@/lib/utils";
import { SOURCE_CATEGORY_LABELS, type EvidenceItem } from "@/lib/voiceclaim/types";

const RELATION_STYLE = {
  supports: "text-verdict-supported border-verdict-supported/40",
  contradicts: "text-verdict-contradicted border-verdict-contradicted/40",
  contextual: "text-muted-foreground border-border",
} as const;

const RELATION_LABEL = {
  supports: "Təsdiqləyir",
  contradicts: "Təkzib edir",
  contextual: "Əlavə məlumat",
} as const;

export function EvidenceCard({ item }: { item: EvidenceItem }) {
  return (
    <article className="rounded-lg border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 font-semibold tracking-wide uppercase",
            RELATION_STYLE[item.relation],
          )}
        >
          {RELATION_LABEL[item.relation]}
        </span>
        <span className="text-muted-foreground">{SOURCE_CATEGORY_LABELS[item.category]}</span>
        <span className="text-muted-foreground/60">·</span>
        <span className="text-muted-foreground">
          Mənbənin etibarlılığı: {{ low: "Aşağı", medium: "Orta", high: "Yüksək" }[item.authority]}
        </span>
        {!item.independent && (
          <span className="inline-flex items-center gap-1 text-verdict-mixed">
            <Link2Off className="size-3" />
            Müstəqil mənbə deyil
          </span>
        )}
      </div>

      <h4 className="mt-2.5 font-display text-sm leading-snug font-semibold">
        {item.translatedTitle ?? item.title}
      </h4>
      <p className="mt-2 border-l-2 border-border pl-3 text-sm leading-relaxed text-muted-foreground">
        {item.translatedExcerpt ?? item.excerpt}
      </p>
      {item.translatedExcerpt && (
        <details className="mt-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Mənbədəki orijinal mətn</summary>
          <p className="mt-2">{item.title}</p>
          <blockquote className="mt-1">{item.excerpt}</blockquote>
        </details>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <a
          href={item.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
        >
          {item.domain}
          <ExternalLink className="size-3" />
        </a>
        {item.publishedAt && <span>Dərc edilib: {item.publishedAt}</span>}
        <span>Əldə edilib: {new Date(item.retrievedAt).toLocaleTimeString("az-AZ")}</span>
        {item.upstreamOf && <span>Təkrar mənbə: {item.upstreamOf}</span>}
      </div>
    </article>
  );
}
