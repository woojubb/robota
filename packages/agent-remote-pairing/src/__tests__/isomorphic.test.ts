import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * REMOTE-005 B3 TC-10 — the package must be isomorphic (Node 22 + browser): its shipped source may use ONLY
 * WebCrypto/standard web APIs. Assert no `node:` imports and no `crypto.timingSafeEqual` (node-only) leak into
 * the source, so the Stage-D browser client can reuse it unchanged.
 *
 * SCOPED TO THE MAIN ENTRY (SEC-010). `src/local/` is a SEPARATE, node-only entry point exported at
 * `@robota-sdk/agent-remote-pairing/local`, and it needs `node:fs` by design: its whole proof is a
 * directory's owner and mode, which a browser has no way to read and no local peer to read it for.
 *
 * Excluding it does NOT weaken this test. The claim being defended is that the BROWSER-REACHABLE
 * surface stays isomorphic, and nothing in `src/local/` is reachable from `src/index.ts` — asserted
 * below rather than assumed, because an exclusion that also excused an accidental import from the
 * main entry would quietly turn this check off.
 */

const SRC_DIR = join(__dirname, '..');
const NODE_ONLY_ENTRY = 'local';

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__' && entry.name !== NODE_ONLY_ENTRY) {
        out.push(...sourceFiles(join(dir, entry.name)));
      }
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

  it('the node-only entry is NOT reachable from the main entry (SEC-010)', () => {
    // The exclusion above is only safe while this holds. Asserted rather than assumed: an
    // accidental `export … from './local/…'` in the main entry would put node:fs back on the
    // browser surface, and the exclusion would then be hiding exactly the defect this file exists
    // to catch. Walk the main entry's transitive relative imports and require none to enter local/.
    const seen = new Set<string>();
    const queue = [join(SRC_DIR, 'index.ts')];
    while (queue.length > 0) {
      const file = queue.pop() as string;
      if (seen.has(file)) continue;
      seen.add(file);
      const code = readFileSync(file, 'utf8');
      for (const match of code.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
        const target = join(dirname(file), match[1].replace(/\.js$/, '.ts'));
        expect(target, `${file} must not reach the node-only entry`).not.toMatch(
          new RegExp(`\\${sep}${NODE_ONLY_ENTRY}\\${sep}`),
        );
        if (existsSync(target)) queue.push(target);
      }
    }

    // Fail closed: a walk that visited only the entry file would pass this vacuously.
    expect(seen.size).toBeGreaterThan(1);
  });

  it('runs its crypto under the isomorphic globalThis.crypto (WebCrypto)', () => {
    expect(typeof globalThis.crypto.subtle.sign).toBe('function');
    expect(typeof globalThis.crypto.getRandomValues).toBe('function');
  });
});
