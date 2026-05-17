import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function readPackageVersion(importMetaUrl: string): string {
  const dir = dirname(fileURLToPath(importMetaUrl));
  const candidates = [join(dir, '..', '..', 'package.json'), join(dir, '..', 'package.json')];

  for (const pkgPath of candidates) {
    try {
      const raw = readFileSync(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw) as { version?: string; name?: string };
      if (pkg.version !== undefined && pkg.name !== undefined) {
        return pkg.version;
      }
    } catch {
      // allow-fallback: package.json absent at this candidate path; advance to next
      continue;
    }
  }

  return '0.0.0'; // allow-fallback: version display must not crash startup when no package.json found
}
