import { Injectable } from "@nestjs/common";
import { ArchiveService } from "./archive.service";
import { KnowledgeService } from "./knowledge.service";
import { fold, normalize } from "./text";
import { TrendsService } from "./trends.service";

export interface DraftSentence {
  text: string;
  source_quote: string | null;
  asset_id: string;
  /** Hook i puenta nie niosą faktów, więc nie wymagają cytatu. */
  kind?: "hook" | "fact" | "punchline";
  /** Popularne hasło, do którego nawiązuje hook. */
  trend?: string | null;
  /** Tekst źródłowy, z którego pochodzi opowieść. */
  doc_id?: string | null;
  /** Naklejka pokazywana na ekranie przy zdaniu; lektor jej nie czyta. */
  sticker?: { text: string; tone: "plus" | "minus" } | null;
  /** Po zdaniu film odlicza 3-2-1 przed odpowiedzią zagadki. */
  countdown?: boolean;
  /** Kadr nie pokazuje podpisu źródła, żeby nie zdradzić odpowiedzi. */
  hide_chip?: boolean;
}

export interface Verdict extends DraftSentence {
  ok: boolean;
  reason?: string;
  checks: string[];
}

/**
 * Własna warstwa weryfikacji: sprawdza zdania kodem, a nie modelem.
 * 1. Cytat musi dosłownie występować w tekście źródłowym albo w opisie obiektu.
 * 2. Każda liczba ze zdania musi występować w tekście źródłowym albo w opisie lub dacie obiektu.
 * 3. Każda nazwa własna ze zdania musi występować w źródle albo, w hooku, na liście trendów.
 */
@Injectable()
export class VerifyService {
  constructor(
    private readonly archive: ArchiveService,
    private readonly trends: TrendsService,
    private readonly knowledge: KnowledgeService,
  ) {}

  verify(sentences: DraftSentence[]): Verdict[] {
    const allEvidence = sentences
      .map((s) => this.archive.get(s.asset_id))
      .filter((o) => !!o)
      .map((o) => this.archive.evidence(o!))
      .join(" ");

    return sentences.map((sentence) => {
      const object = this.archive.get(sentence.asset_id);
      if (!object) return { ...sentence, ok: false, reason: "nieznany obiekt archiwalny", checks: [] };
      const framing = sentence.kind === "hook" || sentence.kind === "punchline";
      // Hook i puenta mogą nazywać temat całego filmu, fakty tylko to, co jest przy ich obiekcie.
      // Hook może dodatkowo wymienić hasło z listy trendów, ale tylko takie, które naprawdę na niej było.
      const trend = sentence.kind === "hook" && sentence.trend && this.trends.known(sentence.trend) ? sentence.trend : "";
      const doc = sentence.doc_id ? this.knowledge.get(sentence.doc_id)?.text ?? "" : "";
      const evidence = framing ? `${allEvidence} ${doc} ${trend}` : `${this.archive.evidence(object)} ${doc}`;
      const checks: string[] = [];

      if (!framing) {
        if (!sentence.source_quote) return { ...sentence, ok: false, reason: "brak cytatu ze źródła", checks };
        const quote = normalize(sentence.source_quote);
        if (quote.length < 6 || !(normalize(object.description).includes(quote) || normalize(doc).includes(quote))) {
          return { ...sentence, ok: false, reason: "cytat nie występuje w źródle", checks };
        }
        checks.push("cytat");
      }

      const haystack = normalize(evidence);
      for (const number of sentence.text.match(/\d+/g) ?? []) {
        if (!haystack.split(" ").includes(number)) {
          return { ...sentence, ok: false, reason: `liczba „${number}” nie ma pokrycia w źródle`, checks };
        }
      }
      checks.push("liczby");

      const folded = fold(evidence);
      const words = sentence.text.split(/\s+/);
      for (let i = 1; i < words.length; i++) {
        const word = words[i].replace(/[^\p{L}]/gu, "");
        const startsSentence = /[.!?]$/.test(words[i - 1]);
        if (word.length < 4 || startsSentence || word[0] !== word[0].toUpperCase() || word[0] === word[0].toLowerCase()) continue;
        if (!folded.includes(fold(word).slice(0, 4))) {
          return { ...sentence, ok: false, reason: `nazwa „${word}” nie ma pokrycia w źródle`, checks };
        }
      }
      checks.push("nazwy");
      return { ...sentence, ok: true, checks };
    });
  }
}
