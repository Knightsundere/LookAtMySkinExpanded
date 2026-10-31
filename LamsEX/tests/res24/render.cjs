// Renders each fixture at 16x and 24x through the real app (Vite dev bridge) and compares.
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const [,, appDir, fx, out, url] = process.argv;
const devRun = path.join(appDir, "dev-run");
const cases = [
  ["block", "pack", "assets/test/models/block/fx_cube.json"],
  ["block_png", "pack", "assets/test/textures/block/fx_cube.png"],
  ["item", "pack", "assets/test/models/item/fx_item.json"],
  ["anim_f0", "pack", "assets/test/models/block/fx_anim.json"],
  ["geo64", "pack", "assets/test/geo/fx_mob.geo.json"],
  ["geo64_png", "pack", "assets/test/textures/entity/fx_mob.png"],
  ["geo32_png", "pack", "assets/test/textures/entity/fx_mob32.png"],
  ["bbmodel", "pack", "assets/test/models/entity/fx_bb.bbmodel"],
  ["skin_wide", "skins", "skin_wide.png"],
  ["skin_slim", "skins", "skin_slim.png"],
  ["skin_legacy", "skins", "skin_legacy.png"],
];
(async () => {
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const results = {};
  for (const res of ["16", "24"]) {
    fs.mkdirSync(devRun, { recursive: true });
    fs.writeFileSync(path.join(devRun, "config.txt"), `color Void = #ffffff\nresources = ${path.join(fx, "pack" + res)}\n`);
    try { fs.unlinkSync(path.join(devRun, "state.json")); } catch {}
    const page = await browser.newPage({ viewport: { width: 360, height: 360 }, deviceScaleFactor: 1 });
    page.on("pageerror", (e) => console.log("pageerror", e.message));
    await page.goto(url);
    await page.waitForFunction(() => !!window.lamsOpen);
    for (const [name, kind, rel] of cases) {
      const file = path.join(fx, kind + res, rel);
      const err = await page.evaluate(async (f) => { try { await window.lamsOpen(f); return null; } catch (e) { return String(e && e.message || e); } }, file);
      await page.waitForTimeout(400);
      const msg = await page.evaluate(() => { const e = document.getElementById("error"); return e.classList.contains("show") ? e.textContent : ""; });
      await page.evaluate(() => document.getElementById("error").classList.remove("show"));
      await page.waitForTimeout(100);
      await page.locator("#view").screenshot({ path: path.join(out, `${name}_${res}.png`) });
      if (name === "anim_f0") {
        await page.waitForTimeout(3300);
        await page.locator("#view").screenshot({ path: path.join(out, `anim_f1_${res}.png`) });
      }
      results[`${name}_${res}`] = { err, msg };
    }
    await page.close();
  }
  await browser.close();
  fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(results, null, 1));
})();
