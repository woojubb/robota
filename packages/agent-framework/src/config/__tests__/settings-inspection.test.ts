import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../config-loader.js';
import { inspectSettingsLayers } from '../settings-inspection.js';
import { SettingsParseError } from '../settings-parse-error.js';
import {
  createNodeHostSettingsSource,
  createWorkspaceProjectSettingsSources,
} from '../settings-source.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { getWorkspaceProjectReader } from '../../workspace-trust/index.js';

const roots: string[] = [];
function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'robota-settings-inspection-'));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function source(root: string, name: string, content?: string) {
  const path = join(root, name);
  if (content !== undefined) writeFileSync(path, content, 'utf8');
  return createNodeHostSettingsSource('user', path);
}

const SECRET = 'sk-doctor-marker-adjacent-1a2b3c';

describe('inspectSettingsLayers (OBSERVABILITY-1991 TC-02)', () => {
  it('classifies every layer state with a structured cause and no file content', () => {
    const root = tempRoot();
    const absent = source(root, 'absent.json');
    const ok = source(root, 'ok.json', '{"language":"ko"}');
    const empty = source(root, 'empty.json', '');
    const invalid = source(root, 'invalid.json', `{"apiKey": ${SECRET}}`);
    const schema = source(root, 'schema.json', '{"defaultTrustLevel":42}');
    const dir = join(root, 'dir.json');
    mkdirSync(dir);
    const unreadable = createNodeHostSettingsSource('user', dir);

    const inspection = inspectSettingsLayers([absent, ok, empty, invalid, schema, unreadable]);
    const states = inspection.layers.map((layer) => layer.state);
    expect(states).toEqual([
      'absent',
      'ok',
      'empty',
      'invalid-json',
      'schema-invalid',
      'unreadable',
    ]);
    expect(inspection.partial).toBe(true);

    const invalidLayer = inspection.layers[3]!;
    expect(invalidLayer.cause?.state).toBe('invalid-json');
    expect(
      typeof invalidLayer.cause?.offset === 'number' || invalidLayer.cause?.offset === undefined,
    ).toBe(true);
    expect(JSON.stringify(inspection)).not.toContain(SECRET);

    const schemaLayer = inspection.layers[4]!;
    expect(schemaLayer.cause?.issues?.map((issue) => issue.path)).toEqual(['defaultTrustLevel']);
    expect(JSON.stringify(schemaLayer.cause)).not.toContain('42');

    expect(inspection.layers[5]!.cause).toEqual({ state: 'unreadable', errno: 'EISDIR' });
  });

  it('reports per-key merge rule and contributing layers over the merged view', () => {
    const root = tempRoot();
    const user = source(
      root,
      'user.json',
      JSON.stringify({
        defaultTrustLevel: 'full',
        permissions: { allow: ['a'], deny: ['x'] },
        hooks: { PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'echo' }] }] },
      }),
    );
    const project = source(
      root,
      'project.json',
      JSON.stringify({ defaultTrustLevel: 'safe', permissions: { deny: ['y'] }, language: 'ko' }),
    );
    const inspection = inspectSettingsLayers([user, project]);
    expect(inspection.partial).toBe(false);
    const byKey = new Map(inspection.provenance.map((entry) => [entry.key, entry]));
    expect(byKey.get('defaultTrustLevel')).toEqual({
      key: 'defaultTrustLevel',
      rule: 'most-restrictive',
      contributors: [user.displayName, project.displayName],
    });
    expect(byKey.get('permissions.deny')?.rule).toBe('union');
    expect(byKey.get('permissions.allow')?.contributors).toEqual([user.displayName]);
    expect(byKey.get('hooks')?.rule).toBe('per-event');
    expect(byKey.get('language')?.rule).toBe('replace');
    expect(inspection.merged.defaultTrustLevel).toBe('safe');
    expect(inspection.merged.permissions?.deny).toEqual(['x', 'y']);
  });

  it('attributes effective user and project hooks and excludes disabled groups in a partial inspection', async () => {
    const root = tempRoot();
    const user = source(
      root,
      'user-hooks.json',
      JSON.stringify({
        disabledHooks: ['project-muted'],
        hooks: {
          PreToolUse: [{ matcher: '*', hooks: [{ type: 'command', command: 'user-private' }] }],
        },
      }),
    );
    mkdirSync(join(root, '.robota'));
    writeFileSync(
      join(root, '.robota', 'settings.json'),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: '*', hooks: [{ type: 'command', command: 'project-private' }] },
            {
              id: 'project-muted',
              matcher: '*',
              hooks: [{ type: 'prompt', prompt: 'muted-private' }],
            },
          ],
        },
      }),
      'utf8',
    );
    const access = await createTrustedProjectAccessFixture(root);
    if (access.status !== 'trusted') throw new Error('Expected trusted project access.');
    const project = createWorkspaceProjectSettingsSources(
      getWorkspaceProjectReader(access.authority),
    )[0]!;
    const broken = source(root, 'broken.json', '{');

    const inspection = inspectSettingsLayers([user, project, broken]);

    expect(inspection.partial).toBe(true);
    expect(inspection.hookSources).toEqual([
      { event: 'PreToolUse', type: 'command', source: user.displayName },
      { event: 'PreToolUse', type: 'command', source: project.displayName },
    ]);
    expect(JSON.stringify(inspection.hookSources)).not.toMatch(/private/);
    expect(inspection.merged.hooks?.PreToolUse).toHaveLength(2);
  });

  it('keeps loadConfig raising the same error at the same layer: read-phase first, then schema', async () => {
    const root = tempRoot();
    const schemaFirst = source(root, 'a.json', '{"defaultTrustLevel":42}');
    const invalidSecond = source(root, 'b.json', '{');
    await expect(loadConfig([schemaFirst, invalidSecond])).rejects.toBeInstanceOf(
      SettingsParseError,
    );
    await expect(loadConfig([schemaFirst])).rejects.toThrow(/Invalid settings in .*a\.json/);
    const empty = source(root, 'c.json', '   ');
    await expect(loadConfig([empty])).rejects.toThrow(/the settings file is empty/);
  });

  it('keeps loadConfig propagating the reader error for an unreadable layer', async () => {
    const root = tempRoot();
    const path = join(root, 'locked.json');
    writeFileSync(path, '{}', 'utf8');
    chmodSync(path, 0o000);
    const locked = createNodeHostSettingsSource('user', path);
    const inspection = inspectSettingsLayers([locked]);
    if (inspection.layers[0]!.state === 'ok') {
      // Running as a user that ignores mode bits (root); nothing to assert about unreadability here.
      return;
    }
    expect(inspection.layers[0]!.cause?.errno).toBe('EACCES');
    await expect(loadConfig([locked])).rejects.toMatchObject({ code: 'EACCES' });
  });
});
