import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * REMOTE-005 B3 TC-10 — the package must be isomorphic (Node 22 + browser): its shipped source may use ONLY
 * WebCrypto/standard web APIs. Assert no `node:` imports and no `crypto.timingSafeEqual` (node-only) leak into
 * the source, so the Stage-D browser client can reuse it unchanged.
 */

const SRC_DIR = join(__dirname, '..');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') out.push(...sourceFiles(join(dir, entry.name)));
    } else if (entry.name.endsWith('.ts')) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

describe('agent-remote-pairing isomorphism (REMOTE-005 B3 — TC-10)', () => {
  it('shipped source imports no node: module and uses no node-only timingSafeEqual', () => {
    const files = sourceFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      // Strip block + line comments so documentation that mentions `node:` / `timingSafeEqual` isn't flagged.
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(code, `${file} must not import a node: module`).not.toMatch(/from\s+['"]node:/);
      expect(code, `${file} must not call node-only timingSafeEqual`).not.toMatch(
        /timingSafeEqual\s*\(/,
      );
    }
  });

  it('runs its crypto under the isomorphic globalThis.crypto (WebCrypto)', () => {
    expect(typeof globalThis.crypto.subtle.sign).toBe('function');
    expect(typeof globalThis.crypto.getRandomValues).toBe('function');
  });
});
