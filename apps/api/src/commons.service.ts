import { Injectable, Logger, ServiceUnavailableException } from "@nestjs/common";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ArchiveObject } from "./archive.service";
import { ROOT } from "./paths";
import { fold, tokens } from "./text";

const API = "https://commons.wikimedia.org/w/api.php";
const HEADERS = { "User-Agent": "Kronika916Demo/0.1 (hackathon demo)" };
const LICENSES: Record<string, string> = { "Public domain": "domena publiczna", CC0: "CC0" };

const strip = (html = "") =>
  html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();

const cleanDate = (raw: string) =>
  raw.replace(/date QS:.*$/, "").replace(/^(?:between|między) (\d{4}) (?:and|a) (\d{4})/, "$1–$2").replace(/^before /, "przed ").trim();

/** Wyszukiwanie na żywo w Wikimedia Commons, ograniczone do starych zdjęć w domenie publicznej. */
@Injectable()
export class CommonsService {
  private readonly logger = new Logger(CommonsService.name);

  async search(topic: string, limit = 10): Promise<ArchiveObject[]> {
    // Commons wymaga wszystkich słów naraz, więc drugie podejście pomija spójniki i przyimki.
    const queries = [...new Set([topic, tokens(topic).filter((t) => t.length >= 4).join(" ")].filter(Boolean))];
    const slug = fold(topic).replace(/[^a-z0-9]+/g, " ").trim().slice(0, 40);
    let failures = 0;
    // Najpierw archiwalia w domenie publicznej; dopiero gdy ich brak, współczesne zdjęcia na wolnej licencji.
    for (const modern of [false, true]) {
      for (const query of queries) {
        try {
          const found = await this.query(query, slug, limit, modern);
          if (found.length >= 3) return found;
        } catch (err) {
          failures++;
          this.logger.warn(`Commons nie odpowiedziało dla „${query}”: ${err}`);
        }
      }
    }
    // Brak odpowiedzi to co innego niż brak zdjęć; użytkownik ma dostać prawdziwy powód.
    if (failures === queries.length * 2) throw new ServiceUnavailableException("Archiwum Wikimedia Commons nie odpowiada. Spróbuj ponownie za chwilę.");
    return [];
  }

  private async query(query: string, topic: string, limit: number, modern: boolean): Promise<ArchiveObject[]> {
    const params = new URLSearchParams({
      action: "query", format: "json", generator: "search", gsrnamespace: "6", gsrlimit: "40",
      // P6216=Q19652 to status „domena publiczna” w danych strukturalnych Commons.
      gsrsearch: modern ? `${query} filetype:bitmap` : `${query} filetype:bitmap haswbstatement:P6216=Q19652`,
      prop: "imageinfo", iiprop: "url|size|extmetadata", iiurlwidth: "1600", iiextmetadatalanguage: "pl",
    });
    // Jedno ponowienie: pojedyncze zerwane połączenie nie powinno kończyć się pustym archiwum.
    const call = () => fetch(`${API}?${params}`, { headers: HEADERS, signal: AbortSignal.timeout(45000) }).then((r) => r.json());
    const body: any = await call().catch(() => call());
    const pages: any[] = Object.values(body.query?.pages ?? {});
    pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

    const candidates: (ArchiveObject & { thumbUrl: string })[] = [];
    const seen = new Set<string>();
    for (const page of pages) {
      const info = page.imageinfo?.[0];
      if (!info?.thumburl || !/\.jpe?g(\?|$)/i.test(info.thumburl) || info.width < 1000) continue;
      const meta = info.extmetadata ?? {};
      const value = (key: string) => strip(meta[key]?.value ?? "");
      const short = value("LicenseShortName");
      // Licencje CC BY i CC BY-SA pozwalają na użycie pod warunkiem podania autora.
      const license = LICENSES[short] ?? (modern && /^CC BY(-SA)? \d/.test(short) ? short : undefined);
      const author = value("Artist").replace(/^(Unknown author ?)+$/, "autor nieznany").slice(0, 60);
      const description = value("ImageDescription");
      const date = cleanDate(value("DateTimeOriginal"));
      // Data skanu zamiast daty zdjęcia zdradza współczesny plik; takie obiekty pomijamy.
      const year = Number(/\d{4}/.exec(date)?.[0] ?? 0);
      if (!license || description.length < 12 || description.length > 600) continue;
      if (!modern && year > 1975) continue;
      if (license.startsWith("CC BY") && !author) continue;
      // Ten sam obraz bywa wgrany kilka razy (kadr, inna rozdzielczość); powtórki psują montaż.
      const key = fold(description).replace(/[^a-z0-9]+/g, "").slice(0, 48);
      if (seen.has(key)) continue;
      seen.add(key);
      const id = `obj_${page.pageid}`;
      candidates.push({
        id, topic,
        title: String(page.title).replace(/^File:/, "").replace(/\.[a-z]+$/i, ""),
        description, date: date.replace(/^(\d{4})-\d{2}-\d{2}.*$/, "$1"),
        author,
        source: "Wikimedia Commons",
        license,
        url: info.descriptionurl,
        file: `assets/archive/${id}.jpg`,
        thumbUrl: info.thumburl,
      });
      if (candidates.length >= limit) break;
    }

    const saved = await Promise.all(
      candidates.map(async ({ thumbUrl, ...object }) => {
        const target = path.join(ROOT, object.file);
        if (!existsSync(target)) {
          const img = await fetch(thumbUrl, { headers: HEADERS, signal: AbortSignal.timeout(45000) }).catch(() => null);
          if (!img?.ok) return null;
          await writeFile(target, Buffer.from(await img.arrayBuffer()));
        }
        return object;
      }),
    );
    return saved.filter((o): o is ArchiveObject => o !== null);
  }
}
