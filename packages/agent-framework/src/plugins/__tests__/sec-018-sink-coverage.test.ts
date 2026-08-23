import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { MarketplaceClient } from '../marketplace-client.js';
import { removeInstalledPluginsForMarketplace } from '../marketplace-registry.js';

import type { TExecFn } from '../marketplace-types.js';

/**
 * SEC-018 - the two remaining sinks, each driven rather than assumed.
 *
 * `regression-red-proof` reported `accidental-green-fail (all-pass)` for `marketplace-registry.ts` and
 * `marketplace-client.ts`: reversing the guards changed nothing, because no test reached either sink.
 * That is the THIRD time in this one change that a guard was added and its use was not asserted - the
 * reviewer found two, the floor found these two. Testing `plugin-paths.ts` proves the predicate; only
 * driving the sink proves the call.
 */
function writeJson(path: string, data: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), 'utf-8');
}

describe('SEC-018 - the marketplace-wide cleanup refuses a path outside the plugin cache', () => {
  let base: string;
  let pluginsDir: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'sec-018-registry-'));
    pluginsDir = join(base, 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
  });

  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('does not delete a tampered installPath, and still drops the entry', () => {
    const victim = join(base, 'victim');
    mkdirSync(victim, { recursive: true });
    writeFileSync(join(victim, 'keep.txt'), 'do not delete me', 'utf-8');

    writeJson(join(pluginsDir, 'installed_plugins.json'), {
      'evil@market': { marketplace: 'market', installPath: victim },
    });

    removeInstalledPluginsForMarketplace(pluginsDir, 'market');

    expect(existsSync(join(victim, 'keep.txt')), 'a path outside the cache was deleted').toBe(true);
    const registry = JSON.parse(
      readFileSync(join(pluginsDir, 'installed_plugins.json'), 'utf-8'),
    ) as Record<string, unknown>;
    expect(registry['evil@market'], 'a tampered entry pinned itself in place').toBeUndefined();
  });

  it('refuses a path inside the plugins root but OUTSIDE the cache', () => {
    // The finding that made both sinks agree on one root: `pluginsDir/marketplaces/<name>` is inside
    // the plugins root and outside the cache, so a wider check would recursively delete a sibling
    // marketplace clone - or the registry file itself.
    const sibling = join(pluginsDir, 'marketplaces', 'other-market');
    mkdirSync(sibling, { recursive: true });
    writeFileSync(join(sibling, 'keep.txt'), 'another marketplace', 'utf-8');

    writeJson(join(pluginsDir, 'installed_plugins.json'), {
      'evil@market': { marketplace: 'market', installPath: sibling },
    });

    removeInstalledPluginsForMarketplace(pluginsDir, 'market');

    expect(existsSync(join(sibling, 'keep.txt')), 'a sibling marketplace was deleted').toBe(true);
  });

  it('still deletes a legitimate cache directory', () => {
    const legit = join(pluginsDir, 'cache', 'market', 'plug', '1.0.0');
    mkdirSync(legit, { recursive: true });
    writeFileSync(join(legit, 'index.js'), '', 'utf-8');

    writeJson(join(pluginsDir, 'installed_plugins.json'), {
      'plug@market': { marketplace: 'market', installPath: legit },
    });

    removeInstalledPluginsForMarketplace(pluginsDir, 'market');

    expect(existsSync(legit), 'the guard refused a legitimate removal').toBe(false);
  });
});

describe('SEC-018 - a marketplace manifest name cannot select a destination outside its root', () => {
  let base: string;
  let pluginsDir: string;
  let mockExec: Mock;
  let client: MarketplaceClient;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), 'sec-018-client-'));
    pluginsDir = join(base, 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    mockExec = vi.fn().mockReturnValue('');
    client = new MarketplaceClient({ pluginsDir, exec: mockExec as unknown as TExecFn });
  });

  afterEach(() => rmSync(base, { recursive: true, force: true }));

  it('refuses a manifest whose name traverses out of the marketplaces directory', () => {
    // The reproduction the issue describes: a REMOTE manifest named `../../escaped-market` selected
    // the rename destination, so the marketplace landed outside its root.
    const localSource = join(base, 'source');
    mkdirSync(join(localSource, '.claude-plugin'), { recursive: true });
    writeJson(join(localSource, '.claude-plugin', 'marketplace.json'), {
      name: '../../escaped-market',
      version: '1.0',
      plugins: [],
    });

    expect(() => client.addMarketplace({ type: 'local', path: localSource })).toThrow(
      /Invalid plugin marketplace name/,
    );
    expect(
      existsSync(join(base, 'escaped-market')),
      'a marketplace was created outside its root',
    ).toBe(false);
  });

  it('accepts a well-formed manifest name', () => {
    const localSource = join(base, 'good-source');
    mkdirSync(join(localSource, '.claude-plugin'), { recursive: true });
    writeJson(join(localSource, '.claude-plugin', 'marketplace.json'), {
      name: 'good-market',
      version: '1.0',
      plugins: [],
    });

    expect(client.addMarketplace({ type: 'local', path: localSource })).toBe('good-market');
  });
});
