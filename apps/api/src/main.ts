import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { NestExpressApplication } from "@nestjs/platform-express";
import dns from "node:dns";
import net from "node:net";
import path from "node:path";
import { Agent, setGlobalDispatcher } from "undici";
import { AppModule } from "./app.module";
import { ROOT } from "./paths";

// Domyślne 250 ms na próbę połączenia zrywa zapytania do archiwum przy wolnym IPv6.
dns.setDefaultResultOrder("ipv4first");
net.setDefaultAutoSelectFamilyAttemptTimeout(2000);
// Na wolnym łączu samo zestawienie połączenia trwa kilka sekund; domyślne 10 s to za mało.
setGlobalDispatcher(new Agent({ connect: { timeout: 30000 } }));

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: true });
  app.useStaticAssets(path.join(ROOT, "assets/archive"), { prefix: "/files/archive" });
  app.useStaticAssets(path.join(ROOT, "out"), { prefix: "/files/out" });
  await app.listen(Number(process.env.PORT ?? 4000));
}

bootstrap();
