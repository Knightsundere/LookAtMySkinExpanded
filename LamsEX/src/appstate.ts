// What LamsEX remembers between launches: window size and the model that was open.
// Kept in state.json next to the app (like config.txt), and rewritten whenever it changes.

import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { platform, joinPath } from "./platform";

export interface AppState {
  window?: { width: number; height: number; maximized: boolean };
  /** The opened file, its arm type for skins, and the texture picked for a .geo.json. */
  model?: { path: string; slim?: boolean; texture?: string };
}

const isTauri = "__TAURI_INTERNALS__" in window;
let state: AppState = {};
let statePath = "";
let saveTimer: number | undefined;

export async function loadState(): Promise<AppState> {
  statePath = joinPath(await platform.exeDir(), "state.json");
  try {
    if ((await platform.pathKind(statePath)) === "file") state = JSON.parse(new TextDecoder().decode(await platform.readFile(statePath)));
  } catch { state = {}; } // unreadable: start fresh, it's rewritten on the next change
  return state;
}

export function updateState(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void platform.writeFile(statePath, new TextEncoder().encode(JSON.stringify(state, null, 2))).catch(() => undefined);
  }, 300);
}

/** Restores the saved window size, shows the window (it starts hidden), then tracks resizes. */
export async function restoreWindow() {
  if (!isTauri) return;
  const win = getCurrentWindow();
  try {
    const w = state.window;
    if (w && w.width >= 100 && w.height >= 100) {
      await win.setSize(new LogicalSize(w.width, w.height));
      await win.center();
      if (w.maximized) await win.maximize();
    }
  } finally {
    await win.show();
  }
  await win.onResized(async () => {
    const maximized = await win.isMaximized();
    if (maximized) { updateState({ window: { ...(state.window ?? { width: 1280, height: 720 }), maximized } }); return; }
    const size = (await win.innerSize()).toLogical(await win.scaleFactor());
    if (size.width < 100 || size.height < 100) return; // minimized
    updateState({ window: { width: Math.round(size.width), height: Math.round(size.height), maximized: false } });
  });
}
