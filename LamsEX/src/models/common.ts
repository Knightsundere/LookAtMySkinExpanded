import * as THREE from "three";
import type { V3 } from "../geometry";
import type { SceneTexture } from "../textures";

/** A built model ready for the viewer. */
export interface BuiltModel {
  object: THREE.Object3D;
  /** Poseable parts by name (kept across live reloads). Empty = rotate as a whole only. */
  parts: Map<string, THREE.Object3D>;
  textures: SceneTexture[];
  /** Base orientation applied under the user's rotation (e.g. the item "gui" display rotation). */
  baseRotation: THREE.Euler;
  /** Real files used, to watch for changes. */
  files: string[];
  /** Non-fatal problems to report (missing textures, parents...). */
  warnings: string[];
  kind: "skin" | "block" | "item" | "entity";
}

/** Vertex color for a face: shade factor and tint are given in sRGB, like the game applies them. */
export function faceColor(shade: number, tint?: V3): V3 {
  const c = new THREE.Color();
  const t = tint ?? [1, 1, 1];
  c.setRGB(t[0] * shade, t[1] * shade, t[2] * shade, THREE.SRGBColorSpace);
  return [c.r, c.g, c.b];
}
