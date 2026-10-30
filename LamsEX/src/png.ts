// PNG decoding to straight (non-premultiplied) RGBA8, whatever the source bit depth,
// palette or tRNS chunk. Done in JS rather than via <img>/canvas so alpha stays exact.

import UPNG from "upng-js";

export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array; // width * height * 4, row 0 = top
}

export function decodePng(bytes: Uint8Array): Rgba {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const img = UPNG.decode(buf);
  if (!img.width || !img.height) throw new Error("not a PNG");
  const frames = UPNG.toRGBA8(img);
  return { width: img.width, height: img.height, data: new Uint8Array(frames[0]) };
}

export const alphaAt = (img: Rgba, x: number, y: number) =>
  x < 0 || y < 0 || x >= img.width || y >= img.height ? 0 : img.data[(y * img.width + x) * 4 + 3];
