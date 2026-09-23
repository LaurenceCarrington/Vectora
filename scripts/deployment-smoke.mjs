// Exercise the built asset graph on a strict static host, including a Pages-style subdirectory.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const files = new Map();
function collect(directory, prefix = "") {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) collect(join(directory, entry.name), `${name}/`);
    else if (entry.isFile()) files.set(name, readFileSync(join(directory, entry.name)));
    else throw new Error(`Unexpected non-file in build: ${name}`);
  }
}
collect(join(root, "dist"));
assert(files.has("index.html"), "Run npm run build first.");
assert.match(files.get("index.html").toString("utf8"), /<link\b[^>]*rel="icon"[^>]*type="image\/svg\+xml"[^>]*href="[^"]+"/, "The Vectora favicon must be declared in the built page.");
assert.deepEqual(files.get("LEGAL_ATTRIBUTIONS.md"), readFileSync(join(root, "LEGAL_ATTRIBUTIONS.md")), "The complete third-party notices must ship unchanged.");

const contentTypes = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".woff": "font/woff", ".woff2": "font/woff2", ".md": "text/plain", ".svg": "image/svg+xml",
};
let mount = "/";
const server = createServer((request, response) => {
  const path = new URL(request.url, "http://localhost").pathname;
  const name = path.startsWith(mount) ? path.slice(mount.length) || "index.html" : null;
  const data = name === null ? undefined : files.get(name);
  response.writeHead(data ? 200 : 404, {
    "Content-Type": contentTypes[extname(name ?? "")] ?? "application/octet-stream",
    "Cache-Control": "no-store",
  });
  response.end(data ?? "Not found");
});

function references(source, extension) {
  const patterns = extension === ".html"
    ? [/\b(?:src|href)=["']([^"']+)["']/g]
    : extension === ".css"
      ? [/url\(\s*["']?([^\s"')]+)["']?\s*\)/g]
      : extension === ".js"
        ? [/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\bnew\s+URL\s*\(\s*)["'`]([A-Za-z0-9_./-]+\.(?:js|css|woff2?|ttf|svg|png|jpe?g))["'`]/g]
        : [];
  return patterns.flatMap(pattern => [...source.matchAll(pattern)].map(match => match[1]))
    .filter(value => !/^(?:[a-z]+:|#)/i.test(value));
}

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
let keepServing = false;
try {
  for (mount of ["/", "/vectora-pages-check/"]) {
    const base = new URL(mount, origin);
    const queue = [base, new URL("LEGAL_ATTRIBUTIONS.md", base)];
    const visited = new Set();
    while (queue.length) {
      const url = queue.shift();
      assert.equal(url.origin, base.origin, `Unexpected external build asset: ${url}`);
      assert(url.pathname.startsWith(mount), `Asset escaped the repository path: ${url}`);
      const name = url.pathname.slice(mount.length) || "index.html";
      if (visited.has(name)) continue;
      visited.add(name);
      const response = await fetch(url);
      assert.equal(response.status, 200, `Missing production asset: ${url}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(bytes, files.get(name), `Unexpected response for ${url}`);
      for (const reference of references(bytes.toString("utf8"), extname(name))) {
        queue.push(new URL(reference, url));
      }
    }
    const unreachable = [...files.keys()].filter(name => !visited.has(name));
    assert.deepEqual(unreachable, [], "Build contains assets unreachable from its HTML, styles, modules, or workers.");
    const missing = await fetch(new URL("missing-asset.js", base));
    assert.equal(missing.status, 404, "Static host must not mask missing assets with the application HTML.");
    console.log(`Static hosting passed at ${mount}: ${visited.size} files, including lazy modules, worker bundles, fonts, and notices.`);
  }
  if (process.argv.includes("--serve")) {
    keepServing = true;
    console.log(`Production check server: ${origin}${mount}`);
    console.log("Press Ctrl+C to stop.");
    process.once("SIGINT", () => server.close());
    process.once("SIGTERM", () => server.close());
  }
} finally {
  if (!keepServing) await new Promise(resolve => server.close(resolve));
}
