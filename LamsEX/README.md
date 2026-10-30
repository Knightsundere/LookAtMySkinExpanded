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

Keys can be remapped in `config.txt`.

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
`.geo.json` files, for example exported from Blockbench's built-in vanilla entity models.
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
villager professions and similar. Without one, LamsEX can't find the model, and a 64x64
texture opens on the player model instead.

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
