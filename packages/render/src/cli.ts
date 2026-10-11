// Buduje przykładowy film: skrypt → lektor → storyboard → MP4 w wybranych stylach.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { renderStoryboard } from "./render";
import type { Credit, Manifest, Storyboard, StyleId } from "./types";
import { voiceSentences } from "./voice";

async function main() {
  const root = path.resolve(__dirname, "../../..");
  const scriptPath = path.resolve(root, process.argv[2] ?? "samples/gdynia.script.json");
  const styles = (process.argv[3] ?? "brainrot,kronika").split(",") as StyleId[];
  const script = JSON.parse(await readFile(scriptPath, "utf8"));
  const objects = JSON.parse(await readFile(path.join(root, "data/objects.json"), "utf8"));
  const manifest: Manifest = JSON.parse(await readFile(path.join(root, "assets/manifest.json"), "utf8"));

  const work = path.join(root, "out", script.id);
  const voice = await voiceSentences(script.scenes.map((s: { text: string }) => s.text), path.join(work, "voice"));
  const credits: Credit[] = objects
    .filter((o: { id: string }) => script.scenes.some((s: { asset_id: string }) => s.asset_id === o.id))
    .map((o: any) => ({ asset_id: o.id, title: o.title, date: o.date, source: o.source, license: o.license, url: o.url, file: o.file }));

  for (const style of styles) {
    const sb: Storyboard = {
      id: script.id,
      topic: script.topic,
      style,
      audio_url: `/files/${script.id}/voice.m4a`,
      duration: voice.duration,
      scenes: script.scenes.map((s: any, i: number) => ({ ...s, ...voice.sentences[i] })),
      credits,
      rejected: script.rejected,
    };
    await writeFile(path.join(work, `storyboard.${style}.json`), JSON.stringify(sb, null, 2));
    const started = Date.now();
    const out = await renderStoryboard(sb, manifest, {
      root,
      audioPath: voice.audioPath,
      outPath: path.join(work, `${script.id}.${style}.mp4`),
      workDir: path.join(work, `render-${style}`),
    });
    console.log(`${style}: ${out} (${sb.duration.toFixed(1)} s lektora, render ${((Date.now() - started) / 1000).toFixed(1)} s)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
