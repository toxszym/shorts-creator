// Downloads the Piper TTS binary (Linux x86_64) and the Polish voice mc_speech into .cache/piper.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, ".cache/piper");
const BINARY_URL = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz";
const VOICE_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/pl/pl_PL/mc_speech/medium/pl_PL-mc_speech-medium";

if (process.platform !== "linux" || process.arch !== "x64") {
  throw new Error(`Piper is only set up for Linux x86_64 (this is ${process.platform}/${process.arch}); macOS uses its system voice.`);
}

/** Downloads to a temporary name first, so an interrupted download is not mistaken for a complete file. */
async function download(url, file) {
  if (existsSync(file)) return console.log("already there:", path.relative(root, file));
  console.log("downloading:", url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  await writeFile(`${file}.part`, Buffer.from(await res.arrayBuffer()));
  await rename(`${file}.part`, file);
}

await mkdir(path.join(dir, "voices"), { recursive: true });

if (!existsSync(path.join(dir, "piper/piper"))) {
  const archive = path.join(dir, "piper.tar.gz");
  await download(BINARY_URL, archive);
  execFileSync("tar", ["-xzf", archive, "-C", dir]);
  await rm(archive);
}
for (const ext of ["onnx", "onnx.json"]) {
  await download(`${VOICE_URL}.${ext}`, path.join(dir, `voices/pl_PL-mc_speech-medium.${ext}`));
}
console.log("Piper ready in", path.relative(root, dir));
