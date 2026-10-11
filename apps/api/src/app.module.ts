import { Module } from "@nestjs/common";
import { AppController } from "./app.controller";
import { ArchiveService } from "./archive.service";
import { CommonsService } from "./commons.service";
import { JobsService } from "./jobs.service";
import { KnowledgeService } from "./knowledge.service";
import { MaterialsService } from "./materials.service";
import { ScriptService } from "./script.service";
import { SearchService } from "./search.service";
import { TrendsService } from "./trends.service";
import { VerifyService } from "./verify.service";
import { WriterService } from "./writer.service";

@Module({
  controllers: [AppController],
  providers: [ArchiveService, KnowledgeService, TrendsService, CommonsService, WriterService, SearchService, MaterialsService, ScriptService, VerifyService, JobsService],
})
export class AppModule {}
