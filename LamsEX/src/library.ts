// Entity model library: a folder (config.txt "entity_library") of .bbmodel / .geo.json files,
// e.g. exported from Blockbench's built-in vanilla entity models.
//
// Matching is by name: a texture or a code-drawn model called "zombie" finds zombie.bbmodel
// (or zombie.geo.json). For anything else, an optional "lamsex-library.txt" in the folder lists
// what each model file goes with, one pairing per line:
//
//   zombie.bbmodel = entity/zombie/zombie, entity/zombie/husk
//   chest.bbmodel = entity/chest/normal, block/chest, item/chest
//   bed.bbmodel = entity/bed/red, block/red_bed, item/red_bed
//
// Ids starting with block/ or item/ are models; anything else is a texture (under textures/).
// When a model id matches, the first texture on its line is used for it.

import { platform, joinPath, baseName, toSlash } from "./platform";
import { normId, parseId } from "./resources";

export const LIBRARY_MAP_FILE = "lamsex-library.txt";

export interface LibraryMatch {
  file: string;
  /** Texture id to show the model with; null = the model's own texture. */
  textureId: string | null;
}

interface Line { file: string; textures: string[]; models: string[] }

const isModelFile = (f: string) => /\.(bbmodel|geo\.json)$/i.test(f);
const stem = (f: string) => baseName(f).replace(/\.(bbmodel|geo\.json)$/i, "").toLowerCase();

export class EntityLibrary {
  constructor(readonly dir: string | null) {}

  get mapFile() { return this.dir ? joinPath(this.dir, LIBRARY_MAP_FILE) : null; }

  private async load(): Promise<{ files: string[]; lines: Line[]; errors: string[] }> {
    if (!this.dir || (await platform.pathKind(this.dir)) !== "dir") return { files: [], lines: [], errors: [] };
    const files = (await platform.listFiles(this.dir)).filter(isModelFile).map((f) => joinPath(this.dir!, f));
    const lines: Line[] = [];
    const errors: string[] = [];
    const map = this.mapFile!;
    if ((await platform.pathKind(map)) === "file") {
      const text = new TextDecoder().decode(await platform.readFile(map));
      text.split(/\r?\n/).forEach((raw, i) => {
        const line = raw.trim();
        if (!line || line.startsWith("#")) return;
        const eq = line.indexOf("=");
        if (eq < 0) { errors.push(`${LIBRARY_MAP_FILE} line ${i + 1}: expected "model file = ids"`); return; }
        const file = line.slice(0, eq).trim();
        const full = files.find((f) => toSlash(f).toLowerCase().endsWith("/" + toSlash(file).toLowerCase()));
        if (!full) { errors.push(`${LIBRARY_MAP_FILE} line ${i + 1}: no model file "${file}" in the library`); return; }
        const ids = line.slice(eq + 1).split(",").map((s) => s.trim()).filter(Boolean).map(normId);
        const isModelId = (id: string) => /^(block|item)\//.test(parseId(id).path);
        lines.push({ file: full, textures: ids.filter((id) => !isModelId(id)), models: ids.filter(isModelId) });
      });
    }
    return { files, lines, errors };
  }

  /** Model for a texture id like "minecraft:entity/zombie/zombie". */
  async findForTexture(texId: string): Promise<{ match: LibraryMatch | null; errors: string[] }> {
    const { files, lines, errors } = await this.load();
    const id = normId(texId);
    const line = lines.find((l) => l.textures.includes(id));
    if (line) return { match: { file: line.file, textureId: id }, errors };
    const name = parseId(id).path.split("/").pop()!.toLowerCase();
    const file = files.find((f) => stem(f) === name);
    return { match: file ? { file, textureId: id } : null, errors };
  }

  /** Model for a code-drawn block or item model id like "minecraft:block/chest". */
  async findForModel(modelId: string): Promise<{ match: LibraryMatch | null; errors: string[] }> {
    const { files, lines, errors } = await this.load();
    const id = normId(modelId);
    const line = lines.find((l) => l.models.includes(id));
    if (line) return { match: { file: line.file, textureId: line.textures[0] ?? null }, errors };
    const name = parseId(id).path.split("/").pop()!.toLowerCase();
    const file = files.find((f) => stem(f) === name);
    return { match: file ? { file, textureId: null } : null, errors };
  }
}
