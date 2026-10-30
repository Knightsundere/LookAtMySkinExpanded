// Resource folders: each holds an "assets" folder (extracted .jar, unzipped pack or mod),
// or is a .jar/.zip read directly. First source with a matching file wins.

import { unzipSync, strFromU8 } from "fflate";
import { platform, joinPath, toSlash } from "./platform";

export interface Found {
  bytes: Uint8Array;
  /** Real file path when the file is on disk (watchable), null inside a .jar/.zip. */
  realPath: string | null;
  display: string;
}

interface Source {
  root: string;
  read(rel: string): Promise<Found | null>;
  readAllModels(): Promise<[string, string][]>;
}

function dirSource(root: string): Source {
  return {
    root,
    async read(rel) {
      const p = joinPath(root, rel);
      if ((await platform.pathKind(p)) !== "file") return null;
      return { bytes: await platform.readFile(p), realPath: p, display: p };
    },
    readAllModels: () => platform.readAllModels(root),
  };
}

function zipSource(root: string): Source {
  let data: Promise<Uint8Array> | null = null;
  let names: Promise<Set<string>> | null = null;
  const bytes = () => (data ??= platform.readFile(root));
  const nameSet = () =>
    (names ??= bytes().then((b) => {
      const s = new Set<string>();
      unzipSync(b, { filter: (f) => { s.add(f.name); return false; } });
      return s;
    }));
  return {
    root,
    async read(rel) {
      if (!(await nameSet()).has(rel)) return null;
      const out = unzipSync(await bytes(), { filter: (f) => f.name === rel });
      return out[rel] ? { bytes: out[rel], realPath: null, display: `${root}!/${rel}` } : null;
    },
    async readAllModels() {
      const out = unzipSync(await bytes(), { filter: (f) => /^assets\/[^/]+\/models\/.+\.json$/.test(f.name) });
      return Object.entries(out).map(([k, v]) => [k, strFromU8(v)] as [string, string]);
    },
  };
}

/** "minecraft:block/stone", "block/stone" -> { ns: "minecraft", path: "block/stone" } */
export function parseId(id: string): { ns: string; path: string } {
  const i = id.indexOf(":");
  return i < 0 ? { ns: "minecraft", path: id } : { ns: id.slice(0, i), path: id.slice(i + 1) };
}
export const normId = (id: string) => { const { ns, path } = parseId(id); return `${ns}:${path}`; };

/** If `file` sits at <root>/assets/<ns>/<kind>/<sub>.<ext>, returns the pieces. */
export function locateInAssets(file: string, kind: "textures" | "models" | "geo") {
  const s = toSlash(file);
  const m = /^(.*)\/assets\/([^/]+)\/([^/]+)\/(.+)\.[^./]+$/i.exec(s);
  if (!m || m[3].toLowerCase() !== kind) return null;
  return { root: m[1], ns: m[2], sub: m[4], id: `${m[2]}:${m[4]}` };
}

export class Resources {
  private sources: Source[] = [];
  private indexCache = new Map<string, Promise<ModelIndex>>();

  constructor(private configured: string[]) {}

  get hasConfigured() { return this.configured.length > 0; }
  /** True when the last prepare() found at least one usable resource folder. */
  get hasSources() { return this.sources.length > 0; }

  /** Use `extraRoot` (the resource folder the opened file lives in) ahead of the configured ones. */
  async prepare(extraRoot: string | null) {
    const roots = [...(extraRoot ? [extraRoot] : []), ...this.configured];
    const seen = new Set<string>();
    const list: Source[] = [];
    for (const r of roots) {
      const key = toSlash(r).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const existing = this.sources.find((s) => toSlash(s.root).toLowerCase() === key);
      if (existing) { list.push(existing); continue; }
      const kind = await platform.pathKind(r);
      if (kind === "dir") list.push(dirSource(r));
      else if (kind === "file" && /\.(jar|zip)$/i.test(r)) list.push(zipSource(r));
    }
    this.sources = list;
  }

  async read(rel: string): Promise<Found | null> {
    for (const s of this.sources) {
      const f = await s.read(rel);
      if (f) return f;
    }
    return null;
  }

  readModelJson(id: string) {
    const { ns, path } = parseId(id);
    return this.read(`assets/${ns}/models/${path}.json`);
  }
  readTexture(id: string) {
    const { ns, path } = parseId(id);
    return this.read(`assets/${ns}/textures/${path}.png`);
  }
  readMcmeta(id: string) {
    const { ns, path } = parseId(id);
    return this.read(`assets/${ns}/textures/${path}.png.mcmeta`);
  }

  /** Models (across the current sources) that end up using texture `texId`. */
  async modelsUsingTexture(texId: string, preferRoot: string | null): Promise<string[]> {
    const key = this.sources.map((s) => s.root).join("|");
    let idx = this.indexCache.get(key);
    if (!idx) { idx = buildIndex(this.sources); this.indexCache.set(key, idx); }
    const index = await idx;
    const users = index.users.get(normId(texId)) ?? [];
    const pref = preferRoot ? toSlash(preferRoot).toLowerCase() : null;
    return [...users].sort((a, b) => {
      const pa = pref && index.origin.get(a) === pref ? 0 : 1;
      const pb = pref && index.origin.get(b) === pref ? 0 : 1;
      return pa - pb;
    });
  }
}

interface ModelIndex {
  users: Map<string, string[]>; // texture id -> model ids
  origin: Map<string, string>; // model id -> source root (lowercased)
}

async function buildIndex(sources: Source[]): Promise<ModelIndex> {
  const models = new Map<string, { parent?: string; textures?: Record<string, string> }>();
  const origin = new Map<string, string>();
  for (const s of sources) {
    let all: [string, string][] = [];
    try { all = await s.readAllModels(); } catch { continue; }
    for (const [rel, text] of all) {
      const m = /^assets\/([^/]+)\/models\/(.+)\.json$/.exec(rel);
      if (!m) continue;
      const id = `${m[1]}:${m[2]}`;
      if (models.has(id)) continue;
      try {
        const j = JSON.parse(text);
        models.set(id, { parent: j.parent, textures: j.textures });
        origin.set(id, toSlash(s.root).toLowerCase());
      } catch { /* broken json: skip */ }
    }
  }
  const resolved = new Map<string, Record<string, string>>();
  const texturesOf = (id: string, depth = 0): Record<string, string> => {
    const hit = resolved.get(id);
    if (hit) return hit;
    const m = models.get(id);
    if (!m || depth > 32) return {};
    const parent = m.parent && !m.parent.startsWith("builtin/") ? texturesOf(normId(m.parent), depth + 1) : {};
    const out = { ...parent, ...(m.textures ?? {}) };
    resolved.set(id, out);
    return out;
  };
  const users = new Map<string, string[]>();
  for (const id of models.keys()) {
    const tex = texturesOf(id);
    const seen = new Set<string>();
    for (const v of Object.values(tex)) {
      if (typeof v !== "string" || v.startsWith("#")) continue;
      const t = normId(v);
      if (seen.has(t)) continue;
      seen.add(t);
      const list = users.get(t) ?? [];
      list.push(id);
      users.set(t, list);
    }
  }
  return { users, origin };
}
