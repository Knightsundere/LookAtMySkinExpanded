# LamsEX

A Minecraft model viewer in the spirit of [LookAtMySkin](https://github.com/Goodlyay/LookAtMySkin):
player skins, blocks and items (v1), mobs and other entities from Blockbench and GeckoLib
files (v2), with live reloading and real alpha.

## Using it

`LamsEX.exe` is portable. Put it in its own folder; on first run it creates `config.txt`
next to itself, and F2 screenshots go to `screenshots/` there too.

**Resource folders.** Minecraft's own assets aren't shipped. Point `resources =` lines in
`config.txt` at any of:

- an extracted Minecraft jar (`.minecraft/versions/1.20.1/1.20.1.jar`, unzipped), the folder that contains `assets`
- an unzipped resource pack or mod `.jar`
- a `.jar` / `.zip` file directly (no unzipping needed, but files inside it aren't live-watched)

First match wins, like resource pack order. A PNG you open from inside a folder that has
`assets/<namespace>/textures/...` uses that folder first, so pack edits show up over vanilla.

| Action | Default key |
| --- | --- |
| Open a file | Model button, or drop the file on the window |
| Rotate model | Left-drag on empty space or the body |
| Pose a limb / head (skins), or a bone (Blockbench / GeckoLib) | Left-drag on it |
| Zoom / reset zoom | Scroll wheel / middle click |
| Reset everything | Space |
| Reset rotation | Backspace |
| Classic / slim arms | M |
| Background brighter / darker | Up / Down (hold to sweep) |
| Screenshot (3D view only) | F2 |

| Stay on top over Paint.NET: pause / resume | T |

Keys can be remapped in `config.txt`.

**Floating over Paint.NET.** While Paint.NET is the active window, LamsEX stays on top of it, so
you can paint and watch the model at the same time. Clicking into LamsEX keeps it on top;
switching to any other program lets it drop behind as normal. Set `on_top_with =` in
`config.txt` to other programs' exe names (comma-separated) or to `none` to turn it off.

**Higher-resolution textures (e.g. 24x).** UVs stay in the model's own units (0-16 for blocks
and items, the declared texture size for entities) and are scaled to whatever size the PNG
really is, as in game: a 24x24 block texture, a 24x96 animated strip or a 96x96 mob texture on
a model that says 64x64 all just work. Skins can be any multiple of 32 pixels wide from 64 up,
so 96x96 / 96x48 skins open on the player model too. Keep the aspect ratio exact.

### Mobs and other entities (v2)

- **`.bbmodel`** (Blockbench) opens directly, using the textures embedded in it, or else the
  texture paths saved in it.
- **`.geo.json`** (GeckoLib / Bedrock geometry) opens directly. Its texture is found by the
  GeckoLib 4 convention (`assets/<ns>/geo/<name>.geo.json` → `assets/<ns>/textures/entity/<name>.png`,
  also in subfolders), or a PNG with the same name next to it. If neither exists, a second
  file picker asks for it. Animations aren't played; models show their default pose.
- **An entity texture** inside a resource folder (`textures/entity/...png`) opens the
  `.geo.json` with the same name from that namespace's `geo/` folder, or else a model from
  the entity library.
- **Code-drawn blocks and items** (chests, beds, signs…), whose `.json` has no geometry, are
  looked up in the entity library too.

Dragging a bone poses it. Dragging a top-level bone that holds other bones, or one named
like `body` / `root` (at any depth), turns the whole model. Space puts bones back in their saved pose.

**Entity model library.** Set `entity_library =` in `config.txt` to a folder of `.bbmodel` /
`.geo.json` / `.jem` files, for example exported from Blockbench's built-in vanilla entity models.

The quickest way to fill it for a whole modlist is the Entity Model Features (EMF) mod: in a
game instance with the modlist installed, open EMF's settings, go to Tools, and set **Export
models** to export all models. Leave the settings screen, let the resources reload, then point
`entity_library =` at `.minecraft/emf/export`. That covers vanilla mobs and modded mobs drawn by
code (GeckoLib mobs already work from their `.geo.json`). `.jem` files can also be opened
directly; their texture comes from the file, a same-name PNG beside it, or a file picker.
Files match by name: `zombie.png` finds `zombie.bbmodel`. For anything else, add a
`lamsex-library.txt` to that folder, one pairing per line:

```
# <model file> = <ids>   (block/... and item/... are models; anything else is a texture)
zombie.bbmodel = entity/zombie/zombie, entity/zombie/husk
chest.bbmodel = entity/chest/normal, block/chest, item/chest
bed.bbmodel = entity/bed/red, block/red_bed, item/red_bed
```

When a block or item model matches, it's shown with the first texture on its line. Editing
this file updates the open model.

Matching by name only looks at the texture's file name, so many vanilla textures need a
line here: chests (`entity/chest/normal`), beds (`entity/bed/red`), cat and horse variants,
villager professions and similar. Without one, LamsEX can't find the model, and a 64x64 (or 96x96)
texture opens on the player model instead.

**owen_ mods.** These mobs reuse other mobs' models with their own textures, so EMF exports
them only under the original mob's name. `tools/update-owen-mobs.bat` (copied next to
`LamsEX.exe`, with `tools/owen_mobs.py` and `tools/vanilla-names.json` in a `tools` folder
beside it) keeps LamsEX in step; run it again whenever the mods change. It needs Python 3.
It copies the `assets` of every enabled `owen_*.jar` in the instance's mods folder (found from
`entity_library`) into `owen_assets`, adds that folder to `config.txt` as a resource folder,
and reads each mod's classes to find the model each mob texture is drawn with: the renderer it
extends or the model layer it uses, or the vanilla mob it is spawned as. The pairings go into
`lamsex-library.txt` between `# >>> owen mods` and `# <<< owen mods`; anything outside those
lines is kept. Open a mob by dropping its PNG from `owen_assets` into LamsEX.
`owen-mobs-report.txt` lists what matched and what didn't. To fix or add a pairing, put a line
in `owen-models.txt` next to `LamsEX.exe`, or ship `assets/<modid>/lamsex.txt` inside the mod,
both in the `lamsex-library.txt` format; those lines win over the guesses:

```
aquamirae/optifine/cem/eel.jem = owen_creatures:entity/jarlwurm
```

## Developing

Needs Node.js and Rust (MSVC toolchain).

```
npm install
npm run tauri dev      # desktop app with hot reload
npx tauri build --no-bundle   # -> src-tauri/target/release/lamsex.exe
```

`npm run dev` alone serves the UI at http://localhost:1420 with a dev-only file bridge
(see `vite.config.ts`), using `dev-run/` as the "app folder". In the browser console,
`lamsOpen("C:/path/to/file.png")` opens a file.

Layout: `src/models/player.ts` (skin parts list), `src/models/blockmodel.ts` (JSON models,
parent chain, item extrusion), `src/models/entity.ts` (.bbmodel / .geo.json, bones),
`src/library.ts` (entity model library), `src/resources.ts` (resource folders, texture→model index),
`src/viewer.ts` (3D view and controls), `src/hud.ts` (buttons), `src/main.ts` (wiring,
live reload, keys), `src-tauri/src/lib.rs` (file access and watching).

## Credits

- Button art and design: Owen.
- Font: **Volume Dealer** by “escaphandro”, licensed CC BY-SA 3.0
  (http://creativecommons.org/licenses/by-sa/3.0/). See `public/ui/font/license.txt`.
- App icon (placeholder): the LookAtMySkin icon.
