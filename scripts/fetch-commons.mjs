// Pobiera obiekty z Wikimedia Commons (zdjęcie + opis + licencja) do assets/archive i data/objects.json.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UA = "Kronika916Demo/0.1 (hackathon demo)";
const strip = (html = "") =>
  html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();

const seeds = JSON.parse(await readFile(path.join(root, "data/seed-titles.json"), "utf8"));
await mkdir(path.join(root, "assets/archive"), { recursive: true });

const objects = [];
const LICENSES = { "Public domain": "domena publiczna" };
// Commons bywa podaje datę skanu zamiast daty zdjęcia, dlatego wpis może nadpisać datę ręcznie.
const cleanDate = (raw) => raw.replace(/date QS:.*$/, "").replace(/^(?:between|między) (\d{4}) (?:and|a) (\d{4})/, "$1–$2").replace(/^przed /, "przed ").trim();

for (const [topic, entries] of Object.entries(seeds)) {
  const overrides = Object.fromEntries(entries.filter((e) => typeof e !== "string").map((e) => [e.title, e]));
  const titles = entries.map((e) => (typeof e === "string" ? e : e.title));
  const params = new URLSearchParams({
    action: "query", format: "json", titles: titles.join("|"),
    prop: "imageinfo", iiprop: "url|size|extmetadata", iiurlwidth: "1600", iiextmetadatamultilang: "1",
  });
  const res = await fetch(`https://commons.wikimedia.org/w/api.php?${params}`, { headers: { "User-Agent": UA } });
  const body = await res.json();
  const pages = Object.values(body.query.pages);
  const normalized = Object.fromEntries((body.query.normalized ?? []).map((n) => [n.from, n.to]));
  for (const title of titles) {
    const page = pages.find((p) => p.title === (normalized[title] ?? title));
    if (!page?.imageinfo) { console.warn("brak:", title); continue; }
    const info = page.imageinfo[0];
    const meta = info.extmetadata;
    const multi = (key) => {
      const v = meta[key]?.value;
      if (!v) return "";
      if (typeof v === "string") return strip(v);
      return strip(v.pl ?? v.en ?? Object.values(v).find((x) => typeof x === "string") ?? "");
    };
    const id = `obj_${String(page.pageid)}`;
    const file = `assets/archive/${id}.jpg`;
    if (!existsSync(path.join(root, file))) {
      const img = await fetch(info.thumburl ?? info.url, { headers: { "User-Agent": UA } });
      if (!img.ok) { console.warn("pobieranie nieudane:", title, img.status); continue; }
      await writeFile(path.join(root, file), Buffer.from(await img.arrayBuffer()));
    }
    objects.push({
      id, topic,
      title: title.replace(/^File:/, "").replace(/\.[a-z]+$/i, ""),
      description: multi("ImageDescription"),
      date: overrides[title]?.date ?? cleanDate(multi("DateTimeOriginal")),
      author: multi("Artist").replace(/^(Unknown author ?)+$/, "autor nieznany"),
      credit: multi("Credit"),
      source: "Wikimedia Commons",
      license: LICENSES[multi("LicenseShortName")] ?? multi("LicenseShortName"),
      license_url: meta.LicenseUrl?.value ?? "",
      url: info.descriptionurl,
      file, width: info.thumbwidth ?? info.width, height: info.thumbheight ?? info.height,
    });
    console.log("ok:", id, title);
  }
}
await writeFile(path.join(root, "data/objects.json"), JSON.stringify(objects, null, 2));
console.log(`zapisano ${objects.length} obiektów`);
