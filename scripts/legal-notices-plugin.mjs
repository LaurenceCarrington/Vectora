import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** Include the complete attribution document in every Vite production output. */
export function legalNoticesPlugin() {
  return {
    name: 'vectora-legal-notices',
    apply: 'build',
    generateBundle() {
      if (process.env.VECTORA_LICENSE_INVENTORY === '1') return;
      const source = readFileSync(new URL('../LEGAL_ATTRIBUTIONS.md', import.meta.url), 'utf8');
      const lock = readFileSync(new URL('../package-lock.json', import.meta.url));
      const fingerprint = createHash('sha256').update(lock).digest('hex');
      if (!source.includes(`Lockfile SHA-256: \`${fingerprint}\``)) {
        this.error('Third-party notices are stale. Review the dependency changes and run npm run audit:licenses:write.');
      }
      this.emitFile({ type: 'asset', fileName: 'LEGAL_ATTRIBUTIONS.md', source });
    },
  };
}
