// Textures: exact-alpha PNGs as nearest-filtered DataTextures, with .mcmeta animation.

import * as THREE from "three";
import type { Rgba } from "./png";

export interface McAnimation {
  frameTime: number;
  frames: { index: number; time: number }[];
  frameW: number;
  frameH: number;
}

export class SceneTexture {
  readonly tex: THREE.DataTexture;
  /** Pixels currently shown (one frame for animated textures). Used for picking and item extrusion. */
  readonly view: Rgba;
  readonly hasTranslucent: boolean;
  private tick = 0;
  private frameIdx = 0;

  constructor(readonly source: Rgba, readonly anim: McAnimation | null = null) {
    const w = anim ? anim.frameW : source.width;
    const h = anim ? anim.frameH : source.height;
    this.view = { width: w, height: h, data: new Uint8Array(w * h * 4) };
    this.copyFrame(anim ? anim.frames[0].index : 0);
    this.tex = new THREE.DataTexture(this.view.data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.flipY = false; // row 0 = top of the image = v 0
    this.tex.needsUpdate = true;
    // Translucent = any pixel strictly between 0 and 255 alpha, in any frame.
    let partial = false;
    for (let i = 3; i < source.data.length; i += 4) {
      const a = source.data[i];
      if (a !== 0 && a !== 255) { partial = true; break; }
    }
    this.hasTranslucent = partial;
  }

  get width() { return this.view.width; }
  get height() { return this.view.height; }

  private copyFrame(index: number) {
    const { width: sw } = this.source;
    const { width: w, height: h, data } = this.view;
    const perRow = Math.max(1, Math.floor(sw / w));
    const fx = (index % perRow) * w;
    const fy = Math.floor(index / perRow) * h;
    for (let y = 0; y < h; y++) {
      const src = ((fy + y) * sw + fx) * 4;
      if (src + w * 4 > this.source.data.length) break;
      data.set(this.source.data.subarray(src, src + w * 4), y * w * 4);
    }
  }

  /** Advance one game tick (50 ms). Returns true when the shown frame changed. */
  step(): boolean {
    if (!this.anim || this.anim.frames.length < 2) return false;
    this.tick++;
    if (this.tick < this.anim.frames[this.frameIdx].time) return false;
    this.tick = 0;
    this.frameIdx = (this.frameIdx + 1) % this.anim.frames.length;
    this.copyFrame(this.anim.frames[this.frameIdx].index);
    this.tex.needsUpdate = true;
    return true;
  }

  dispose() { this.tex.dispose(); }
}

/** Parses a .png.mcmeta "animation" section against the texture size. Null if not animated. */
export function parseMcmeta(text: string, img: Rgba): McAnimation | null {
  let json: { animation?: { frametime?: number; frames?: (number | { index: number; time?: number })[]; width?: number; height?: number } };
  try { json = JSON.parse(text); } catch { return null; }
  const a = json.animation;
  if (!a) return null;
  let fw = a.width ?? 0, fh = a.height ?? 0;
  if (!fw && !fh) { fw = fh = Math.min(img.width, img.height); }
  else if (!fw) fw = img.width;
  else if (!fh) fh = img.height;
  const count = Math.max(1, Math.floor(img.width / fw) * Math.floor(img.height / fh));
  const frameTime = Math.max(1, a.frametime ?? 1);
  const frames = (a.frames ?? [...Array(count).keys()])
    .map((f) => (typeof f === "number" ? { index: f, time: frameTime } : { index: f.index, time: Math.max(1, f.time ?? frameTime) }))
    .filter((f) => f.index >= 0 && f.index < count);
  if (frames.length === 0) return null;
  return { frameTime, frames, frameW: fw, frameH: fh };
}

const GRAY: Rgba = { width: 1, height: 1, data: new Uint8Array([128, 128, 128, 255]) };
export const missingTexture = () => new SceneTexture(GRAY);
