/**
 * MCP-002: `composeMcpClientForStartup` is the ONE function that turns product startup inputs
 * (settings sources, workspace-trust decision, `cwd`) into a live `IMcpClientComposition` — proof
 * that the `/mcp` port and the connected tool surface are reachable from something other than
 * `mcp-client-composition.test.ts`'s hand-built `resolvedEntries`.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  WorkspaceTrustService,
  createDefaultUserSettingsSources,
  createRestrictedWorkspaceProjectAccess,
  createWorkspaceProjectSettingsSources,
  getWorkspaceProjectReader,
} from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it } from 'vitest';

import { composeMcpClientForStartup } from '../mcp-startup.js';

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
  return createWorkspaceProjectSettingsSources(getWorkspaceProjectReader(access.authority));
}

describe('composeMcpClientForStartup', () => {
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
      settingsSources: createDefaultUserSettingsSources(userHome),
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
      settingsSources: createDefaultUserSettingsSources(userHome),
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
        settingsSources: createDefaultUserSettingsSources(userHome),
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
      settingsSources: createDefaultUserSettingsSources(userHome),
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
        settingsSources: createDefaultUserSettingsSources(userHome),
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
      settingsSources: createDefaultUserSettingsSources(userHome),
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
