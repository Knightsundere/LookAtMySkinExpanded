// Minecraft JSON block/item models: parent chain, texture variables, elements,
// and "item/generated" sprites extruded one pixel deep.

import * as THREE from "three";
import { QuadBuilder, texturedMeshes, type V3, type UV } from "../geometry";
import { SceneTexture, missingTexture } from "../textures";
import { alphaAt } from "../png";
import { faceColor, type BuiltModel } from "./common";
import { normId, parseId } from "../resources";

export type Dir = "down" | "up" | "north" | "south" | "west" | "east";

interface ModelFace { uv?: [number, number, number, number]; texture?: string; rotation?: number; tintindex?: number }
interface ModelElement {
  from: V3; to: V3;
  rotation?: { origin: V3; axis: "x" | "y" | "z"; angle: number; rescale?: boolean };
  shade?: boolean;
  faces?: Partial<Record<Dir, ModelFace>>;
}
interface ModelJson {
  parent?: string;
  textures?: Record<string, string>;
  elements?: ModelElement[];
  display?: Record<string, { rotation?: V3 }>;
}

export interface ModelLoader {
  /** Find a parent model by id. Returns parsed JSON and the real file path when on disk. */
  loadParent(id: string, childFile: string | null): Promise<{ json: ModelJson; file: string | null } | null>;
  /** Load a texture by id; null if not found anywhere. */
  loadTexture(id: string, modelFile: string | null): Promise<{ texture: SceneTexture; file: string | null } | null>;
  hasResources: boolean;
}

export interface ResolvedModel {
  textures: Record<string, string>;
  elements: ModelElement[] | null;
  guiRotation: V3 | null;
  generated: boolean;
  builtinEntity: boolean;
  files: string[];
  warnings: string[];
}

const GENERATED = new Set(["builtin/generated", "minecraft:builtin/generated"]);
const GENERATED_FALLBACK = new Set(["minecraft:item/generated", "minecraft:item/handheld", "minecraft:item/handheld_rod"]);

export async function resolveModel(json: ModelJson, file: string | null, loader: ModelLoader): Promise<ResolvedModel> {
  const out: ResolvedModel = { textures: {}, elements: null, guiRotation: null, generated: false, builtinEntity: false, files: file ? [file] : [], warnings: [] };
  const chain: ModelJson[] = [json];
  let cur = json, curFile = file;
  let brokenChain = false;
  const visited = new Set<string>();
  for (let depth = 0; cur.parent && depth < 32; depth++) {
    const p = cur.parent;
    if (visited.has(normId(p))) { out.warnings.push(`Missing parent model: ${p}`); brokenChain = true; break; } // parent loop
    visited.add(normId(p));
    if (GENERATED.has(p)) { out.generated = true; break; }
    if (p === "builtin/entity" || p === "minecraft:builtin/entity") { out.builtinEntity = true; break; }
    const found = await loader.loadParent(normId(p), curFile);
    if (!found) {
      if (GENERATED_FALLBACK.has(normId(p))) { out.generated = true; break; }
      out.warnings.push(loader.hasResources ? `Missing parent model: ${p}` : "No resource folder set - add one in config.txt.");
      brokenChain = true;
      break;
    }
    if (found.file) out.files.push(found.file);
    chain.push(found.json);
    cur = found.json;
    curFile = found.file;
  }
  // Child values override parents: walk from the root parent down.
  for (const m of [...chain].reverse()) {
    Object.assign(out.textures, m.textures ?? {});
    if (m.elements) out.elements = m.elements;
    if (m.display?.gui?.rotation) out.guiRotation = m.display.gui.rotation;
  }
  if (out.elements) out.generated = false; // elements always win over the generated sprite
  // A block whose (usually vanilla) parent is missing would also lose block/block's inventory
  // angle; use that standard angle so what's there is still readable.
  if (brokenChain && out.elements && !out.guiRotation) out.guiRotation = [30, 225, 0];
  return out;
}

/** "#all" -> "minecraft:block/stone", following variables; null when unresolved. */
function resolveTextureVar(ref: string, vars: Record<string, string>): string | null {
  let r = ref;
  for (let i = 0; i < 16 && r.startsWith("#"); i++) r = vars[r.slice(1)] ?? "";
  if (!r || r.startsWith("#")) return null;
  return normId(r);
}

const BIOME_GRASS: V3 = hex("#91BD59");
const BIOME_FOLIAGE: V3 = hex("#77AB2F");
const FIXED_TINTS: Record<string, V3> = { birch_leaves: hex("#80A755"), spruce_leaves: hex("#619961") };
function tintFor(texId: string): V3 {
  const name = parseId(texId).path.split("/").pop() ?? "";
  if (FIXED_TINTS[name]) return FIXED_TINTS[name];
  return /leaves|vine/.test(name) ? BIOME_FOLIAGE : BIOME_GRASS;
}
function hex(h: string): V3 {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
}

export const SHADE: Record<Dir, number> = { up: 1, down: 0.5, north: 0.8, south: 0.8, west: 0.6, east: 0.6 };
export const NORMALS: Record<Dir, V3> = { up: [0, 1, 0], down: [0, -1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] };

function defaultUv(dir: Dir, f: V3, t: V3): [number, number, number, number] {
  switch (dir) {
    case "down": return [f[0], 16 - t[2], t[0], 16 - f[2]];
    case "up": return [f[0], f[2], t[0], t[2]];
    case "north": return [16 - t[0], 16 - t[1], 16 - f[0], 16 - f[1]];
    case "south": return [f[0], 16 - t[1], t[0], 16 - f[1]];
    case "west": return [f[2], 16 - t[1], t[2], 16 - f[1]];
    case "east": return [16 - t[2], 16 - t[1], 16 - f[2], 16 - f[1]];
  }
}

/** Face corners TL, TR, BR, BL as seen from outside the box. */
export function faceCorners(dir: Dir, f: V3, t: V3): V3[] {
  const [x0, y0, z0] = f, [x1, y1, z1] = t;
  switch (dir) {
    case "north": return [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]];
    case "south": return [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]];
    case "west": return [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]];
    case "east": return [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]];
    case "up": return [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
    case "down": return [[x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0]];
  }
}

function elementMatrix(el: ModelElement): THREE.Matrix4 | null {
  const r = el.rotation;
  if (!r || !r.angle) return null;
  const axis = new THREE.Vector3(r.axis === "x" ? 1 : 0, r.axis === "y" ? 1 : 0, r.axis === "z" ? 1 : 0);
  const rad = THREE.MathUtils.degToRad(r.angle);
  const o = new THREE.Vector3(...r.origin);
  const m = new THREE.Matrix4().makeTranslation(o.x, o.y, o.z);
  m.multiply(new THREE.Matrix4().makeRotationAxis(axis, rad));
  if (r.rescale) {
    const s = 1 / Math.cos(rad);
    m.multiply(new THREE.Matrix4().makeScale(r.axis === "x" ? 1 : s, r.axis === "y" ? 1 : s, r.axis === "z" ? 1 : s));
  }
  m.multiply(new THREE.Matrix4().makeTranslation(-o.x, -o.y, -o.z));
  return m;
}

/** Builds meshes for a resolved model; textures are loaded through `loader`. */
export async function buildJsonModel(model: ResolvedModel, modelFile: string | null, loader: ModelLoader): Promise<BuiltModel> {
  const warnings = [...model.warnings];
  const files = [...model.files];
  const root = new THREE.Group();
  const textures: SceneTexture[] = [];
  const cache = new Map<string, SceneTexture>();

  const getTexture = async (texId: string | null, label: string): Promise<SceneTexture> => {
    const key = texId ?? `missing:${label}`;
    const hit = cache.get(key);
    if (hit) return hit;
    let t: SceneTexture | null = null;
    if (texId) {
      const found = await loader.loadTexture(texId, modelFile);
      if (found) { t = found.texture; if (found.file) files.push(found.file); }
    }
    if (!t) {
      t = missingTexture();
      const path = texId ? `${parseId(texId).ns}:textures/${parseId(texId).path}.png` : label;
      const msg = `Missing texture: ${path}`;
      if (!warnings.includes(msg)) warnings.push(msg);
    }
    cache.set(key, t);
    textures.push(t);
    return t;
  };

  let kind: BuiltModel["kind"] = "block";
  if (model.elements) {
    const groups = new Map<SceneTexture, QuadBuilder>();
    for (const el of model.elements) {
      const m = elementMatrix(el);
      for (const dir of Object.keys(el.faces ?? {}) as Dir[]) {
        const face = el.faces![dir]!;
        if (!NORMALS[dir]) continue;
        const texId = face.texture ? resolveTextureVar(face.texture, model.textures) : null;
        const tex = await getTexture(texId, face.texture ?? dir);
        const [u1, v1, u2, v2] = face.uv ?? defaultUv(dir, el.from, el.to);
        // UVs are in 0-16 space regardless of texture resolution.
        let uvs: UV[] = [[u1, v1], [u2, v1], [u2, v2], [u1, v2]];
        const rot = (((face.rotation ?? 0) / 90) % 4 + 4) % 4;
        if (rot) uvs = uvs.map((_, i) => uvs[(i - rot + 4) % 4]);
        let corners = faceCorners(dir, el.from, el.to);
        let normal = NORMALS[dir];
        if (m) {
          corners = corners.map((c) => new THREE.Vector3(...c).applyMatrix4(m).toArray() as V3);
          normal = new THREE.Vector3(...normal).transformDirection(m).toArray() as V3;
        }
        const shade = el.shade === false ? 1 : SHADE[dir];
        const tint = face.tintindex !== undefined && face.tintindex >= 0 && texId ? tintFor(texId) : undefined;
        let qb = groups.get(tex);
        if (!qb) { qb = new QuadBuilder(); groups.set(tex, qb); }
        qb.add(corners, uvs, normal, faceColor(shade, tint), 16, 16);
      }
    }
    for (const [tex, qb] of groups) texturedMeshes(qb.build(), tex, false, { texture: tex, part: null }).forEach((x) => root.add(x));
  } else if (model.generated) {
    kind = "item";
    for (let layer = 0; ; layer++) {
      const ref = model.textures[`layer${layer}`];
      if (!ref) break;
      const texId = resolveTextureVar(ref, model.textures);
      const tex = await getTexture(texId, `layer${layer}`);
      const qb = extrudeSprite(tex, layer * 0.002);
      if (!qb.empty) texturedMeshes(qb.build(), tex, false, { texture: tex, part: null }).forEach((x) => root.add(x));
    }
  }
  if (model.builtinEntity) warnings.push("Drawn by the game's code: add a model for it to the entity library.");
  if (root.children.length === 0 && warnings.length === 0) warnings.push("Model has no geometry.");

  const g = model.guiRotation;
  const baseRotation = g
    ? new THREE.Euler(THREE.MathUtils.degToRad(g[0]), THREE.MathUtils.degToRad(g[1]), THREE.MathUtils.degToRad(g[2]), "XYZ")
    : new THREE.Euler();
  return { object: root, parts: new Map(), textures, baseRotation, files: [...new Set(files)], warnings, kind };
}

/** item/generated: the sprite as a 1/16-deep slab, every opaque pixel's open edges walled in. */
function extrudeSprite(tex: SceneTexture, zBias: number): QuadBuilder {
  const img = tex.view;
  const W = img.width, H = img.height;
  const sx = 16 / W, sy = 16 / H;
  const z0 = 7.5 - zBias, z1 = 8.5 + zBias;
  const qb = new QuadBuilder();
  const full = faceColor(1);
  // Front (south, toward the viewer) and back, whole sprite; transparent pixels are discarded by the shader.
  qb.add([[0, 16, z1], [16, 16, z1], [16, 0, z1], [0, 0, z1]], [[0, 0], [W, 0], [W, H], [0, H]], [0, 0, 1], full, W, H);
  qb.add([[16, 16, z0], [0, 16, z0], [0, 0, z0], [16, 0, z0]], [[W, 0], [0, 0], [0, H], [W, H]], [0, 0, -1], full, W, H);
  const e = 1 / 64; // sample inside the pixel to avoid picking up the neighbour
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (alphaAt(img, x, y) === 0) continue;
      const X0 = x * sx, X1 = (x + 1) * sx, Y1 = 16 - y * sy, Y0 = 16 - (y + 1) * sy;
      const uv: UV[] = [[x + e, y + e], [x + 1 - e, y + e], [x + 1 - e, y + 1 - e], [x + e, y + 1 - e]];
      if (alphaAt(img, x - 1, y) === 0) qb.add([[X0, Y1, z0], [X0, Y1, z1], [X0, Y0, z1], [X0, Y0, z0]], uv, [-1, 0, 0], faceColor(SHADE.west), W, H);
      if (alphaAt(img, x + 1, y) === 0) qb.add([[X1, Y1, z1], [X1, Y1, z0], [X1, Y0, z0], [X1, Y0, z1]], uv, [1, 0, 0], faceColor(SHADE.east), W, H);
      if (alphaAt(img, x, y - 1) === 0) qb.add([[X0, Y1, z0], [X1, Y1, z0], [X1, Y1, z1], [X0, Y1, z1]], uv, [0, 1, 0], faceColor(SHADE.up), W, H);
      if (alphaAt(img, x, y + 1) === 0) qb.add([[X0, Y0, z1], [X1, Y0, z1], [X1, Y0, z0], [X0, Y0, z0]], uv, [0, -1, 0], faceColor(SHADE.down), W, H);
    }
  }
  return qb;
}
