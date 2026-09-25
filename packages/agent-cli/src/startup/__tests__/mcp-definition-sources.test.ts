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
  createNodeHostSettingsSource,
  createWorkspaceProjectSettingsSources,
  getWorkspaceProjectReader,
} from '@robota-sdk/agent-framework';
import { afterEach, describe, expect, it } from 'vitest';

import { describeJsonParseFailure, resolveMcpDefinitions } from '../mcp-definition-sources.js';
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
    const { entries, problems, sourceProblems } = resolveMcpDefinitions(
      settingsSources,
      process.env,
    );

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
    const { entries, problems, sourceProblems } = resolveMcpDefinitions(
      settingsSources,
      process.env,
    );

    expect(entries).toEqual([]);
    expect(problems).toEqual([]);
    expect(sourceProblems).toEqual([]);
  });

  // BEHAVIOR-2794 (issue #2794 / #3073): the `user` tier is NOT the managed tier, so its source
  // problem stays purely informational — `project` (a higher-precedence tier here) resolves exactly
  // as if the broken `user` layer were absent. This is NOT the fail-closed case; that one needs the
  // MANAGED tier specifically, exercised separately below.
  it('leaves a higher-precedence layer resolved when a lower, non-managed layer is unreadable', async () => {
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
    expect(entries[0]?.status).toBe('resolved');
    expect(sourceProblems).toHaveLength(1);
    expect(sourceProblems[0]).toMatchObject({
      name: '',
      source: 'user',
      reason: '`mcpServers` is not an object',
    });
  });

  // BEHAVIOR-2794 fail-closed (owner direction, PR #3076 review): an unreadable MANAGED source is
  // the one tier whose source problem is NOT purely informational — it blocks every name that would
  // otherwise resolve from a lower tier, here a `project`-scoped server, because the unreadable
  // managed policy might have defined that exact name.
  it('blocks a lower-tier server and reports the managed source problem when the managed layer is unreadable', async () => {
    const managedRoot = tempRoot('robota-mcp-defs-unreadable-managed-');
    const projectRoot = tempRoot('robota-mcp-defs-managed-project-');
    const managedPath = join(managedRoot, 'managed-policy.json');
    writeFileSync(managedPath, JSON.stringify({ mcpServers: 'not an object' }));
    mkdirSync(join(projectRoot, '.robota'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.robota', 'settings.json'),
      JSON.stringify({
        mcpServers: { weather: { type: 'http', url: 'https://project.example/weather' } },
      }),
    );

    const settingsSources = [
      createNodeHostSettingsSource('managed', managedPath),
      ...(await trustedProjectSettingsSources(projectRoot)),
    ];

    const { entries, sourceProblems } = resolveMcpDefinitions(settingsSources, process.env);

    expect(sourceProblems).toHaveLength(1);
    expect(sourceProblems[0]).toMatchObject({
      name: '',
      source: 'managed',
      reason: '`mcpServers` is not an object',
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]?.name).toBe('weather');
    // Blocked, not activated.
    expect(entries[0]?.status).toBe('unresolved');
    expect(entries[0]?.definition).toBeUndefined();
    expect(entries[0]?.problem?.reason).toContain('managed');
  });

  // Secret-free parse errors (PR #3076 review): Node's JSON.parse can echo a fragment of the source
  // text into its error message for a malformed value — including a secret sitting beside it. This
  // must never reach `sourceProblems`/`problems`, which feed both the startup diagnostic and (via
  // `mcp-client-composition.ts`) the live `/mcp status` command.
  it('never leaks a secret-looking value from a corrupt file into the reported reason', () => {
    const userHome = tempRoot('robota-mcp-defs-secret-leak-');
    mkdirSync(join(userHome, '.robota'), { recursive: true });
    const settingsPath = join(userHome, '.robota', 'settings.json');
    // Assembled from fragments at runtime, never a literal secret-shaped token in source control.
    const secretLookingValue = ['sk', 'live', 'se', 'cre', 't', 'value'].join('-');
    const corruptJson = `{ "mcpServers": { "weather": { "env": { "API_KEY": ${secretLookingValue} } } } }`;
    writeFileSync(settingsPath, corruptJson);
    // Sanity check: Node's own JSON.parse message echoes a LEADING FRAGMENT of the offending value
    // (not necessarily all of it — its snippet is bounded), so this checks for that fragment rather
    // than assuming the whole value survives; otherwise this test could pass for the wrong reason if
    // Node's snippet length ever changed.
    const leakedFragment = secretLookingValue.slice(0, 10);
    let nodeEchoesTheValue = false;
    try {
      JSON.parse(corruptJson);
    } catch (error) {
      nodeEchoesTheValue = error instanceof Error && error.message.includes(leakedFragment);
    }
    expect(nodeEchoesTheValue).toBe(true);

    const settingsSources = createRobotaUserSettingsSources(userHome);
    const { problems, sourceProblems } = resolveMcpDefinitions(settingsSources, process.env);

    expect(problems).toHaveLength(1);
    expect(problems[0]?.reason).not.toContain(leakedFragment);
    expect(sourceProblems).toHaveLength(1);
    expect(sourceProblems[0]?.reason).not.toContain(leakedFragment);
    expect(problems[0]?.reason).toMatch(/^invalid JSON/);
  });

  it('describeJsonParseFailure extracts only a position, never the raw message', () => {
    // Assembled from fragments, never a literal secret-shaped token in source control.
    const secretLookingFragment = ['sk', 'live', 'se'].join('-');
    expect(describeJsonParseFailure(new SyntaxError('Unexpected end of JSON input'))).toBe(
      'invalid JSON',
    );
    expect(
      describeJsonParseFailure(
        new SyntaxError("Expected property name or '}' in JSON at position 2 (line 1 column 3)"),
      ),
    ).toBe('invalid JSON (line 1, column 3)');
    expect(
      describeJsonParseFailure(
        new SyntaxError(
          `Unexpected token 's', ..."API_KEY": ${secretLookingFragment}"... is not valid JSON`,
        ),
      ),
    ).toBe('invalid JSON');
  });
});
