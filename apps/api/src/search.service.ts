import { Injectable } from "@nestjs/common";
import { ArchiveObject, ArchiveService } from "./archive.service";
import { sameWord, tokens } from "./text";

export interface SearchHit extends ArchiveObject {
  score: number;
  thumb: string;
  /** Słowa tematu trafione w tytule lub na początku opisu. */
  headMatches: string[];
}

/**
 * Wyszukiwanie leksykalne po opisach: wspólne rdzenie słów ważone rzadkością.
 * Interfejs jest gotowy na podmianę na embeddingi bez zmian w kontrolerze.
 */
@Injectable()
export class SearchService {
  constructor(private readonly archive: ArchiveService) {}

  search(topic: string, limit = 8): SearchHit[] {
    const query = [...new Set(tokens(topic))];
    if (!query.length) return [];
    // Główne słowo tematu musi opisywać zdjęcie; inaczej trafiamy na przypadkowe wzmianki.
    const main = [...query].sort((a, b) => b.length - a.length)[0];
    const has = (words: string[], q: string) => words.some((w) => sameWord(w, q));

    // Indeks liczony przy każdym zapytaniu, bo archiwum rośnie w trakcie działania, a jest małe.
    const index = this.archive.objects.map((object) => ({
      object,
      // Trafienie w tytule lub na początku opisu mówi o temacie zdjęcia; dalej bywa adres wydawcy.
      head: tokens(`${object.title} ${object.description.slice(0, 80)} ${object.topic}`),
      all: tokens(this.archive.evidence(object)),
    }));
    const idf = new Map(query.map((q) => [q, Math.log(1 + index.length / (1 + index.filter((e) => has(e.all, q)).length))]));

    return index
      .filter(({ head }) => has(head, main))
      .map(({ object, head, all }) => ({
        ...object,
        thumb: `/files/archive/${object.id}.jpg`,
        headMatches: query.filter((q) => has(head, q)),
        score: Number(query.reduce((sum, q) => sum + (has(head, q) ? 3 : has(all, q) ? 1 : 0) * (idf.get(q) ?? 0), 0).toFixed(3)),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
