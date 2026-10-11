export type StyleId = "kronika" | "storytime" | "brainrot";

export interface Word {
  w: string;
  t0: number;
  t1: number;
}

export interface Scene {
  text: string;
  /** Dosłowny fragment opisu archiwalnego, z którego pochodzi zdanie. Hook i puenta mogą go nie mieć. */
  source_quote: string | null;
  asset_id: string;
  start: number;
  end: number;
  words: Word[];
  /** Naklejka wjeżdżająca pod koniec zdania, np. punktacja. */
  sticker?: { text: string; tone: "plus" | "minus" };
  /** Pod koniec sceny jest cisza, w której na ekranie leci odliczanie 3-2-1. */
  countdown?: boolean;
  /** Scena nie pokazuje podpisu źródła ani roku, bo zdradziłyby odpowiedź zagadki. */
  hide_chip?: boolean;
}

export interface Credit {
  asset_id: string;
  title: string;
  date?: string;
  /** Autor; przy licencjach CC BY jego podanie jest warunkiem użycia. */
  author?: string;
  source: string;
  license: string;
  url: string;
  /** Ścieżka do pliku względem katalogu projektu. */
  file: string;
}

export interface RejectedSentence {
  text: string;
  reason: string;
}

export interface Storyboard {
  id: string;
  topic: string;
  style: StyleId;
  audio_url: string;
  /** Długość lektora w sekundach, bez planszy końcowej. */
  duration: number;
  scenes: Scene[];
  credits: Credit[];
  /** Teksty, z których pochodzą fakty opowieści. */
  text_sources?: { title: string; source: string; license: string; url: string }[];
  rejected?: RejectedSentence[];
}

export interface CaptionStyle {
  font: string;
  size: number;
  /** Środek napisu w pikselach od góry kadru 1080×1920. */
  y: number;
  wordsPerChunk: number;
  /** Największa liczba znaków, która mieści się w jednej linii przy tym kroju i rozmiarze. */
  maxChars: number;
  uppercase: boolean;
  /** Kolor aktywnego słowa, RRGGBB. */
  highlight: string;
  outline: number;
  /** Największe przechylenie napisu w stopniach; 0 wyłącza. */
  tilt: number;
}

export interface StyleTemplate {
  layout: "full" | "split";
  /** Tło dolnej połowy dla układu split, ścieżka względem katalogu projektu. */
  background?: string;
  look: "archival" | "punchy";
  /** Docelowa długość jednego ujęcia; krótsza daje szybszy montaż. */
  shotSeconds: number;
  /** Podkład muzyczny, ścieżka względem katalogu projektu. */
  music?: string | string[];
  musicVolume?: number;
  /** Efekty dźwiękowe: na zmianę sceny, na stempel z rokiem i na naklejkę. Ścieżki względem katalogu projektu. */
  sfx?: { cut?: string; stamp?: string; sticker?: string; volume: number };
  /** Duży stempel z rokiem, gdy zdanie go wymienia. */
  yearStamp: boolean;
  /** Kolory akcentu, z których film losuje jeden; bez listy obowiązuje kolor napisów. */
  accents?: string[];
  /** Krótkie drgnięcie kadru przy stemplu, naklejce i odpowiedzi. */
  shake?: boolean;
  caption: CaptionStyle;
}

export interface Manifest {
  endCardSeconds: number;
  styles: Record<StyleId, StyleTemplate>;
}
