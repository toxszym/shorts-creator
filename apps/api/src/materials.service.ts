import { Injectable } from "@nestjs/common";
import { ArchiveService } from "./archive.service";
import { CommonsService } from "./commons.service";
import { SearchHit, SearchService } from "./search.service";

export interface Materials {
  origin: string;
  objects: SearchHit[];
}

/** Dobiera obiekty do tematu: najpierw ze zbioru lokalnego, a gdy ten nie zna tematu, na żywo z archiwum. */
@Injectable()
export class MaterialsService {
  constructor(
    private readonly archive: ArchiveService,
    private readonly commons: CommonsService,
    private readonly searchService: SearchService,
  ) {}

  async find(topic: string): Promise<Materials> {
    const local = this.searchService.search(topic);
    // Zbiór lokalny wystarcza, gdy zna co najmniej cztery zdjęcia na ten temat.
    if (local.length >= 4) return { origin: "zbiór lokalny", objects: local };

    // Kolejność z archiwum zostaje: jego wyszukiwarka zna frazę lepiej niż nasze dopasowanie słów.
    const found = await this.commons.search(topic);
    this.archive.add(found);
    return {
      origin: found.some((o) => o.license.startsWith("CC BY"))
        ? "Wikimedia Commons na żywo, zdjęcia współczesne na wolnej licencji"
        : "Wikimedia Commons na żywo",
      objects: found.map((o) => ({ ...o, thumb: `/files/archive/${o.id}.jpg`, score: 0, headMatches: [] })),
    };
  }
}
