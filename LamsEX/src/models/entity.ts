// Entity-style models: Blockbench (.bbmodel) and GeckoLib / Bedrock geometry (.geo.json).
// Both are converted to Blockbench's own layout (groups = bones with a pivot and rotation,
// cubes with per-face UVs) and built by the same code.

import * as THREE from "three";
import { QuadBuilder, texturedMeshes, type V3, type UV } from "../geometry";
import type { SceneTexture } from "../textures";
import { faceColor, type BuiltModel } from "./common";
import { faceCorners, NORMALS, SHADE, type Dir } from "./blockmodel";

export type Uv4 = [number, number, number, number];

export interface EFace { uv: Uv4; texture: number | null; rotation?: number }
export interface ECube {
  kind: "cube";
  name: string;
  from: V3;
  to: V3;
  origin: V3; // rotation pivot
  rotation: V3; // degrees, applied Z then Y then X (Blockbench's order)
  inflate: number;
  faces: Partial<Record<Dir, EFace>>;
}
export interface EGroup {
  kind: "group";
  name: string;
  origin: V3;
  rotation: V3;
  children: ENode[];
}
export type ENode = ECube | EGroup;

export interface EModel {
  roots: ENode[];
  /** UV space size for a texture index (UVs are in this space, whatever the PNG's real size). */
  uvSize: (texture: number) => [number, number];
  /** "block" for Blockbench Java block models; everything else is shown like an entity. */
  style: "entity" | "block";
  guiRotation: V3 | null;
  warnings: string[];
}

/** Above this many cubes the model is cut off (the spec leaves high-poly support to us). */
export const MAX_CUBES = 10000;

/** Box UV layout as Blockbench computes it, for an entity facing north (-z). */
export function boxUvFaces(u: number, v: number, size: V3, mirror: boolean): Record<Dir, Uv4> {
  const [w, h, d] = size;
  const layout: Record<Dir, { from: [number, number]; size: [number, number] }> = {
    north: { from: [d, d], size: [w, h] },
    east: { from: [0, d], size: [d, h] },
    south: { from: [d * 2 + w, d], size: [w, h] },
    west: { from: [d + w, d], size: [d, h] },
    up: { from: [d + w, d], size: [-w, -d] },
    down: { from: [d + w * 2, 0], size: [-w, d] },
  };
  if (mirror) {
    for (const f of Object.values(layout)) { f.from[0] += f.size[0]; f.size[0] *= -1; }
    [layout.east, layout.west] = [layout.west, layout.east];
  }
  const out = {} as Record<Dir, Uv4>;
  for (const [dir, f] of Object.entries(layout) as [Dir, (typeof layout)[Dir]][]) {
    out[dir] = [u + f.from[0], v + f.from[1], u + f.from[0] + f.size[0], v + f.from[1] + f.size[1]];
  }
  return out;
}

const BODY_NAMES = /^(body|root|main|base|torso|all|bb_main|everything|model)$/i;

/**
 * Bones you can drag to pose. Dragging a top-level bone that holds other bones, or one named
 * like a body/root at any depth, turns the whole model instead (that's what "drag on the body" means).
 */
function isPoseable(g: EGroup, topLevel: boolean) {
  // Body-named bones turn the model at any depth: GeckoLib models often nest them (root > body > head, arms).
  if (BODY_NAMES.test(g.name)) return false;
  if (attached.has(g)) return false; // dragging the beak turns the head it belongs to
  if (!topLevel) return true;
  return !g.children.some((c) => c.kind === "group" && !attached.has(c));
}

/** Bones moved under a head by attachToHeads; they don't stop the head being poseable. */
const attached = new WeakSet<ENode>();
const same = (a: V3, b: V3) => a.every((x, i) => Math.abs(x - b[i]) < 1e-3);

/**
 * Pieces that sit on a head's pivot but are separate bones (the chicken's beak and wattle) move
 * with the head in game, because the game copies the head's angles onto them. Make them children
 * of the head so posing the head carries them along.
 */
function attachToHeads(nodes: ENode[]) {
  const groups = nodes.filter((n): n is EGroup => n.kind === "group");
  for (const head of groups.filter((g) => /head/i.test(g.name))) {
    for (const g of groups) {
      if (g === head || !nodes.includes(g) || /head/i.test(g.name) || BODY_NAMES.test(g.name) || !same(g.origin, head.origin)) continue;
      const headTurned = head.rotation.some((a) => a !== 0);
      if (headTurned && !same(g.rotation, head.rotation)) continue;
      nodes.splice(nodes.indexOf(g), 1);
      const piece: EGroup = headTurned ? { ...g, rotation: [0, 0, 0] } : g;
      attached.add(piece);
      head.children.push(piece);
    }
  }
  for (const n of nodes) if (n.kind === "group") attachToHeads(n.children);
}

/** Builds meshes; `textures[i]` is the texture for face texture index i (missing ones draw gray). */
export function buildEntity(model: EModel, textures: (SceneTexture | null)[], fallback: SceneTexture, files: string[], warnings: string[]): BuiltModel {
  const root = new THREE.Group();
  const parts = new Map<string, THREE.Object3D>();
  const used = new Set<SceneTexture>();
  let cubes = 0;

  const addNodes = (nodes: ENode[], parent: THREE.Object3D, parentOrigin: V3, pose: THREE.Object3D | null, topLevel: boolean) => {
    // Quads of the cubes directly in this group, bucketed by texture.
    const buckets = new Map<SceneTexture, QuadBuilder>();
    for (const n of nodes) {
      if (n.kind === "group") {
        const g = new THREE.Group();
        g.name = n.name;
        g.position.set(n.origin[0] - parentOrigin[0], n.origin[1] - parentOrigin[1], n.origin[2] - parentOrigin[2]);
        g.rotation.copy(euler(n.rotation));
        g.userData.rest = g.quaternion.clone(); // what "reset poses" returns to
        if (/head/i.test(n.name)) { g.userData.poseStyle = "head"; g.userData.front = -1; } // nods and turns, like LAMS
        parent.add(g);
        const poseable = isPoseable(n, topLevel);
        if (poseable && !parts.has(n.name)) parts.set(n.name, g);
        addNodes(n.children, g, n.origin, poseable ? g : pose, false);
        continue;
      }
      if (++cubes > MAX_CUBES) continue;
      const m = cubeMatrix(n, parentOrigin);
      const inf = n.inflate;
      const from: V3 = [n.from[0] - inf - parentOrigin[0], n.from[1] - inf - parentOrigin[1], n.from[2] - inf - parentOrigin[2]];
      const to: V3 = [n.to[0] + inf - parentOrigin[0], n.to[1] + inf - parentOrigin[1], n.to[2] + inf - parentOrigin[2]];
      for (const dir of Object.keys(n.faces) as Dir[]) {
        const face = n.faces[dir];
        if (!face || face.texture === null || !NORMALS[dir]) continue;
        const tex = textures[face.texture] ?? fallback;
        const [uw, uh] = model.uvSize(face.texture);
        const [u1, v1, u2, v2] = face.uv;
        let uvs: UV[] = [[u1, v1], [u2, v1], [u2, v2], [u1, v2]];
        const rot = (((face.rotation ?? 0) / 90) % 4 + 4) % 4;
        if (rot) uvs = uvs.map((_, i) => uvs[(i - rot + 4) % 4]);
        const corners = faceCorners(dir, from, to).map((c) => new THREE.Vector3(...c).applyMatrix4(m).toArray() as V3);
        const normal = new THREE.Vector3(...NORMALS[dir]).transformDirection(m).toArray() as V3;
        let qb = buckets.get(tex);
        if (!qb) { qb = new QuadBuilder(); buckets.set(tex, qb); }
        qb.add(corners, uvs, normal, faceColor(SHADE[dir]), uw, uh);
      }
    }
    for (const [tex, qb] of buckets) {
      used.add(tex);
      // Entities render double sided, so gaps in hats and the like show their inside, as in game.
      texturedMeshes(qb.build(), tex, true, { texture: tex, part: pose }).forEach((x) => parent.add(x));
    }
  };

  attachToHeads(model.roots);
  addNodes(model.roots, root, [0, 0, 0], null, true);
  if (cubes > MAX_CUBES) warnings.push(`Model is too detailed: only the first ${MAX_CUBES} cubes are shown.`);
  if (cubes === 0) warnings.push("Model has no geometry.");

  const block = model.style === "block";
  const g = model.guiRotation ?? (block ? [30, 225, 0] : null);
  const baseRotation = g
    ? new THREE.Euler(...(g.map((a) => THREE.MathUtils.degToRad(a)) as V3), "XYZ")
    : new THREE.Euler(0, Math.PI, 0); // entities face north (-z); turn them toward the camera
  return {
    object: root,
    parts: block ? new Map() : parts, // blocks rotate as a whole only
    textures: [...new Set([...textures.filter((t): t is SceneTexture => !!t), fallback])],
    baseRotation,
    files: [...new Set(files)],
    warnings,
    kind: block ? "block" : "entity",
  };
}

const euler = (r: V3) => new THREE.Euler(...(r.map((a) => THREE.MathUtils.degToRad(a)) as V3), "ZYX");

/** Cube rotation around its own pivot, in the coordinates of its parent group. */
function cubeMatrix(c: ECube, parentOrigin: V3): THREE.Matrix4 {
  const o = new THREE.Vector3(c.origin[0] - parentOrigin[0], c.origin[1] - parentOrigin[1], c.origin[2] - parentOrigin[2]);
  if (!c.rotation[0] && !c.rotation[1] && !c.rotation[2]) return new THREE.Matrix4();
  return new THREE.Matrix4().makeTranslation(o.x, o.y, o.z)
    .multiply(new THREE.Matrix4().makeRotationFromEuler(euler(c.rotation)))
    .multiply(new THREE.Matrix4().makeTranslation(-o.x, -o.y, -o.z));
}

// ---------------- GeckoLib / Bedrock geometry ----------------

interface BedrockCube {
  origin?: V3; size?: V3; uv?: [number, number] | Partial<Record<Dir, { uv: [number, number]; uv_size?: [number, number]; uv_rotation?: number }>>;
  inflate?: number; mirror?: boolean; pivot?: V3; rotation?: V3;
}
interface BedrockBone { name: string; parent?: string; pivot?: V3; rotation?: V3; mirror?: boolean; inflate?: number; cubes?: BedrockCube[] }

/** True for Bedrock / GeckoLib geometry JSON (new or old format). */
export function isBedrockGeometry(j: unknown): boolean {
  if (!j || typeof j !== "object") return false;
  if ("minecraft:geometry" in j) return true;
  return "format_version" in j && Object.keys(j).some((k) => k.startsWith("geometry."));
}

export function parseBedrock(json: Record<string, unknown>): EModel {
  let desc: { texture_width?: number; texture_height?: number; texturewidth?: number; textureheight?: number } = {};
  let bones: BedrockBone[] = [];
  const geos = json["minecraft:geometry"];
  if (Array.isArray(geos) && geos.length) {
    desc = geos[0].description ?? {};
    bones = geos[0].bones ?? [];
  } else {
    const key = Object.keys(json).find((k) => k.startsWith("geometry."));
    const g = key ? (json[key] as { bones?: BedrockBone[] }) : null;
    desc = (g as typeof desc) ?? {};
    bones = g?.bones ?? [];
  }
  const tw = desc.texture_width ?? desc.texturewidth ?? 64;
  const th = desc.texture_height ?? desc.textureheight ?? 64;
  // Bedrock's x axis is mirrored relative to Blockbench's; same conversion Blockbench uses on import.
  const pivotOf = (p?: V3): V3 => (p ? [-p[0], p[1], p[2]] : [0, 0, 0]);
  const rotOf = (r?: V3): V3 => (r ? [-r[0], -r[1], r[2]] : [0, 0, 0]);
  const groups = new Map<string, EGroup>();
  for (const b of bones) {
    const g: EGroup = { kind: "group", name: b.name, origin: pivotOf(b.pivot), rotation: rotOf(b.rotation), children: [] };
    for (const c of b.cubes ?? []) {
      const o = c.origin ?? [0, 0, 0], s = c.size ?? [0, 0, 0];
      const from: V3 = [-(o[0] + s[0]), o[1], o[2]];
      const to: V3 = [from[0] + s[0], from[1] + s[1], from[2] + s[2]];
      let faces: Partial<Record<Dir, EFace>>;
      if (Array.isArray(c.uv) || !c.uv) {
        const [u, v] = (c.uv as [number, number]) ?? [0, 0];
        const box = boxUvFaces(u, v, s.map(Math.floor) as V3, c.mirror ?? b.mirror ?? false);
        faces = Object.fromEntries(Object.entries(box).map(([d, uv]) => [d, { uv, texture: 0 }]));
      } else {
        faces = {};
        for (const [d, f] of Object.entries(c.uv) as [Dir, { uv: [number, number]; uv_size?: [number, number]; uv_rotation?: number }][]) {
          if (!f) continue;
          const [w, h] = f.uv_size ?? [0, 0];
          const uv: Uv4 = [f.uv[0], f.uv[1], f.uv[0] + w, f.uv[1] + h];
          // Bedrock stores up/down face UVs the other way round; Blockbench swaps the corners on import too.
          faces[d] = { uv: d === "up" || d === "down" ? [uv[2], uv[3], uv[0], uv[1]] : uv, texture: 0, rotation: f.uv_rotation };
        }
      }
      g.children.push({
        kind: "cube", name: b.name, from, to,
        origin: c.pivot ? pivotOf(c.pivot) : g.origin,
        rotation: rotOf(c.rotation),
        inflate: c.inflate ?? b.inflate ?? 0,
        faces,
      });
    }
    groups.set(b.name, g);
  }
  const roots: ENode[] = [];
  for (const b of bones) {
    const g = groups.get(b.name)!;
    const parent = b.parent ? groups.get(b.parent) : undefined;
    (parent ? parent.children : roots).push(g);
  }
  return { roots, uvSize: () => [tw, th], style: "entity", guiRotation: null, warnings: [] };
}

// ---------------- Blockbench .bbmodel ----------------

export interface BbTexture { name: string; source: string | null; path: string | null; relativePath: string | null }

interface BbElement {
  uuid: string; name?: string; type?: string; export?: boolean;
  from?: V3; to?: V3; origin?: V3; rotation?: V3 | number; inflate?: number;
  box_uv?: boolean; uv_offset?: [number, number]; mirror_uv?: boolean;
  faces?: Partial<Record<Dir, { uv?: Uv4; texture?: number | string | null | false; rotation?: number }>>;
}
interface BbGroup { uuid?: string; name?: string; origin?: V3; rotation?: V3; export?: boolean; children?: (string | BbGroup)[] }

export function parseBbmodel(json: Record<string, unknown>): { model: EModel; textures: BbTexture[] } {
  const meta = (json.meta ?? {}) as { model_format?: string; box_uv?: boolean };
  const res = (json.resolution ?? {}) as { width?: number; height?: number };
  const rawTex = (Array.isArray(json.textures) ? json.textures : []) as { id?: string; name?: string; source?: string; path?: string; relative_path?: string; uv_width?: number; uv_height?: number }[];
  const textures: BbTexture[] = rawTex.map((t) => ({
    name: t.name ?? "texture",
    source: typeof t.source === "string" && t.source.startsWith("data:") ? t.source : null,
    path: t.path || null,
    relativePath: t.relative_path || null,
  }));
  const texIndex = (ref: number | string | null | false | undefined): number | null => {
    if (ref === null || ref === false) return null;
    if (rawTex.length === 0) return 0; // no textures saved in the file: use whatever texture it's shown with
    if (ref === undefined) return null;
    const byId = rawTex.findIndex((t) => t.id !== undefined && String(t.id) === String(ref));
    if (byId >= 0) return byId;
    const n = Number(ref);
    return Number.isInteger(n) && n >= 0 && n < rawTex.length ? n : null;
  };
  const warnings: string[] = [];
  const elements = new Map<string, BbElement>();
  for (const e of (Array.isArray(json.elements) ? json.elements : []) as BbElement[]) elements.set(e.uuid, e);
  // Newer Blockbench versions list groups separately and keep only uuids + children in the outliner.
  const groupInfo = new Map<string, BbGroup>();
  for (const g of (Array.isArray(json.groups) ? json.groups : []) as BbGroup[]) if (g.uuid) groupInfo.set(g.uuid, g);

  let skippedMeshes = false;
  const used = new Set<string>();
  const toCube = (e: BbElement): ECube | null => {
    used.add(e.uuid);
    if (e.export === false) return null; // unticked "Export" in Blockbench: not part of the model
    if (e.type && e.type !== "cube") { if (e.type === "mesh") skippedMeshes = true; return null; }
    const from = e.from ?? [0, 0, 0], to = e.to ?? [0, 0, 0];
    const rot: V3 = Array.isArray(e.rotation) ? e.rotation : [0, 0, 0];
    const faces: Partial<Record<Dir, EFace>> = {};
    const boxed = (e.box_uv ?? meta.box_uv) && e.uv_offset
      ? boxUvFaces(e.uv_offset[0], e.uv_offset[1], [to[0] - from[0], to[1] - from[1], to[2] - from[2]].map(Math.floor) as V3, !!e.mirror_uv)
      : null;
    for (const [d, f] of Object.entries(e.faces ?? {}) as [Dir, NonNullable<BbElement["faces"]>[Dir]][]) {
      if (!f) continue;
      const uv = f.uv ?? boxed?.[d];
      if (!uv) continue;
      faces[d] = { uv, texture: texIndex(f.texture), rotation: f.rotation };
    }
    return { kind: "cube", name: e.name ?? "cube", from, to, origin: e.origin ?? [0, 0, 0], rotation: rot, inflate: e.inflate ?? 0, faces };
  };
  // A group left out of the export takes its contents with it.
  const markUsed = (n: string | BbGroup): void => {
    if (typeof n === "string") used.add(n);
    else (n.children ?? []).forEach(markUsed);
  };
  const toNode = (n: string | BbGroup): ENode | null => {
    if (typeof n === "string") { const e = elements.get(n); return e ? toCube(e) : null; }
    const info = { ...(n.uuid ? groupInfo.get(n.uuid) : undefined), ...n };
    if (info.export === false) { markUsed(n); return null; }
    return {
      kind: "group",
      name: info.name ?? "group",
      origin: info.origin ?? [0, 0, 0],
      rotation: info.rotation ?? [0, 0, 0],
      children: (n.children ?? []).map(toNode).filter((x): x is ENode => !!x),
    };
  };
  const roots = ((Array.isArray(json.outliner) ? json.outliner : []) as (string | BbGroup)[]).map(toNode).filter((x): x is ENode => !!x);
  for (const e of elements.values()) if (!used.has(e.uuid)) { const c = toCube(e); if (c) roots.push(c); }
  if (skippedMeshes) warnings.push("Mesh elements aren't supported; only cubes are shown.");

  const display = json.display as Record<string, { rotation?: V3 }> | undefined;
  return {
    model: {
      roots,
      uvSize: (i) => [rawTex[i]?.uv_width ?? res.width ?? 16, rawTex[i]?.uv_height ?? res.height ?? 16],
      style: meta.model_format === "java_block" ? "block" : "entity",
      guiRotation: display?.gui?.rotation ?? null,
      warnings,
    },
    textures,
  };
}

/** "data:image/png;base64,..." -> bytes */
export function dataUrlBytes(url: string): Uint8Array {
  const b64 = url.slice(url.indexOf(",") + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------- OptiFine CEM .jem (as exported by Entity Model Features) ----------------
// Read the same way Blockbench imports .jem files, so models look the same as in Blockbench.

interface JemBox {
  coordinates?: number[]; textureOffset?: [number, number]; sizeAdd?: number;
  uvNorth?: Uv4; uvEast?: Uv4; uvSouth?: Uv4; uvWest?: Uv4; uvUp?: Uv4; uvDown?: Uv4;
}
interface JemPart {
  part?: string; id?: string; comment?: string; translate?: V3; rotate?: V3; mirrorTexture?: string;
  boxes?: JemBox[]; submodels?: JemPart[]; submodel?: JemPart;
}

/** True for a .jem file's JSON: a "models" list of parts. */
export function isJem(j: unknown): boolean {
  return !!j && typeof j === "object" && Array.isArray((j as { models?: unknown }).models)
    && (j as { models: unknown[] }).models.some((m) => !!m && typeof m === "object" && ("part" in m || "boxes" in m || "submodels" in m));
}

/** Parses a .jem; `texture` is the file's own texture reference, if it names one. */
export function parseJem(json: Record<string, unknown>): { model: EModel; texture: string | null } {
  const size = Array.isArray(json.textureSize) ? (json.textureSize as number[]) : [64, 32];
  const tw = Number(size[0]) || 64, th = Number(size[1]) || 32;
  const sub = (p: JemPart): JemPart[] => [...(p.submodels ?? []), ...(p.submodel ? [p.submodel] : [])];
  let skipped = false;

  const cube = (box: JemBox, name: string, offset: V3, mirror: boolean): ECube | null => {
    const c = box.coordinates;
    if (!c || c.length < 6) return null;
    const from: V3 = [c[0] + offset[0], c[1] + offset[1], c[2] + offset[2]];
    const to: V3 = [from[0] + c[3], from[1] + c[4], from[2] + c[5]];
    let faces: Partial<Record<Dir, EFace>>;
    if (box.textureOffset) {
      const uv = boxUvFaces(box.textureOffset[0], box.textureOffset[1], [c[3], c[4], c[5]].map(Math.floor) as V3, mirror);
      faces = Object.fromEntries(Object.entries(uv).map(([d, f]) => [d, { uv: f, texture: 0 }]));
    } else {
      const per: Record<Dir, Uv4 | undefined> = { north: box.uvNorth, east: box.uvEast, south: box.uvSouth, west: box.uvWest, up: box.uvUp, down: box.uvDown };
      faces = {};
      for (const [d, uv] of Object.entries(per) as [Dir, Uv4 | undefined][]) if (uv) faces[d] = { uv, texture: 0 };
      if (Object.keys(faces).length === 0) { skipped = true; return null; }
    }
    return { kind: "cube", name, from, to, origin: [0, 0, 0], rotation: [0, 0, 0], inflate: box.sizeAdd ?? 0, faces };
  };

  // Children of a part: boxes (offset by the part's pivot below the top level) and submodels.
  const content = (p: JemPart, group: EGroup, depth: number, top: boolean) => {
    const mirror = !!p.mirrorTexture?.includes("u");
    for (const b of p.boxes ?? []) {
      const c = cube(b, group.name, top ? [0, 0, 0] : group.origin, mirror);
      if (c) group.children.push(c);
    }
    sub(p).forEach((s, i) => {
      let origin: V3 = s.translate ? [...s.translate] as V3 : depth >= 1 ? [...group.origin] as V3 : [0, 0, 0];
      if (depth >= 1 && s.translate) origin = [origin[0] + group.origin[0], origin[1] + group.origin[1], origin[2] + group.origin[2]];
      const g: EGroup = { kind: "group", name: s.id || s.comment || `${group.name}_sub_${i}`, origin, rotation: s.rotate ?? [0, 0, 0], children: [] };
      group.children.push(g);
      content(s, g, depth + 1, false);
    });
  };

  const roots: ENode[] = [];
  for (const p of (json.models as JemPart[]).filter((m) => m && typeof m === "object")) {
    const t = p.translate ?? [0, 0, 0];
    const g: EGroup = { kind: "group", name: p.part ?? p.id ?? "part", origin: [-t[0], -t[1], -t[2]], rotation: p.rotate ?? [0, 0, 0], children: [] };
    roots.push(g);
    content(p, g, 0, true);
  }
  const warnings = skipped ? ["Some boxes have no texture mapping and are hidden."] : [];
  return {
    model: { roots, uvSize: () => [tw, th], style: "entity", guiRotation: null, warnings },
    texture: typeof json.texture === "string" ? json.texture : null,
  };
}
