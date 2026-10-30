import { defineConfig, type Plugin } from "vite";
import fs from "node:fs";
import path from "node:path";

// Dev-only stand-in for the Tauri backend, so the UI can be tested in a plain browser
// (`npm run dev` and open http://localhost:1420). Never part of the built app.
function devFsBridge(): Plugin {
  const devRoot = path.resolve("dev-run");
  const listRec = (dir: string): string[] => {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else out.push(path.relative(dir, p).replace(/\\/g, "/"));
      }
    };
    if (fs.existsSync(dir)) walk(dir);
    return out;
  };
  return {
    name: "lamsex-dev-fs",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__devfs", (req, res) => {
        // Only the app's own page may use the bridge. Without this, any website open in the
        // browser could send a plain cross-origin POST here and write files anywhere on disk.
        const site = req.headers["sec-fetch-site"];
        const origin = req.headers.origin;
        if ((site && site !== "same-origin") || (origin && origin !== `http://${req.headers.host}`)) {
          res.statusCode = 403; res.end("forbidden"); return;
        }
        const url = new URL(req.url ?? "", "http://x");
        const op = url.pathname.slice(1);
        const p = url.searchParams.get("path") ?? "";
        const json = (v: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(v)); };
        try {
          if (op === "exe_dir") { fs.mkdirSync(devRoot, { recursive: true }); return json(devRoot); }
          if (op === "read_file") return res.end(fs.readFileSync(p));
          if (op === "path_kind") {
            const st = fs.existsSync(p) ? fs.statSync(p) : null;
            return json(st ? (st.isDirectory() ? "dir" : "file") : "none");
          }
          if (op === "list_files") return json(listRec(p));
          if (op === "read_all_models") {
            const out: [string, string][] = [];
            const assets = path.join(p, "assets");
            if (fs.existsSync(assets)) for (const ns of fs.readdirSync(assets)) {
              const m = path.join(assets, ns, "models");
              for (const rel of listRec(m)) if (rel.endsWith(".json"))
                out.push([`assets/${ns}/models/${rel}`, fs.readFileSync(path.join(m, rel), "utf8")]);
            }
            return json(out);
          }
          if (op === "write_file") {
            const chunks: Buffer[] = [];
            req.on("data", (c) => chunks.push(c));
            req.on("end", () => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.concat(chunks)); res.end("ok"); });
            return;
          }
          res.statusCode = 404; res.end("unknown op");
        } catch (e) {
          res.statusCode = 500; res.end(String(e));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [devFsBridge()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/dev-run/**"] } },
  build: { target: "es2022", chunkSizeWarningLimit: 2000 },
});
