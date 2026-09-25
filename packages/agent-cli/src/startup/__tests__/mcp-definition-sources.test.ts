/**
 * MCP-002: `resolveMcpDefinitions` sources every settings layer's `mcpServers` object and resolves
 * precedence across them — the one thing neither `agent-framework`'s settings inspection nor
 * `agent-mcp`'s decoder/precedence modules do on their own.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  WorkspaceTrustService,
  createWorkspaceProjectSettingsSources,
  getWorkspaceProjectReader,
} from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it } from 'vitest';

import { resolveMcpDefinitions } from '../mcp-definition-sources.js';
import { ROBOTA_PROJECT_SETTINGS } from '../../product/robota-project-settings.js';
import { createRobotaUserSettingsSources } from '../../product/robota-user-settings.js';

import type { IWorkspaceIdentity, TSettingsSource } from '@robota-sdk/agent-framework';

const roots: string[] = [];

function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A trusted project's settings sources, minted through the real trust-service path (no forged reader). */
async function trustedProjectSettingsSources(root: string): Promise<readonly TSettingsSource[]> {
  const identity: IWorkspaceIdentity = {
    repositoryKey: `fixture:${root}`,
    displayPath: root,
    worktreeRoot: root,
  };
  const service = new WorkspaceTrustService({
    identityResolver: { resolve: () => identity },
    store: {
      inspect: async () => ({ state: 'trusted', generation: 1 }),
      grant: async () => ({ state: 'trusted', generation: 1 }),
      revoke: async () => ({ state: 'revoked', generation: 2 }),
    },
  });
  const access = await service.inspect(root);
  if (access.status !== 'trusted') throw new Error('Fixture trust service did not return trusted.');
  return createWorkspaceProjectSettingsSources(
    getWorkspaceProjectReader(access.authority),
    ROBOTA_PROJECT_SETTINGS,
  );
}

describe('resolveMcpDefinitions', () => {
  it('resolves a name declared by both a user and a project layer to the project entry', async () => {
    const userHome = tempRoot('robota-mcp-defs-user-');
    const projectRoot = tempRoot('robota-mcp-defs-project-');
    mkdirSync(join(userHome, '.robota'), { recursive: true });
    writeFileSync(
      join(userHome, '.robota', 'settings.json'),
      JSON.stringify({
        mcpServers: { weather: { type: 'http', url: 'https://user.example/weather' } },
      }),
    );
    mkdirSync(join(projectRoot, '.robota'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.robota', 'settings.json'),
      JSON.stringify({
        mcpServers: { weather: { type: 'http', url: 'https://project.example/weather' } },
      }),
    );

    const settingsSources = [
      ...createRobotaUserSettingsSources(userHome),
      ...(await trustedProjectSettingsSources(projectRoot)),
    ];

    const { entries, problems } = resolveMcpDefinitions(settingsSources, process.env);

    expect(problems).toEqual([]);
    expect(entries).toHaveLength(1);
    const [weather] = entries;
    expect(weather?.name).toBe('weather');
    expect(weather?.source).toBe('project');
    expect(weather?.status).toBe('resolved');
    expect(weather?.definition?.url).toBe('https://project.example/weather');
    expect(weather?.shadowed).toEqual([
      { name: 'weather', source: 'user', origin: expect.stringContaining('.robota') },
    ]);
  });

  it('reports an invalid-json layer as a source-scoped problem naming its origin, never silently', () => {
    const userHome = tempRoot('robota-mcp-defs-invalid-');
    mkdirSync(join(userHome, '.robota'), { recursive: true });
    const settingsPath = join(userHome, '.robota', 'settings.json');
    writeFileSync(settingsPath, '{ this is not json');

    const settingsSources = createRobotaUserSettingsSources(userHome);
    const { entries, problems, sourceProblems } = resolveMcpDefinitions(settingsSources, process.env);

    expect(entries).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({ name: '', source: 'user', origin: settingsPath });
    expect(problems[0]?.reason).toContain('invalid JSON');
    // BEHAVIOR-2794 (issue #2794 / #3073): the same problem also reaches the dedicated
    // source-problem channel, not just the flat `problems` list used for startup diagnostics.
    expect(sourceProblems).toEqual(problems);
  });

  it('produces nothing for a layer that declares no mcpServers', () => {
    const userHome = tempRoot('robota-mcp-defs-none-');
    mkdirSync(join(userHome, '.robota'), { recursive: true });
    writeFileSync(join(userHome, '.robota', 'settings.json'), JSON.stringify({ language: 'en' }));

    const settingsSources = createRobotaUserSettingsSources(userHome);
    const { entries, problems, sourceProblems } = resolveMcpDefinitions(settingsSources, process.env);

    expect(entries).toEqual([]);
    expect(problems).toEqual([]);
    expect(sourceProblems).toEqual([]);
  });

  // BEHAVIOR-2794 (issue #2794 / #3073): an unreadable managed-equivalent source (here, the user
  // layer standing in for any layer) must surface a source problem AND leave a lower-precedence
  // layer's entries resolved — the fail-closed/fail-open distinction the issue is about.
  it('surfaces an unreadable settings layer as a source problem while a project entry still resolves', async () => {
    const userHome = tempRoot('robota-mcp-defs-unreadable-user-');
    const projectRoot = tempRoot('robota-mcp-defs-unreadable-project-');
    mkdirSync(join(userHome, '.robota'), { recursive: true });
    // `mcpServers` present but not an object — decoded by `agent-mcp`'s strict decoder as a
    // source-level problem, not a per-entry one (there are no entries to blame).
    writeFileSync(
      join(userHome, '.robota', 'settings.json'),
      JSON.stringify({ mcpServers: 'not an object' }),
    );
    mkdirSync(join(projectRoot, '.robota'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.robota', 'settings.json'),
      JSON.stringify({
        mcpServers: { weather: { type: 'http', url: 'https://project.example/weather' } },
      }),
    );

    const settingsSources = [
      ...createRobotaUserSettingsSources(userHome),
      ...(await trustedProjectSettingsSources(projectRoot)),
    ];

    const { entries, sourceProblems } = resolveMcpDefinitions(settingsSources, process.env);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('weather');
    expect(entries[0]?.source).toBe('project');
    expect(sourceProblems).toHaveLength(1);
    expect(sourceProblems[0]).toMatchObject({
      name: '',
      source: 'user',
      reason: '`mcpServers` is not an object',
    });
  });
});
