// HUD buttons: Owen's button art sliced into left edge / stretchable middle / right edge,
// drawn at a whole-number pixel scale so the pixels stay crisp.

import { decodePng, type Rgba } from "./png";

type State = "normal" | "hover" | "press";

// Button widths in native art pixels, per slot (1-4 left, 5-8 right).
const FULL_SLOTS = [1, 2, 5, 6];
const WIDE_SLOTS = [3, 7]; // ~92 %
const LABEL_COLOR = "#2F2F35";
const EDGE = 3; // native px of bevel on each side
const TEXT_LEFT = 5; // native px from the button's left edge
const TEXT_BASELINE = 5; // native px from the bottom
const TEXT_RIGHT = 5;
const FONT_SIZE = 11; // native px
const MIN_FONT_SIZE = 7;

export interface SlotSpec { label: string; action: () => void }

/** Most art is shipped pre-enlarged; find the factor so it can be reduced to 1x. */
function nativeScale(img: Rgba): number {
  for (let k = 8; k > 1; k--) {
    if (img.width % k || img.height % k) continue;
    let ok = true;
    outer: for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
      const a = (y * img.width + x) * 4, b = (Math.floor(y / k) * k * img.width + Math.floor(x / k) * k) * 4;
      for (let c = 0; c < 4; c++) if (img.data[a + c] !== img.data[b + c]) { ok = false; break outer; }
    }
    if (ok) return k;
  }
  return 1;
}

function downscale(img: Rgba, k: number): Rgba {
  const w = img.width / k, h = img.height / k;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * k * img.width + x * k) * 4;
    data.set(img.data.subarray(s, s + 4), (y * w + x) * 4);
  }
  return { width: w, height: h, data };
}

/** Left edge + middle resampled (nearest) to the new width + right edge, at native scale. */
function composeWidth(art: Rgba, width: number): Rgba {
  const h = art.height, mid = art.width - 2 * EDGE, outMid = width - 2 * EDGE;
  const data = new Uint8Array(width * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < width; x++) {
    let sx: number;
    if (x < EDGE) sx = x;
    else if (x >= width - EDGE) sx = art.width - (width - x);
    else sx = EDGE + Math.min(mid - 1, Math.floor(((x - EDGE) * mid) / outMid));
    data.set(art.data.subarray((y * art.width + sx) * 4, (y * art.width + sx) * 4 + 4), (y * width + x) * 4);
  }
  return { width, height: h, data };
}

const toCanvas = (img: Rgba) => {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  c.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
};

class HudButton {
  readonly el = document.createElement("canvas");
  private state: State = "normal";
  private spec: SlotSpec | null = null;
  private art: Record<State, HTMLCanvasElement> | null = null;
  private native: Rgba | null = null;
  private scale = 1;
  private pressing = false;

  constructor(readonly slot: number, private nativeWidth: number) {
    this.el.className = "hud-button hud-slot-hidden";
    // Press look only for a press that started on this button, not one dragged in from elsewhere.
    this.el.addEventListener("pointermove", (e) => this.setState(this.inside(e) ? (this.pressing ? "press" : "hover") : "normal"));
    this.el.addEventListener("pointerleave", () => this.setState("normal"));
    this.el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || !this.inside(e)) return;
      try { this.el.setPointerCapture(e.pointerId); } catch { /* synthetic or stale pointer */ }
      this.pressing = true;
      this.setState("press");
    });
    this.el.addEventListener("pointerup", (e) => {
      const wasPressing = this.pressing;
      this.pressing = false;
      const inside = this.inside(e);
      this.setState(inside ? "hover" : "normal");
      if (wasPressing && inside) this.spec?.action();
    });
    this.el.addEventListener("pointercancel", () => { this.pressing = false; this.setState("normal"); });
  }

  /** Exact pixel area of the art: fully transparent pixels don't count. */
  private inside(e: PointerEvent) {
    const r = this.el.getBoundingClientRect();
    if (!this.native) return false;
    const x = Math.floor(((e.clientX - r.left) / r.width) * this.native.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * this.native.height);
    if (x < 0 || y < 0 || x >= this.native.width || y >= this.native.height) return false;
    return this.native.data[(y * this.native.width + x) * 4 + 3] !== 0;
  }

  set(spec: SlotSpec | null) {
    this.spec = spec;
    this.el.classList.toggle("hud-slot-hidden", !spec);
    this.draw();
  }

  layout(arts: Record<State, Rgba>, scale: number) {
    this.scale = scale;
    this.native = composeWidth(arts.normal, this.nativeWidth);
    this.art = {
      normal: toCanvas(this.native),
      hover: toCanvas(composeWidth(arts.hover, this.nativeWidth)),
      press: toCanvas(composeWidth(arts.press, this.nativeWidth)),
    };
    const dpr = window.devicePixelRatio || 1;
    this.el.width = this.native.width * scale;
    this.el.height = this.native.height * scale;
    this.el.style.width = `${this.el.width / dpr}px`;
    this.el.style.height = `${this.el.height / dpr}px`;
    this.draw();
  }

  private setState(s: State) {
    if (s === this.state) return;
    this.state = s;
    this.draw();
  }

  private draw() {
    if (!this.art || !this.spec) return;
    const ctx = this.el.getContext("2d")!;
    const s = this.scale;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, this.el.width, this.el.height);
    ctx.drawImage(this.art[this.state], 0, 0, this.el.width, this.el.height);
    // Label: bottom-left, shrunk to fit, then cut with "..."
    const maxW = (this.native!.width - TEXT_LEFT - TEXT_RIGHT) * s;
    let size = FONT_SIZE;
    let text = this.spec.label;
    const setFont = () => (ctx.font = `${size * s}px "Volume Dealer"`);
    setFont();
    while (ctx.measureText(text).width > maxW && size > MIN_FONT_SIZE) { size -= 0.5; setFont(); }
    if (ctx.measureText(text).width > maxW) {
      while (text.length > 1 && ctx.measureText(text + "...").width > maxW) text = text.slice(0, -1);
      text += "...";
    }
    ctx.fillStyle = LABEL_COLOR;
    ctx.textBaseline = "alphabetic";
    ctx.fillText(text, TEXT_LEFT * s, (this.native!.height - TEXT_BASELINE) * s);
  }
}

export class Hud {
  private buttons = new Map<number, HudButton>();
  private arts: Record<State, Rgba> | null = null;
  private fullWidth = 82;

  constructor(private left: HTMLElement, private right: HTMLElement) {
    window.addEventListener("resize", () => this.layout());
  }

  async init() {
    const load = async (name: string) => decodePng(new Uint8Array(await (await fetch(`/ui/${name}.png`)).arrayBuffer()));
    const [n, h, p] = await Promise.all([load("buttontemplate"), load("buttonhover"), load("buttonpress")]);
    const k = nativeScale(n);
    this.arts = { normal: downscale(n, k), hover: downscale(h, k), press: downscale(p, k) };
    this.fullWidth = this.arts.normal.width;
    for (let slot = 1; slot <= 8; slot++) {
      const f = FULL_SLOTS.includes(slot) ? 1 : WIDE_SLOTS.includes(slot) ? 0.92 : 0.64;
      const b = new HudButton(slot, Math.round(this.fullWidth * f));
      this.buttons.set(slot, b);
      (slot <= 4 ? this.left : this.right).appendChild(b.el);
    }
    await document.fonts.load(`20px "Volume Dealer"`).catch(() => undefined);
    this.layout();
  }

  setSlot(slot: number, spec: SlotSpec | null) { this.buttons.get(slot)?.set(spec); }

  private layout() {
    if (!this.arts) return;
    const dpr = window.devicePixelRatio || 1;
    const quarter = (window.innerWidth * dpr) / 4;
    let scale = 1;
    while ((this.fullWidth + 2) * (scale + 1) <= quarter) scale++;
    const gap = `${(2 * scale) / dpr}px`;
    for (const col of [this.left, this.right]) {
      col.style.padding = gap;
      col.style.gap = gap;
    }
    this.buttons.forEach((b) => b.layout(this.arts!, scale));
  }
}
