/**
 * Issue #3693 — `Session` is platform-neutral and reads nothing from the machine, so the framework
 * hands it the home directory, the workspace resolver, the path canonicalizer and the hook executors
 * its host lends, wherever it builds one. A member the host leaves out stays out. These cases watch
 * what reaches the real `Session` constructor.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSession } from '../create-session.js';
import { createSubagentSession } from '../create-subagent-session.js';
import { createTestFrameworkHost } from '../../testing/framework-host.js';

import type { ICreateSessionOptions } from '../create-session-types.js';
import type { ISubagentOptions } from '../create-subagent-session.js';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type { ISessionOptions } from '@robota-sdk/agent-session';

const testHost = createTestFrameworkHost();

const constructed = vi.hoisted(() => [] as unknown[]);

vi.mock('@robota-sdk/agent-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-session')>();
  class RecordingSession extends actual.Session {
    constructor(options: ISessionOptions) {
      constructed.push(options);
      super(options);
    }
  }
  return { ...actual, Session: RecordingSession };
});

const provider = {
  name: 'test',
  version: 'test',
  chat: vi.fn(),
  generateResponse: async () => ({ content: 'ok' }),
  supportsTools: () => false,
  validateConfig: () => true,
} as unknown as IAIProvider;

const terminal = {
  write: () => undefined,
  writeLine: () => undefined,
  writeMarkdown: () => undefined,
  writeError: () => undefined,
  prompt: async () => '',
  select: async () => 0,
  spinner: () => ({ stop: () => undefined, update: () => undefined }),
};

const config = {
  defaultTrustLevel: 'safe' as const,
  provider: { name: 'test', model: 'test-model', apiKey: undefined },
  permissions: { allow: [], deny: [] },
  env: {},
};
const context = { agentsMd: '', projectNotesMd: '' };

let root: string;
let workspace: string;
beforeEach(() => {
  constructed.length = 0;
  root = realpathSync(mkdtempSync(join(tmpdir(), 'node-session-ports-')));
  workspace = join(root, 'ws');
  mkdirSync(workspace);
  writeFileSync(join(workspace, 'note.txt'), 'note');
  writeFileSync(join(root, 'secret'), 'secret');
  symlinkSync(join(root, 'secret'), join(workspace, 'link'));
  symlinkSync(workspace, join(root, 'alias'));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

function onlyOptions(): ISessionOptions {
  expect(constructed).toHaveLength(1);
  return constructed[0] as ISessionOptions;
}

function expectNodePorts(options: ISessionOptions): void {
  expect(options.homeDirectory).toBe(homedir());
  expect(options.hookTypeExecutors.map((executor) => executor.type)).toEqual(
    expect.arrayContaining(['command', 'http']),
  );
  // Symlinks are followed, as the gate's read-only check requires.
  expect(options.resolveInWorkspace?.(undefined, 'note.txt')).toBe(join(workspace, 'note.txt'));
  expect(options.resolveInWorkspace?.(undefined, 'link')).toBeUndefined();
  expect(options.canonicalizePath?.(join(root, 'alias'))).toBe(workspace);
  // A directory that is gone is an error, as it always was for the snapshot and journal checks.
  expect(() => options.canonicalizePath?.(join(root, 'missing'))).toThrow();
}

describe('the Node host ports createSession and createSubagentSession pass', () => {
  it('createSession passes the home directory, resolver, canonicalizer and hook executors', async () => {
    const created = {
      host: testHost,
      config,
      context,
      terminal,
      provider,
      defaultTools: [],
      cwd: workspace,
    } as unknown as ICreateSessionOptions;

    await createSession(created);

    expectNodePorts(onlyOptions());
  });

  it('createSubagentSession passes the same, with the built-in hook executors when none are given', () => {
    createSubagentSession({
      host: testHost,
      agentDefinition: { name: 'worker', description: 'w', systemPrompt: 'Work.' },
      parentConfig: config,
      parentContext: context,
      parentTools: [],
      provider,
      terminal,
      cwd: workspace,
    });

    expectNodePorts(onlyOptions());
  });

  it('createSubagentSession keeps the executors its parent supplied', () => {
    const parent = [{ type: 'command' as const, execute: vi.fn() }];
    createSubagentSession({
      host: testHost,
      agentDefinition: { name: 'worker', description: 'w', systemPrompt: 'Work.' },
      parentConfig: config,
      parentContext: context,
      parentTools: [],
      provider,
      terminal,
      cwd: workspace,
      hookTypeExecutors: parent,
    });

    expect(onlyOptions().hookTypeExecutors).toBe(parent);
  });

  it('a session built by createSession names its directory with symlinks followed', async () => {
    const { session } = await createSession({
      host: testHost,
      config,
      context,
      terminal,
      provider,
      defaultTools: [],
      cwd: join(root, 'alias'),
    } as unknown as ICreateSessionOptions);

    expect(session.getConversationSnapshot().cwd).toBe(workspace);
  });
});

describe('a host that lends less than the Node host', () => {
  const subagent = (host: ISubagentOptions['host'], extra: Partial<ISubagentOptions> = {}) =>
    createSubagentSession({
      host,
      agentDefinition: { name: 'worker', description: 'w', systemPrompt: 'Work.' },
      parentConfig: config,
      parentContext: context,
      parentTools: [],
      provider,
      terminal,
      cwd: workspace,
      ...extra,
    });
  const created = (host: ICreateSessionOptions['host']): ICreateSessionOptions =>
    ({
      host,
      config,
      context,
      terminal,
      provider,
      defaultTools: [],
      cwd: workspace,
    }) as unknown as ICreateSessionOptions;

  it('passes none of the three ports and no hook executor when it lends nothing', async () => {
    await createSession(created({}));
    const options = onlyOptions();
    expect('homeDirectory' in options).toBe(false);
    expect('resolveInWorkspace' in options).toBe(false);
    expect('canonicalizePath' in options).toBe(false);
    expect(options.hookTypeExecutors).toEqual([]);
  });

  it('gives a subagent no ports and an empty executor list when it lends nothing', () => {
    subagent({});
    const options = onlyOptions();
    expect('homeDirectory' in options).toBe(false);
    expect('resolveInWorkspace' in options).toBe(false);
    expect('canonicalizePath' in options).toBe(false);
    expect(options.hookTypeExecutors).toEqual([]);
  });

  describe('a subagent whose host lends no hook executors', () => {
    const declared = {
      PostToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'true' }] }],
    };

    it('refuses a declared hook on an advisory event, naming the type and the host member', () => {
      expect(() => subagent({}, { hooks: declared })).toThrow(
        /"command" \(no command executor: the host lends none \(`host\.createHookExecutors`\)/u,
      );
      expect(constructed).toHaveLength(0);
    });

    it('runs on when it declares no hook', () => {
      expect(() => subagent({}, { hooks: {} })).not.toThrow();
      expect(() => subagent({})).not.toThrow();
    });

    it('keeps an explicit executor list, the empty one included, as its parent chose it', () => {
      expect(() => subagent({}, { hooks: declared, hookTypeExecutors: [] })).not.toThrow();
      expect(onlyOptions().hookTypeExecutors).toEqual([]);
    });

    it('is not refused when the host builds executors', () => {
      expect(() => subagent(testHost, { hooks: declared })).not.toThrow();
    });
  });

  it('passes exactly the members it lends, and builds the resolver for the session root', async () => {
    const canonicalizePath = (path: string): string => path;
    const createWorkspacePathResolver = vi.fn(() => () => undefined);
    await createSession(
      created({ homeDirectory: '/home/someone', canonicalizePath, createWorkspacePathResolver }),
    );
    const options = onlyOptions();
    expect(options.homeDirectory).toBe('/home/someone');
    expect(options.canonicalizePath).toBe(canonicalizePath);
    expect(createWorkspacePathResolver).toHaveBeenCalledExactlyOnceWith(workspace);
    expect(options.resolveInWorkspace).toBe(createWorkspacePathResolver.mock.results[0]!.value);
  });

  it('builds the executors with the shell a product chose for command hooks', async () => {
    const executor = { type: 'command' as const, execute: vi.fn() };
    const createHookExecutors = vi.fn(() => [executor]);
    await createSession({ ...created({ createHookExecutors }), commandHookShell: '/bin/zsh' });
    expect(createHookExecutors).toHaveBeenCalledExactlyOnceWith({ shell: '/bin/zsh' });
    expect(onlyOptions().hookTypeExecutors).toEqual([executor]);
  });

  it('seeds no executor when the session disables the built-in ones, however the host builds them', async () => {
    const createHookExecutors = vi.fn(() => [{ type: 'command' as const, execute: vi.fn() }]);
    await createSession({
      ...created({ createHookExecutors }),
      disableBuiltInHookExecutors: true,
    });
    expect(createHookExecutors).not.toHaveBeenCalled();
    expect(onlyOptions().hookTypeExecutors).toEqual([]);
  });

  it('refuses a declared command hook it has no executor for, naming the host member', async () => {
    const withHook = {
      ...created({}),
      config: {
        ...config,
        hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'command', command: 'true' }] }] },
      },
    } as unknown as ICreateSessionOptions;
    await expect(createSession(withHook)).rejects.toThrow(
      /"command" \(no command executor: the host lends none \(`host\.createHookExecutors`\)/u,
    );
    expect(constructed).toHaveLength(0);
  });

  it('asks the host for the remotes its auto-mode classifier names, in the session root', async () => {
    const readGitRemotes = vi.fn(async () => ['git@github.com:me/repo.git']);
    const host = createTestFrameworkHost({ readGitRemotes });
    const judged = vi.fn(async () => ({
      content: '{"decision":"allow","reason":"local"}',
    }));
    const judging = { ...provider, chat: judged } as unknown as IAIProvider;
    const call = { toolName: 'Bash', toolArgs: { command: 'ls' }, cwd: workspace };

    await createSession({ ...created(host), provider: judging });
    await onlyOptions().permissionClassifier?.classify(call);
    expect(readGitRemotes).toHaveBeenCalledExactlyOnceWith(workspace);

    constructed.length = 0;
    readGitRemotes.mockClear();
    subagent(host, { provider: judging, permissionMode: 'auto' });
    await onlyOptions().permissionClassifier?.classify(call);
    expect(readGitRemotes).toHaveBeenCalledExactlyOnceWith(workspace);
  });
});
