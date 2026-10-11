import { Injectable } from "@nestjs/common";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { StyleId } from "@kronika/render";
import { ArchiveObject, ArchiveService } from "./archive.service";
import { KnowledgeService, SourceDoc } from "./knowledge.service";
import { ROOT } from "./paths";
import { TrendsService } from "./trends.service";
import { DraftSentence, VerifyService } from "./verify.service";
import { FORMATS, FormatId, WriterService } from "./writer.service";

interface Fixture {
  topic: string;
  hooks: Record<StyleId, string>;
  scenes: DraftSentence[];
  punchline: string;
}

export interface Draft {
  origin: "model językowy" | "przygotowany scenariusz" | "opisy źródłowe";
  sentences: DraftSentence[];
  /** Rodzaj hooka wybrany przez model i trend, do którego nawiązuje. */
  hook_type?: string;
  trend?: string | null;
  /** Kąt opowieści wybrany przez model i kąty, które odrzucił. */
  angle?: string;
  angles?: string[];
  /** Konwencja filmu wybrana przez model: pov, aura albo klasyczny. */
  format?: string;
  text_source?: Pick<SourceDoc, "id" | "title" | "url" | "source" | "license"> | null;
}

function auraSticker(aura: number | null, prefix = ""): DraftSentence["sticker"] {
  if (aura === null || !Number.isFinite(aura) || aura === 0) return null;
  const value = Math.max(-9900, Math.min(9900, Math.round(aura / 100) * 100));
  return { text: `${prefix}${value > 0 ? "+" : "−"}${Math.abs(value)} AURY`, tone: value > 0 ? "plus" : "minus" };
}

/**
 * Układa szkic scenariusza. Pisze go model językowy; gdy jest niedostępny,
 * szkic pochodzi z przygotowanego pliku albo wprost z opisów archiwalnych.
 */
@Injectable()
export class ScriptService {
  constructor(
    private readonly archive: ArchiveService,
    private readonly writer: WriterService,
    private readonly trends: TrendsService,
    private readonly verifier: VerifyService,
    private readonly knowledge: KnowledgeService,
  ) {}

  async draft(topic: string, assetIds: string[], style: StyleId, wanted?: string): Promise<Draft> {
    const objects = assetIds.map((id) => this.archive.get(id)).filter((o): o is ArchiveObject => !!o);
    if (!objects.length) return { origin: "opisy źródłowe", sentences: [] };

    const [trends, doc] = await Promise.all([this.trends.list(), this.knowledge.find(topic)]);
    // Bez wskazania format jest losowany, żeby kolejne filmy różniły się konwencją.
    const format: FormatId = style === "kronika"
      ? "klasyczny"
      : FORMATS.includes(wanted as FormatId) ? (wanted as FormatId) : FORMATS[Math.floor(Math.random() * FORMATS.length)];
    const written = await this.writer.write(topic, style, format, objects, trends, doc);
    const reveal = written?.format === "zgadnij" && Number.isInteger(written.reveal_index) && written.reveal_index! > 0 ? written.reveal_index! : null;
    const docId = doc?.id ?? null;
    const facts: DraftSentence[] = (written?.sentences ?? [])
      .map(({ aura, ...s }, i) => ({
        ...s, kind: "fact" as const, doc_id: docId,
        sticker: written?.format === "aura" ? auraSticker(aura) : null,
        // W zagadce kadry przed odpowiedzią nie pokazują podpisów, a ostatnia wskazówka kończy się odliczaniem.
        hide_chip: reveal !== null && i < reveal,
        countdown: reveal !== null && i === reveal - 1,
      }))
      .filter((s) => assetIds.includes(s.asset_id));
    const total = (written?.sentences ?? []).reduce((sum, s) => sum + (s.aura ?? 0), 0);
    if (written && facts.length) {
      const first = facts[0].asset_id;
      let hook: DraftSentence = { text: written.hook, source_quote: null, asset_id: first, kind: "hook", trend: written.trend, doc_id: docId, hide_chip: reveal !== null };
      let hookType: string = written.hook_type;
      // Hook z trendem, który nie przechodzi weryfikacji, ustępuje zwykłemu, żeby film nie został bez otwarcia.
      if (!this.verifier.verify([hook, ...facts])[0].ok) {
        hook = { ...hook, text: written.hook_plain, trend: null };
        hookType = "zapasowy";
      }
      return {
        origin: "model językowy",
        hook_type: hookType,
        trend: hook.trend ?? null,
        angle: written.angle,
        angles: written.angles,
        format: written.format,
        text_source: doc ? { id: doc.id, title: doc.title, url: doc.url, source: doc.source, license: doc.license } : null,
        sentences: [
          hook,
          ...facts,
          {
            text: written.punchline, source_quote: null, asset_id: facts[facts.length - 1].asset_id, kind: "punchline", doc_id: docId,
            sticker: written.format === "aura" ? auraSticker(total, "RAZEM ") : null,
          },
        ],
      };
    }
    return this.fallback(objects, assetIds, style);
  }

  private fallback(objects: ArchiveObject[], assetIds: string[], style: StyleId): Draft {
    const counts = new Map<string, number>();
    for (const o of objects) counts.set(o.topic, (counts.get(o.topic) ?? 0) + 1);
    const topic = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const file = path.join(ROOT, "samples", `${topic}.script.json`);

    if (existsSync(file)) {
      const fixture: Fixture = JSON.parse(readFileSync(file, "utf8"));
      const facts = fixture.scenes.filter((s) => assetIds.includes(s.asset_id));
      if (facts.length >= 3) {
        return {
          origin: "przygotowany scenariusz",
          sentences: [
            { text: fixture.hooks[style], source_quote: null, asset_id: facts[0].asset_id, kind: "hook" },
            ...facts.map((s) => ({ ...s, kind: "fact" as const })),
            { text: fixture.punchline, source_quote: null, asset_id: facts[facts.length - 1].asset_id, kind: "punchline" },
          ],
        };
      }
    }

    // Bez modelu językowego zdaniem staje się sam opis archiwalny.
    return {
      origin: "opisy źródłowe",
      sentences: objects.map((o) => {
        const text = o.description.replace(/\[|\]/g, "").split(/(?<=\.)\s/)[0].slice(0, 110);
        return { text, source_quote: text, asset_id: o.id, kind: "fact" as const };
      }),
    };
  }
}
