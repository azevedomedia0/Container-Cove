import { serve } from "bun";
import { readFileSync, existsSync } from "fs";
import { join, extname } from "path";

const ROOT = new URL(".", import.meta.url).pathname;
const MIME = {
  ".html": "text/html",
  ".css": "text/css",
  ".ts": "application/javascript",
  ".js": "application/javascript",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

serve({
  port: 3333,
  fetch(req) {
    let path = new URL(req.url).pathname;
    if (path === "/" || path === "") path = "/src/renderer/launcher/index.html";

    // resolve relative asset paths (../../../assets/...)
    const candidates = [
      join(ROOT, path),
      join(ROOT, "src/renderer/launcher", path),
      join(ROOT, path.replace(/^\/+/, "")),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        const ext = extname(candidate);
        const body = readFileSync(candidate);
        return new Response(body, {
          headers: { "Content-Type": MIME[ext] ?? "text/plain" },
        });
      }
    }

    return new Response("Not found: " + path, { status: 404 });
  },
});

console.log("Serving launcher at http://localhost:3333");
