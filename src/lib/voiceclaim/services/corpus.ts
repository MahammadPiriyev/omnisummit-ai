import Papa from "papaparse";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { embedTexts } from "../functions";
import {
  assetRepository,
  chunkRepository,
  type CorpusChunkRecord,
  type StoredAsset,
} from "../storage";
import type { EvidenceCorpusService } from "./types";
import { cosine } from "../vector";

interface SourceText {
  text: string;
  provenance: string;
}

export class IndexedDbEvidenceCorpusService implements EvidenceCorpusService {
  constructor(
    private readonly sessionId: string,
    private readonly sessionToken: string,
  ) {}

  async register(files: File[]) {
    const stored = await assetRepository.list(this.sessionId, "corpus");
    const assets = stored.length
      ? stored
      : await assetRepository.storeCorpus(this.sessionId, files);
    const records: CorpusChunkRecord[] = [];
    let totalCharacters = 0;
    for (const asset of assets) {
      if (!asset.source) continue;
      await assetRepository.updateSource(asset.id, { parserStatus: "parsing" });
      try {
        const sections = await parseAsset(asset);
        const chunks = sections.flatMap((section) => chunkSection(section));
        const remainingCharacters = Math.max(0, 1_000_000 - totalCharacters);
        const accepted = chunks
          .map((chunk) => ({ ...chunk, text: chunk.text.slice(0, remainingCharacters) }))
          .filter((chunk) => chunk.text)
          .slice(0, Math.max(0, 300 - records.length));
        totalCharacters += accepted.reduce((sum, chunk) => sum + chunk.text.length, 0);
        await assetRepository.updateSource(asset.id, {
          parserStatus: "indexing",
          chunkCount: accepted.length,
          ...(asset.source.kind === "pdf" ? { pageCount: sections.length } : {}),
          ...(asset.source.kind === "csv" ? { rowCount: sections.length } : {}),
        });
        const vectors: number[][] = [];
        for (let index = 0; index < accepted.length; index += 32) {
          const batch = accepted.slice(index, index + 32);
          const embedded = await embedTexts({
            data: {
              texts: batch.map((chunk) => chunk.text),
              purpose: "document",
              sessionId: this.sessionId,
              sessionToken: this.sessionToken,
            },
          });
          vectors.push(...embedded.vectors);
        }
        accepted.forEach((chunk, index) => {
          records.push({
            id: `${asset.source!.id}:chunk:${index}`,
            sessionId: this.sessionId,
            sourceId: asset.source!.id,
            sourceName: asset.source!.name,
            provenance: chunk.provenance,
            text: chunk.text,
            vector: vectors[index]!,
          });
        });
        await assetRepository.updateSource(asset.id, {
          parserStatus: "ready",
          chunkCount: accepted.length,
        });
      } catch (error) {
        await assetRepository.updateSource(asset.id, {
          parserStatus: "error",
          indexingError: error instanceof Error ? error.message : "Faylı emal etmək mümkün olmadı",
        });
      }
    }
    await chunkRepository.replace(this.sessionId, records);
  }

  async contextForClaim(claim: string) {
    const chunks = await chunkRepository.list(this.sessionId);
    if (!chunks.length) return "";
    const embedded = await embedTexts({
      data: {
        texts: [claim],
        purpose: "query",
        sessionId: this.sessionId,
        sessionToken: this.sessionToken,
      },
    });
    const query = embedded.vectors[0]!;
    const selected = chunks
      .map((chunk) => ({ chunk, score: cosine(query, chunk.vector) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    let length = 0;
    const context: string[] = [];
    for (const { chunk } of selected) {
      const entry = `[custom:${chunk.sourceId} | ${chunk.sourceName} | ${chunk.provenance}]\n${chunk.text}`;
      if (length + entry.length > 12_000) break;
      length += entry.length;
      context.push(entry);
    }
    return context.join("\n\n");
  }

  clear() {
    return assetRepository.deleteSession(this.sessionId);
  }
}

async function parseAsset(asset: StoredAsset): Promise<SourceText[]> {
  const kind = asset.source?.kind;
  if (kind === "txt")
    return [{ text: (await asset.file.text()).slice(0, 1_000_000), provenance: "mətn" }];
  if (kind === "csv") {
    const parsed = Papa.parse<string[]>(await asset.file.text(), { skipEmptyLines: true });
    if (parsed.errors.length)
      throw new Error(parsed.errors[0]?.message ?? "CSV faylını oxumaq mümkün olmadı");
    return parsed.data.map((row, index) => ({
      text: row.join(" | "),
      provenance: `sətir ${index + 1}`,
    }));
  }
  if (kind === "pdf") {
    const signature = new TextDecoder().decode(
      new Uint8Array(await asset.file.slice(0, 5).arrayBuffer()),
    );
    if (signature !== "%PDF-") throw new Error("PDF faylı etibarlı deyil");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    const document = await pdfjs.getDocument({
      data: new Uint8Array(await asset.file.arrayBuffer()),
    }).promise;
    const pages: SourceText[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      pages.push({ text, provenance: `səhifə ${pageNumber}` });
    }
    return pages;
  }
  throw new Error("Bu fayl növü dəstəklənmir");
}

function chunkSection(section: SourceText) {
  const chunks: SourceText[] = [];
  for (let start = 0; start < section.text.length; start += 2_700) {
    chunks.push({ text: section.text.slice(start, start + 3_000), provenance: section.provenance });
  }
  return chunks;
}
