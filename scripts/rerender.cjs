// Renderuje ponownie zapisany storyboard: node scripts/rerender.cjs <katalog zadania> [styl]
const fs = require("node:fs");
const path = require("node:path");
const { renderStoryboard } = require("../packages/render/dist");

const root = path.resolve(__dirname, "..");
const dir = path.resolve(process.argv[2]);
const sb = JSON.parse(fs.readFileSync(path.join(dir, "storyboard.json"), "utf8"));
if (process.argv[3]) sb.style = process.argv[3];
const manifest = JSON.parse(fs.readFileSync(path.join(root, "assets/manifest.json"), "utf8"));
const started = Date.now();
renderStoryboard(sb, manifest, {
  root,
  audioPath: path.join(dir, "voice.m4a"),
  outPath: path.join(dir, `rerender.${sb.style}.mp4`),
  workDir: path.join(dir, `rerender-${sb.style}`),
}).then((out) => console.log(out, `${((Date.now() - started) / 1000).toFixed(1)} s`), (err) => { console.error(String(err).slice(0, 3000)); process.exit(1); });
