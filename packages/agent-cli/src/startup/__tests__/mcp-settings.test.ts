/**
 * MCP-004 (TC-11): `resolveMcpSettings` reads `mcp.autoBackgroundMs` / `mcp.callTimeoutMs` from the
 * SAME layered settings documents `resolveMcpDefinitions` reads `mcpServers` from, folding per key by
 * the same precedence order — never through `agent-framework`'s `SettingsSchema`.
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

import {
  DEFAULT_MCP_AUTO_BACKGROUND_MS,
  DEFAULT_MCP_CALL_TIMEOUT_MS,
  resolveMcpSettings,
} from '../mcp-settings.js';
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

describe('resolveMcpSettings', () => {
  it('defaults to 120000 / 600000 with handoff enabled when no layer declares mcp', () => {
    const userHome = tempRoot('robota-mcp-settings-empty-');
    mkdirSync(join(userHome, '.robota'), { recursive: true });
    writeFileSync(join(userHome, '.robota', 'settings.json'), JSON.stringify({ language: 'en' }));

    const resolution = resolveMcpSettings(createRobotaUserSettingsSources(userHome));

    expect(resolution.autoBackgroundMs).toBe(DEFAULT_MCP_AUTO_BACKGROUND_MS);
    expect(resolution.callTimeoutMs).toBe(DEFAULT_MCP_CALL_TIMEOUT_MS);
    expect(resolution.handoffEnabled).toBe(true);
    expect(resolution.problems).toEqual([]);
    expect(resolution.diagnostics).toEqual([]);
  });

  it('layers per key: a higher-precedence (project) document overrides only the key it declares', async () => {
    const userHome = tempRoot('robota-mcp-settings-user-');
    const projectRoot = tempRoot('robota-mcp-settings-project-');
    mkdirSync(join(userHome, '.robota'), { recursive: true });
    writeFileSync(
      join(userHome, '.robota', 'settings.json'),
      JSON.stringify({ mcp: { autoBackgroundMs: 30_000, callTimeoutMs: 90_000 } }),
    );
    mkdirSync(join(projectRoot, '.robota'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.robota', 'settings.json'),
      JSON.stringify({ mcp: { autoBackgroundMs: 45_000 } }),
    );

    const settingsSources = [
      ...createRobotaUserSettingsSources(userHome),
      ...(await trustedProjectSettingsSources(projectRoot)),
    ];
    const resolution = resolveMcpSettings(settingsSources);

    // project beats user for the key it declares...
    expect(resolution.autoBackgroundMs).toBe(45_000);
    // ...and the user layer's value survives for the key project left undeclared.
    expect(resolution.callTimeoutMs).toBe(90_000);
    expect(resolution.handoffEnabled).toBe(true);
    expect(resolution.problems).toEqual([]);
  });

  it('0 disables the handoff silently (no diagnostic)', () => {
    const userHome = tempRoot('robota-mcp-settings-zero-');
    mkdirSync(join(userHome, '.robota'), { recursive: true });
    writeFileSync(
      join(userHome, '.robota', 'settings.json'),
      JSON.stringify({ mcp: { autoBackgroundMs: 0 } }),
    );

    const resolution = resolveMcpSettings(createRobotaUserSettingsSources(userHome));

    expect(resolution.autoBackgroundMs).toBe(0);
    expect(resolution.handoffEnabled).toBe(false);
    expect(resolution.problems).toEqual([]);
    expect(resolution.diagnostics).toEqual([]);
  });

  it('autoBackgroundMs >= callTimeoutMs disables the handoff with exactly one diagnostic', () => {
    const userHome = tempRoot('robota-mcp-settings-ge-');
    mkdirSync(join(userHome, '.robota'), { recursive: true });
    writeFileSync(
      join(userHome, '.robota', 'settings.json'),
      JSON.stringify({ mcp: { autoBackgroundMs: 600_000, callTimeoutMs: 600_000 } }),
    );

    const resolution = resolveMcpSettings(createRobotaUserSettingsSources(userHome));

    expect(resolution.handoffEnabled).toBe(false);
    expect(resolution.problems).toEqual([]);
    expect(resolution.diagnostics).toHaveLength(1);
    expect(resolution.diagnostics[0]).toContain('autoBackgroundMs');
    expect(resolution.diagnostics[0]).toContain('callTimeoutMs');
  });

  it('a negative value is a reported problem; the default is not silently used', () => {
    const userHome = tempRoot('robota-mcp-settings-negative-');
    mkdirSync(join(userHome, '.robota'), { recursive: true });
    const settingsPath = join(userHome, '.robota', 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({ mcp: { autoBackgroundMs: -1 } }));

    const resolution = resolveMcpSettings(createRobotaUserSettingsSources(userHome));

    expect(resolution.autoBackgroundMs).toBe(DEFAULT_MCP_AUTO_BACKGROUND_MS);
    expect(resolution.problems).toHaveLength(1);
    expect(resolution.problems[0]).toMatchObject({
      key: 'autoBackgroundMs',
      source: 'user',
      origin: settingsPath,
    });
    expect(resolution.problems[0]?.reason).toContain('non-negative integer');
  });

  it('a non-integer value is a reported problem; the default is not silently used', () => {
    const userHome = tempRoot('robota-mcp-settings-noninteger-');
    mkdirSync(join(userHome, '.robota'), { recursive: true });
    writeFileSync(
      join(userHome, '.robota', 'settings.json'),
      JSON.stringify({ mcp: { callTimeoutMs: 1234.5 } }),
    );

    const resolution = resolveMcpSettings(createRobotaUserSettingsSources(userHome));

    expect(resolution.callTimeoutMs).toBe(DEFAULT_MCP_CALL_TIMEOUT_MS);
    expect(resolution.problems).toHaveLength(1);
    expect(resolution.problems[0]).toMatchObject({ key: 'callTimeoutMs', source: 'user' });
  });

  it('an invalid key refuses the WHOLE document — a valid sibling key in the same document is not applied', () => {
    const userHome = tempRoot('robota-mcp-settings-whole-doc-');
    mkdirSync(join(userHome, '.robota'), { recursive: true });
    writeFileSync(
      join(userHome, '.robota', 'settings.json'),
      JSON.stringify({ mcp: { autoBackgroundMs: 'not-a-number', callTimeoutMs: 90_000 } }),
    );

    const resolution = resolveMcpSettings(createRobotaUserSettingsSources(userHome));

    expect(resolution.autoBackgroundMs).toBe(DEFAULT_MCP_AUTO_BACKGROUND_MS);
    // The valid `callTimeoutMs: 90_000` sibling is refused along with the document, not applied.
    expect(resolution.callTimeoutMs).toBe(DEFAULT_MCP_CALL_TIMEOUT_MS);
    expect(resolution.problems).toHaveLength(1);
    expect(resolution.problems[0]).toMatchObject({ key: 'autoBackgroundMs', source: 'user' });
  });

  it('reports an invalid-json layer as a problem naming its origin, never silently', () => {
    const userHome = tempRoot('robota-mcp-settings-invalid-json-');
    mkdirSync(join(userHome, '.robota'), { recursive: true });
    const settingsPath = join(userHome, '.robota', 'settings.json');
    writeFileSync(settingsPath, '{ this is not json');

    const resolution = resolveMcpSettings(createRobotaUserSettingsSources(userHome));

    expect(resolution.autoBackgroundMs).toBe(DEFAULT_MCP_AUTO_BACKGROUND_MS);
    expect(resolution.callTimeoutMs).toBe(DEFAULT_MCP_CALL_TIMEOUT_MS);
    expect(resolution.problems).toHaveLength(1);
    expect(resolution.problems[0]).toMatchObject({
      key: '*',
      source: 'user',
      origin: settingsPath,
    });
    expect(resolution.problems[0]?.reason).toContain('invalid JSON');
  });
});
