import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { probeDuration, run } from "./ffmpeg";
import type { Word } from "./types";

export interface VoicedSentence {
  start: number;
  end: number;
  words: Word[];
}

export interface VoiceResult {
  audioPath: string;
  duration: number;
  sentences: VoicedSentence[];
}

/** Syntezuje jedno zdanie do pliku audio. Podmieniane na syntezę z API bez zmian w reszcie kodu. */
export type Synthesize = (text: string, outPath: string) => Promise<void>;

/** Zapasowy lektor: systemowy polski głos macOS. */
export const saySynthesize: Synthesize = async (text, outPath) => {
  await run("say", ["-v", "Zosia", "-r", "195", "-o", outPath, "--data-format=LEI16@44100", text]);
};

/** Fallback voice on Linux: Polish espeak-ng voice. Writes 22.05 kHz WAV; voiceSentences resamples it. */
export const espeakSynthesize: Synthesize = async (text, outPath) => {
  await run("espeak-ng", ["-v", "pl", "-s", "175", "-w", outPath, text]);
};

/** System voice for the current platform: `say` on macOS, espeak-ng elsewhere. */
export const systemSynthesize: Synthesize = process.platform === "darwin" ? saySynthesize : espeakSynthesize;

/** Rozkłada czas zdania na słowa proporcjonalnie do ich długości, z pauzą po znakach przestankowych. */
function estimateWords(text: string, start: number, end: number): Word[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const weights = tokens.map((w) => w.replace(/[^\p{L}\p{N}]/gu, "").length + 1.5 + (/[.,!?;:…]$/.test(w) ? 2 : 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  let t = start;
  return tokens.map((w, i) => {
    const t0 = t;
    t += ((end - start) * weights[i]) / sum;
    return { w, t0: Number(t0.toFixed(3)), t1: Number(t.toFixed(3)) };
  });
}

const GAP = 0.14;

/**
 * Nagrywa lektora zdanie po zdaniu. Dzięki temu granice scen są dokładne,
 * a czasy słów wewnątrz zdania wystarczy oszacować.
 */
export async function voiceSentences(texts: string[], workDir: string, synthesize: Synthesize = systemSynthesize, ext = "wav", pauses: number[] = []): Promise<VoiceResult> {
  await mkdir(workDir, { recursive: true });
  const sentences: VoicedSentence[] = [];
  const parts: string[] = [];
  let t = 0;
  for (let i = 0; i < texts.length; i++) {
    const part = path.join(workDir, `line_${i}.${ext}`);
    await synthesize(texts[i], part);
    const d = await probeDuration(part);
    parts.push(part);
    // Dodatkowa cisza po zdaniu, np. na odliczanie przed odpowiedzią.
    const end = t + d + GAP + (pauses[i] ?? 0);
    sentences.push({ start: Number(t.toFixed(3)), end: Number(end.toFixed(3)), words: estimateWords(texts[i], t, t + d) });
    t = end;
  }
  const audioPath = path.join(workDir, "voice.m4a");
  const inputs = parts.flatMap((p) => ["-i", p]);
  const chain = parts.map((_, i) => `[${i}:a]aresample=44100,aformat=channel_layouts=mono,apad=pad_dur=${(GAP + (pauses[i] ?? 0)).toFixed(3)}[a${i}]`).join(";");
  const concat = `${parts.map((_, i) => `[a${i}]`).join("")}concat=n=${parts.length}:v=0:a=1,loudnorm=I=-15:TP=-1.5[out]`;
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...inputs, "-filter_complex", `${chain};${concat}`, "-map", "[out]", "-c:a", "aac", "-b:a", "160k", audioPath]);
  await writeFile(path.join(workDir, "voice.json"), JSON.stringify(sentences, null, 2));
  return { audioPath, duration: Number(t.toFixed(3)), sentences };
}
