import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const CORE_SRC = path.join(WORKSPACE_ROOT, 'packages/agent-core/src');
const BROWSER_BUNDLE = path.join(WORKSPACE_ROOT, 'packages/agent-core/dist/browser/index.js');

/**
 * CORE-028 — `agent-core` publishes a `browser` export condition, and the build under it imported
 * Node builtins on its FIRST LINE. `apps/agent-web/next.config.ts` carries webpack `false` aliases
 * and two hand-written stub modules that exist only to patch around that.
 *
 * TWO CHECKS, because they answer different questions and are available at different times.
 *
 * The SOURCE check runs everywhere and catches a regression where it is introduced. The BUNDLE check
 * is the authoritative one — an import can arrive through any module in the graph — but it needs a
 * build output, and the `scans` job is deliberately dist-independent. The first version was only the
 * bundle check, so it could never pass in CI: a check placed where its input does not exist. It says
 * so explicitly when it skips rather than passing quietly.
 */
const KNOWN_REMAINING = ['node:child_process', 'node:fs', 'node:path'];

/**
 * The modules the BROWSER build actually includes.
 *
 * `src/testing/` is excluded because `tsdown.config.ts` excludes it — its comment says so in as many
 * words ("Browser build excludes test-only fixtures"), and it is a separate entry. Scoping this
 * check to a wider set than the artefact it is about would report defects that cannot reach the
 * bundle, and `cassette-provider.ts` is one: it imports `createHash`, whose Web Crypto equivalent is
 * ASYNC and therefore not a drop-in. A guard that fires where the defect cannot occur gets an
 * exception written into it, and then the exception is what people remember.
 */
const EXCLUDED_FROM_BROWSER_ENTRY = new Set(['__tests__', 'node_modules', 'testing']);

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_FROM_BROWSER_ENTRY.has(entry.name)) continue;
      sourceFiles(full, out);
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

describe('the agent-core browser surface (CORE-028)', () => {
  it('no module imports node:crypto — the five that did now ask the platform', () => {
    const files = sourceFiles(CORE_SRC);
    expect(files.length, 'no source files were read, so this proves nothing').toBeGreaterThan(50);
    const offenders = files
      .filter((file) => /from\s+['"]node:crypto['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(WORKSPACE_ROOT, file));
    expect(
      offenders,
      'Use `randomId()` from `utils/random-id.js`. `globalThis.crypto.randomUUID()` is the same ' +
        'function in Node and the browser; importing it from `node:crypto` puts it in the browser ' +
        'bundle, which every browser consumer then has to stub.',
    ).toEqual([]);
  });

  /**
   * `skipIf`, not an early `return`.
   *
   * The first version warned and returned, and vitest counts that as PASSED — "a check that reports
   * success over work it did not do", which is the class HARNESS-052/056 exist for and which the
   * comment right here claimed to be avoiding. In CI, where `scans` is dist-independent, that branch
   * is ALWAYS the one taken, so a green tick stood for an assertion that never ran. Review of #1597
   * caught it.
   *
   * A skipped result is a different colour from a passing one, which is the whole point.
   */
  it.skipIf(!existsSync(BROWSER_BUNDLE))(
    'the BUILT bundle imports no Node builtin beyond the ones CORE-028 still tracks (needs `pnpm --filter @robota-sdk/agent-core build`)',
    () => {
      const source = readFileSync(BROWSER_BUNDLE, 'utf8');
      const found = [
        ...new Set([...source.matchAll(/["']node:([a-z_]+)["']/g)].map((m) => `node:${m[1]}`)),
      ].sort();

      // The list is what REMAINS, not what is acceptable. Removing an entry is the point; adding one
      // needs a reason.
      expect(
        found,
        'A Node builtin appeared in the BROWSER bundle. Every browser consumer has to stub it, which ' +
          'is the defect CORE-028 is about.',
      ).toEqual(KNOWN_REMAINING);
    },
  );
});
