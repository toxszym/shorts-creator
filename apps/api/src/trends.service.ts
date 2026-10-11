import { Injectable, Logger } from "@nestjs/common";

const SKIP = /^(Strona_główna|Polska|Zmarli_w_|\d{1,2}_(stycznia|lutego|marca|kwietnia|maja|czerwca|lipca|sierpnia|września|października|listopada|grudnia)$)/;

/**
 * Sygnał „co jest teraz popularne”: najczęściej czytane wczoraj hasła polskiej Wikipedii.
 * Otwarte API bez klucza; lista służy wyłącznie do budowania hooka.
 */
@Injectable()
export class TrendsService {
  private readonly logger = new Logger(TrendsService.name);
  private cache: { day: string; titles: string[] } | null = null;
  /** Wszystkie trendy widziane od startu, żeby film zaczęty przed północą przeszedł weryfikację po niej. */
  private readonly seen = new Set<string>();

  async list(limit = 40): Promise<string[]> {
    const today = new Date().toISOString().slice(0, 10);
    if (this.cache?.day === today) return this.cache.titles;
    for (const back of [1, 2]) {
      const date = new Date(Date.now() - back * 86400000).toISOString().slice(0, 10).replace(/-/g, "/");
      try {
        const res = await fetch(`https://wikimedia.org/api/rest_v1/metrics/pageviews/top/pl.wikipedia/all-access/${date}`, {
          headers: { "User-Agent": "Kronika916Demo/0.1 (hackathon demo)" },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) continue;
        const articles: { article: string }[] = (await res.json()).items[0].articles;
        const titles = articles
          .map((a) => a.article)
          .filter((title) => !title.includes(":") && !SKIP.test(title))
          .slice(0, limit)
          .map((title) => title.replace(/_/g, " "));
        titles.forEach((title) => this.seen.add(title));
        this.cache = { day: today, titles };
        return titles;
      } catch (err) {
        this.logger.warn(`Nie udało się pobrać trendów: ${err}`);
      }
    }
    return [];
  }

  known(title: string): boolean {
    return this.seen.has(title);
  }
}
