// config.txt: a hand-editable file next to the app. Bad lines are reported and skipped.

import { platform, joinPath } from "./platform";

export interface BgColor { name: string; hex: string }

export interface Config {
  colors: BgColor[];
  resources: string[];
  entityLibrary: string | null;
  /** Programs (exe names) that LamsEX floats over while they're in front. Empty = off. */
  onTopWith: string[];
  keys: Record<KeyAction, string>;
}

export type KeyAction = "brighter" | "darker" | "reset_all" | "reset_rotation" | "arm_type" | "screenshot" | "on_top";

const DEFAULT_KEYS: Record<KeyAction, string> = {
  brighter: "ArrowUp",
  darker: "ArrowDown",
  reset_all: "Space",
  reset_rotation: "Backspace",
  arm_type: "M",
  screenshot: "F2",
  on_top: "T",
};

const DEFAULT_ON_TOP_WITH = ["paintdotnet.exe"];

export const DEFAULT_CONFIG_TEXT = `# LamsEX settings. Lines starting with # are comments.

# Background colors, in click order: color <name> = <hex>
color Void = #ffffff
color Periwinkle = #CCCCFF
color Cosmica = #422718

# Resource folders, first match wins. Each one contains an "assets" folder
# (an extracted Minecraft .jar, an unzipped resource pack or mod).
# A .jar or .zip file can be listed directly too.
# resources = C:\\Minecraft\\extracted\\1.20.1
# resources = C:\\Minecraft\\packs\\MyPack

# Entity model library (v2)
# entity_library = C:\\Minecraft\\entity_models

# Stay on top of the screen while one of these programs is the active window,
# so you can paint and watch the model at once. Clicking into LamsEX keeps it on
# top; switching to any other program lets it go behind again. Comma-separated
# exe names; "none" turns it off. Key T (key_on_top) switches it off/on for now.
on_top_with = paintdotnet.exe

# Keys (names as in the browser KeyboardEvent: ArrowUp, Space, Backspace, M, F2, ...)
key_brighter = ArrowUp
key_darker = ArrowDown
key_reset_all = Space
key_reset_rotation = Backspace
key_arm_type = M
key_screenshot = F2
key_on_top = T
`;

export function parseConfig(text: string): { config: Config; errors: string[] } {
  const config: Config = { colors: [], resources: [], entityLibrary: null, onTopWith: [...DEFAULT_ON_TOP_WITH], keys: { ...DEFAULT_KEYS } };
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    const n = i + 1;
    if (!line || line.startsWith("#")) return;
    const eq = line.indexOf("=");
    if (eq < 0) { errors.push(`config.txt line ${n}: expected "name = value"`); return; }
    const left = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    const lower = left.toLowerCase();
    if (lower.startsWith("color ")) {
      const name = left.slice(6).trim();
      const hex = value.startsWith("#") ? value : "#" + value;
      if (!name) errors.push(`config.txt line ${n}: color needs a name`);
      else if (!/^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(hex)) errors.push(`config.txt line ${n}: "${value}" is not a hex color`);
      else config.colors.push({ name, hex: expandHex(hex) });
    } else if (lower === "resources") {
      if (!value) errors.push(`config.txt line ${n}: resources needs a folder path`);
      else config.resources.push(stripQuotes(value));
    } else if (lower === "entity_library") {
      config.entityLibrary = stripQuotes(value) || null;
    } else if (lower === "on_top_with") {
      const v = value.toLowerCase();
      config.onTopWith = v === "" || v === "none" || v === "off"
        ? []
        : value.split(",").map((x) => stripQuotes(x.trim())).filter(Boolean);
    } else if (lower.startsWith("key_")) {
      const action = lower.slice(4) as KeyAction;
      if (!(action in DEFAULT_KEYS)) errors.push(`config.txt line ${n}: unknown key setting "${left}"`);
      else if (!value) errors.push(`config.txt line ${n}: ${left} needs a key name`);
      else config.keys[action] = value;
    } else {
      errors.push(`config.txt line ${n}: unknown setting "${left}"`);
    }
  });
  if (config.colors.length === 0) config.colors.push({ name: "Void", hex: "#ffffff" });
  return { config, errors };
}

const stripQuotes = (s: string) => s.replace(/^"(.*)"$/, "$1");
const expandHex = (h: string) =>
  h.length === 4 ? "#" + [...h.slice(1)].map((c) => c + c).join("") : h.toLowerCase();

/** Loads config.txt from next to the app, creating it with defaults if missing. */
export async function loadConfig(): Promise<{ config: Config; errors: string[]; path: string }> {
  const dir = await platform.exeDir();
  const path = joinPath(dir, "config.txt");
  let text: string;
  if ((await platform.pathKind(path)) === "file") {
    text = new TextDecoder().decode(await platform.readFile(path));
  } else {
    text = DEFAULT_CONFIG_TEXT;
    try { await platform.writeFile(path, new TextEncoder().encode(text.replace(/\n/g, "\r\n"))); } catch { /* read-only folder: run on defaults */ }
  }
  return { ...parseConfig(text), path };
}

/** True when a keyboard event matches a configured key name like "M", "Space", "ArrowUp", "F2". */
export function keyMatches(e: KeyboardEvent, name: string): boolean {
  const n = name.toLowerCase();
  if (e.code.toLowerCase() === n || e.key.toLowerCase() === n) return true;
  if (n === "space" && e.key === " ") return true;
  if (n.length === 1 && (e.code.toLowerCase() === "key" + n || e.code.toLowerCase() === "digit" + n)) return true;
  return false;
}
