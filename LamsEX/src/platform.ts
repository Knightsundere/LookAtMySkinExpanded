// File access, isolated so the rest of the app doesn't care whether it runs
// inside Tauri or (for development/testing) in a plain browser via the Vite bridge.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";

export interface Platform {
  exeDir(): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  pathKind(path: string): Promise<"file" | "dir" | "none">;
  listFiles(dir: string): Promise<string[]>;
  /** All model .json texts under <root>/assets/<ns>/models, as [path relative to root, text]. */
  readAllModels(root: string): Promise<[string, string][]>;
  watchFiles(paths: string[]): Promise<void>;
  onFileChange(cb: (path: string) => void): void;
  pickFile(title: string, filters: { name: string; extensions: string[] }[]): Promise<string | null>;
}

const isTauri = "__TAURI_INTERNALS__" in window;

const tauriPlatform: Platform = {
  exeDir: () => invoke<string>("exe_dir"),
  async readFile(path) {
    const buf = await invoke<ArrayBuffer>("read_file", { path });
    return new Uint8Array(buf);
  },
  async writeFile(path, data) {
    await invoke("write_file", data, { headers: { path: encodeURIComponent(path) } });
  },
  pathKind: (path) => invoke("path_kind", { path }),
  listFiles: (dir) => invoke("list_files", { dir }),
  readAllModels: (root) => invoke("read_all_models", { root }),
  watchFiles: (paths) => invoke("watch_files", { paths }),
  onFileChange(cb) {
    void listen<{ path: string }>("fs-change", (e) => cb(e.payload.path));
  },
  async pickFile(title, filters) {
    const r = await open({ title, multiple: false, directory: false, filters });
    return typeof r === "string" ? r : null;
  },
};

// Dev bridge (see vite.config.ts). Watching is polled, file picking goes through window.lamsOpen().
const devPlatform: Platform = (() => {
  const q = (op: string, path = "") => `/__devfs/${op}?path=${encodeURIComponent(path)}`;
  const ok = async (r: Response) => { if (!r.ok) throw new Error(await r.text()); return r; };
  let watched: string[] = [];
  const stamps = new Map<string, string>();
  const listeners: ((p: string) => void)[] = [];
  const sig = async (p: string) => {
    try { const b = new Uint8Array(await (await ok(await fetch(q("read_file", p)))).arrayBuffer()); let h = 0; for (const x of b) h = (h * 31 + x) | 0; return `${b.length}:${h}`; }
    catch { return "missing"; }
  };
  setInterval(async () => {
    for (const p of watched) {
      const s = await sig(p);
      if (stamps.has(p) && stamps.get(p) !== s) listeners.forEach((cb) => cb(p));
      stamps.set(p, s);
    }
  }, 500);
  return {
    exeDir: async () => (await (await ok(await fetch(q("exe_dir")))).json()),
    readFile: async (p) => new Uint8Array(await (await ok(await fetch(q("read_file", p)))).arrayBuffer()),
    async writeFile(p, data) { await ok(await fetch(q("write_file", p), { method: "POST", body: data as BodyInit })); },
    pathKind: async (p) => (await (await ok(await fetch(q("path_kind", p)))).json()),
    listFiles: async (p) => (await (await ok(await fetch(q("list_files", p)))).json()),
    readAllModels: async (p) => (await (await ok(await fetch(q("read_all_models", p)))).json()),
    async watchFiles(paths) { watched = paths; stamps.clear(); for (const p of paths) stamps.set(p, await sig(p)); },
    onFileChange(cb) { listeners.push(cb); },
    async pickFile(title) { try { return window.prompt(title + " (full path)"); } catch { return null; } },
  };
})();

export const platform: Platform = isTauri ? tauriPlatform : devPlatform;

// ---- path helpers (paths are kept with the OS separators the user gave us) ----

export const toSlash = (p: string) => p.replace(/\\/g, "/");
export const baseName = (p: string) => toSlash(p).split("/").pop() ?? p;
export const dirName = (p: string) => {
  const s = toSlash(p);
  const i = s.lastIndexOf("/");
  return i < 0 ? "" : s.slice(0, i);
};
export const joinPath = (...parts: string[]) =>
  parts.filter(Boolean).map((p, i) => (i === 0 ? toSlash(p).replace(/\/+$/, "") : toSlash(p).replace(/^\/+|\/+$/g, ""))).join("/");
