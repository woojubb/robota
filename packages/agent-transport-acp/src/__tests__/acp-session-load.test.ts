import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFakeSession,
  endedTurn,
  executionResult,
  openSession,
  SESSION_ID,
  settle,
  startTransport,
  textPrompt,
  WORKSPACE,
} from './acp-test-harness.js';

import type { IFakeSession } from './acp-test-harness.js';
import type { IAcpTransportOptions, IAcpTransportSession } from '../acp-types.js';
import type { IHistoryDisplaySegment } from '@robota-sdk/agent-interface-session';

type ICommandListEntry = ReturnType<NonNullable<IAcpTransportSession['listCommands']>>[number];
type ICommandSkillListEntry = ReturnType<NonNullable<IAcpTransportSession['listSkills']>>[number];

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
const skill = (
  name: string,
  extra: Partial<ICommandSkillListEntry> = {},
): ICommandSkillListEntry => ({
  name,
  description: `${name} skill`,
  source: 'project',
  modelInvocable: true,
  userInvocable: true,
  ...extra,
});

describe('published narrow session compatibility', () => {
  function narrowSession(): IAcpTransportSession {
    const {
      submit,
      abort,
      cancelQueue,
      on,
      off,
      resolvePermission,
      resolveAsk,
      getStatusSnapshot,
    } = createFakeSession().session;
    return {
      submit,
      abort,
      cancelQueue,
      on,
      off,
      resolvePermission,
      resolveAsk,
      getStatusSnapshot,
    };
  }

  it('serves prompts and slash commands without catalog or history capabilities', async () => {
    const fixture = await startTransport(narrowSession(), {
      executeCommand: async () => 'NARROW_COMMAND_DONE',
    });
    open.push(fixture);
    const sessionId = await openSession(fixture.editor);
    for (const text of ['ordinary prompt', '/help']) {
      await expect(
        fixture.editor.connection.agent.request('session/prompt', {
          sessionId,
          prompt: textPrompt(text),
        }),
      ).resolves.toEqual({ stopReason: 'end_turn' });
    }
    await settle();
    expect(fixture.deliveryErrors).toEqual([]);
    expect(fixture.editor.commandLists).toEqual([]);
    expect(fixture.editor.updates).toContainEqual({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'NARROW_COMMAND_DONE' },
    });
  });

  it('does not offer or invoke a load port without history capability', async () => {
    const loadSession = vi.fn(async () => ({ loaded: true as const }));
    const fixture = await startTransport(narrowSession(), { loadSession });
    open.push(fixture);
    const initialized = await fixture.editor.connection.agent.request('initialize', {
      protocolVersion: 1,
    });
    expect(initialized.agentCapabilities?.loadSession).toBe(false);
    await expect(
      fixture.editor.connection.agent.request('session/load', {
        sessionId: 'stored',
        cwd: WORKSPACE,
        mcpServers: [],
      }),
    ).rejects.toMatchObject({ code: -32601 });
    expect(loadSession).not.toHaveBeenCalled();
  });
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

  it('sends the list only after the reply that gives the editor the session id', async () => {
    const fake = createFakeSession();
    fake.session.listCommands = () => [command('help')];
    const { editor } = await start(fake);
    await editor.connection.agent.request('initialize', { protocolVersion: 1 });
    let listsWhenAnswered = -1;
    await editor.connection.agent
      .request('session/new', { cwd: WORKSPACE, mcpServers: [] })
      .then(() => (listsWhenAnswered = editor.commandLists.length));
    expect(listsWhenAnswered).toBe(0);
    await vi.waitFor(() => expect(editor.commandLists).toHaveLength(1));
  });

  it('keeps serving when the command catalog cannot be read, and reports why', async () => {
    const fake = createFakeSession();
    fake.session.listSkills = () => {
      throw new Error('skill roots unreadable');
    };
    const fixture = await start(fake, { executeCommand: async () => 'ran' });
    const sessionId = await openSession(fixture.editor);
    await expect(
      fixture.editor.connection.agent.request('session/prompt', {
        sessionId,
        prompt: textPrompt('/x'),
      }),
    ).resolves.toEqual({ stopReason: 'end_turn' });
    await vi.waitFor(() =>
      expect(fixture.deliveryErrors.map((e) => e.context)).toContain('available_commands_update'),
    );
    expect(fixture.editor.commandLists).toEqual([]);
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

describe('available commands after a model turn', () => {
  it('sends the list again after a prompt that is not a command when the turn changed it', async () => {
    let skills = [skill('review')];
    const fake = createFakeSession(async () => {
      // A model turn can install or remove a skill, as a command can.
      skills = [skill('review'), skill('deploy')];
      return endedTurn(executionResult('installed'));
    });
    fake.session.listSkills = () => skills;
    const { editor } = await start(fake);
    const sessionId = await openSession(editor);
    await vi.waitFor(() => expect(editor.commandLists).toHaveLength(1));
    await editor.connection.agent.request('session/prompt', {
      sessionId,
      prompt: textPrompt('add the deploy skill'),
    });
    await vi.waitFor(() => expect(editor.commandLists).toHaveLength(2));
    expect(editor.commandLists[1]!.map((c) => c.name)).toEqual(['review', 'deploy']);
    // A turn that leaves the list as it is sends nothing.
    await editor.connection.agent.request('session/prompt', {
      sessionId,
      prompt: textPrompt('thanks'),
    });
    await settle();
    expect(editor.commandLists).toHaveLength(2);
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
    fake.session.getStatusSnapshot = () => ({
      ...snapshot(),
      sessionId: current ?? snapshot().sessionId,
    });
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

  it('replaces the session a connection already serves, and serves only the loaded id afterwards', async () => {
    const fake = createFakeSession(async () => endedTurn(executionResult('next')));
    fake.session.listCommands = () => [command('help')];
    const loadSession = loadable(fake);
    const { editor } = await start(fake, { loadSession });
    const first = await openSession(editor);
    await vi.waitFor(() => expect(editor.commandLists).toHaveLength(1));
    await editor.connection.agent.request('session/load', {
      sessionId: 'stored-1',
      cwd: WORKSPACE,
      mcpServers: [],
    });
    // The loaded session gets its own list, even though the commands are the same.
    await vi.waitFor(() => expect(editor.commandLists).toHaveLength(2));
    await expect(
      editor.connection.agent.request('session/prompt', {
        sessionId: first,
        prompt: textPrompt('old'),
      }),
    ).rejects.toMatchObject({ code: -32602 });
    await expect(
      editor.connection.agent.request('session/prompt', {
        sessionId: 'stored-1',
        prompt: textPrompt('new'),
      }),
    ).resolves.toEqual({ stopReason: 'end_turn' });
  });

  /** What a request settled with so far, so a request that is wrongly left waiting fails an assertion instead of hanging. */
  function outcomeOf(request: Promise<unknown>): { readonly current: unknown } {
    const box: { current: unknown } = { current: 'still waiting' };
    request.then(
      (value) => (box.current = value),
      (error: unknown) => (box.current = error),
    );
    return box;
  }

  it('refuses a load while a session/new is still waiting for its session to start', async () => {
    const fake = createFakeSession();
    let started!: () => void;
    // A session that builds itself in the background names itself only once it has started.
    const building: Pick<IAcpTransportSession, 'whenInitialized'> = {
      whenInitialized: () => new Promise<void>((resolve) => (started = resolve)),
    };
    Object.assign(fake.session, building);
    const loadSession = loadable(fake);
    const { editor } = await start(fake, { loadSession });
    const { agent } = editor.connection;
    await agent.request('initialize', { protocolVersion: 1 });
    const creating = agent.request('session/new', { cwd: WORKSPACE, mcpServers: [] });
    await settle();
    const loading = outcomeOf(
      agent.request('session/load', { sessionId: 'stored-1', cwd: WORKSPACE, mcpServers: [] }),
    );
    try {
      await vi.waitFor(() =>
        expect(loading.current).toMatchObject({
          code: -32602,
          message: expect.stringContaining('already being opened'),
        }),
      );
      // The refused load reached neither the host nor the session the new request is about to name.
      expect(loadSession).not.toHaveBeenCalled();
    } finally {
      started();
    }
    await expect(creating).resolves.toEqual({ sessionId: SESSION_ID });
    expect(loadSession).not.toHaveBeenCalled();
  });

  it('refuses a load while another load is still in progress, and asks the host only once', async () => {
    const fake = createFakeSession();
    let finish!: () => void;
    const held = new Promise<void>((resolve) => (finish = resolve));
    const loadSession = vi.fn(async () => {
      await held;
      return { loaded: true as const };
    });
    const { editor } = await start(fake, { loadSession });
    const { agent } = editor.connection;
    await agent.request('initialize', { protocolVersion: 1 });
    const params = { sessionId: 'stored-1', cwd: WORKSPACE, mcpServers: [] };
    const first = agent.request('session/load', params);
    await settle();
    const second = outcomeOf(agent.request('session/load', params));
    try {
      await vi.waitFor(() =>
        expect(second.current).toMatchObject({
          code: -32602,
          message: expect.stringContaining('already being opened'),
        }),
      );
      expect(loadSession).toHaveBeenCalledTimes(1);
    } finally {
      finish();
    }
    await expect(first).resolves.toEqual({});
    expect(loadSession).toHaveBeenCalledTimes(1);
  });

  it('refuses a prompt while a load is still settling', async () => {
    const fake = createFakeSession();
    let finish!: () => void;
    const held = new Promise<void>((resolve) => (finish = resolve));
    const loadSession = vi.fn(async () => {
      await held;
      return { loaded: true as const };
    });
    const { editor } = await start(fake, { loadSession });
    const sessionId = await openSession(editor);
    const loading = editor.connection.agent.request('session/load', {
      sessionId,
      cwd: WORKSPACE,
      mcpServers: [],
    });
    await settle();
    await expect(
      editor.connection.agent.request('session/prompt', { sessionId, prompt: textPrompt('now') }),
    ).rejects.toMatchObject({ code: -32602 });
    finish();
    await loading;
  });

  it('gives a replayed call a fresh row when its id already named an earlier one', async () => {
    const fake = createFakeSession();
    const repeated: IHistoryDisplaySegment[] = [
      {
        type: 'tool',
        tool: {
          toolName: 'Read',
          firstArg: 'a',
          isRunning: false,
          result: 'success',
          executionId: 'call_0',
        },
      },
      {
        type: 'tool',
        tool: {
          toolName: 'Read',
          firstArg: 'b',
          isRunning: false,
          result: 'success',
          executionId: 'call_0',
        },
      },
    ];
    fake.session.getMessagesDisplay = () => repeated;
    const { editor } = await start(fake, { loadSession: async () => ({ loaded: true }) });
    await editor.connection.agent.request('initialize', { protocolVersion: 1 });
    await editor.connection.agent.request('session/load', {
      sessionId: 'robota-session-1',
      cwd: WORKSPACE,
      mcpServers: [],
    });
    expect(editor.updates.map((u) => (u as { toolCallId: string }).toolCallId)).toEqual([
      'call_0',
      'tool-1',
    ]);
  });

  it('answers a fixed error when the loaded history cannot be read, and keeps the cause local', async () => {
    const fake = createFakeSession();
    fake.session.getMessagesDisplay = () => {
      throw new Error('/home/me/.robota/sessions/x.json: bad record');
    };
    const fixture = await start(fake, { loadSession: async () => ({ loaded: true }) });
    await fixture.editor.connection.agent.request('initialize', { protocolVersion: 1 });
    const failure = await fixture.editor.connection.agent
      .request('session/load', { sessionId: 'robota-session-1', cwd: WORKSPACE, mcpServers: [] })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      code: -32603,
      message: 'The session history could not be shown',
    });
    expect(fixture.deliveryErrors.map((e) => e.context)).toContain('session/load');
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
      {
        error: expect.objectContaining({ message: expect.stringContaining('unreadable') }),
        context: 'session/load',
      },
    ]);
  });
});
