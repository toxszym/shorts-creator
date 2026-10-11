import { Injectable, Logger } from "@nestjs/common";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./paths";

export interface SourceDoc {
  id: string;
  title: string;
  text: string;
  url: string;
  source: string;
  license: string;
}

const DIR = path.join(ROOT, "data/docs");
const MAX_CHARS = 10000;

/**
 * Dłuższy tekst o temacie, z którego da się zbudować opowieść: artykuł polskiej Wikipedii.
 * Podpisy zdjęć mają zwykle jedno zdanie, więc same nie wystarczają na fabułę.
 */
@Injectable()
export class KnowledgeService {
  private readonly logger = new Logger(KnowledgeService.name);
  private readonly docs = new Map<string, SourceDoc>();

  get(id: string): SourceDoc | undefined {
    if (!/^doc_[a-z0-9_]+$/.test(id)) return undefined;
    const cached = this.docs.get(id);
    if (cached) return cached;
    const file = path.join(DIR, `${id}.json`);
    if (!existsSync(file)) return undefined;
    const doc: SourceDoc = JSON.parse(readFileSync(file, "utf8"));
    this.docs.set(id, doc);
    return doc;
  }

  async find(topic: string): Promise<SourceDoc | null> {
    const params = new URLSearchParams({
      action: "query", format: "json", generator: "search", gsrsearch: topic, gsrlimit: "1",
      prop: "extracts|info", explaintext: "1", exlimit: "1", inprop: "url",
    });
    try {
      const res = await fetch(`https://pl.wikipedia.org/w/api.php?${params}`, {
        headers: { "User-Agent": "Kronika916Demo/0.1 (hackathon demo)" },
        signal: AbortSignal.timeout(45000),
      });
      const page: any = Object.values((await res.json()).query?.pages ?? {})[0];
      if (!page?.extract) return null;
      // Sekcje z przypisami i odsyłaczami nie niosą opowieści, więc tekst kończymy przed nimi.
      const body = String(page.extract)
        .split(/\n==+\s*(Przypisy|Bibliografia|Zobacz też|Linki zewnętrzne|Uwagi)\s*==+/)[0]
        .replace(/\n==+[^=\n]+==+\n/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{2,}/g, "\n")
        .trim();
      if (body.length < 400) return null;
      const doc: SourceDoc = {
        id: `doc_plwiki_${page.pageid}`,
        title: page.title,
        text: body.slice(0, MAX_CHARS),
        url: page.fullurl,
        source: "Wikipedia",
        license: "CC BY-SA 4.0",
      };
      this.docs.set(doc.id, doc);
      writeFileSync(path.join(DIR, `${doc.id}.json`), JSON.stringify(doc, null, 2));
      return doc;
    } catch (err) {
      this.logger.warn(`Nie udało się pobrać tekstu źródłowego dla „${topic}”: ${err}`);
      return null;
    }
  }
}
