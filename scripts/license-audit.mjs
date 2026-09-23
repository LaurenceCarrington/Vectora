/** Offline inventory and notice generation; this is evidence collection, not legal certification. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import opentype from 'opentype.js';

const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
const write = process.argv.includes('--write');
const hash = value => createHash('sha256').update(value).digest('hex');
const read = file => fs.readFileSync(file, 'utf8');
const lockBytes = fs.readFileSync('package-lock.json');
const lock = JSON.parse(lockBytes);
const normalize = id => id.replaceAll(root, '').replaceAll('\\', '/');
const packagePath = id => normalize(id).match(/(?:^|\/)((?:node_modules\/.*\/)?node_modules\/(?:@[^/]+\/)?[^/?]+)/)?.[1];
const entries = Object.entries(lock.packages).filter(([p]) => p).sort(([a], [b]) => a.localeCompare(b));
const known = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', '0BSD', 'BSL-1.0', 'OFL-1.1', 'Unlicense', 'MPL-2.0']);
for (const [p, info] of entries) {
  if (!known.has(info.license)) throw new Error(`Unreviewed license: ${p}: ${info.license}`);
  if (fs.existsSync(`${p}/package.json`)) {
    const installed = JSON.parse(read(`${p}/package.json`));
    if (installed.version !== info.version || installed.license !== info.license) throw new Error(`Installed version/license differs from lock: ${p}`);
  }
}
const modules = [], assets = [];
const plugin = scope => ({
  name: 'vectora-license-inventory',
  generateBundle(_, bundle) {
    for (const item of Object.values(bundle)) {
      if (item.type === 'chunk') {
        for (const [id, details] of Object.entries(item.modules)) {
          if (details.renderedLength > 0) modules.push({ scope, chunk: item.fileName, id: normalize(id), renderedLength: details.renderedLength });
        }
      } else if (item.fileName !== 'LEGAL_ATTRIBUTIONS.md') assets.push({ scope, file: item.fileName, originalFileNames: item.originalFileNames ?? [] });
    }
  },
});
// Skip the notice emitter while regenerating a stale notice. The normal production
// build checks its lock fingerprint and always emits it.
process.env.VECTORA_LICENSE_INVENTORY = '1';
await build({ build: { write: false }, plugins: [plugin('main')], worker: { plugins: () => [plugin('worker')] } });
delete process.env.VECTORA_LICENSE_INVENTORY;
const shipped = new Set([...modules.map(m => packagePath(m.id)), ...assets.flatMap(a => a.originalFileNames.map(packagePath))].filter(Boolean));
// Bundler helpers and Tailwind's generated CSS are not ordinary input modules.
for (const name of ['vite', 'rolldown', 'tailwindcss']) shipped.add(`node_modules/${name}`);
for (const p of shipped) {
  if (!lock.packages[p]) throw new Error(`Unlocked bundled component: ${p}`);
  if (lock.packages[p].license === 'MPL-2.0') throw new Error(`MPL runtime component requires review: ${p}`);
}
const fonts = ['lora', 'roboto', 'roboto-mono'].map(name => {
  const file = `node_modules/typeface-${name}/files/${name}-latin-400.woff`;
  const bytes = fs.readFileSync(file);
  const names = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)).names.windows;
  return { file, sha256: hash(bytes), names };
});
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]);
const sources = walk('src').sort().map(file => {
  const source = read(file);
  const imports = [...source.matchAll(/(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)["']([^"']+)["']/g)].map(m => m[1]);
  return { file, sha256: hash(source), imports: [...new Set(imports)].sort() };
});
const manifest = JSON.parse(read('package.json'));
for (const source of sources) for (const specifier of source.imports.filter(i => !i.startsWith('.'))) {
  const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
  if (!manifest.dependencies?.[name] && !manifest.devDependencies?.[name]) throw new Error(`Undeclared source import: ${source.file}: ${specifier}`);
}
const bundleInputs = [...new Set([...modules.map(m => m.id.split('?')[0]), ...assets.flatMap(a => a.originalFileNames)])]
  .filter(file => !file.startsWith('\0') && fs.existsSync(file) && fs.statSync(file).isFile()).sort()
  .map(file => ({ file, sha256: hash(fs.readFileSync(file)) }));
const packages = entries.map(([p, info]) => ({ path: p, version: info.version, license: info.license, dev: !!info.dev, optional: !!info.optional, installed: fs.existsSync(p), bundled: shipped.has(p), integrity: info.integrity ?? null }));
const upstream = JSON.parse(read('legal/upstream/sources.json'));
const upstreamFiles = new Set();
for (const item of upstream) {
  if (typeof item.file !== 'string' || !/^[A-Za-z0-9._-]+$/.test(item.file) || upstreamFiles.has(item.file) || typeof item.url !== 'string' || !item.url.startsWith('https://')) throw new Error('Every upstream notice requires a unique safe file name and HTTPS URL');
  upstreamFiles.add(item.file);
  if (!/^[0-9a-f]{64}$/.test(item.sha256)) throw new Error(`Invalid upstream notice hash: ${item.file}`);
  if (item.extraction && !/^[0-9a-f]{64}$/.test(item.sourceSha256 ?? '')) throw new Error(`Extracted upstream notice lacks a source hash: ${item.file}`);
  if (hash(fs.readFileSync(`legal/upstream/${item.file}`)) !== item.sha256) throw new Error(`Changed upstream notice: ${item.file}`);
}
const notices = [];
function notice(title, file, text = read(file)) { notices.push({ title, file, sha256: hash(text), text }); }
// Keep all production-tree notices, even if a package is currently tree-shaken.
for (const [p, info] of entries.filter(([p, info]) => !info.dev || shipped.has(p))) {
  const name = p.replace(/^node_modules\//, '');
  if (name.startsWith('typeface-')) continue; // Only font binaries ship; metadata is not the font license.
  if (name === 'splaytree') { notice(`${name} ${info.version} — MIT`, `${p}/Readme.md`, read(`${p}/Readme.md`).split('## License')[1].trim()); continue; }
  const files = fs.readdirSync(p).filter(f => /^(licen[sc]e|notice|copyrightnotice)(\.|$)/i.test(f)).sort();
  if (!files.length) throw new Error(`Missing notice for ${p}`);
  for (const file of files) {
    let content = read(`${p}/${file}`);
    if (name === 'vite') content = content.split('\n##')[0]; // Core MIT grant covers emitted preload helpers.
    notice(`${name} ${info.version} — ${info.license}`, `${p}/${file}`, content);
  }
}
for (const item of upstream) notice(item.file, `legal/upstream/${item.file}`);
const extra = read('legal/EMBEDDED_NOTICES.md');
const inventory = {
  lockfileSha256: hash(lockBytes), scope: 'Production main/lazy/worker modules and emitted assets; full npm lock metadata; installed versions; literal source imports and source hashes.',
  limitations: 'Not proof of authorship, an exhaustive code-similarity search, or a legal/patent clearance. Embedded component versions can differ from lockfile versions; see AUDIT.md and EMBEDDED_NOTICES.md.',
  packages, fonts, sources, bundleInputs,
  modules: modules.sort((a, b) => `${a.scope}/${a.chunk}/${a.id}`.localeCompare(`${b.scope}/${b.chunk}/${b.id}`)),
  assets: assets.sort((a, b) => a.file.localeCompare(b.file)),
  notices: notices.map(({ text: _text, ...info }) => info), upstream,
};
const table = packages.map(p => `| ${p.path.replace(/^node_modules\//, '')} | ${p.version} | ${p.license} | ${p.bundled ? 'Bundle / generated asset' : p.dev ? 'Build / development only' : 'Production tree; see embedded notes'} |`).join('\n');
const markdown = `# Vectora — third-party attributions\n\nGenerated from the locked dependency tree. This document grants no license to Vectora itself.\n\nLockfile SHA-256: \`${hash(lockBytes)}\`\n\n## Scope and findings\n\nThis inventory includes ${packages.length} locked package records, production JavaScript (including workers and lazy chunks), fonts, and identified embedded code. No GPL/AGPL package license or mandatory paid commercial license was found in the reviewed production inputs. This is not a guarantee of authorship or complete upstream provenance.\n\nThe requested MIT/Apache/BSD/ISC-only policy is **not met**: Boost (BSL-1.0), OFL-1.1, Unlicense, 0BSD and the embedded notices below also apply. BSL-1.0 here means Boost Software License, not Business Source License. OFL fonts may accompany commercial software while retaining their font terms. Lightning CSS 1.32.0/1.33.0 is MPL-2.0 build tooling; its implementation was not present in the inspected runtime module graph.\n\nRetain this entire document with distributed builds. License grants, conditions and disclaimers below control over this summary. The repository's legal/AUDIT.md records evidence and unresolved provenance questions. Re-audit after dependency, asset, or import changes.\n\n## Locked components\n\nClassification is based on bundle metadata plus known generated helpers. Bundled libraries may themselves contain code with different versions/licenses; these are listed separately below. Platform-optional packages absent on the audit machine have metadata-only coverage. Build-only entries do not imply their code is shipped.\n\n| Component / lock path | Version | Declared npm license | Scope |\n| --- | --- | --- | --- |\n${table}\n\n${extra}\n\n## Bundled drawing font metadata\n\nOnly the following WOFF binaries ship from the three typeface packages; their MIT package labels do not replace the font licenses. No package wrapper CSS is imported from these packages. The fonts are bundled unchanged.\n\n${fonts.map(f => `### ${f.file}\n\n${f.names.copyright.en}\n\n${f.names.version.en}; license URL embedded in font: ${f.names.licenseURL.en}\n\nSHA-256: \`${f.sha256}\``).join('\n\n')}\n\n## License texts and notices\n\nThe sections below preserve installed or upstream license texts. Supplemental upstream notices include their source URLs in legal/upstream/sources.json in the source distribution.\n\n${notices.map(n => `### ${n.title}\n\nSource: \`${n.file}\`\n\n\`\`\`text\n${n.text.trim()}\n\`\`\``).join('\n\n')}\n`;
for (const [file, content] of [['legal/dependency-inventory.json', JSON.stringify(inventory, null, 2) + '\n'], ['LEGAL_ATTRIBUTIONS.md', markdown]]) {
  if (write) fs.writeFileSync(file, content);
  else if (!fs.existsSync(file) || read(file) !== content) throw new Error(`${file} is stale; review changes and run npm run audit:licenses:write`);
}
console.log(`License inventory ${write ? 'written' : 'verified'}: ${packages.length} locked records, ${shipped.size} package inputs/helpers, ${sources.length} source files; no declared GPL/AGPL. See legal/AUDIT.md for exceptions and limits.`);
