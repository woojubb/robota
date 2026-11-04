/**
 * Issue #3693 — `Session` is platform-neutral and reads nothing from the machine, so this Node-only
 * package hands it the home directory, the workspace resolver, the path canonicalizer and the hook
 * executors wherever it builds one. These cases watch what reaches the real `Session` constructor.
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createSession } from '../create-session.js';
import { createSubagentSession } from '../create-subagent-session.js';

import type { ICreateSessionOptions } from '../create-session-types.js';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type { ISessionOptions } from '@robota-sdk/agent-session';

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
