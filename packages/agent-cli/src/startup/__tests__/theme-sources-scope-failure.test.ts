/**
 * SCREEN-2002 TC-11 — a plugin scope the loader cannot read.
 *
 * Its own file, because proving it needs the plugin loader to throw, and mocking that module for
 * the whole `theme-sources` suite would make every other case answer a mock instead of the loader.
 *
 * The property: a scope that explodes must not fail the start, and must not be silent either. A
 * silent catch is indistinguishable from "this machine has no plugin themes".
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

// Spread the real module and override ONE export: a hand-listed factory silently drops whatever the
// module gains later, and the failure lands as "not a function" in an unrelated file.
vi.mock('@robota-sdk/agent-framework', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@robota-sdk/agent-framework')>()),
  loadHostBundlePluginsFromScopes: (): never => {
    throw new Error(`scope unreadable ${String.fromCharCode(0x9b)}2J`);
  },
}));

const { loadThemeSources } = await import('../theme-sources.js');

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('loadThemeSources when a plugin scope cannot be read', () => {
  it('says so as a skip, and keeps the escape sequence in the error off the terminal', () => {
    const home = mkdtempSync(join(tmpdir(), 'robota-theme-scope-'));
    roots.push(home);

    const sources = loadThemeSources({ cwd: undefined, userHome: home });

    expect(sources.themes).toEqual([]);
    expect(sources.skipped).toHaveLength(1);
    expect(sources.skipped[0]?.reason).toMatch(/the plugin scopes could not be read/u);
    expect(sources.skipped[0]?.reason).toContain('scope unreadable');
    // The message embeds paths from the environment and a dependency's own text.
    expect(sources.skipped[0]?.reason).not.toContain(String.fromCharCode(0x9b));
    expect(sources.skipped[0]?.fileName).not.toBe('');
  });
});
