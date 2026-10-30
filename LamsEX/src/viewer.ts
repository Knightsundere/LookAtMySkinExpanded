// The 3D view: model placement, LAMS-style rotate/pose/zoom controls, on-demand rendering.

import * as THREE from "three";
import { disposeObject, type PickInfo } from "./geometry";
import { alphaAt } from "./png";
import type { BuiltModel } from "./models/common";

const FOV = 35;
const DRAG_DEG_PER_PX = 0.5;
const DEFAULT_VIEW: Record<BuiltModel["kind"], { yaw: number; pitch: number }> = {
  skin: { yaw: 25, pitch: 10 },
  block: { yaw: 0, pitch: 0 }, // blocks already get the inventory ("gui") angle
  item: { yaw: 0, pitch: 0 },
  entity: { yaw: 25, pitch: 10 }, // entities are turned to face the camera by their base rotation
};

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 5000);
  private pivot = new THREE.Group(); // user rotation
  private base = new THREE.Group(); // model's own display rotation
  private center = new THREE.Group(); // puts the model's middle at the origin
  private model: BuiltModel | null = null;
  private yaw = 0;
  private pitch = 0;
  private zoom = 1;
  private fitDistance = 60;
  private renderQueued = false;
  private animTimer: number | null = null;
  private raycaster = new THREE.Raycaster();
  private drag: { mode: "model" | "part"; part?: THREE.Object3D; x: number; y: number } | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.scene.add(this.pivot);
    this.pivot.add(this.base);
    this.base.add(this.center);
    this.scene.background = new THREE.Color("#000000");
    window.addEventListener("resize", () => this.resize());
    this.resize();
    this.bindInput();
  }

  // ---------- rendering ----------

  requestRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.renderNow();
    });
  }

  private renderNow() {
    this.camera.position.set(0, 0, this.fitDistance * this.zoom);
    this.camera.lookAt(0, 0, 0);
    this.renderer.render(this.scene, this.camera);
  }

  private resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  setBackground(hex: string) {
    (this.scene.background as THREE.Color).set(hex);
    this.requestRender();
  }

  // ---------- model ----------

  get current() { return this.model; }

  /** Show a model. keepView keeps rotation, zoom, poses and framing (used by live reload). */
  setModel(m: BuiltModel, keepView: boolean) {
    const old = this.model;
    const poses = new Map<string, THREE.Quaternion>();
    if (keepView && old) old.parts.forEach((p, name) => poses.set(name, p.quaternion.clone()));
    if (old) {
      this.center.remove(old.object);
      disposeObject(old.object);
      old.textures.forEach((t) => t.dispose());
    }
    this.model = m;
    this.center.add(m.object);
    this.base.quaternion.setFromEuler(m.baseRotation);
    m.parts.forEach((p, name) => { const q = poses.get(name); if (q) p.quaternion.copy(q); });
    if (!keepView || !old || old.kind !== m.kind) {
      this.fit();
      this.resetAll();
    }
    this.setupAnimation();
    this.requestRender();
  }

  private fit() {
    if (!this.model) return;
    this.center.position.set(0, 0, 0);
    this.model.object.updateMatrixWorld(true);
    const box = new THREE.Box3();
    // Bounds in the model's own frame (before display/user rotation).
    const inv = new THREE.Matrix4().copy(this.model.object.matrixWorld).invert();
    this.model.object.traverse((o) => {
      if (o instanceof THREE.Mesh && o.geometry.boundingBox) {
        box.union(o.geometry.boundingBox.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)));
      }
    });
    if (box.isEmpty()) box.set(new THREE.Vector3(-8, -8, -8), new THREE.Vector3(8, 8, 8));
    const c = box.getCenter(new THREE.Vector3());
    this.center.position.copy(c).negate();
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 1);
    this.fitDistance = (radius / Math.sin(THREE.MathUtils.degToRad(FOV / 2))) * 1.15;
  }

  private applyRotation() {
    const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(this.yaw));
    const qx = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(this.pitch));
    this.pivot.quaternion.copy(qx.multiply(qy));
    this.requestRender();
  }

  resetRotation() {
    const v = DEFAULT_VIEW[this.model?.kind ?? "skin"];
    this.yaw = v.yaw;
    this.pitch = v.pitch;
    this.applyRotation();
  }
  resetZoom() { this.zoom = 1; this.requestRender(); }
  /** Back to the pose the model was saved in (bones of Blockbench/GeckoLib models can start rotated). */
  resetPoses() {
    this.model?.parts.forEach((p) => (p.userData.rest ? p.quaternion.copy(p.userData.rest) : p.quaternion.identity()));
    this.requestRender();
  }
  resetAll() { this.resetPoses(); this.resetZoom(); this.resetRotation(); }

  private setupAnimation() {
    if (this.animTimer !== null) { clearInterval(this.animTimer); this.animTimer = null; }
    const animated = this.model?.textures.filter((t) => t.anim) ?? [];
    if (animated.length === 0) return;
    this.animTimer = window.setInterval(() => {
      let changed = false;
      for (const t of animated) changed = t.step() || changed;
      if (changed) this.requestRender();
    }, 50);
  }

  /** PNG of the 3D view only (no HUD). */
  async screenshot(): Promise<Uint8Array> {
    this.renderNow();
    const blob = await new Promise<Blob | null>((res) => this.canvas.toBlob(res, "image/png"));
    if (!blob) throw new Error("screenshot failed");
    return new Uint8Array(await blob.arrayBuffer());
  }

  // ---------- input ----------

  private pick(clientX: number, clientY: number): PickInfo | null | "empty" {
    if (!this.model) return "empty";
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.camera.position.set(0, 0, this.fitDistance * this.zoom);
    this.camera.updateMatrixWorld();
    this.scene.updateMatrixWorld(true);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObject(this.model.object, true);
    for (const h of hits) {
      if (h.object.userData.noPick || !h.uv) continue;
      const pick = h.object.userData.pick as PickInfo | undefined;
      if (!pick) continue;
      const img = pick.texture.view;
      const x = Math.floor(h.uv.x * img.width), y = Math.floor(h.uv.y * img.height);
      if (alphaAt(img, x, y) === 0) continue; // see-through pixel: keep looking behind it
      return pick;
    }
    return "empty";
  }

  private bindInput() {
    const c = this.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("pointerdown", (e) => {
      if (e.button === 1) { e.preventDefault(); this.resetZoom(); return; }
      if (e.button !== 0) return;
      try { c.setPointerCapture(e.pointerId); } catch { /* synthetic or stale pointer */ }
      const hit = this.pick(e.clientX, e.clientY);
      const part = hit !== "empty" && hit?.part ? hit.part : null;
      this.drag = part ? { mode: "part", part, x: e.clientX, y: e.clientY } : { mode: "model", x: e.clientX, y: e.clientY };
    });
    c.addEventListener("pointermove", (e) => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
      if (this.drag.mode === "model") {
        this.yaw += dx * DRAG_DEG_PER_PX;
        this.pitch += dy * DRAG_DEG_PER_PX;
        this.applyRotation();
      } else if (this.drag.part) {
        this.rotatePart(this.drag.part, dx, dy);
      }
    });
    const end = (e: PointerEvent) => {
      if (this.drag && c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId);
      this.drag = null;
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const step = Math.sign(e.deltaY);
      this.zoom = THREE.MathUtils.clamp(this.zoom * (step > 0 ? 1.1 : 1 / 1.1), 0.15, 6);
      this.requestRender();
    }, { passive: false });
  }

  /**
   * Posing works like LookAtMySkin's ObjectRotator:
   * - Heads nod around their own side-to-side axis and turn around the body's vertical axis,
   *   so they never roll sideways.
   * - Limbs swing in the screen plane (drag left/right) and toward or away from the viewer
   *   (drag up/down). They never spin around their own length, so arms can't be turned inside out.
   * Drags move the grabbed end of the part along with the mouse.
   */
  private rotatePart(part: THREE.Object3D, dx: number, dy: number) {
    const rad = THREE.MathUtils.degToRad(DRAG_DEG_PER_PX);
    if (part.userData.poseStyle === "head") {
      // Turn: around the parent's up axis. Nod: around the head's own x axis; entity models face -z,
      // so their nod is reversed to keep "drag down = look down".
      const front = part.userData.front ?? 1;
      part.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * rad));
      part.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * rad * front));
    } else {
      // Screen axes: the camera looks down -z, so "into the screen" is z and "screen right" is x.
      const qWorld = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), dx * rad)
        .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * rad));
      const parentQ = new THREE.Quaternion();
      part.parent!.getWorldQuaternion(parentQ);
      const local = parentQ.clone().invert().multiply(qWorld).multiply(parentQ);
      part.quaternion.premultiply(local);
    }
    this.requestRender();
  }
}
