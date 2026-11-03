/**
 * Issue #3693 — what a Node host used to be read from the machine is now handed to the session:
 * the executors that run hook handlers, the home directory, the workspace resolver and the path
 * canonicalizer. Each is optional where "unknown" has a safe meaning and required where it does not.
 */

import { clearRegisteredToolProfiles, registerToolPermissionProfile } from '@robota-sdk/agent-core';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompactionOrchestrator } from '../compaction-orchestrator.js';
import { PermissionEnforcer } from '../permission-enforcer.js';
import { buildPermissionEnforcer } from '../session-components.js';
import { Session } from '../session.js';

import type { IPermissionEnforcerOptions } from '../permission-types.js';
import type { ISessionOptions } from '../session-types.js';
import type { ITerminalOutput } from '@robota-sdk/agent-core';

function terminal(): ITerminalOutput {
  return {
    write: vi.fn(),
    writeLine: vi.fn(),
    writeMarkdown: vi.fn(),
    writeError: vi.fn(),
    prompt: vi.fn().mockResolvedValue(''),
    select: vi.fn().mockResolvedValue(0),
    spinner: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
  };
}

const sessions: Session[] = [];
function session(options: Partial<ISessionOptions> = {}): Session {
  const created = new Session({
    hookTypeExecutors: [],
    cwd: '/work',
    sessionId: 'ports-session',
    systemMessage: 'Fixture',
    model: 'test-model',
    provider: createScriptedProvider([{ text: 'done' }]).provider,
    autoCompactThreshold: false,
    terminal: terminal(),
    tools: [],
    ...options,
  });
  sessions.push(created);
  return created;
}

beforeEach(() => {
  clearRegisteredToolProfiles();
  registerToolPermissionProfile('Bash', {
    argument: { key: 'command', kind: 'command' },
    riskClass: 'execute',
  });
});

afterEach(async () => {
  await Promise.all(sessions.splice(0).map((created) => created.shutdown()));
  clearRegisteredToolProfiles();
});

describe('hookTypeExecutors is required wherever it is consumed', () => {
  const missing = undefined as unknown as ISessionOptions['hookTypeExecutors'];

  it('PermissionEnforcer refuses a missing list', () => {
    const options: IPermissionEnforcerOptions = {
      hookTypeExecutors: missing,
      sessionId: 's',
      cwd: '/work',
      getPermissionMode: () => 'default',
      config: { permissions: { allow: [], deny: [] } },
      terminal: terminal(),
    };
    expect(() => new PermissionEnforcer(options)).toThrow(
      /PermissionEnforcer requires `hookTypeExecutors`/,
    );
  });

  it('CompactionOrchestrator refuses a missing list', () => {
    expect(
      () =>
        new CompactionOrchestrator({
          hookTypeExecutors: missing,
          sessionId: 's',
          cwd: '/work',
          model: 'm',
        }),
    ).toThrow(/CompactionOrchestrator requires `hookTypeExecutors`/);
  });

  it('accepts an empty list, which runs no handler', () => {
    expect(() => session({ hookTypeExecutors: [] })).not.toThrow();
  });
});

describe('homeDirectory', () => {
  const enforcerFor = (homeDirectory: string | undefined): PermissionEnforcer =>
    buildPermissionEnforcer(
      {
        hookTypeExecutors: [],
        terminal: terminal(),
        ...(homeDirectory === undefined ? {} : { homeDirectory }),
      } as unknown as ISessionOptions,
      'ports-session',
      '/w/project',
      () => 'bypassPermissions',
      undefined,
    );

  it('reaches the gate through the session components: removing it is not auto-approved', async () => {
    await expect(
      enforcerFor('/home/me').checkPermission('Bash', { command: 'rm -rf /home/me' }),
    ).resolves.toBe(false);
  });

  it('is unknown when absent, rather than read from the machine', async () => {
    await expect(
      enforcerFor(undefined).checkPermission('Bash', { command: 'rm -rf /home/me' }),
    ).resolves.toBe(true);
    // A bare `~` is still a critical target without knowing where it points.
    await expect(
      enforcerFor(undefined).checkPermission('Bash', { command: 'rm -rf ~' }),
    ).resolves.toBe(false);
  });
});

describe('resolveInWorkspace', () => {
  it('reaches the gate through the session components', async () => {
    const resolveInWorkspace = vi.fn(
      (_base: string | undefined, path: string) => `/w/project/${path}`,
    );
    const enforcer = buildPermissionEnforcer(
      {
        hookTypeExecutors: [],
        terminal: terminal(),
        resolveInWorkspace,
      } as unknown as ISessionOptions,
      'ports-session',
      '/w/project',
      () => 'default',
      undefined,
    );

    await expect(enforcer.checkPermission('Bash', { command: 'cat notes.txt' })).resolves.toBe(
      true,
    );
    expect(resolveInWorkspace).toHaveBeenCalledWith(undefined, 'notes.txt');
  });
});

describe('canonicalizePath', () => {
  const canonical = (path: string): string => path.replace(/\/+$/u, '');

  it('names the session directory in a snapshot as the host spells it', () => {
    const snapshot = session({
      canonicalizePath: (path) => `canonical:${path}`,
    }).getConversationSnapshot();

    expect(snapshot.cwd).toBe('canonical:/work');
  });

  it('is the identity when absent, so a directory that does not exist is not an error', () => {
    const snapshot = session({ cwd: '/does/not/exist/anywhere' }).getConversationSnapshot();

    expect(snapshot.cwd).toBe('/does/not/exist/anywhere');
  });

  it('decides whether a snapshot belongs to this workspace', () => {
    const snapshot = session({ cwd: '/work' }).getConversationSnapshot();

    expect(() =>
      session({ cwd: '/work/', canonicalizePath: canonical }).restoreConversation(snapshot),
    ).not.toThrow();
    expect(() => session({ cwd: '/work/' }).restoreConversation(snapshot)).toThrow(
      'Conversation owner or workspace differs',
    );
  });
});
