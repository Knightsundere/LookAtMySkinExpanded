// Player skin model. Built from a list of parts (not hard-coded meshes) so extra parts,
// e.g. Custom Player Models features, can be added later.

import * as THREE from "three";
import { QuadBuilder, mirrorX, texturedMeshes, type V3, type UV } from "../geometry";
import { SceneTexture } from "../textures";
import { alphaAt, type Rgba } from "../png";
import { faceColor, type BuiltModel } from "./common";

export interface SkinBox {
  from: V3; // model pixels; y up, feet at 0, front faces +z
  to: V3;
  uv: [number, number];
  inflate?: number;
  mirror?: boolean;
  outer?: boolean; // outer (second) layer: double sided
}

export interface SkinPart {
  name: string;
  pivot: V3;
  poseable: boolean;
  boxes: SkinBox[];
}

export type SkinFormat = "modern" | "legacy";

export function skinFormat(img: Rgba): SkinFormat | null {
  if (img.width === 64 && img.height === 64) return "modern";
  if (img.width === 64 && img.height === 32) return "legacy";
  return null;
}

/** Slim when the unused strip of the right arm (x 54-55, y 20-31) is fully transparent. */
export function guessSlim(img: Rgba): boolean {
  if (img.height !== 64) return false;
  for (let y = 20; y < 32; y++) for (let x = 54; x < 56; x++) if (alphaAt(img, x, y) !== 0) return false;
  return true;
}

export function playerParts(format: SkinFormat, slim: boolean): SkinPart[] {
  const modern = format === "modern";
  const aw = slim ? 3 : 4;
  const armTop = slim ? 23.5 : 24;
  const armPivotY = slim ? 21.5 : 22;
  const layer = (b: SkinBox, uv: [number, number], inflate: number): SkinBox[] =>
    modern ? [b, { ...b, uv, inflate, outer: true }] : [b];
  return [
    { name: "head", pivot: [0, 24, 0], poseable: true, boxes: [
      { from: [-4, 24, -4], to: [4, 32, 4], uv: [0, 0] },
      { from: [-4, 24, -4], to: [4, 32, 4], uv: [32, 0], inflate: 0.5, outer: true }, // hat exists in both formats
    ] },
    { name: "body", pivot: [0, 24, 0], poseable: false, boxes:
      layer({ from: [-4, 12, -2], to: [4, 24, 2], uv: [16, 16] }, [16, 32], 0.25) },
    { name: "right_arm", pivot: [-5, armPivotY, 0], poseable: true, boxes:
      layer({ from: [-4 - aw, armTop - 12, -2], to: [-4, armTop, 2], uv: [40, 16] }, [40, 32], 0.25) },
    { name: "left_arm", pivot: [5, armPivotY, 0], poseable: true, boxes: modern
      ? layer({ from: [4, armTop - 12, -2], to: [4 + aw, armTop, 2], uv: [32, 48] }, [48, 48], 0.25)
      : [{ from: [4, armTop - 12, -2], to: [4 + aw, armTop, 2], uv: [40, 16], mirror: true }] },
    { name: "right_leg", pivot: [-1.9, 12, 0], poseable: true, boxes:
      layer({ from: [-3.9, 0, -2], to: [0.1, 12, 2], uv: [0, 16] }, [0, 32], 0.25) },
    { name: "left_leg", pivot: [1.9, 12, 0], poseable: true, boxes: modern
      ? layer({ from: [-0.1, 0, -2], to: [3.9, 12, 2], uv: [16, 48] }, [0, 48], 0.25)
      : [{ from: [-0.1, 0, -2], to: [3.9, 12, 2], uv: [0, 16], mirror: true }] },
  ];
}

const rect = (u1: number, v1: number, u2: number, v2: number): UV[] => [[u1, v1], [u2, v1], [u2, v2], [u1, v2]];

/** Standard Minecraft box UV layout, front of the box facing +z. */
export function addSkinBox(qb: QuadBuilder, b: SkinBox, texW: number, texH: number) {
  const inf = b.inflate ?? 0;
  const [x0, y0, z0] = [b.from[0] - inf, b.from[1] - inf, b.from[2] - inf];
  const [x1, y1, z1] = [b.to[0] + inf, b.to[1] + inf, b.to[2] + inf];
  const w = b.to[0] - b.from[0], h = b.to[1] - b.from[1], d = b.to[2] - b.from[2];
  const [u, v] = b.uv;
  const white = faceColor(1);
  const faces: { c: V3[]; uv: UV[]; n: V3 }[] = [
    { n: [0, 0, 1], uv: rect(u + d, v + d, u + d + w, v + d + h), c: [[x0, y1, z1], [x1, y1, z1], [x1, y0, z1], [x0, y0, z1]] },
    { n: [-1, 0, 0], uv: rect(u, v + d, u + d, v + d + h), c: [[x0, y1, z0], [x0, y1, z1], [x0, y0, z1], [x0, y0, z0]] },
    { n: [1, 0, 0], uv: rect(u + d + w, v + d, u + 2 * d + w, v + d + h), c: [[x1, y1, z1], [x1, y1, z0], [x1, y0, z0], [x1, y0, z1]] },
    { n: [0, 0, -1], uv: rect(u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h), c: [[x1, y1, z0], [x0, y1, z0], [x0, y0, z0], [x1, y0, z0]] },
    { n: [0, 1, 0], uv: rect(u + d, v, u + d + w, v + d), c: [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]] },
    // Bottom: same layout as the top (front edge at the bottom of the UV rect), seen from below.
    { n: [0, -1, 0], uv: rect(u + d + w, v, u + d + 2 * w, v + d), c: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
  ];
  const cx = (x0 + x1) / 2;
  for (const f of faces) {
    if (b.mirror) qb.add(mirrorX(f.c, cx), f.uv, [-f.n[0], f.n[1], f.n[2]], white, texW, texH);
    else qb.add(f.c, f.uv, f.n, white, texW, texH);
  }
}

export function buildSkin(img: Rgba, slim: boolean, file: string): BuiltModel {
  const format = skinFormat(img)!;
  const texture = new SceneTexture(img);
  const root = new THREE.Group();
  const parts = new Map<string, THREE.Object3D>();
  for (const p of playerParts(format, slim)) {
    const pivot = new THREE.Group();
    pivot.name = p.name;
    pivot.position.set(...p.pivot);
    root.add(pivot);
    const pick = { texture, part: p.poseable ? pivot : null };
    for (const outer of [false, true]) {
      const qb = new QuadBuilder();
      for (const b of p.boxes.filter((b) => !!b.outer === outer)) {
        addSkinBox(qb, { ...b, from: sub(b.from, p.pivot), to: sub(b.to, p.pivot) }, img.width, img.height);
      }
      if (!qb.empty) texturedMeshes(qb.build(), texture, outer, pick).forEach((m) => pivot.add(m));
    }
    if (p.poseable) parts.set(p.name, pivot);
  }
  return { object: root, parts, textures: [texture], baseRotation: new THREE.Euler(), files: [file], warnings: [], kind: "skin" };
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
