import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');
const BROWSER_BUNDLE = path.join(WORKSPACE_ROOT, 'packages/agent-core/dist/browser/index.js');

/**
 * CORE-028 — `agent-core` publishes a `browser` export condition, and the build under it imported
 * Node builtins on its FIRST LINE. `apps/agent-web/next.config.ts` carries webpack `false` aliases
 * and two hand-written stub modules that exist only to patch around that.
 *
 * This is a RATCHET over the built artefact, not over the source: an import can arrive through any
 * module in the graph, and the only place the answer is unambiguous is the bundle.
 *
 * The list is what remains, not what is acceptable. `node:crypto` came out when five modules moved
 * to `globalThis.crypto`; the other three need a build-configuration change and are tracked in
 * CORE-028. Removing one from this list is the point — adding one needs a reason.
 */
const KNOWN_REMAINING = ['node:child_process', 'node:fs', 'node:path'];

describe('the agent-core browser bundle (CORE-028)', () => {
  it('imports no Node builtin beyond the ones CORE-028 still tracks', () => {
    if (!existsSync(BROWSER_BUNDLE)) {
      // The bundle is a build output. Saying "skipped, and why" beats a silent pass over a file
      // that is not there.
      expect(
        existsSync(BROWSER_BUNDLE),
        `${BROWSER_BUNDLE} is missing — run \`pnpm --filter @robota-sdk/agent-core build\` first. ` +
          'This check reads the built artefact because that is the only place the answer is ' +
          'unambiguous.',
      ).toBe(true);
      return;
    }

    const source = readFileSync(BROWSER_BUNDLE, 'utf8');
    const found = [
      ...new Set([...source.matchAll(/["']node:([a-z_]+)["']/g)].map((m) => `node:${m[1]}`)),
    ].sort();

    expect(
      found,
      'A Node builtin appeared in the BROWSER bundle. Every browser consumer has to stub it, which ' +
        'is the defect CORE-028 is about.',
    ).toEqual(KNOWN_REMAINING);
  });

  it('does not import node:crypto — the five modules that did now ask the platform', () => {
    if (!existsSync(BROWSER_BUNDLE)) return;
    const source = readFileSync(BROWSER_BUNDLE, 'utf8');
    expect(source).not.toContain('node:crypto');
  });
});
