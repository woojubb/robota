import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFakeSession,
  endedTurn,
  executionResult,
  openSession,
  settle,
  startTransport,
  textPrompt,
  WORKSPACE,
} from './acp-test-harness.js';

import type { IFakeSession } from './acp-test-harness.js';
import type { IAcpTransportOptions } from '../acp-types.js';
import type {
  ICommandListEntry,
  ICommandSkillListEntry,
  IHistoryDisplaySegment,
} from '@robota-sdk/agent-interface-session';

const open: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.stop();
});

async function start(fake: IFakeSession, overrides: Partial<IAcpTransportOptions> = {}) {
  const fixture = await startTransport(fake.session, overrides);
  open.push(fixture);
  return fixture;
}

const command = (name: string, extra: Partial<ICommandListEntry> = {}): ICommandListEntry => ({
  name,
  description: `${name} command`,
  modelInvocable: false,
  runner: 'runtime',
  ...extra,
});
const skill = (name: string, extra: Partial<ICommandSkillListEntry> = {}): ICommandSkillListEntry => ({
  name,
  description: `${name} skill`,
  source: 'project',
  modelInvocable: true,
  userInvocable: true,
  ...extra,
});

describe('available commands', () => {
  it('advertises the runtime commands and user-invocable skills once the session is created', async () => {
    const fake = createFakeSession();
    fake.session.listCommands = () => [
      command('help'),
      command('model', { argumentHint: '<model>' }),
      command('exit', { runner: 'client' }),
    ];
    fake.session.listSkills = () => [
      skill('review', { argumentHint: '[path]' }),
      skill('internal', { userInvocable: false }),
      skill('help'),
    ];
    const { editor } = await start(fake);
    await openSession(editor);
    await vi.waitFor(() => expect(editor.commandLists).toHaveLength(1));
    expect(editor.commandLists[0]).toEqual([
      { name: 'help', description: 'help command' },
      { name: 'model', description: 'model command', input: { hint: '<model>' } },
      { name: 'review', description: 'review skill', input: { hint: '[path]' } },
    ]);
  });

  it('sends the list again after a command only when the command changed it', async () => {
    const fake = createFakeSession();
    let skills = [skill('review')];
    fake.session.listSkills = () => skills;
    const executeCommand = vi.fn(async (text: string) => {
      if (text === '/reload') skills = [skill('review'), skill('deploy')];
      return 'done';
    });
    const { editor } = await start(fake, { executeCommand });
    const sessionId = await openSession(editor);
    await vi.waitFor(() => expect(editor.commandLists).toHaveLength(1));
    const prompt = (text: string) =>
      editor.connection.agent.request('session/prompt', { sessionId, prompt: textPrompt(text) });
    await prompt('/help');
    await settle();
    expect(editor.commandLists).toHaveLength(1);
    await prompt('/reload');
    await settle();
    expect(editor.commandLists.map((list) => list.map((c) => c.name))).toEqual([
      ['review'],
      ['review', 'deploy'],
    ]);
  });
});

describe('session/load', () => {
  const history: IHistoryDisplaySegment[] = [
    { type: 'text', role: 'user', content: 'read the probe' },
    {
      type: 'tool',
      tool: {
        toolName: 'Read',
        firstArg: 'PROBE.txt',
        isRunning: false,
        result: 'success',
        executionId: 'call-old',
      },
    },
    {
      type: 'tool',
      tool: { toolName: 'Shell', firstArg: 'rm -rf x', isRunning: false, result: 'denied' },
    },
    { type: 'tool', tool: { toolName: 'goal', firstArg: '', isRunning: false, internal: true } },
    { type: 'text', role: 'assistant', content: 'It says probe.' },
  ];

  /** A host whose load makes the attached session the stored one, with its id and history. */
  function loadable(fake: IFakeSession, known = 'stored-1') {
    const snapshot = fake.session.getStatusSnapshot.bind(fake.session);
    let current: string | undefined;
    fake.session.getStatusSnapshot = () => ({ ...snapshot(), sessionId: current ?? snapshot().sessionId });
    fake.session.getMessagesDisplay = () => (current === undefined ? [] : history);
    return vi.fn(async (id: string) => {
      if (id !== known) return { loaded: false as const, message: `No session ${id}` };
      current = id;
      return { loaded: true as const };
    });
  }

  it('is offered only when the host can load a session', async () => {
    const without = await start(createFakeSession());
    await expect(
      without.editor.connection.agent.request('initialize', { protocolVersion: 1 }),
    ).resolves.toMatchObject({ agentCapabilities: { loadSession: false } });
    const fake = createFakeSession();
    const withPort = await start(fake, { loadSession: loadable(fake) });
    await expect(
      withPort.editor.connection.agent.request('initialize', { protocolVersion: 1 }),
    ).resolves.toMatchObject({ agentCapabilities: { loadSession: true } });
    await expect(
      without.editor.connection.agent.request('session/load', {
        sessionId: 'stored-1',
        cwd: WORKSPACE,
        mcpServers: [],
      }),
    ).rejects.toMatchObject({ code: -32601 });
  });

  it('replays the stored conversation before it answers, then serves prompts on that session', async () => {
    const fake = createFakeSession(async () => endedTurn(executionResult('next')));
    const loadSession = loadable(fake);
    const { editor } = await start(fake, { loadSession });
    const { agent } = editor.connection;
    await agent.request('initialize', { protocolVersion: 1 });
    let seenWhenAnswered = -1;
    await agent
      .request('session/load', { sessionId: 'stored-1', cwd: WORKSPACE, mcpServers: [] })
      .then(() => (seenWhenAnswered = editor.updates.length));
    expect(loadSession).toHaveBeenCalledWith('stored-1');
    expect(editor.updates).toEqual([
      { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'read the probe' } },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-old',
        title: 'Read: PROBE.txt',
        kind: 'read',
        status: 'completed',
      },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'tool-1',
        title: 'Shell: rm -rf x',
        kind: 'execute',
        status: 'failed',
      },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'It says probe.' } },
    ]);
    expect(seenWhenAnswered).toBe(4);
    await vi.waitFor(() => expect(editor.commandLists).toHaveLength(1));
    await expect(
      agent.request('session/prompt', { sessionId: 'stored-1', prompt: textPrompt('go on') }),
    ).resolves.toEqual({ stopReason: 'end_turn' });
    await expect(
      agent.request('session/new', { cwd: WORKSPACE, mcpServers: [] }),
    ).rejects.toMatchObject({ code: -32602 });
  });

  it('refuses what session/new refuses, and an id the host does not know', async () => {
    const fake = createFakeSession();
    const loadSession = loadable(fake);
    let admitted = true;
    const { editor } = await start(fake, {
      loadSession,
      admitWorkspace: () =>
        admitted ? { admitted: true } : { admitted: false, message: 'Run robota trust --yes' },
    });
    const { agent } = editor.connection;
    await agent.request('initialize', { protocolVersion: 1 });
    const load = (params: Partial<{ sessionId: string; cwd: string; mcpServers: never[] }>) =>
      agent.request('session/load', {
        sessionId: 'stored-1',
        cwd: WORKSPACE,
        mcpServers: [],
        ...params,
      } as never);
    await expect(load({ cwd: '/elsewhere' })).rejects.toMatchObject({ code: -32602 });
    await expect(
      load({ mcpServers: [{ name: 'x', command: 'x', args: [], env: [] }] as never }),
    ).rejects.toMatchObject({ code: -32602 });
    await expect(load({ sessionId: 'unknown' })).rejects.toMatchObject({
      code: -32602,
      message: expect.stringContaining('No session unknown'),
    });
    admitted = false;
    await expect(load({})).rejects.toMatchObject({
      code: -32001,
      data: { reason: 'workspace-not-trusted' },
    });
    expect(loadSession).toHaveBeenCalledTimes(1);
    expect(editor.updates).toEqual([]);
  });

  it('refuses a load while a prompt is running', async () => {
    let finish!: () => void;
    const held = new Promise<void>((resolve) => (finish = resolve));
    const fake = createFakeSession(async () => {
      await held;
      return endedTurn();
    });
    const loadSession = loadable(fake);
    const { editor } = await start(fake, { loadSession });
    const sessionId = await openSession(editor);
    const running = editor.connection.agent.request('session/prompt', {
      sessionId,
      prompt: textPrompt('wait'),
    });
    await settle();
    await expect(
      editor.connection.agent.request('session/load', {
        sessionId: 'stored-1',
        cwd: WORKSPACE,
        mcpServers: [],
      }),
    ).rejects.toMatchObject({ code: -32602 });
    finish();
    await running;
    expect(loadSession).not.toHaveBeenCalled();
  });

  it('answers a fixed error when the host fails to load, and keeps the cause local', async () => {
    const fake = createFakeSession();
    const fixture = await start(fake, {
      loadSession: async () => {
        throw new Error('/home/me/.robota/sessions is unreadable');
      },
    });
    await fixture.editor.connection.agent.request('initialize', { protocolVersion: 1 });
    const failure = await fixture.editor.connection.agent
      .request('session/load', { sessionId: 'stored-1', cwd: WORKSPACE, mcpServers: [] })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: -32603, message: 'The session could not be loaded' });
    expect(fixture.deliveryErrors).toEqual([
      { error: expect.objectContaining({ message: expect.stringContaining('unreadable') }), context: 'session/load' },
    ]);
  });
});
