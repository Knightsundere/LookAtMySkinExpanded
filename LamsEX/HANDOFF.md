# LamsEX handoff (30 Oct 2026)

Hi Owen, this file sums up one Claude Code session with Antoine, so you (or an agent) can pick
up LamsEX from here. Your `spec.txt` is still the source of truth; this file only records what
was built, what was decided, and what's still open.

**Status:** v1 (player skins, blocks, items) and v2 (Blockbench `.bbmodel`, GeckoLib
`.geo.json`, entity model library, code-drawn blocks) are built and working. See "v2" below.
Custom Player Models (the spec's "later" phase) is not started.

## Where things are

| Path | What it is |
| --- | --- |
| `spec.txt` | Your spec, unchanged. |
| `source/` | Source code (Tauri 2 + TypeScript + three.js). Its `README.md` has controls, setup and build commands. |
| `build/LamsEX.exe` | Latest build (v2): a portable 6.5 MB exe with no installer. On first run it creates `config.txt` next to itself; F2 screenshots go to `screenshots/` there. |
| `owen-assets/` | The files you sent: button art, example skins, the mockup and `volume_dealer.zip`. The app's own copies of the art and font are in `source/public/ui/`. |
| `reference/LookAtMySkin-master/` | The original LookAtMySkin project, for comparison. |
| `test-resources/desolation-1.3.2/` | The `assets` folder unzipped from the Desolation 1.3.2 mod jar, used as a test resource folder. To use it, add `resources = <full path to this folder>` to `config.txt`. |

Build output (`node_modules/`, `src-tauri/target/`, `dist/`, `src-tauri/gen/`), the dev test
folder and Antoine's `config.txt` aren't included. They're all recreated by `npm install`, a
build, or the first run. The hand-written test models used below were in the dev test folder.

### Code map (`source/src/`)
- `main.ts`: wiring. Opening files (applies the spec's PNG rules 1-3), live reload, keys, background color, screenshots, the error strip.
- `viewer.ts`: three.js scene, centering and fitting the model, rotate/pose/zoom controls, picking (ignores fully transparent pixels), redraws only when something changes.
- `hud.ts`: the 8 button slots. Reads Owen's art, slices it into edges and middle, picks a whole-number scale, handles hover/press, shrinks long labels then adds "...".
- `models/player.ts`: the skin model, built from a **list of parts** (ready for Custom Player Models later). Handles 64x64 / 64x32 and the same layouts at higher resolutions (96x96 / 96x48 for 24x, 128x128...), and guesses classic or slim.
- `models/blockmodel.ts`: JSON models (parent chain, texture variables, elements, rotation, tint) and the extruded `item/generated` sprite.
- `models/entity.ts`: `.bbmodel` and `.geo.json`. Both are converted to Blockbench's own layout
  (bones with pivot + rotation, cubes with per-face UVs) and built by one function. Bedrock's
  x axis is mirrored on import, as Blockbench does.
- `library.ts`: the entity model library and its `lamsex-library.txt` mapping file.
- `resources.ts`: resource folders, also `.jar`/`.zip` files directly; first match wins. Builds the texture → model lookup.
- `textures.ts`: exact-alpha textures with nearest filtering, `.mcmeta` animation. `png.ts`: PNG decoding (any bit depth or palette).
- `geometry.ts`: quad builder; draws opaque pixels and partly transparent pixels in two passes, sorting the transparent faces back to front.
- `config.ts`: reads and writes `config.txt`; a bad line is reported by line number and skipped.
- `platform.ts` + `src-tauri/src/lib.rs`: file reading, writing and watching. In dev, a Vite bridge (`vite.config.ts`) stands in so the UI runs in a normal browser.

### Building
Needs Node.js and Rust (MSVC). Both are now installed on Antoine's PC.
```
cd source
npm install
npm run tauri dev              # desktop app with hot reload
npx tauri build --no-bundle    # -> src-tauri/target/release/lamsex.exe
```
`npm install` comes first. The first Rust build downloads and compiles dependencies (a few
minutes, about 4 GB in `src-tauri/target/`).
`npm run dev` alone serves the UI at http://localhost:1420, using `source/dev-run/` (created
automatically) as the app folder for `config.txt` and screenshots. In the browser console,
`lamsOpen("C:/path/file.png")` opens a file; there's no file picker in that mode.

## Decisions Antoine approved
Asked during the review step at the start; Antoine agreed to all of them and said spec or art
issues can be fixed on your end later.

- **Portable exe**, not an installer, so `config.txt` and `screenshots/` can sit next to it.
- **Button art is 4× pre-enlarged** (328×116 = 82×29 × 4). LamsEX detects that, shrinks it
  back to 82×29, then scales it by a whole number (3× at 1280 px wide). Slot widths are 82 / 75 / 52 px at 1×.
  The 3 px edges are kept and the middle is stretched; the middle has a faint diagonal
  gradient, so it's resampled rather than stretched from a single column.
- **The art has no alpha channel**, so the whole rectangle counts as the button. The code
  already ignores transparent pixels, so art with transparent corners will just work.
- **Blocks and items display at their inventory angle** (the model's `display.gui.rotation`).
- **`resources =` can also be a `.jar` / `.zip`** file directly.
- **Texture → model lookup** is built once per session and kept in memory.
- **Volume Dealer is CC BY-SA 3.0**; it's credited in `source/README.md`.

## Where it differs from or adds to the spec
Please confirm or reject these:
- F2 shows "Screenshot saved: …" in the error strip.
- Extra messages not in the spec's list:
  - "Drawn by the game's code: add a model for it to the entity library." (a code-drawn model with no library match)
  - "Mesh elements aren't supported; only cubes are shown." and "Model is too detailed: …" (v2)
  - Entity library mapping errors, reported like config.txt lines
  - "Model has no geometry."
  - "(+N more)" when several problems happen at once
- Choosing a model for a texture: exact name match, then **the longest model name the texture
  name starts with** (`charred_log_top` → `charred_log`), then the first match. The middle step
  was needed for the spec's own oak_log example to work.
- Birch and spruce leaves use their fixed in-game colors instead of the plains foliage color.
- If a parent model is missing but the model has its own elements, it still gets the standard
  block angle `[30, 225, 0]` so it isn't seen edge-on.
- `config.txt` is reloaded live when edited. The default file has `resources =` commented out.
- Feel compared to LAMS:
  - Drag turns 0.5°/px (LAMS used 0.4°).
  - Zoom moves in 10% steps.
  - The head can be posed like the limbs.
  - Up/down drag tilts the model rather than orbiting the camera; it looks the same.
- Label margins and font size were estimated from the mockup (left 5, bottom 5, size 11, in
  1× pixels; constants at the top of `hud.ts`). Please check them against what you intended.
- The app icon is the LookAtMySkin icon as a placeholder; please send a LamsEX one.

## Testing done
All interactive testing ran in the browser preview. The exe was launch-tested only: it
starts and writes `config.txt`.

- **Skins:** `edit1.8.png` (classic), `edit1.8Alex.png` (slim, auto-detected), `edit1.7.png`
  (legacy, palette PNG, mirrored left limbs). Posing, rotation, all resets, M, and F2 work.
- **Blocks and items (hand-written test models):** a 3-level parent chain, tintindex, a rotated
  element, a face rotation, an animated `.mcmeta` texture, a missing texture (gray + message),
  and an extruded generated item.
- **Live reload:** overwriting the file updates it; deleting it keeps the model and shows the error.
  Removing or re-adding an `.mcmeta` reloads it.
- **HUD:** scaling, long-label shrinking and "...", color cycling, brightness hold-repeat.
- **Desolation 1.3.2 (Fabric mod):** flat items (charcoal, boat, air filter) and self-contained
  blocks (ash layers) render. Opening `charred_log_top.png` finds `charred_log`. Blocks whose shape
  comes from vanilla (`cube_all`, `cross`, stairs, doors…) are blank with "Missing parent
  model", which is expected until a vanilla jar is added.

**Not tested yet:**
- Real vanilla 1.20.1 assets (none on this PC). Check whether the block angle is mirrored, for example a
  furnace's front against the in-game inventory; the fix is one line in `blockmodel.ts`.
- The desktop window by hand, including Windows file watching, the file picker, and Windows display scaling at 125% / 150%.

## Bugs fixed after the self-review
1. Editing `config.txt` left LamsEX with no resource folders, so models opened through a texture stopped reloading.
2. `.png.mcmeta` files weren't watched.
3. The "No resource folder set" check looked at the previously opened file.
4. Dragging onto a button with the mouse held showed the pressed look.
5. A standalone model could load *itself* as its parent (an item and its block often share a name), causing a loop. Parent loops are now caught.

## Known limits / open items
- The texture → model lookup isn't refreshed during a session, so newly added models aren't found from their textures until a restart.
- Files inside a `.jar` can't be opened from the Model button (the Windows picker can't look inside it); unzip it into a folder instead.
- Item tints aren't applied (spawn eggs, leather armor show gray). Animations that blend between frames play without blending.
- Two partly transparent surfaces that cut through each other can draw in the wrong order.
- Fitting the model to the view uses only the vertical field of view, which is fine at the 800×600 minimum window size.
- Still open from the spec: `[OPEN] Owen: confirm the file names above match what you're sending, and add any of your own example skins.`
  There's no separate `Controls.txt` in the package (the spec already includes it), and the mockup's filename is longer than the spec says.

## v2 (built after the handoff was first written)
How it works for users is in `source/README.md` ("Mobs and other entities").

**What's in:**
- `.bbmodel`: embedded textures first, then saved paths (absolute, then relative, then by
  name next to the file). Groups become bones; a `java_block` format model is shown like a block.
- `.geo.json` (new and old Bedrock formats): box and per-face UVs, inflate, mirror, cube
  pivots and rotations, bone parents. The texture is found by the GeckoLib 4 convention,
  then by the same name next to the file, then with a second file picker.
- Files are told apart by content: a `.json` with Bedrock geometry inside is a GeckoLib model,
  whatever its name.
- A PNG under `textures/entity/` in a resource folder opens a same-name `.geo.json` from that
  namespace's `geo/` folder, then an entity library model, showing the opened PNG.
  Non-entity textures with no JSON model also try `geo/` (for GeckoLib blocks and items).
- Code-drawn blocks and items (`builtin/entity`, or a `.json` with no geometry) are matched
  in the entity library by name or by the mapping file.
- **Entity library mapping file format** (the spec left it to us): `lamsex-library.txt`,
  `<model file> = <ids>`. Ids starting with `block/` or `item/` are models; anything else is a
  texture. Bad lines are reported by line number. It's watched live.
- Posing: dragging a bone poses it. Top-level bones that hold other bones, or are named
  body/root/main/base/torso/bb_main…, turn the whole model instead. Space returns bones to
  their **saved** rotation, not to zero.
- Entities are drawn double-sided, so gaps in hats and similar show their inside, and are
  turned to face the camera.
- Limit: 10,000 cubes per model (the spec left the limit to us); past that a message says
  the model is cut off.

**Tested (browser preview):**
- Desolation's GeckoLib Ash Scuttler and Blackened, opened directly and from their entity PNGs.
- A hand-made `.bbmodel` humanoid using `edit1.8.png` (box UV, embedded texture, a group
  rotated -30°). It renders the same as the skin view, which confirms the UV layout and facing.
- A test library with a mapping file: entity texture → model, `block/chest` → model and texture,
  and a bad line reported.
- A `.geo.json` with no texture draws gray with a message; one with a same-name PNG beside it.
- Live reload of an edited `.geo.json`.

**Not tested:**
- Real Blockbench-saved files: the test `.bbmodel` was written by a script.
- Blockbench's exported vanilla entity models, and GeckoLib models with per-face UVs or
  nested cube rotations.
- The second file picker, which only exists in the desktop app.

**Not supported:**
- Blockbench mesh elements (only cubes are shown, with a message).
- Animations (out of scope per the spec).
- GeckoLib glow layers such as `*_glow.png` (only the main texture is shown).
- Per-texture render settings.
