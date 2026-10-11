import { Injectable } from "@nestjs/common";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./paths";

export interface ArchiveObject {
  id: string;
  topic: string;
  title: string;
  description: string;
  date: string;
  author: string;
  source: string;
  license: string;
  url: string;
  file: string;
}

const SEED = path.join(ROOT, "data/objects.json");
const LIVE = path.join(ROOT, "data/objects.live.json");

@Injectable()
export class ArchiveService {
  /** Obiekty zebrane ręcznie oraz te pobrane z archiwum w trakcie działania. */
  readonly objects: ArchiveObject[] = [
    ...JSON.parse(readFileSync(SEED, "utf8")),
    ...(existsSync(LIVE) ? JSON.parse(readFileSync(LIVE, "utf8")) : []),
  ];
  private readonly seedCount: number = JSON.parse(readFileSync(SEED, "utf8")).length;

  get(id: string): ArchiveObject | undefined {
    return this.objects.find((o) => o.id === id);
  }

  add(found: ArchiveObject[]): void {
    const fresh = found.filter((o) => !this.get(o.id));
    if (!fresh.length) return;
    this.objects.push(...fresh);
    writeFileSync(LIVE, JSON.stringify(this.objects.slice(this.seedCount), null, 2));
  }

  /** Cały tekst, na który scenariusz może się powołać przy danym obiekcie. */
  evidence(o: ArchiveObject): string {
    return [o.description, o.title, o.date, o.author].join(" ");
  }
}
