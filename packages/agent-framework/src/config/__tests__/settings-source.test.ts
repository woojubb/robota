import { mkdirSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createNodeHostSettingsSource,
  createWorkspaceProjectSettingsSources,
  readSettingsSourceText,
} from '../settings-source.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { TEST_PROJECT_SETTINGS_PATHS } from '../../testing/project-settings-path-fixture.js';
import {
  WorkspaceAuthorityRequiredError,
  getWorkspaceProjectReader,
} from '../../workspace-trust/index.js';

const roots: string[] = [];

function tempRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'robota-settings-source-')));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('discriminated settings sources', () => {
  it('loads only the project settings paths supplied by the host', async () => {
    const root = tempRoot();
    mkdirSync(join(root, '.custom'), { recursive: true });
    mkdirSync(join(root, '.robota'), { recursive: true });
    writeFileSync(join(root, '.custom', 'settings.json'), '{"custom":true}', 'utf8');
    writeFileSync(join(root, '.robota', 'settings.json'), '{"robota":true}', 'utf8');
    const access = await createTrustedProjectAccessFixture(root);
    if (access.status !== 'trusted') throw new Error('Expected trusted project access.');
    const reader = getWorkspaceProjectReader(access.authority);

    expect(createWorkspaceProjectSettingsSources(reader, [])).toEqual([]);
    const sources = createWorkspaceProjectSettingsSources(reader, [
      { scope: 'project', relativePath: join('.custom', 'settings.json') },
    ]);
    expect(sources.map((source) => source.relativePath)).toEqual([
      join('.custom', 'settings.json'),
    ]);
    expect(readSettingsSourceText(sources[0]!, 'test custom settings')).toBe('{"custom":true}');
  });

  it('reads project layers only through a production-minted reader', async () => {
    const root = tempRoot();
    mkdirSync(join(root, '.robota'), { recursive: true });
    writeFileSync(join(root, '.robota', 'settings.json'), '{"project":true}', 'utf8');
    const access = await createTrustedProjectAccessFixture(root);
    if (access.status !== 'trusted') throw new Error('Expected trusted project access.');

    const sources = createWorkspaceProjectSettingsSources(
      getWorkspaceProjectReader(access.authority),
      TEST_PROJECT_SETTINGS_PATHS,
    );

    expect(sources.map((source) => source.scope)).toEqual([
      'project',
      'project-local',
      'project',
      'project-local',
    ]);
    expect(readSettingsSourceText(sources[0], 'test project settings')).toBe('{"project":true}');
  });

  it('rejects a structural host reader masquerading as a project source', () => {
    const forged = {
      kind: 'project',
      scope: 'project',
      displayName: '.robota/settings.json',
      relativePath: '.robota/settings.json',
      reader: { readText: () => '{"forged":true}' },
    } as never;

    expect(() => readSettingsSourceText(forged, 'test forged project settings')).toThrowError(
      WorkspaceAuthorityRequiredError,
    );
  });

  it('keeps explicitly named Node host sources distinct from project authority', () => {
    const root = tempRoot();
    const path = join(root, 'managed.json');
    writeFileSync(path, '{"managed":true}', 'utf8');

    const source = createNodeHostSettingsSource('managed', path);

    expect(source.kind).toBe('host');
    expect(readSettingsSourceText(source, 'test managed settings')).toBe('{"managed":true}');
  });
});
