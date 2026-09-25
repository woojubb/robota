/**
 * MCP-002: `composeMcpClientForStartup` is the ONE function that turns product startup inputs
 * (settings sources, workspace-trust decision, `cwd`) into a live `IMcpClientComposition` — proof
 * that the `/mcp` port and the connected tool surface are reachable from something other than
 * `mcp-client-composition.test.ts`'s hand-built `resolvedEntries`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  WorkspaceTrustService,
  createRestrictedWorkspaceProjectAccess,
  createWorkspaceProjectSettingsSources,
  getWorkspaceProjectReader,
} from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it } from 'vitest';

import { composeMcpClientForStartup } from '../mcp-startup.js';
import { ROBOTA_PROJECT_SETTINGS } from '../../product/robota-project-settings.js';
import { createRobotaUserSettingsSources } from '../../product/robota-user-settings.js';

import type {
  IWorkspaceIdentity,
  TSettingsSource,
  TWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';

const roots: string[] = [];

function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function diagnosticsSink() {
  const messages: string[] = [];
  return { messages, reportDiagnostic: (message: string) => messages.push(message) };
}

/** Trusted access for one root, minted through the real trust-service path (no forged authority). */
async function trustedAccessFor(root: string): Promise<TWorkspaceProjectAccess> {
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
  return service.inspect(root);
}

/** A trusted project's settings sources, minted through the real trust-service path. */
async function trustedProjectSettingsSources(root: string): Promise<readonly TSettingsSource[]> {
  const access = await trustedAccessFor(root);
  if (access.status !== 'trusted') throw new Error('Fixture trust service did not return trusted.');
  return createWorkspaceProjectSettingsSources(
    getWorkspaceProjectReader(access.authority),
    ROBOTA_PROJECT_SETTINGS,
  );
}

describe('composeMcpClientForStartup', () => {
  it('connects a settings-defined stdio server with Robota client identity', async () => {
    const cwd = tempRoot('robota-mcp-startup-live-');
    const userHome = tempRoot('robota-mcp-startup-live-home-');
    const fixture = fileURLToPath(
      new URL('../../../../agent-mcp/examples/stdio-fixture-server.mjs', import.meta.url),
    );
    const args = [fixture, 'client-info'];
    mkdirSync(join(userHome, '.robota'), { recursive: true });
    writeFileSync(
      join(userHome, '.robota', 'settings.json'),
      JSON.stringify({
        mcpServers: { local: { type: 'stdio', command: process.execPath, args, cwd } },
      }),
    );
    const { messages, reportDiagnostic } = diagnosticsSink();
    const mcp = await composeMcpClientForStartup({
      settingsSources: createRobotaUserSettingsSources(userHome),
      projectAccess: await trustedAccessFor(cwd),
      cwd,
      env: {},
      mode: 'interactive',
      inspectTrust: async () => ({ state: 'trusted', generation: 1 }),
      reportDiagnostic,
      stdioAuthorities: {
        local: {
          allowedRoot: cwd,
          generation: 'host-1',
          executables: [{ command: process.execPath, args: [args] }],
          environment: { HOME: userHome },
        },
      },
    });
    await mcp.activationAdapter.approve('local');
    try {
      const tools = await mcp.connect();
      expect(messages).toEqual([]);
      expect(tools.map((tool) => tool.getName())).toEqual([
        'local__ping',
        'robota_read_mcp_result',
      ]);
      const tool = tools[0];
      if (tool === undefined) throw new Error('Expected admitted stdio tool');
      const result = await tool.execute({}, { toolName: 'local__ping', parameters: {} });
      expect(result.success).toBe(true);
      expect(JSON.stringify(result)).toContain('robota-agent-mcp');
      expect(mcp.connectedToolProvenance.get('local__ping')?.sourceName).toBe('ping');
    } finally {
      await mcp.shutdown();
    }
  });

  it('forwards host stdio authority separately from settings into command admission', async () => {
    const cwd = tempRoot('robota-mcp-startup-stdio-');
    const userHome = tempRoot('robota-mcp-startup-stdio-home-');
    mkdirSync(join(userHome, '.robota'), { recursive: true });
    writeFileSync(
      join(userHome, '.robota', 'settings.json'),
      JSON.stringify({
        mcpServers: {
          weather: {
            type: 'stdio',
            command: process.execPath,
            args: ['--unapproved-argument'],
            cwd,
          },
        },
      }),
    );
    const { messages, reportDiagnostic } = diagnosticsSink();
    const mcp = await composeMcpClientForStartup({
      settingsSources: createRobotaUserSettingsSources(userHome),
      projectAccess: await trustedAccessFor(cwd),
      cwd,
      env: {},
      mode: 'interactive',
      inspectTrust: async () => ({ state: 'trusted', generation: 1 }),
      reportDiagnostic,
      stdioAuthorities: {
        weather: {
          allowedRoot: cwd,
          generation: 'host-1',
          executables: [{ command: process.execPath, args: [[]] }],
        },
      },
    });
    await mcp.activationAdapter.approve('weather');
    expect(await mcp.connect()).toEqual([]);
    expect(messages.join('\n')).toContain('refused');
    expect(messages.join('\n')).not.toContain('host authority');
    expect(messages.join('\n')).not.toContain('--unapproved-argument');
    await mcp.shutdown();
  });

  it('lists a resolved http definition sourced from a fake settings source, given trusted access', async () => {
    const cwd = tempRoot('robota-mcp-startup-trusted-');
    const userHome = tempRoot('robota-mcp-startup-user-');
    mkdirSync(join(userHome, '.robota'), { recursive: true });
    writeFileSync(
      join(userHome, '.robota', 'settings.json'),
      JSON.stringify({
        mcpServers: { weather: { type: 'http', url: 'https://mcp.example.com/weather' } },
      }),
    );

    const { messages, reportDiagnostic } = diagnosticsSink();

    const mcp = await composeMcpClientForStartup({
      settingsSources: createRobotaUserSettingsSources(userHome),
      projectAccess: await trustedAccessFor(cwd),
      cwd,
      env: process.env,
      mode: 'interactive',
      reportDiagnostic,
      inspectTrust: async () => ({ state: 'trusted', generation: 5 }),
    });

    const list = mcp.activationAdapter.list();
    expect(list.map((summary) => summary.serverId)).toContain('weather');
    expect(list.find((summary) => summary.serverId === 'weather')?.source).toBe('user');
    expect(messages).toEqual([]);
  });

  // BEHAVIOR-2794 (issue #2794 / #3073): an unreadable source (here, a user-layer `mcpServers` that
  // is not an object) must still surface through the LIVE `/mcp` port — not only as a one-time
  // startup diagnostic — while a lower-precedence, well-formed layer still resolves normally.
  it('surfaces an unreadable source through activationAdapter.sourceProblems, beside a resolved server', async () => {
    const cwd = tempRoot('robota-mcp-startup-unreadable-');
    const userHome = tempRoot('robota-mcp-startup-unreadable-user-');
    const projectRoot = tempRoot('robota-mcp-startup-unreadable-project-');
    mkdirSync(join(userHome, '.robota'), { recursive: true });
    writeFileSync(
      join(userHome, '.robota', 'settings.json'),
      JSON.stringify({ mcpServers: 'not an object' }),
    );
    mkdirSync(join(projectRoot, '.robota'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.robota', 'settings.json'),
      JSON.stringify({
        mcpServers: { weather: { type: 'http', url: 'https://mcp.example.com/weather' } },
      }),
    );

    const { reportDiagnostic } = diagnosticsSink();

    const mcp = await composeMcpClientForStartup({
      settingsSources: [
        ...createRobotaUserSettingsSources(userHome),
        ...(await trustedProjectSettingsSources(projectRoot)),
      ],
      projectAccess: await trustedAccessFor(projectRoot),
      cwd: projectRoot,
      env: process.env,
      mode: 'interactive',
      reportDiagnostic,
      inspectTrust: async () => ({ state: 'trusted', generation: 1 }),
    });

    const list = mcp.activationAdapter.list();
    expect(list.map((summary) => summary.serverId)).toContain('weather');

    const sourceProblems = mcp.activationAdapter.sourceProblems?.() ?? [];
    expect(sourceProblems).toHaveLength(1);
    expect(sourceProblems[0]).toMatchObject({
      source: 'user',
      reason: '`mcpServers` is not an object',
    });
  });

  it('refuses a project-source definition under restricted (untrusted) workspace access', async () => {
    const projectRoot = tempRoot('robota-mcp-startup-project-');
    mkdirSync(join(projectRoot, '.robota'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.robota', 'settings.json'),
      JSON.stringify({
        mcpServers: { internal: { type: 'http', url: 'https://internal.example.com/mcp' } },
      }),
    );
    const { reportDiagnostic } = diagnosticsSink();

    const mcp = await composeMcpClientForStartup({
      settingsSources: await trustedProjectSettingsSources(projectRoot),
      // Restricted, no identity: `toMcpActivationWorkspace` reads `trustState` straight off this
      // access rather than from a (never-invoked) trust inspection.
      projectAccess: createRestrictedWorkspaceProjectAccess('untrusted', projectRoot),
      cwd: projectRoot,
      env: process.env,
      mode: 'interactive',
      reportDiagnostic,
    });

    const list = mcp.activationAdapter.list();
    const internal = list.find((summary) => summary.serverId === 'internal');
    expect(internal).toBeDefined();
    expect(internal?.status).toBe('untrusted');
    expect(internal?.allowed).toBe(false);
  });

  it('returns an empty, diagnostic-free composition when no layer declares mcpServers', async () => {
    const userHome = tempRoot('robota-mcp-startup-empty-');
    const { messages, reportDiagnostic } = diagnosticsSink();

    const mcp = await composeMcpClientForStartup({
      settingsSources: createRobotaUserSettingsSources(userHome),
      projectAccess: createRestrictedWorkspaceProjectAccess('identity-unavailable', userHome),
      cwd: userHome,
      env: process.env,
      mode: 'interactive',
      reportDiagnostic,
    });

    expect(mcp.activationAdapter.list()).toEqual([]);
    expect(messages).toEqual([]);
    await expect(mcp.connect()).resolves.toEqual([]);
  });
});

// --- MCP-004 (TC-25, TC-11's startup half): `buildToolCallHandoff` gates the handoff policy on
// `mode` and the resolved `mcp.autoBackgroundMs`/`mcp.callTimeoutMs` settings. These fixtures
// configure NO `mcpServers`, so `toolNames`/`provenance` are empty here by construction — a real
// connection populating them from a live server is `mcp-client-composition.test.ts`'s
// "records connected-tool provenance" case; this file's job is the mode/settings gate around it.

describe('composeMcpClientForStartup → buildToolCallHandoff (TC-25)', () => {
  it('interactive and serve carry toolCallHandoff with thresholdMs/budgetMs from settings; print does not', async () => {
    const userHome = tempRoot('robota-mcp-startup-handoff-modes-');
    mkdirSync(join(userHome, '.robota'), { recursive: true });
    writeFileSync(
      join(userHome, '.robota', 'settings.json'),
      JSON.stringify({ mcp: { autoBackgroundMs: 45_000, callTimeoutMs: 300_000 } }),
    );

    for (const mode of ['interactive', 'serve'] as const) {
      const { messages, reportDiagnostic } = diagnosticsSink();
      const mcp = await composeMcpClientForStartup({
        settingsSources: createRobotaUserSettingsSources(userHome),
        projectAccess: createRestrictedWorkspaceProjectAccess('identity-unavailable', userHome),
        cwd: userHome,
        env: process.env,
        mode,
        reportDiagnostic,
      });
      await mcp.connect();

      const handoff = mcp.buildToolCallHandoff('default');
      expect(handoff).toEqual({
        thresholdMs: 45_000,
        budgetMs: 300_000,
        toolNames: [],
        provenance: {},
      });
      expect(messages).toEqual([]);
    }

    const { messages: printMessages, reportDiagnostic: reportPrintDiagnostic } = diagnosticsSink();
    const printMcp = await composeMcpClientForStartup({
      settingsSources: createRobotaUserSettingsSources(userHome),
      projectAccess: createRestrictedWorkspaceProjectAccess('identity-unavailable', userHome),
      cwd: userHome,
      env: process.env,
      mode: 'print',
      reportDiagnostic: reportPrintDiagnostic,
    });
    await printMcp.connect();

    expect(printMcp.buildToolCallHandoff('default')).toBeUndefined();
    expect(printMessages).toHaveLength(1);
    expect(printMessages[0]).toContain('ignored in print mode');
  });

  it('autoBackgroundMs: 0 carries no policy in any mode and emits no diagnostic', async () => {
    const userHome = tempRoot('robota-mcp-startup-handoff-zero-');
    mkdirSync(join(userHome, '.robota'), { recursive: true });
    writeFileSync(
      join(userHome, '.robota', 'settings.json'),
      JSON.stringify({ mcp: { autoBackgroundMs: 0 } }),
    );

    for (const mode of ['interactive', 'serve', 'print'] as const) {
      const { messages, reportDiagnostic } = diagnosticsSink();
      const mcp = await composeMcpClientForStartup({
        settingsSources: createRobotaUserSettingsSources(userHome),
        projectAccess: createRestrictedWorkspaceProjectAccess('identity-unavailable', userHome),
        cwd: userHome,
        env: process.env,
        mode,
        reportDiagnostic,
      });
      await mcp.connect();

      expect(mcp.buildToolCallHandoff('default')).toBeUndefined();
      expect(messages).toEqual([]);
    }
  });

  it('autoBackgroundMs >= callTimeoutMs disables the handoff (one diagnostic) in every mode', async () => {
    const userHome = tempRoot('robota-mcp-startup-handoff-ge-');
    mkdirSync(join(userHome, '.robota'), { recursive: true });
    writeFileSync(
      join(userHome, '.robota', 'settings.json'),
      JSON.stringify({ mcp: { autoBackgroundMs: 600_000, callTimeoutMs: 600_000 } }),
    );

    const { messages, reportDiagnostic } = diagnosticsSink();
    const mcp = await composeMcpClientForStartup({
      settingsSources: createRobotaUserSettingsSources(userHome),
      projectAccess: createRestrictedWorkspaceProjectAccess('identity-unavailable', userHome),
      cwd: userHome,
      env: process.env,
      mode: 'interactive',
      reportDiagnostic,
    });
    await mcp.connect();

    expect(mcp.buildToolCallHandoff('default')).toBeUndefined();
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('autoBackgroundMs');
    expect(messages[0]).toContain('callTimeoutMs');
  });
});
