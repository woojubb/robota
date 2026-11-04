import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config-loader.js';
import { createNodeHostSettingsSource } from '../node-host-settings-source.js';
import { SettingsParseError } from '../settings-parse-error.js';
import { inspectSettingsLayers } from '../settings-inspection.js';
import { readSettingsSourceText } from '../settings-source.js';

import type { IHostSettingsSource } from '../settings-source.js';

/**
 * A host settings source is whatever the host reads its document through. The framework asks it
 * for text and never opens a path, so a host with no file system lends the same contract.
 */

function memorySource(
  text: string | undefined,
  scope: 'user' | 'managed' = 'user',
): IHostSettingsSource {
  return Object.freeze({
    kind: 'host' as const,
    scope,
    displayName: 'in-memory settings',
    read: () => text,
  });
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function tempRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'agent-host-settings-source-')));
  roots.push(root);
  return root;
}

describe('a host settings source that is not a file', () => {
  it('is read through its own `read`, with no path involved', () => {
    expect(readSettingsSourceText(memorySource('{"language":"ko"}'), 'test')).toBe(
      '{"language":"ko"}',
    );
    expect(readSettingsSourceText(memorySource(undefined), 'test')).toBeUndefined();
  });

  it('is classified like a file layer: absent, ok, empty, invalid-json and unreadable', () => {
    const unreadable: IHostSettingsSource = {
      kind: 'host',
      scope: 'user',
      displayName: 'locked',
      read: () => {
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      },
    };

    const inspection = inspectSettingsLayers([
      memorySource(undefined),
      memorySource('{"language":"ko"}'),
      memorySource('   '),
      memorySource('{ not json'),
      unreadable,
    ]);

    expect(inspection.layers.map((layer) => layer.state)).toEqual([
      'absent',
      'ok',
      'empty',
      'invalid-json',
      'unreadable',
    ]);
    expect(inspection.layers[4]?.cause).toEqual({ state: 'unreadable', errno: 'EACCES' });
    expect(inspection.partial).toBe(true);
  });

  it('merges into the configuration `loadConfig` builds', async () => {
    const config = await loadConfig([
      memorySource('{"language":"en"}'),
      memorySource('{"language":"ko"}', 'managed'),
    ]);

    expect(config.language).toBe('ko');
  });

  it('refuses a layer that exists but fails to parse, as a file layer does', async () => {
    await expect(loadConfig([memorySource('{ not json')])).rejects.toThrow(SettingsParseError);
  });

  it('propagates the reader`s own error for a layer that exists but cannot be read', async () => {
    const unreadable: IHostSettingsSource = {
      kind: 'host',
      scope: 'user',
      displayName: 'locked',
      read: () => {
        throw new Error('permission denied');
      },
    };

    await expect(loadConfig([unreadable])).rejects.toThrow('permission denied');
  });
});

describe('createNodeHostSettingsSource', () => {
  it('reads a missing file as absent and an existing file as its text', () => {
    const root = tempRoot();
    const path = join(root, 'settings.json');

    const source = createNodeHostSettingsSource('user', path);
    expect(source.read()).toBeUndefined();

    writeFileSync(path, '{"language":"ko"}', 'utf8');
    expect(source.read()).toBe('{"language":"ko"}');
    expect(source.displayName).toBe(path);
    expect(source.path).toBe(path);
    expect(source.kind).toBe('host');
    expect(source.scope).toBe('user');
  });

  it('throws when the path exists but cannot be read, so it is never mistaken for an absent file', () => {
    const root = tempRoot();
    const directory = join(root, 'a-directory');
    mkdirSync(directory);

    expect(() => createNodeHostSettingsSource('user', directory).read()).toThrow();
  });
});
