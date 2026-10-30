import { platform, baseName, dirName, joinPath, toSlash } from "./platform";
import { loadConfig, keyMatches, type Config } from "./config";
import { Resources, locateInAssets, parseId } from "./resources";
import { decodePng } from "./png";
import { SceneTexture, parseMcmeta, missingTexture } from "./textures";
import { Viewer } from "./viewer";
import { Hud } from "./hud";
import { EntityLibrary } from "./library";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { loadState, restoreWindow, updateState, type AppState } from "./appstate";
import { buildSkin, guessSlim, skinFormat } from "./models/player";
import { buildJsonModel, resolveModel, type ModelLoader } from "./models/blockmodel";
import { buildEntity, dataUrlBytes, isBedrockGeometry, parseBbmodel, parseBedrock, type BbTexture } from "./models/entity";
import type { BuiltModel } from "./models/common";

// ---------- errors ----------

const errorEl = document.getElementById("error")!;
let errorTimer: number | undefined;
function showError(msg: string) {
  errorEl.textContent = msg;
  errorEl.classList.add("show");
  clearTimeout(errorTimer);
  errorTimer = window.setTimeout(() => errorEl.classList.remove("show"), 4000);
}

class LoadError extends Error {}

// ---------- state ----------

const viewer = new Viewer(document.getElementById("view") as HTMLCanvasElement);
const hud = new Hud(document.getElementById("hud-left")!, document.getElementById("hud-right")!);
let config: Config;
let configPath = "";
let resources = new Resources([]);
let library = new EntityLibrary(null);

/** What is open, so live reload can rebuild it the same way. */
interface Session { path: string; build: () => Promise<BuiltModel>; slim?: boolean; texture?: string }
let session: Session | null = null;

// ---------- background ----------

let bgIndex = 0;
let bgValue = 0; // HSV value, 0-100
let bgHS: [number, number] = [0, 0];

function hexToHsv(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16 & 255) / 255, g = (n >> 8 & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max * 100];
}
function hsvToHex(h: number, s: number, v: number) {
  const val = v / 100, c = val * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = val - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [r, g, b].map((k) => Math.round((k + m) * 255).toString(16).padStart(2, "0")).join("");
}
function selectColor(i: number) {
  bgIndex = ((i % config.colors.length) + config.colors.length) % config.colors.length;
  const c = config.colors[bgIndex];
  const [h, s, v] = hexToHsv(c.hex);
  bgHS = [h, s];
  bgValue = Math.round(v);
  viewer.setBackground(c.hex);
  hud.setSlot(2, { label: c.name.toLowerCase(), action: () => selectColor(bgIndex + 1) });
}
function stepBrightness(d: number) {
  bgValue = Math.max(0, Math.min(100, bgValue + d));
  viewer.setBackground(hsvToHex(bgHS[0], bgHS[1], bgValue));
}

// ---------- loading ----------

async function readPngTexture(bytes: Uint8Array, mcmeta: Uint8Array | null): Promise<SceneTexture> {
  const img = decodePng(bytes);
  const anim = mcmeta ? parseMcmeta(new TextDecoder().decode(mcmeta), img) : null;
  return new SceneTexture(img, anim);
}

const modelLoader: ModelLoader = {
  // Sources are prepared per opened file, so this covers both config.txt folders and the file's own folder.
  get hasResources() { return resources.hasSources; },
  async loadParent(id, childFile) {
    const found = await resources.readModelJson(id);
    if (found) return { json: JSON.parse(new TextDecoder().decode(found.bytes)), file: found.realPath };
    // Standalone model: parent sitting next to the child file.
    if (childFile) {
      const p = joinPath(dirName(childFile), baseName(parseId(id).path) + ".json");
      const self = toSlash(p).toLowerCase() === toSlash(childFile).toLowerCase(); // item and block models often share a name
      if (!self && (await platform.pathKind(p)) === "file") return { json: JSON.parse(new TextDecoder().decode(await platform.readFile(p))), file: p };
    }
    return null;
  },
  async loadTexture(id, modelFile) {
    const found = await resources.readTexture(id);
    if (found) {
      const meta = await resources.readMcmeta(id);
      return { texture: await readPngTexture(found.bytes, meta?.bytes ?? null), file: found.realPath };
    }
    if (modelFile) {
      const p = joinPath(dirName(modelFile), baseName(parseId(id).path) + ".png");
      if ((await platform.pathKind(p)) === "file") {
        const metaPath = p + ".mcmeta";
        const meta = (await platform.pathKind(metaPath)) === "file" ? await platform.readFile(metaPath) : null;
        return { texture: await readPngTexture(await platform.readFile(p), meta), file: p };
      }
    }
    return null;
  },
};

async function readOrFail(path: string) {
  try { return await platform.readFile(path); } catch { throw new LoadError(`Couldn't read ${baseName(path)}.`); }
}

async function readJson(path: string) {
  try { return JSON.parse(new TextDecoder().decode(await readOrFail(path))); }
  catch (e) { throw e instanceof LoadError ? e : new LoadError(`Couldn't read ${baseName(path)}.`); }
}

async function buildModelFile(path: string): Promise<BuiltModel> {
  const loc = locateInAssets(path, "models");
  await resources.prepare(loc?.root ?? null);
  const json = await readJson(path);
  if (typeof json !== "object" || !json || !(json.parent || json.elements || json.textures))
    throw new LoadError("Unknown file type.");
  const resolved = await resolveModel(json, path, modelLoader);
  const id = loc?.id ?? `minecraft:${baseName(path).replace(/\.json$/i, "")}`;
  return (await codeDrawn(id, resolved)) ?? buildJsonModel(resolved, path, modelLoader);
}

async function buildModelId(id: string): Promise<BuiltModel> {
  const found = await resources.readModelJson(id);
  if (!found) throw new LoadError(`Missing parent model: ${id}`);
  const json = JSON.parse(new TextDecoder().decode(found.bytes));
  const resolved = await resolveModel(json, found.realPath, modelLoader);
  return (await codeDrawn(id, resolved)) ?? buildJsonModel(resolved, found.realPath, modelLoader);
}

/** Chests, beds, signs...: no geometry in their .json, so look for them in the entity library. */
async function codeDrawn(id: string, resolved: Awaited<ReturnType<typeof resolveModel>>): Promise<BuiltModel | null> {
  if (!resolved.builtinEntity && (resolved.elements || resolved.generated)) return null;
  const { match, errors } = await library.findForModel(id);
  if (errors.length) showError(errors[0]);
  if (!match) return null;
  return buildEntityFile(match.file, match.textureId ? { id: match.textureId } : "auto", resolved.files);
}

// ---------- entity models (.bbmodel / .geo.json) ----------

/** Where an entity model's texture comes from: a file, a resource id, or nowhere (draws gray). */
type TexRef = { path: string } | { id: string } | null;

async function loadTextureFile(path: string): Promise<SceneTexture> {
  const metaPath = path + ".mcmeta";
  const meta = (await platform.pathKind(metaPath)) === "file" ? await platform.readFile(metaPath) : null;
  return readPngTexture(await readOrFail(path), meta);
}

async function loadTexRef(ref: TexRef): Promise<{ texture: SceneTexture; file: string | null } | null> {
  if (!ref) return null;
  if ("path" in ref) return { texture: await loadTextureFile(ref.path), file: ref.path };
  return modelLoader.loadTexture(ref.id, null);
}

const geoName = (p: string) => baseName(p).replace(/\.geo\.json$/i, "").replace(/\.json$/i, "");

/** GeckoLib convention: assets/<ns>/geo/<name>.geo.json uses assets/<ns>/textures/entity/<name>.png
 *  (sometimes in a subfolder); otherwise a PNG with the same name next to the model. */
async function findGeoTexture(geoPath: string): Promise<string | null> {
  const name = geoName(geoPath).toLowerCase();
  const loc = locateInAssets(geoPath, "geo");
  if (loc) {
    const sub = loc.sub.replace(/\.geo$/i, "");
    const texDir = joinPath(loc.root, "assets", loc.ns, "textures");
    for (const rel of [`entity/${sub.replace(/^entity\//, "")}.png`, `${sub}.png`]) {
      const p = joinPath(texDir, rel);
      if ((await platform.pathKind(p)) === "file") return p;
    }
    const all = await platform.listFiles(texDir).catch(() => [] as string[]);
    const hits = all.filter((f) => baseName(f).toLowerCase() === name + ".png")
      .sort((a, b) => Number(!a.startsWith("entity/")) - Number(!b.startsWith("entity/")));
    if (hits.length) return joinPath(texDir, hits[0]);
  }
  const beside = joinPath(dirName(geoPath), geoName(geoPath) + ".png");
  return (await platform.pathKind(beside)) === "file" ? beside : null;
}

/** For a texture in a resource folder: a GeckoLib model with the same name in that namespace's geo/ folder. */
async function findGeoForTexture(root: string, ns: string, sub: string): Promise<string | null> {
  const geoDir = joinPath(root, "assets", ns, "geo");
  const all = (await platform.listFiles(geoDir).catch(() => [] as string[])).filter((f) => /\.json$/i.test(f));
  const name = sub.split("/").pop()!.toLowerCase();
  const exact = all.find((f) => f.toLowerCase() === `${sub.toLowerCase()}.geo.json`);
  const hit = exact ?? all.find((f) => geoName(f).toLowerCase() === name);
  return hit ? joinPath(geoDir, hit) : null;
}

/** Builds a .bbmodel or .geo.json. "auto" = the model's own / conventional texture. */
async function buildEntityFile(file: string, tex: TexRef | "auto", extraFiles: string[] = []): Promise<BuiltModel> {
  const json = await readJson(file);
  const files = [file, ...extraFiles];
  if (isBedrockGeometry(json)) {
    const model = parseBedrock(json);
    const warnings = [...model.warnings];
    let ref: TexRef = tex === "auto" ? null : tex;
    if (tex === "auto") { const p = await findGeoTexture(file); ref = p ? { path: p } : null; }
    const loaded = await loadTexRef(ref);
    if (loaded?.file) files.push(loaded.file);
    if (!loaded) warnings.push(`Missing texture: ${ref && "id" in ref ? ref.id : geoName(file) + ".png"}`);
    return buildEntity(model, [loaded?.texture ?? null], missingTexture(), files, warnings);
  }
  if (json && typeof json === "object" && (json.meta || json.outliner || json.elements)) {
    const { model, textures } = parseBbmodel(json);
    const warnings = [...model.warnings];
    const loaded: (SceneTexture | null)[] = [];
    for (let i = 0; i < Math.max(textures.length, tex !== "auto" ? 1 : 0); i++) {
      if (i === 0 && tex !== "auto") {
        // Showing a specific texture (e.g. the PNG that was opened) in place of the model's first one.
        const r = await loadTexRef(tex);
        if (r?.file) files.push(r.file);
        if (!r) warnings.push(`Missing texture: ${tex && "id" in tex ? tex.id : textures[0]?.name ?? "texture"}`);
        loaded.push(r?.texture ?? null);
      } else {
        loaded.push(await bbTexture(textures[i], file, files, warnings));
      }
    }
    return buildEntity(model, loaded, missingTexture(), files, warnings);
  }
  throw new LoadError("Unknown file type.");
}

/** Blockbench textures: embedded first, then the saved path, then a relative path, then by name next to the file. */
async function bbTexture(t: BbTexture, bbPath: string, files: string[], warnings: string[]): Promise<SceneTexture | null> {
  if (t.source) return readPngTexture(dataUrlBytes(t.source), null);
  const named = t.name.toLowerCase().endsWith(".png") ? t.name : t.name + ".png";
  for (const p of [t.path, t.relativePath && joinPath(dirName(bbPath), t.relativePath), joinPath(dirName(bbPath), named)]) {
    if (p && (await platform.pathKind(p)) === "file") { files.push(p); return loadTextureFile(p); }
  }
  warnings.push(`Missing texture: ${named}`);
  return null;
}

async function openGeo(path: string, fresh: boolean, savedTexture?: string) {
  let tex = await findGeoTexture(path);
  // A texture picked by hand last time is reused when the model is reopened on launch.
  if (!tex && savedTexture && (await platform.pathKind(savedTexture)) === "file") tex = savedTexture;
  if (!tex) tex = await platform.pickFile(`Pick the texture for ${baseName(path)}`, [{ name: "PNG texture", extensions: ["png"] }]);
  const ref: TexRef = tex ? { path: tex } : null;
  await openSession({ path, texture: tex ?? undefined, build: () => buildEntityFile(path, ref) }, fresh);
}

/** Pick the model to open for a texture used by several. */
function chooseModel(texId: string, allUsers: string[]) {
  const texPath = parseId(texId).path;
  const texName = texPath.split("/").pop()!;
  const nameOf = (m: string) => parseId(m).path.split("/").pop()!;
  // Models from the texture's own folder first: a block texture opens the block model, not the
  // flat item model that reuses it (saplings, flowers, torches, panes...). Stable, so the
  // resource-folder preference from modelsUsingTexture still holds within each group.
  const folder = (p: string) => p.split("/")[0];
  const other = (m: string) => Number(folder(parseId(m).path) !== folder(texPath));
  const users = [...allUsers].sort((a, b) => other(a) - other(b));
  const exact = users.find((m) => nameOf(m) === texName);
  if (exact) return exact;
  const prefixed = users.filter((m) => texName.startsWith(nameOf(m))).sort((a, b) => nameOf(b).length - nameOf(a).length);
  if (prefixed.length) return prefixed[0];
  return users[0];
}

async function openPath(path: string, fresh = true, savedTexture?: string) {
  const lower = path.toLowerCase();
  try {
    if (lower.endsWith(".png")) await openPng(path, fresh);
    else if (lower.endsWith(".bbmodel")) await openSession({ path, build: () => buildEntityFile(path, "auto") }, fresh);
    else if (lower.endsWith(".json")) {
      // Told apart by content: GeckoLib / Bedrock geometry or a Minecraft block/item model.
      if (isBedrockGeometry(await readJson(path))) await openGeo(path, fresh, savedTexture);
      else await openSession({ path, build: () => buildModelFile(path) }, fresh);
    } else throw new LoadError("Unknown file type.");
  } catch (e) {
    showError(e instanceof LoadError ? e.message : `Couldn't read ${baseName(path)}.`);
    if (!(e instanceof LoadError)) console.error(e);
  }
}

async function openPng(path: string, fresh: boolean) {
  const loc = locateInAssets(path, "textures");
  await resources.prepare(loc?.root ?? null);
  // 1. A texture inside a resource folder opens the model that uses it.
  if (loc) {
    const root = loc.root;
    if (!loc.sub.startsWith("entity/")) {
      const users = await resources.modelsUsingTexture(loc.id, loc.root);
      if (users.length) {
        const id = chooseModel(loc.id, users);
        const note = users.length > 1 ? `Used by several models, showing ${parseId(id).path.split("/").pop()}` : undefined;
        await openSession({ path, build: async () => { await resources.prepare(root); return buildModelId(id); } }, fresh, note);
        return;
      }
    }
    // Entity textures (and GeckoLib blocks/items): a same-name .geo.json in the namespace's geo/ folder,
    // then the entity model library. The opened PNG is the texture shown.
    let model = await findGeoForTexture(loc.root, loc.ns, loc.sub);
    if (!model && loc.sub.startsWith("entity/")) {
      const { match, errors } = await library.findForTexture(loc.id);
      if (errors.length) showError(errors[0]);
      model = match?.file ?? null;
    }
    if (model) {
      const file = model;
      await openSession({ path, build: async () => { await resources.prepare(root); return buildEntityFile(file, { path }); } }, fresh);
      return;
    }
  }
  // 2. A 64x64 / 64x32 PNG is a player skin.
  const img = decodePng(await readOrFail(path));
  if (skinFormat(img)) {
    const s: Session = { path, slim: guessSlim(img), build: async () => {
      const im = decodePng(await readOrFail(path));
      if (!skinFormat(im)) throw new LoadError("Unknown texture/model association.");
      return buildSkin(im, s.slim!, path);
    } };
    await openSession(s, fresh);
    return;
  }
  // 3. Nothing matched.
  throw new LoadError(!loc && !resources.hasConfigured ? "No resource folder set - add one in config.txt." : "Unknown texture/model association.");
}

/** `note` (e.g. "Used by several models...") is shown with the model's warnings rather than replacing them. */
async function openSession(s: Session, fresh: boolean, note?: string) {
  const model = await s.build();
  session = s;
  updateState({ model: { path: s.path, slim: s.slim, texture: s.texture } });
  viewer.setModel(model, !fresh);
  await watchCurrent(model.files);
  const messages = [...model.warnings, ...(note ? [note] : [])];
  if (messages.length) showError(messages[0] + (messages.length > 1 ? ` (+${messages.length - 1} more)` : ""));
}

async function rebuild(keepView = true) {
  if (!session) return;
  const s = session;
  const model = await s.build();
  if (session !== s) return;
  viewer.setModel(model, keepView);
  await watchCurrent(model.files);
  if (model.warnings.length) showError(model.warnings[0] + (model.warnings.length > 1 ? ` (+${model.warnings.length - 1} more)` : ""));
}

// ---------- live updating ----------

let watched: string[] = [];
async function watchCurrent(files: string[]) {
  // Each texture's .mcmeta is watched too, even before it exists, so animations can be added or tuned live.
  const metas = files.filter((f) => f.toLowerCase().endsWith(".png")).map((f) => f + ".mcmeta");
  // The library's mapping file too, so editing it re-matches the open model.
  watched = [...new Set([...files, ...metas, configPath, ...(library.mapFile ? [library.mapFile] : [])])];
  await platform.watchFiles(watched);
}

const pending = new Map<string, number>();
platform.onFileChange((path) => {
  clearTimeout(pending.get(path));
  pending.set(path, window.setTimeout(() => { pending.delete(path); void onChanged(path); }, 150));
});

async function onChanged(path: string) {
  if (path === configPath) { await reloadConfig(); return; }
  if (!session) return;
  // A removed .mcmeta just means "no longer animated" (likewise the optional library mapping file);
  // anything else missing is an error.
  const optional = path.toLowerCase().endsWith(".mcmeta") || path === library.mapFile;
  if (!optional && (await platform.pathKind(path)) !== "file") {
    // Editors often save via delete + rename; give it a moment before calling it gone.
    await delay(150);
    if ((await platform.pathKind(path)) !== "file") { showError(`Watched file was moved or deleted: ${baseName(path)}`); return; }
  }
  try { await rebuild(); }
  catch {
    await delay(150); // probably still being written: retry once
    try { await rebuild(); }
    catch (e) { showError(e instanceof LoadError ? e.message : `Couldn't read ${baseName(path)}.`); }
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- config ----------

async function reloadConfig(first = false) {
  const loaded = await loadConfig();
  config = loaded.config;
  configPath = loaded.path;
  resources = new Resources(config.resources);
  library = new EntityLibrary(config.entityLibrary);
  if (loaded.errors.length) showError(loaded.errors[0] + (loaded.errors.length > 1 ? ` (+${loaded.errors.length - 1} more)` : ""));
  if (first) selectColor(0);
  else {
    selectColor(Math.min(bgIndex, config.colors.length - 1));
    if (session) await rebuild().catch((e) => showError(e instanceof LoadError ? e.message : "Couldn't reload the model."));
  }
}

// ---------- input ----------

let repeatTimer: number | undefined;
let repeatKey: string | null = null;
function stopRepeat() { clearTimeout(repeatTimer); clearInterval(repeatTimer); repeatKey = null; }

window.addEventListener("keydown", (e) => {
  if (!config) return;
  const k = config.keys;
  const brighter = keyMatches(e, k.brighter), darker = keyMatches(e, k.darker);
  if (brighter || darker) {
    e.preventDefault();
    if (e.repeat) return; // we do our own repeat timing
    const d = brighter ? 1 : -1;
    stopRepeat();
    repeatKey = e.code;
    stepBrightness(d);
    repeatTimer = window.setTimeout(() => { repeatTimer = window.setInterval(() => stepBrightness(d), 33); }, 300);
    return;
  }
  if (e.repeat) return;
  if (keyMatches(e, k.reset_all)) { e.preventDefault(); viewer.resetAll(); }
  else if (keyMatches(e, k.reset_rotation)) { e.preventDefault(); viewer.resetRotation(); }
  else if (keyMatches(e, k.arm_type)) {
    if (session?.slim !== undefined) {
      session.slim = !session.slim;
      updateState({ model: { path: session.path, slim: session.slim } });
      void rebuild().catch((err) => showError(err.message));
    }
  } else if (keyMatches(e, k.screenshot)) { e.preventDefault(); void screenshot(); }
});
window.addEventListener("keyup", (e) => { if (e.code === repeatKey) stopRepeat(); });
window.addEventListener("blur", stopRepeat);

async function screenshot() {
  try {
    const png = await viewer.screenshot();
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const name = `LamsEX_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, "0")}.png`;
    await platform.writeFile(joinPath(await platform.exeDir(), "screenshots", name), png);
    showError(`Screenshot saved: screenshots/${name}`);
  } catch {
    showError("Couldn't save the screenshot.");
  }
}

async function pickModel() {
  const path = await platform.pickFile("Open model or texture", [
    { name: "Models and textures", extensions: ["png", "json", "bbmodel"] },
    { name: "All files", extensions: ["*"] },
  ]);
  if (path) await openPath(path);
}

// ---------- start ----------

(async () => {
  const saved = await loadState().catch(() => ({} as AppState));
  await restoreWindow().catch(() => undefined);
  await hud.init();
  hud.setSlot(1, { label: "model", action: () => void pickModel() });
  await reloadConfig(true);
  viewer.requestRender();
  (window as unknown as { lamsOpen: (p: string) => Promise<void> }).lamsOpen = (p) => openPath(p);
  // Dropping a file on the window opens it, like the Model button (desktop app only:
  // a browser drop doesn't give the file's path).
  if ("__TAURI_INTERNALS__" in window) {
    void getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop" && e.payload.paths.length) void openPath(e.payload.paths[0]);
    });
  }
  // Reopen the model from last time, with its arm type.
  const last = saved.model;
  if (last && (await platform.pathKind(last.path)) === "file") {
    await openPath(last.path, true, last.texture);
    const cur = session as Session | null; // set by openPath above
    if (cur && cur.path === last.path && last.slim !== undefined && cur.slim !== undefined && cur.slim !== last.slim) {
      cur.slim = last.slim;
      updateState({ model: { path: cur.path, slim: cur.slim } });
      await rebuild().catch(() => undefined);
    }
  }
})();
