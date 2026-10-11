import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { COUNTDOWN_SECONDS, Manifest, Storyboard, StyleId, renderStoryboard, voiceSentences } from "@kronika/render";
import { ArchiveService } from "./archive.service";
import { KnowledgeService } from "./knowledge.service";
import { MaterialsService } from "./materials.service";
import { ROOT } from "./paths";
import { ScriptService } from "./script.service";
import { DraftSentence, Verdict, VerifyService } from "./verify.service";

export interface RenderRequest {
  topic: string;
  style: StyleId;
  scenes: DraftSentence[];
}

export interface Job {
  id: string;
  status: "running" | "done" | "error";
  stage: "archiwum" | "scenariusz" | "weryfikacja" | "lektor" | "napisy" | "montaż" | "gotowe";
  stages: string[];
  progress: number;
  cached: boolean;
  seconds?: number;
  error?: string;
  video_url?: string;
  storyboard?: Storyboard;
  /** Co system zrobił sam w trybie automatycznym: skąd wziął materiały i tekst, co odrzucił. */
  report?: { materials: string; script: string; hook_type: string | null; trend: string | null; angle: string | null; format: string | null; text_source: string | null; scenes: Verdict[]; rejected: Verdict[] };
}

/** Zadania w tle w procesie API; przy skali ich miejsce zajmuje kolejka i osobne procesy robocze. */
@Injectable()
export class JobsService {
  private readonly jobs = new Map<string, Job>();
  private readonly manifest: Manifest = JSON.parse(readFileSync(path.join(ROOT, "assets/manifest.json"), "utf8"));

  constructor(
    private readonly archive: ArchiveService,
    private readonly materials: MaterialsService,
    private readonly scriptService: ScriptService,
    private readonly verifyService: VerifyService,
    private readonly knowledge: KnowledgeService,
  ) {}

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /** Montaż gotowego, zweryfikowanego scenariusza. */
  start(request: RenderRequest): Job {
    const job = this.create(["lektor", "napisy", "montaż"]);
    this.run(job, () => this.produce(job, request, 0));
    return job;
  }

  /** Tryb automatyczny: od samego tematu do gotowego filmu, bez udziału człowieka. */
  startAuto(topic: string, style: StyleId, format?: string): Job {
    const job = this.create(["archiwum", "scenariusz", "weryfikacja", "lektor", "napisy", "montaż"]);
    this.run(job, async () => {
      const found = await this.materials.find(topic);
      if (found.objects.length < 3) throw new Error("W archiwum jest za mało obiektów pasujących do tego tematu.");

      job.stage = "scenariusz";
      job.progress = 0.08;
      const draft = await this.scriptService.draft(topic, found.objects.slice(0, 8).map((o) => o.id), style, format);

      job.stage = "weryfikacja";
      job.progress = 0.25;
      const verdicts = this.verifyService.verify(draft.sentences);
      const scenes = verdicts.filter((v) => v.ok);
      job.report = { materials: found.origin, script: draft.origin, hook_type: draft.hook_type ?? null, trend: draft.trend ?? null, angle: draft.angle ?? null, format: draft.format ?? null,
        text_source: draft.text_source ? `${draft.text_source.source}, „${draft.text_source.title}”` : null, scenes, rejected: verdicts.filter((v) => !v.ok) };
      if (scenes.filter((s) => s.kind === "fact").length < 2) {
        throw new Error("Po weryfikacji zostało za mało zdań, żeby zmontować film.");
      }
      await this.produce(job, { topic, style, scenes }, 0.3);
    });
    return job;
  }

  private create(stages: string[]): Job {
    const job: Job = { id: randomUUID().slice(0, 12), status: "running", stage: stages[0] as Job["stage"], stages, progress: 0.02, cached: false };
    this.jobs.set(job.id, job);
    return job;
  }

  private run(job: Job, work: () => Promise<void>) {
    const started = Date.now();
    work()
      .then(() => {
        job.seconds = Number(((Date.now() - started) / 1000).toFixed(1));
        job.stage = "gotowe";
        job.progress = 1;
        job.status = "done";
      })
      .catch((err) => {
        job.status = "error";
        job.error = String(err?.message ?? err).slice(0, 600);
      });
  }

  private async produce(job: Job, request: RenderRequest, from: number) {
    const at = (fraction: number) => from + (1 - from) * fraction;
    const scenes = request.scenes.map(({ text, source_quote, asset_id, sticker, countdown, hide_chip }) => ({
      text, source_quote, asset_id, sticker: sticker ?? undefined, countdown: countdown || undefined, hide_chip: hide_chip || undefined,
    }));
    // Ten sam scenariusz w tym samym stylu nigdy nie jest liczony drugi raz.
    // Szablon stylu wchodzi do klucza, więc zmiana wyglądu unieważnia stare filmy.
    const key = createHash("sha1").update(JSON.stringify([request.style, this.manifest.styles[request.style], scenes])).digest("hex").slice(0, 12);
    const dir = path.join(ROOT, "out/jobs", key);
    job.video_url = undefined;

    if (existsSync(path.join(dir, "video.mp4")) && existsSync(path.join(dir, "storyboard.json"))) {
      job.cached = true;
      job.storyboard = JSON.parse(readFileSync(path.join(dir, "storyboard.json"), "utf8"));
      job.video_url = `/files/out/jobs/${key}/video.mp4`;
      return;
    }

    job.stage = "lektor";
    job.progress = at(0.02);
    await mkdir(dir, { recursive: true });
    const voice = await voiceSentences(scenes.map((s) => s.text), path.join(dir, "voice"), undefined, "wav", scenes.map((s) => (s.countdown ? COUNTDOWN_SECONDS : 0)));
    await copyFile(voice.audioPath, path.join(dir, "voice.m4a"));

    job.stage = "napisy";
    job.progress = at(0.3);
    const storyboard: Storyboard = {
      id: key,
      topic: request.topic,
      style: request.style,
      audio_url: `/files/out/jobs/${key}/voice.m4a`,
      duration: voice.duration,
      scenes: scenes.map((s, i) => ({ ...s, ...voice.sentences[i] })),
      text_sources: [...new Set(request.scenes.map((s) => s.doc_id).filter((id): id is string => !!id))]
        .map((id) => this.knowledge.get(id))
        .filter((doc) => !!doc)
        .map((doc) => ({ title: doc!.title, source: doc!.source, license: doc!.license, url: doc!.url })),
      credits: [...new Set(scenes.map((s) => s.asset_id))].map((assetId) => {
        const o = this.archive.get(assetId);
        if (!o) throw new Error(`Nieznany obiekt ${assetId}`);
        return { asset_id: o.id, title: o.title, date: o.date, author: o.author, source: o.source, license: o.license, url: o.url, file: o.file };
      }),
    };

    job.stage = "montaż";
    // Render do pliku tymczasowego, żeby przerwane zadanie nie zostawiło w pamięci podręcznej urwanego filmu.
    const tmp = path.join(dir, "render", "video.mp4");
    await renderStoryboard(storyboard, this.manifest, {
      root: ROOT,
      audioPath: voice.audioPath,
      outPath: tmp,
      workDir: path.join(dir, "render"),
      onProgress: (fraction) => (job.progress = at(0.35 + 0.65 * fraction)),
    });
    await writeFile(path.join(dir, "storyboard.json"), JSON.stringify(storyboard, null, 2));
    await copyFile(tmp, path.join(dir, "video.mp4"));
    job.storyboard = storyboard;
    job.video_url = `/files/out/jobs/${key}/video.mp4`;
  }
}
