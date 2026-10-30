declare module "upng-js" {
  interface Image { width: number; height: number; depth: number; ctype: number; frames: unknown[]; tabs: Record<string, unknown>; data: ArrayBuffer }
  const UPNG: {
    decode(buf: ArrayBuffer): Image;
    toRGBA8(img: Image): ArrayBuffer[];
  };
  export default UPNG;
}
