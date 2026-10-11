import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildAss, COUNTDOWN_SECONDS, stickerTime } from "./ass";
import { probeSize, run } from "./ffmpeg";
import type { Manifest, Scene, Storyboard } from "./types";

const W = 1080;
const H = 1920;
const FPS = 30;

export interface RenderOptions {
  /** Katalog projektu, względem którego podane są ścieżki assetów. */
  root: string;
  audioPath: string;
  outPath: string;
  workDir: string;
  onProgress?: (fraction: number) => void;
}

type ShotKind = "card" | "detail" | "punch";

interface Shot {
  kind: ShotKind;
  file: string;
  frames: number;
  /** Pierwsze ujęcie sceny dostaje błysk, żeby zmiana zdjęcia była wyraźna. */
  opensScene: boolean;
  side: number;
  /** Kolor błysku na wejściu sceny. */
  flash: string;
  /** Karta wjeżdża z boku: -1 z lewej, 1 z prawej, 0 stoi w miejscu. */
  slide: number;
}

/** Deterministyczne losowanie: ten sam storyboard zawsze daje ten sam film, a różne storyboardy różnią się wyglądem. */
function seeded(text: string): () => number {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

/** Dzieli scenę na ujęcia cięte na granicach słów, żeby montaż trzymał rytm lektora. */
function cutScene(scene: Scene, shotSeconds: number): number[] {
  const duration = scene.end - scene.start;
  const count = Math.max(1, Math.min(3, Math.round(duration / shotSeconds)));
  const cuts = [scene.start];
  for (let k = 1; k < count; k++) {
    const ideal = scene.start + (duration * k) / count;
    const nearest = scene.words.reduce((best, w) => (Math.abs(w.t0 - ideal) < Math.abs(best - ideal) ? w.t0 : best), ideal);
    if (nearest - cuts[cuts.length - 1] > 0.5 && scene.end - nearest > 0.5) cuts.push(nearest);
  }
  cuts.push(scene.end);
  return cuts;
}

const PATTERNS: Record<number, ShotKind[][]> = {
  1: [["card"], ["punch"], ["detail"]],
  2: [["card", "detail"], ["detail", "card"], ["punch", "card"]],
  3: [["card", "detail", "punch"], ["punch", "card", "detail"], ["detail", "card", "punch"]],
};

/** Zamienia storyboard i manifest w plik MP4. Nie wykonuje żadnych wywołań sieciowych. */
export async function renderStoryboard(sb: Storyboard, manifest: Manifest, opts: RenderOptions): Promise<string> {
  const base = manifest.styles[sb.style];
  const rand = seeded(sb.id);
  const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
  const accent = base.accents?.length ? pick(base.accents) : base.caption.highlight;
  const template = { ...base, caption: { ...base.caption, highlight: accent } };
  const split = template.layout === "split";
  const FH = split ? H / 2 : H;
  const mainEnd = sb.scenes[sb.scenes.length - 1].end;
  const total = mainEnd + manifest.endCardSeconds;

  await mkdir(opts.workDir, { recursive: true });
  await mkdir(path.dirname(opts.outPath), { recursive: true });
  await writeFile(path.join(opts.workDir, "captions.ass"), buildAss(sb, template, mainEnd, total));

  const shots: Shot[] = [];
  sb.scenes.forEach((scene, i) => {
    const credit = sb.credits.find((c) => c.asset_id === scene.asset_id);
    if (!credit) throw new Error(`Brak wpisu w credits dla ${scene.asset_id}`);
    const cuts = cutScene(scene, template.shotSeconds);
    // Hook otwiera film pełnym kadrem z mocnym przybliżeniem, reszta zaczyna od całego zdjęcia.
    const pattern = i === 0 ? (["punch", "card", "detail"] as ShotKind[]) : pick(PATTERNS[cuts.length - 1]);
    const flash = pick(["white", "white", `0x${accent}`, "black"]);
    for (let k = 0; k < cuts.length - 1; k++) {
      // Granice liczone w klatkach od zera, żeby zaokrąglenia nie rozjechały obrazu z lektorem.
      const frames = Math.round(cuts[k + 1] * FPS) - Math.round(cuts[k] * FPS);
      shots.push({
        kind: pattern[k], file: path.resolve(opts.root, credit.file), frames, opensScene: k === 0, side: (i + k) % 2,
        flash, slide: pick([0, 0, -1, 1]),
      });
    }
  });

  const args: string[] = ["-y", "-hide_banner", "-loglevel", "error", "-progress", "pipe:1"];
  const filters: string[] = [];

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const d = shot.frames / FPS;
    const p = `(t/${d.toFixed(3)})`;
    const flash = shot.opensScene ? `fade=t=in:st=0:d=0.1:color=${shot.flash},` : "";
    const tail = `setsar=1,format=yuv420p,${flash}trim=end_frame=${shot.frames},setpts=PTS-STARTPTS[s${i}]`;
    args.push("-loop", "1", "-framerate", String(FPS), "-t", (d + 0.1).toFixed(3), "-i", shot.file);

    if (shot.kind === "card") {
      // Całe zdjęcie jako karta na własnym rozmytym tle: widz widzi pełny kadr archiwalny.
      const { width, height } = await probeSize(shot.file);
      const border = Math.round(width * 0.012);
      const aspect = (width + 2 * border) / (height + 2 * border);
      const cardW = Math.round(Math.min(W - 80, FH * 0.6 * aspect));
      const zoom = `(0.93+0.09*${p})`;
      filters.push(
        `[${i}:v]split[bi${i}][fi${i}]`,
        `[bi${i}]scale=${W / 4}:${FH / 4}:force_original_aspect_ratio=increase,crop=${W / 4}:${FH / 4},boxblur=12:2,scale=${W}:${FH}:flags=bilinear,eq=brightness=-0.2:saturation=0.7[bg${i}]`,
        `[fi${i}]pad=iw+${2 * border}:ih+${2 * border}:${border}:${border}:color=white,scale=w='2*trunc(${cardW}*${zoom}/2)':h='2*trunc(${cardW}*${zoom}/${aspect.toFixed(4)}/2)':eval=frame:flags=bicubic[fg${i}]`,
        `[bg${i}][fg${i}]overlay=x='(W-w)/2+${shot.slide}*W*pow(1-min(t/0.22\\,1)\\,3)':y='(H-h)/2-${Math.round(FH * 0.06)}':eval=frame,${tail}`,
      );
      continue;
    }

    const zoom = shot.kind === "punch" ? `(1.0+0.28*(1-exp(-5*${p})))` : `(1.5+0.1*${p})`;
    const px = shot.kind === "punch" ? "0.5" : shot.side ? `(0.82-0.14*${p})` : `(0.18+0.14*${p})`;
    filters.push(
      `[${i}:v]scale=w='2*trunc(max(${W}\\,${FH}*a)*${zoom}/2)':h='2*trunc(max(${FH}\\,${W}/a)*${zoom}/2)':eval=frame:flags=bicubic,` +
        `crop=${W}:${FH}:'(in_w-${W})*${px}':'(in_h-${FH})*0.42',${tail}`,
    );
  }

  const look = template.look === "archival"
    ? "eq=contrast=1.1:brightness=-0.02:saturation=0.8,noise=alls=12:allf=t,vignette=PI/4.5"
    : "eq=contrast=1.14:saturation=1.1,unsharp=5:5:0.7,vignette=PI/6";
  let next = shots.length;
  const voiceIndex = next++;
  args.push("-i", opts.audioPath);
  const jolts: number[] = [];
  sb.scenes.forEach((scene, i) => {
    const year = scene.words.find((w) => /^\d{4}\D*$/.test(w.w));
    if (template.yearStamp && year && !scene.hide_chip) jolts.push(year.t0);
    if (scene.sticker) jolts.push(stickerTime(scene));
    if (i > 0 && sb.scenes[i - 1].countdown) jolts.push(scene.start);
  });
  const active = jolts.map((t) => `between(t\\,${t.toFixed(2)}\\,${(t + 0.26).toFixed(2)})`).join("+");
  const shake = template.shake && jolts.length
    ? `,crop=${W - 48}:${FH - 48}:'24+22*sin(95*t)*(${active})':'24+22*cos(83*t)*(${active})',scale=${W}:${FH}:flags=bilinear,setsar=1`
    : "";
  filters.push(`${shots.map((_, i) => `[s${i}]`).join("")}concat=n=${shots.length}:v=1:a=0,${look}${shake}[top]`);

  if (split) {
    if (!template.background) throw new Error(`Styl ${sb.style} wymaga tła w manifeście`);
    const bgIndex = next++;
    args.push("-stream_loop", "-1", "-i", path.resolve(opts.root, template.background));
    filters.push(
      `[${bgIndex}:v]fps=${FPS},scale=${W}:${FH}:force_original_aspect_ratio=increase,crop=${W}:${FH},setsar=1,format=yuv420p,trim=duration=${mainEnd.toFixed(3)},setpts=PTS-STARTPTS[bg]`,
      `[top][bg]vstack=inputs=2,drawbox=x=0:y=${FH - 4}:w=${W}:h=8:color=black:t=fill[main]`,
    );
  } else {
    filters.push("[top]null[main]");
  }

  filters.push(
    `color=c=0x101014:s=${W}x${H}:r=${FPS}:d=${manifest.endCardSeconds},format=yuv420p[end]`,
    `[main][end]concat=n=2:v=1:a=0[joined]`,
    // Pasek postępu u góry kadru.
    `color=c=0x${template.caption.highlight}:s=${W}x10:r=${FPS}:d=${total.toFixed(3)}[bar]`,
    `[joined][bar]overlay=x='-W+W*t/${mainEnd.toFixed(3)}':y=0:shortest=1,ass=captions.ass[v]`,
  );

  const mix = ["[voice]"];
  filters.push(`[${voiceIndex}:a]apad=whole_dur=${total.toFixed(3)}[voice]`);

  const music = Array.isArray(template.music) ? pick(template.music) : template.music;
  if (music) {
    const musicIndex = next++;
    args.push("-stream_loop", "-1", "-i", path.resolve(opts.root, music));
    filters.push(
      `[${musicIndex}:a]atrim=0:${total.toFixed(3)},volume=${template.musicVolume ?? 0.15},afade=t=out:st=${(total - 1.5).toFixed(3)}:d=1.5[music]`,
    );
    mix.push("[music]");
  }

  if (template.sfx) {
    // Każdy efekt to jeden plik rozdzielony na tyle kopii, ile razy pada w filmie.
    const events: Record<string, number[]> = {};
    const add = (file: string | undefined, t: number) => file && (events[file] ??= []).push(t);
    sb.scenes.forEach((scene, i) => {
      if (i > 0) add(template.sfx!.cut, scene.start);
      const year = scene.words.find((w) => /^\d{4}\D*$/.test(w.w));
      if (template.yearStamp && year && !scene.hide_chip) add(template.sfx!.stamp, year.t0);
      if (scene.sticker) add(template.sfx!.sticker, stickerTime(scene));
      if (scene.countdown) [0, 0.5, 1].forEach((k) => add(template.sfx!.sticker, scene.end - COUNTDOWN_SECONDS + 0.1 + k));
      if (i > 0 && sb.scenes[i - 1].countdown) add(template.sfx!.stamp, scene.start);
    });
    add(template.sfx.stamp, 0);
    Object.entries(events).forEach(([file, times], f) => {
      const index = next++;
      args.push("-i", path.resolve(opts.root, file));
      filters.push(`[${index}:a]asplit=${times.length}${times.map((_, k) => `[fx${f}_${k}]`).join("")}`);
      times.forEach((t, k) => {
        filters.push(`[fx${f}_${k}]adelay=${Math.round(t * 1000)}:all=1,volume=${template.sfx!.volume}[fxd${f}_${k}]`);
        mix.push(`[fxd${f}_${k}]`);
      });
    });
  }

  filters.push(mix.length > 1 ? `${mix.join("")}amix=inputs=${mix.length}:duration=first:normalize=0,alimiter=limit=0.95[a]` : "[voice]anull[a]");

  args.push(
    "-filter_complex", filters.join(";"),
    "-map", "[v]", "-map", "[a]",
    "-t", total.toFixed(3), "-r", String(FPS),
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-maxrate", "8M", "-bufsize", "16M", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart",
    path.resolve(opts.outPath),
  );

  await run("ffmpeg", args, {
    cwd: opts.workDir,
    onStdout: (chunk) => {
      const match = /out_time_ms=(\d+)/.exec(chunk);
      if (match) opts.onProgress?.(Math.min(1, Number(match[1]) / 1e6 / total));
    },
  });
  return opts.outPath;
}
