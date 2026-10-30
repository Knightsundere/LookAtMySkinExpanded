// Quad-based mesh building shared by every model kind, plus the two-pass alpha materials.

import * as THREE from "three";
import type { SceneTexture } from "./textures";

export type V3 = [number, number, number];
export type UV = [number, number];

/** Collects textured quads. Corners are given TL, TR, BR, BL as seen from outside the face. */
export class QuadBuilder {
  private pos: number[] = [];
  private uv: number[] = [];
  private col: number[] = [];
  private idx: number[] = [];
  private quads = 0;

  /** uvs are in pixels of a texture `texW` x `texH`, v measured from the top. */
  add(c: V3[], uvs: UV[], normal: V3, color: V3, texW: number, texH: number) {
    const a = new THREE.Vector3(...c[0]), b = new THREE.Vector3(...c[1]), d = new THREE.Vector3(...c[2]);
    const n = b.clone().sub(a).cross(d.clone().sub(a));
    const flip = n.dot(new THREE.Vector3(...normal)) < 0;
    const base = this.quads * 4;
    for (let i = 0; i < 4; i++) {
      this.pos.push(...c[i]);
      this.uv.push(uvs[i][0] / texW, uvs[i][1] / texH);
      this.col.push(...color);
    }
    if (flip) this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    else this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    this.quads++;
  }

  get empty() { return this.quads === 0; }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute("color", new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.idx);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

/** Mirror a list of corners across the plane x = cx (normal is mirrored by the caller). */
export const mirrorX = (c: V3[], cx: number): V3[] => c.map(([x, y, z]) => [2 * cx - x, y, z]);

// Each textured surface is drawn twice: an opaque pass (alpha 255 only, writes depth)
// and, when the texture has any partial alpha, a blended pass for 0 < alpha < 255.
function alphaBandMaterial(tex: THREE.Texture, side: THREE.Side, translucent: boolean) {
  const m = new THREE.MeshBasicMaterial({
    map: tex,
    side,
    vertexColors: true,
    transparent: translucent,
    depthWrite: !translucent,
  });
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <alphatest_fragment>",
      translucent
        ? "if (diffuseColor.a < 0.002 || diffuseColor.a > 0.998) discard;"
        : "if (diffuseColor.a < 0.998) discard; diffuseColor.a = 1.0;",
    );
  };
  m.customProgramCacheKey = () => (translucent ? "lamsex-translucent" : "lamsex-opaque");
  return m;
}

export interface PickInfo {
  texture: SceneTexture;
  /** Object to rotate when this surface is dragged; null means "rotate the whole model". */
  part: THREE.Object3D | null;
}

/** Builds the opaque (+ optional translucent) meshes for one texture's quads. */
export function texturedMeshes(geo: THREE.BufferGeometry, texture: SceneTexture, doubleSided: boolean, pick: PickInfo): THREE.Mesh[] {
  const side = doubleSided ? THREE.DoubleSide : THREE.FrontSide;
  const opaque = new THREE.Mesh(geo, alphaBandMaterial(texture.tex, side, false));
  opaque.userData.pick = pick;
  const out = [opaque];
  if (texture.hasTranslucent) {
    // Separate index so back-to-front sorting doesn't disturb the opaque pass.
    const tgeo = geo.clone();
    const tmesh = new THREE.Mesh(tgeo, alphaBandMaterial(texture.tex, side, true));
    tmesh.renderOrder = 1;
    tmesh.userData.pick = pick;
    tmesh.userData.noPick = true;
    tmesh.onBeforeRender = (_r, _s, camera) => sortQuadsBackToFront(tmesh, camera);
    out.push(tmesh);
  }
  return out;
}

const tmpCam = new THREE.Vector3();
const inv = new THREE.Matrix4();
function sortQuadsBackToFront(mesh: THREE.Mesh, camera: THREE.Camera) {
  const g = mesh.geometry;
  const index = g.getIndex();
  if (!index) return;
  const pos = g.getAttribute("position") as THREE.BufferAttribute;
  const quadCount = index.count / 6;
  inv.copy(mesh.matrixWorld).invert();
  tmpCam.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(inv);
  let centers: Float32Array = g.userData.centers;
  if (!centers) {
    centers = new Float32Array(quadCount * 3);
    for (let q = 0; q < quadCount; q++) {
      for (let k = 0; k < 4; k++) {
        const v = q * 4 + k;
        centers[q * 3] += pos.getX(v) / 4;
        centers[q * 3 + 1] += pos.getY(v) / 4;
        centers[q * 3 + 2] += pos.getZ(v) / 4;
      }
    }
    g.userData.centers = centers;
    g.userData.original = Array.from(index.array as ArrayLike<number>);
  }
  const original: number[] = g.userData.original;
  const order = [...Array(quadCount).keys()];
  const dist = order.map((q) => {
    const dx = centers[q * 3] - tmpCam.x, dy = centers[q * 3 + 1] - tmpCam.y, dz = centers[q * 3 + 2] - tmpCam.z;
    return dx * dx + dy * dy + dz * dz;
  });
  order.sort((a, b) => dist[b] - dist[a]);
  const arr = index.array as Uint16Array | Uint32Array;
  order.forEach((q, i) => { for (let k = 0; k < 6; k++) arr[i * 6 + k] = original[q * 6 + k]; });
  index.needsUpdate = true;
}

export function disposeObject(obj: THREE.Object3D) {
  obj.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    }
  });
}
