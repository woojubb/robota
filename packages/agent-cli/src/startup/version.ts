import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function readVersion(): string {
  try {
    const thisFile = fileURLToPath(import.meta.url);
    const dir = dirname(thisFile);
    const candidates = [join(dir, '..', '..', 'package.json'), join(dir, '..', 'package.json')];

    for (const pkgPath of candidates) {
      try {
        const raw = readFileSync(pkgPath, 'utf-8');
        const pkg = JSON.parse(raw) as { version?: string; name?: string };
        if (pkg.version !== undefined && pkg.name !== undefined) {
          return pkg.version;
        }
      } catch {
        // allow-fallback: unreadable package.json — try next candidate path
        continue;
      }
    }
    return '0.0.0';
  } catch {
    // allow-fallback: entire version read fails — fall back to sentinel
    return '0.0.0';
  }
}
