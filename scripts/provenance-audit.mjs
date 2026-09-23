/** Online verification of supplemental upstream license and notice evidence. */
import fs from "node:fs";
import { createHash } from "node:crypto";
import https from "node:https";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const manifest = JSON.parse(fs.readFileSync(`${root}/legal/upstream/sources.json`, "utf8"));
const digestPattern = /^[0-9a-f]{64}$/;
const fileNamePattern = /^[A-Za-z0-9._-]+$/;
const seenFiles = new Set();

function request(url, redirectsRemaining = 5) {
  return new Promise((resolve, reject) => {
    const outgoing = https.get(url, { headers: { "User-Agent": "Vectora-provenance-audit/1" } }, (response) => {
      if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirectsRemaining === 0) return reject(new Error(`Too many redirects for ${url}`));
        return resolve(request(new URL(response.headers.location, url), redirectsRemaining - 1));
      }
      if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`HTTP ${response.statusCode ?? "unknown"} for ${url}`));
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    outgoing.setTimeout(60_000, () => outgoing.destroy(new Error(`Timed out fetching ${url}`)));
    outgoing.on("error", reject);
  });
}

async function download(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await request(url);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

for (const item of manifest) {
  if (typeof item.file !== "string" || !fileNamePattern.test(item.file) || seenFiles.has(item.file) ||
      typeof item.url !== "string" || !item.url.startsWith("https://")) {
    throw new Error("Every upstream provenance entry requires a file and HTTPS URL.");
  }
  seenFiles.add(item.file);
  if (!digestPattern.test(item.sha256)) throw new Error(`${item.file}: invalid local SHA-256.`);
  const local = fs.readFileSync(`${root}/legal/upstream/${item.file}`);
  if (hash(local) !== item.sha256) throw new Error(`${item.file}: local notice differs from its manifest hash.`);

  const source = await download(item.url);
  if (item.extraction) {
    if (!digestPattern.test(item.sourceSha256 ?? "")) {
      throw new Error(`${item.file}: an extracted notice requires sourceSha256.`);
    }
    if (hash(source) !== item.sourceSha256) throw new Error(`${item.file}: upstream source bytes changed.`);
    const normalizedSource = source.toString("utf8").replaceAll("\r\n", "\n");
    const normalizedNotice = local.toString("utf8").replaceAll("\r\n", "\n").trim();
    if (!normalizedSource.includes(normalizedNotice)) {
      throw new Error(`${item.file}: the recorded notice is not present verbatim in its upstream source.`);
    }
  } else if (hash(source) !== item.sha256) {
    throw new Error(`${item.file}: upstream notice bytes changed.`);
  }
  console.log(`Verified ${item.file} from ${item.url}`);
}

console.log(`Provenance verified: ${manifest.length} supplemental upstream notices.`);
