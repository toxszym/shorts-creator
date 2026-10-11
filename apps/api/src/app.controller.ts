import { BadRequestException, Body, Controller, Get, NotFoundException, Param, Post } from "@nestjs/common";
import type { StyleId } from "@kronika/render";
import { MaterialsService } from "./materials.service";
import { JobsService, RenderRequest } from "./jobs.service";
import { ScriptService } from "./script.service";
import { VerifyService } from "./verify.service";

const STYLES: StyleId[] = ["kronika", "storytime", "brainrot"];

@Controller()
export class AppController {
  constructor(
    private readonly materials: MaterialsService,
    private readonly scriptService: ScriptService,
    private readonly verifyService: VerifyService,
    private readonly jobsService: JobsService,
  ) {}

  @Post("search")
  search(@Body() body: { topic?: string }) {
    const topic = body.topic?.trim();
    if (!topic) throw new BadRequestException("Podaj temat");
    return this.materials.find(topic);
  }

  /** Tryb automatyczny: sam temat na wejściu, gotowy film na wyjściu. */
  @Post("auto")
  auto(@Body() body: { topic?: string; style?: StyleId; format?: string }) {
    const topic = body.topic?.trim();
    if (!topic) throw new BadRequestException("Podaj temat");
    if (!body.style || !STYLES.includes(body.style)) throw new BadRequestException("Nieznany styl");
    return this.jobsService.startAuto(topic, body.style, body.format);
  }

  @Post("script")
  async script(@Body() body: { topic?: string; asset_ids?: string[]; style?: StyleId; format?: string }) {
    if (!body.asset_ids?.length) throw new BadRequestException("Wybierz co najmniej jeden obiekt");
    if (!body.style || !STYLES.includes(body.style)) throw new BadRequestException("Nieznany styl");
    const draft = await this.scriptService.draft(body.topic ?? "", body.asset_ids, body.style, body.format);
    const verdicts = this.verifyService.verify(draft.sentences);
    return {
      origin: draft.origin,
      hook_type: draft.hook_type ?? null,
      trend: draft.trend ?? null,
      angle: draft.angle ?? null,
      format: draft.format ?? null,
      text_source: draft.text_source ?? null,
      scenes: verdicts.filter((v) => v.ok),
      rejected: verdicts.filter((v) => !v.ok),
    };
  }

  /** Ponowna weryfikacja po ręcznej edycji zdania. */
  @Post("verify")
  verify(@Body() body: { sentences?: Parameters<VerifyService["verify"]>[0] }) {
    return { verdicts: this.verifyService.verify(body.sentences ?? []) };
  }

  @Post("render")
  render(@Body() body: RenderRequest) {
    if (!body.scenes?.length) throw new BadRequestException("Scenariusz jest pusty");
    if (!STYLES.includes(body.style)) throw new BadRequestException("Nieznany styl");
    // Do montażu trafiają wyłącznie zdania, które przechodzą weryfikację.
    const failed = this.verifyService.verify(body.scenes).find((v) => !v.ok);
    if (failed) throw new BadRequestException(`Zdanie „${failed.text}” nie przechodzi weryfikacji: ${failed.reason}`);
    return this.jobsService.start(body);
  }

  @Get("jobs/:id")
  job(@Param("id") id: string) {
    const job = this.jobsService.get(id);
    if (!job) throw new NotFoundException("Nie ma takiego zadania");
    return job;
  }
}
