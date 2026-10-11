import type { CaptionStyle, Storyboard, StyleTemplate } from "./types";

const W = 1080;
const H = 1920;

function ts(seconds: number): string {
  const cs = Math.max(0, Math.round(seconds * 100));
  const h = Math.floor(cs / 360000);
  const m = Math.floor((cs % 360000) / 6000);
  const s = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
}

const esc = (text: string) => text.replace(/[{}\\]/g, "").replace(/\n/g, " ");
// ASS zapisuje kolory jako BBGGRR.
const bgr = (rgb: string) => `&H${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}&`;

function chunkWords<T extends { w: string }>(words: T[], size: number, maxChars: number): T[][] {
  const chunks: T[][] = [];
  let current: T[] = [];
  const length = (list: T[]) => list.reduce((sum, x) => sum + x.w.length + 1, -1);
  for (const word of words) {
    // Napis musi zmieścić się w jednej linii kadru, więc długie słowa zamykają grupę wcześniej.
    if (current.length && length(current) + 1 + word.w.length > maxChars) {
      chunks.push(current);
      current = [];
    }
    current.push(word);
    if (current.length >= size || /[.,!?;:…]$/.test(word.w)) {
      chunks.push(current);
      current = [];
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/** Łamie oznaczony tekst na linie według długości samych słów, bo znaczniki koloru nie zajmują miejsca. */
function wrapLines(marked: string, words: string[], maxChars: number): string {
  const parts = marked.split(" ");
  const lines: string[] = [];
  let line: string[] = [];
  let length = 0;
  words.forEach((word, i) => {
    if (line.length && length + 1 + word.length > maxChars) {
      lines.push(line.join(" "));
      line = [];
      length = 0;
    }
    line.push(parts[i]);
    length += (line.length > 1 ? 1 : 0) + word.length;
  });
  if (line.length) lines.push(line.join(" "));
  return lines.join("\\N");
}

function captionEvents(sb: Storyboard, cap: CaptionStyle): string[] {
  const events: string[] = [];
  let n = 0;
  for (const scene of sb.scenes) {
    // Hook stoi na ekranie w całości od pierwszej klatki: widz czyta obietnicę filmu, zanim zdąży przewinąć.
    const isHook = scene === sb.scenes[0] && scene.words.length <= 10;
    const chunks = isHook ? [scene.words] : chunkWords(scene.words, cap.wordsPerChunk, cap.maxChars);
    for (const [c, chunk] of chunks.entries()) {
      // Kolejne grupy słów przechylają się na przemian, żeby napis nie stał w miejscu.
      const tilt = cap.tilt ? `\\frz${(n++ % 2 ? -1 : 1) * cap.tilt}` : "";
      // Grupa znika najpóźniej wtedy, gdy wchodzi następna, żeby dwa napisy nie nałożyły się na siebie.
      const chunkEnd = Math.min(chunk[chunk.length - 1].t1 + 0.08, chunks[c + 1]?.[0].t0 ?? scene.end);
      chunk.forEach((word, i) => {
        const end = i < chunk.length - 1 ? chunk[i + 1].t0 : chunkEnd;
        const text = chunk
          .map((other, j) => {
            const label = esc(cap.uppercase ? other.w.toUpperCase() : other.w);
            return j === i ? `{\\c${bgr(cap.highlight)}}${label}{\\c&HFFFFFF&}` : label;
          })
          .join(" ");
        const shown = isHook ? wrapLines(text, chunk.map((w) => w.w), cap.maxChars) : text;
        const pop = i === 0 ? "\\fscx70\\fscy70\\t(0,110,\\fscx100\\fscy100)" : "";
        events.push(`Dialogue: 2,${ts(word.t0)},${ts(end)},Caption,,0,0,0,,{\\pos(${W / 2},${cap.y})${tilt}${pop}}${shown}`);
      });
    }
  }
  return events;
}

/** Rok wymieniony w zdaniu wjeżdża jako duży stempel: to najkrótsza droga do „kiedy to było”. */
function yearEvents(sb: Storyboard, template: StyleTemplate): string[] {
  if (!template.yearStamp) return [];
  const y = template.layout === "split" ? 150 : 330;
  const events: string[] = [];
  for (const scene of sb.scenes) {
    const word = scene.words.find((w) => /^\d{4}\D*$/.test(w.w));
    if (!word || scene.hide_chip) continue;
    const end = Math.min(scene.end, word.t0 + 1.6);
    const tilt = template.caption.tilt ? -6 : 0;
    events.push(
      `Dialogue: 2,${ts(word.t0)},${ts(end)},Year,,0,0,0,,{\\pos(${W / 2},${y})\\frz${tilt}\\c${bgr(template.caption.highlight)}\\fscx160\\fscy160\\alpha&HFF&\\t(0,140,\\fscx100\\fscy100\\alpha&H00&)\\fad(0,150)}${word.w.slice(0, 4)}`,
    );
  }
  return events;
}

/** Długość ciszy na odliczanie przed odpowiedzią zagadki. */
export const COUNTDOWN_SECONDS = 1.65;

function countdownEvents(sb: Storyboard, template: StyleTemplate): string[] {
  const events: string[] = [];
  for (const scene of sb.scenes.filter((s) => s.countdown)) {
    const from = scene.end - COUNTDOWN_SECONDS + 0.1;
    ["3", "2", "1"].forEach((digit, k) => {
      const t = from + k * 0.5;
      events.push(
        `Dialogue: 5,${ts(t)},${ts(t + 0.5)},Year,,0,0,0,,{\\pos(${W / 2},${template.caption.y - 520})\\c${bgr(template.caption.highlight)}\\fscx220\\fscy220\\t(0,160,\\fscx130\\fscy130)\\fad(0,120)}${digit}`,
      );
    });
  }
  return events;
}

/** Moment, w którym naklejka wchodzi na ekran: tuż po ostatnim słowie zdania albo sekundę przed jego końcem. */
export function stickerTime(scene: Storyboard["scenes"][number]): number {
  return Math.max(scene.start + 0.3, scene.end - 1.0);
}

function stickerEvents(sb: Storyboard, template: StyleTemplate): string[] {
  const y = template.caption.y - 300;
  return sb.scenes.filter((scene) => scene.sticker).map((scene, i) => {
    const colour = scene.sticker!.tone === "plus" ? "3DDC84" : "FF5A5A";
    // Długa naklejka nie mieści się z boku kadru, więc staje na środku.
    const x = scene.sticker!.text.length > 12 ? W / 2 : i % 2 ? 330 : 750;
    return `Dialogue: 4,${ts(stickerTime(scene))},${ts(scene.end)},Sticker,,0,0,0,,{\\pos(${x},${y})\\frz${i % 2 ? 9 : -9}\\c${bgr(colour)}\\fscx190\\fscy190\\t(0,130,\\fscx100\\fscy100)}${esc(scene.sticker!.text)}`;
  });
}

function chipEvents(sb: Storyboard, template: StyleTemplate): string[] {
  // Podpis źródła przy każdym kadrze: to on pokazuje, że film ma pokrycie w archiwum.
  const y = template.layout === "split" ? 56 : 150;
  return sb.scenes.map((scene) => {
    const credit = sb.credits.find((c) => c.asset_id === scene.asset_id);
    if (!credit || scene.hide_chip) return "";
    const by = credit.license.startsWith("CC BY") && credit.author ? `fot. ${credit.author.slice(0, 28)}` : credit.source;
    const label = [credit.date ?? "", by, credit.license].filter(Boolean).map(esc).join("  ·  ");
    return `Dialogue: 1,${ts(scene.start)},${ts(scene.end)},Chip,,0,0,0,,{\\pos(44,${y})}${label}`;
  }).filter(Boolean);
}

function endCardEvents(sb: Storyboard, mainEnd: number, total: number): string[] {
  const start = ts(mainEnd);
  const end = ts(total);
  const used = sb.credits.filter((c) => sb.scenes.some((s) => s.asset_id === c.asset_id));
  const lines = used.slice(0, 7).map((c) => {
    const title = c.title.length > 44 ? `${c.title.slice(0, 43)}…` : c.title;
    const by = c.license.startsWith("CC BY") && c.author ? `  ·  ${esc(c.author.slice(0, 24))}` : "";
    return `${esc(title.slice(0, by ? 30 : 44))}${by}  ·  ${esc(c.license)}`;
  });
  const texts = (sb.text_sources ?? []).map((t) => `Tekst: ${esc(t.source)}, „${esc(t.title)}”  ·  ${esc(t.license)}`);
  if (texts.length) lines.unshift(...texts, "");
  const fade = "{\\fad(200,0)}";
  return [
    `Dialogue: 3,${start},${end},EndTitle,,0,0,0,,{\\pos(${W / 2},520)}${fade}ŹRÓDŁA`,
    `Dialogue: 3,${start},${end},EndBody,,0,0,0,,{\\pos(${W / 2},640)}${fade}${esc(used[0]?.source ?? "")}`,
    `Dialogue: 3,${start},${end},EndList,,0,0,0,,{\\pos(${W / 2},760)}${fade}${lines.join("\\N")}`,
    `Dialogue: 3,${start},${end},EndBody,,0,0,0,,{\\pos(${W / 2},1500)}${fade}Każde zdanie tego filmu ma cytat\\Nze wskazanego źródła.`,
    `Dialogue: 3,${start},${end},EndBrand,,0,0,0,,{\\pos(${W / 2},1700)}${fade}KRONIKA 9:16`,
  ];
}

export function buildAss(sb: Storyboard, template: StyleTemplate, mainEnd: number, total: number): string {
  const cap = template.caption;
  const header = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${cap.font},${cap.size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,-1,0,0,0,100,100,1,0,1,${cap.outline},3,5,40,40,40,1`,
    "Style: Year,Impact,250,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,0,0,0,0,100,100,2,0,1,12,6,5,0,0,0,1",
    "Style: Sticker,Impact,104,&H00FFFFFF,&H00FFFFFF,&H00000000,&H96000000,0,0,0,0,100,100,1,0,1,9,5,5,0,0,0,1",
    "Style: Chip,Helvetica Neue,30,&H00FFFFFF,&H00FFFFFF,&HA0000000,&HA0000000,-1,0,0,0,100,100,0,0,3,10,0,7,0,0,0,1",
    "Style: EndTitle,Impact,110,&H0042C5F5,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,6,0,1,0,0,5,60,60,0,1",
    "Style: EndBody,Helvetica Neue,44,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,5,60,60,0,1",
    "Style: EndList,Helvetica Neue,34,&H00C8C8C8,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,8,60,60,0,1",
    "Style: EndBrand,Impact,56,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,0,0,0,0,100,100,4,0,1,0,0,5,60,60,0,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  return [
    ...header,
    ...chipEvents(sb, template),
    ...yearEvents(sb, template),
    ...captionEvents(sb, cap),
    ...stickerEvents(sb, template),
    ...countdownEvents(sb, template),
    ...endCardEvents(sb, mainEnd, total),
    "",
  ].join("\n");
}
