import { afterEach, describe, expect, it } from 'vitest';

import {
  createFakeSession,
  endedTurn,
  executionResult,
  openSession,
  startTransport,
  textPrompt,
} from './acp-test-harness.js';

import type { IFakeSession } from './acp-test-harness.js';
import type { RequestPermissionResponse } from '@agentclientprotocol/sdk';
import type { IPermissionRequestEvent, IToolState } from '@robota-sdk/agent-interface-session';

const open: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.stop();
});

const shell: IToolState = {
  toolName: 'Shell',
  firstArg: 'rm -rf build',
  isRunning: true,
  executionId: 'call-9',
};
const shellEnded = (result: IToolState['result'], executionId = 'call-9'): IToolState => ({
  ...shell,
  executionId,
  isRunning: false,
  result,
});

interface IAsk {
  /** Emitted before the permission request, as when an earlier call is still running. */
  before?: (fake: IFakeSession) => void;
  /** Emitted once the session has been answered, in the order a real session emits them. */
  after?: (fake: IFakeSession) => void;
  request?: Partial<IPermissionRequestEvent>;
  turn?: ReturnType<typeof endedTurn>;
}

/** Runs one prompt whose turn asks for permission, waits for the session to be answered, then plays `after`. */
async function askPermission(
  answer: () => RequestPermissionResponse | Promise<RequestPermissionResponse>,
  { before, after, request = {}, turn = endedTurn() }: IAsk = {},
) {
  let answered!: () => void;
  const wasAnswered = new Promise<void>((resolve) => (answered = resolve));
  const fake: IFakeSession = createFakeSession(async () => {
    before?.(fake);
    fake.emit('permission_request', {
      id: 'perm-1',
      toolName: 'Shell',
      toolArgs: { command: 'rm -rf build' },
      canPersistProjectPermission: true,
      executionId: 'call-9',
      ...request,
    });
    await wasAnswered;
    after?.(fake);
    return turn;
  });
  fake.resolvePermission.mockImplementation(() => answered());
  const fixture = await startTransport(fake.session);
  open.push(fixture);
  fixture.editor.answerPermission(answer);
  const sessionId = await openSession(fixture.editor);
  const response = await fixture.editor.connection.agent.request('session/prompt', {
    sessionId,
    prompt: textPrompt('clean up'),
  });
  return { fake, editor: fixture.editor, sessionId, fixture, response };
}

const select = (optionId: string): RequestPermissionResponse => ({
  outcome: { outcome: 'selected', optionId },
});

describe('permission requests', () => {
  it.each([
    ['allow-once', true],
    ['allow-session', 'allow-session'],
    ['allow-project', 'allow-project'],
    ['reject', false],
    ['something-else', false],
  ])('maps the editor choosing %s to %j', async (optionId, decision) => {
    const { fake } = await askPermission(() => select(optionId));
    expect(fake.resolvePermission).toHaveBeenCalledWith('perm-1', decision, 'owner');
  });

  it('denies when the editor cancels the request', async () => {
    const { fake } = await askPermission(() => ({ outcome: { outcome: 'cancelled' } }));
    expect(fake.resolvePermission).toHaveBeenCalledWith('perm-1', false, 'owner');
  });

  it('denies when the editor fails to answer', async () => {
    const { fake, fixture } = await askPermission(() => {
      throw new Error('editor closed the dialog');
    });
    expect(fake.resolvePermission).toHaveBeenCalledWith('perm-1', false, 'owner');
    expect(fixture.deliveryErrors.some((e) => e.context === 'session/request_permission')).toBe(
      true,
    );
  });

  it('asks about the call it names and offers the options the session can honour', async () => {
    const { editor, sessionId } = await askPermission(() => select('allow-once'));
    expect(editor.permissionRequests).toEqual([
      {
        sessionId,
        toolCall: {
          toolCallId: 'call-9',
          title: 'Shell: rm -rf build',
          kind: 'execute',
          status: 'pending',
          rawInput: { command: 'rm -rf build' },
        },
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'allow-session', name: 'Allow for this session', kind: 'allow_always' },
          { optionId: 'allow-project', name: 'Allow for this project', kind: 'allow_always' },
          { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
        ],
      },
    ]);
  });

  it('offers a project-wide allow only when the session can persist it, and denies it otherwise', async () => {
    const { editor, fake } = await askPermission(() => select('allow-project'), {
      request: { canPersistProjectPermission: false },
    });
    expect(editor.permissionRequests[0]!.options.map((o) => o.optionId)).toEqual([
      'allow-once',
      'allow-session',
      'reject',
    ]);
    // An answer naming an option the request never listed widens nothing.
    expect(fake.resolvePermission).toHaveBeenCalledWith('perm-1', false, 'owner');
  });

  it('titles the request by the edited file and the background agent that asked', async () => {
    const { editor } = await askPermission(() => select('reject'), {
      request: {
        toolName: 'Edit',
        toolArgs: { file_path: '/workspace/src/a.ts' },
        diffFile: 'src/a.ts',
        requester: { kind: 'background-agent', label: 'reviewer', taskId: 'task-1' },
      },
    });
    expect(editor.permissionRequests[0]!.toolCall).toMatchObject({
      title: 'reviewer: Edit: src/a.ts',
      kind: 'edit',
    });
  });

  it('shows the editor a long command whole, in the title and in the raw input', async () => {
    const command = `echo start && ${'sleep 1 && '.repeat(30)}rm -rf build`;
    expect(command.length).toBeGreaterThan(120);
    const { editor } = await askPermission(() => select('reject'), {
      request: { toolArgs: { command, description: 'clean' } },
    });
    const { toolCall } = editor.permissionRequests[0]!;
    expect(toolCall.title).toBe(`Shell: ${command}`);
    expect(toolCall.rawInput).toEqual({ command, description: 'clean' });
  });

  it('keeps the line structure of a multi-line command in the title', async () => {
    const command = 'echo ok\nrm -rf build';
    const { editor } = await askPermission(() => select('reject'), {
      request: { toolArgs: { command } },
    });
    expect(editor.permissionRequests[0]!.toolCall.title).toBe(`Shell: ${command}`);
  });

  it("adds a shell request's working directory to the raw input", async () => {
    const { editor } = await askPermission(() => select('reject'), {
      request: { toolArgs: { command: 'ls', workingDirectory: '../other' }, cwd: '/other' },
    });
    expect(editor.permissionRequests[0]!.toolCall.rawInput).toEqual({
      command: 'ls',
      workingDirectory: '../other',
      cwd: '/other',
    });
  });

  it('sends an edit as a diff of the file, with its location', async () => {
    const toolArgs = { file_path: '/workspace/src/a.ts', old_string: 'b = 2', new_string: 'b = 3' };
    const { editor } = await askPermission(() => select('reject'), {
      request: {
        toolName: 'Edit',
        toolArgs,
        diffFile: 'src/a.ts',
        diffLines: [
          { type: 'hunk', text: '@@ -1,3 +1,3 @@', lineNumber: 1 },
          { type: 'context', text: 'const a = 1;', lineNumber: 1 },
          { type: 'remove', text: 'const b = 2;', lineNumber: 2 },
          { type: 'add', text: 'const b = 3;', lineNumber: 2 },
          { type: 'context', text: 'export { a, b };', lineNumber: 3 },
        ],
      },
    });
    expect(editor.permissionRequests[0]!.toolCall).toMatchObject({
      kind: 'edit',
      rawInput: toolArgs,
      content: [
        {
          type: 'diff',
          path: '/workspace/src/a.ts',
          oldText: 'const a = 1;\nconst b = 2;\nexport { a, b };',
          newText: 'const a = 1;\nconst b = 3;\nexport { a, b };',
        },
      ],
      locations: [{ path: '/workspace/src/a.ts' }],
    });
  });

  it('sends a new file as a diff with no old text, and keeps an absolute path as it is', async () => {
    const { editor } = await askPermission(() => select('reject'), {
      request: {
        toolName: 'Write',
        toolArgs: { file_path: '/elsewhere/new.txt', content: 'one\ntwo' },
        diffFile: '/elsewhere/new.txt',
        diffLines: [
          { type: 'hunk', text: '@@ -0,0 +1,2 @@', lineNumber: 1 },
          { type: 'add', text: 'one', lineNumber: 1 },
          { type: 'add', text: 'two', lineNumber: 2 },
        ],
      },
    });
    const [block] = editor.permissionRequests[0]!.toolCall.content!;
    expect(block).toEqual({ type: 'diff', path: '/elsewhere/new.txt', newText: 'one\ntwo' });
    expect(editor.permissionRequests[0]!.toolCall.locations).toEqual([
      { path: '/elsewhere/new.txt' },
    ]);
  });

  it('keeps the truncation marker of a capped diff side with that side', async () => {
    const { editor } = await askPermission(() => select('reject'), {
      request: {
        toolName: 'Edit',
        toolArgs: { file_path: '/workspace/src/big.ts', old_string: 'old', new_string: 'new' },
        diffFile: 'src/big.ts',
        diffLines: [
          { type: 'hunk', text: '@@ -1,2 +1,2 @@', lineNumber: 1 },
          { type: 'remove', text: 'old 1', lineNumber: 1 },
          { type: 'hunk', text: '… 499 more removed lines truncated', lineNumber: 2 },
          { type: 'add', text: 'new 1', lineNumber: 1 },
          { type: 'hunk', text: '… 499 more added lines truncated', lineNumber: 2 },
        ],
      },
    });
    const [block] = editor.permissionRequests[0]!.toolCall.content!;
    expect(block).toEqual({
      type: 'diff',
      path: '/workspace/src/big.ts',
      oldText: 'old 1\n… 499 more removed lines truncated',
      newText: 'new 1\n… 499 more added lines truncated',
    });
    const { editor: write } = await askPermission(() => select('reject'), {
      request: {
        toolName: 'Write',
        toolArgs: { file_path: '/workspace/big.txt', content: 'one' },
        diffFile: 'big.txt',
        diffLines: [
          { type: 'hunk', text: '@@ -0,0 +1,501 @@', lineNumber: 1 },
          { type: 'add', text: 'one', lineNumber: 1 },
          { type: 'hunk', text: '… 500 more lines truncated', lineNumber: 2 },
        ],
      },
    });
    expect(write.permissionRequests[0]!.toolCall.content![0]).toEqual({
      type: 'diff',
      path: '/workspace/big.txt',
      newText: 'one\n… 500 more lines truncated',
    });
  });

  it('sends no diff or location for a request that has none', async () => {
    const { editor } = await askPermission(() => select('reject'));
    const { toolCall } = editor.permissionRequests[0]!;
    expect(toolCall).not.toHaveProperty('content');
    expect(toolCall).not.toHaveProperty('locations');
  });
});

describe('the call a permission request asks about', () => {
  const row = (update: object) => expect.objectContaining(update);

  it('is one row that moves from pending to in progress to completed', async () => {
    const { editor } = await askPermission(() => select('allow-once'), {
      after: (fake) => {
        fake.emit('tool_start', shell);
        fake.emit('tool_end', shellEnded('success'));
      },
    });
    expect(editor.permissionRequests[0]!.toolCall.toolCallId).toBe('call-9');
    expect(editor.updates).toEqual([
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-9',
        status: 'in_progress',
        title: 'Shell: rm -rf build',
        kind: 'execute',
        rawInput: { command: 'rm -rf build' },
      },
      { sessionUpdate: 'tool_call_update', toolCallId: 'call-9', status: 'completed' },
    ]);
  });

  it('is closed as failed when the session refuses the call and never starts it', async () => {
    const { editor } = await askPermission(() => select('reject'), {
      after: (fake) => fake.emit('tool_end', shellEnded('denied')),
    });
    expect(editor.updates).toEqual([
      { sessionUpdate: 'tool_call_update', toolCallId: 'call-9', status: 'failed' },
    ]);
  });

  it('is closed once when the session denies the call on its own while the dialog is still open', async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const { editor, fake } = await askPermission(
      async () => {
        await gate;
        return select('allow-once');
      },
      {
        before: (fake) => {
          // The session's backstop denies the call before the editor answers.
          setTimeout(() => {
            fake.emit('tool_end', shellEnded('denied'));
            open();
          }, 5);
        },
      },
    );
    // The late answer reaches the session, which has nothing left to decide; the editor got one row.
    expect(fake.resolvePermission).toHaveBeenCalledWith('perm-1', true, 'owner');
    expect(editor.updates).toEqual([
      { sessionUpdate: 'tool_call_update', toolCallId: 'call-9', status: 'failed' },
    ]);
  });

  it('follows its own call when two same-named requests are answered out of order', async () => {
    const answers = new Map<string, () => void>();
    const answered = (id: string) => new Promise<void>((resolve) => answers.set(id, resolve));
    const fake: IFakeSession = createFakeSession(async () => {
      const first = answered('perm-1');
      const second = answered('perm-2');
      fake.emit('permission_request', {
        id: 'perm-1',
        toolName: 'Shell',
        toolArgs: { command: 'rm -rf build' },
        executionId: 'call-a',
      });
      fake.emit('permission_request', {
        id: 'perm-2',
        toolName: 'Shell',
        toolArgs: { command: 'rm -rf dist' },
        executionId: 'call-b',
      });
      await Promise.all([first, second]);
      // The allowed call runs; the refused one ends without starting.
      fake.emit('tool_start', { ...shell, firstArg: 'rm -rf dist', executionId: 'call-b' });
      fake.emit('tool_end', shellEnded('success', 'call-b'));
      fake.emit('tool_end', shellEnded('denied', 'call-a'));
      return endedTurn();
    });
    fake.resolvePermission.mockImplementation((id) => answers.get(id)?.());
    const fixture = await startTransport(fake.session);
    open.push(fixture);
    // The editor answers the second request first, allowing it, then refuses the first.
    let firstAnswer!: () => void;
    const firstGate = new Promise<void>((resolve) => (firstAnswer = resolve));
    fixture.editor.answerPermission(async (request) => {
      if (request.toolCall.toolCallId === 'call-b') {
        setTimeout(firstAnswer, 5);
        return select('allow-once');
      }
      await firstGate;
      return select('reject');
    });
    const sessionId = await openSession(fixture.editor);
    await fixture.editor.connection.agent.request('session/prompt', {
      sessionId,
      prompt: textPrompt('clean up'),
    });
    expect(fake.resolvePermission.mock.calls.map(([id, decision]) => [id, decision])).toEqual([
      ['perm-2', true],
      ['perm-1', false],
    ]);
    expect(fixture.editor.updates).toEqual([
      row({ sessionUpdate: 'tool_call_update', toolCallId: 'call-b', status: 'in_progress' }),
      { sessionUpdate: 'tool_call_update', toolCallId: 'call-b', status: 'completed' },
      { sessionUpdate: 'tool_call_update', toolCallId: 'call-a', status: 'failed' },
    ]);
  });

  it('is not taken by an unasked same-named call that starts while the dialog is open', async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const { editor } = await askPermission(
      async () => {
        await gate;
        return select('allow-once');
      },
      {
        before: (fake) => {
          // A call the session ran without asking starts while the editor's dialog is open.
          setTimeout(() => {
            fake.emit('tool_start', { ...shell, executionId: 'unasked' });
            fake.emit('tool_end', shellEnded('success', 'unasked'));
            open();
          }, 5);
        },
        after: (fake) => {
          fake.emit('tool_start', shell);
          fake.emit('tool_end', shellEnded('success'));
        },
      },
    );
    expect(
      editor.updates.map((u) => [u.sessionUpdate, (u as { toolCallId: string }).toolCallId]),
    ).toEqual([
      ['tool_call', 'unasked'],
      ['tool_call_update', 'unasked'],
      ['tool_call_update', 'call-9'],
      ['tool_call_update', 'call-9'],
    ]);
  });

  it('is closed as failed when the turn ends without the call ever starting', async () => {
    const { editor, response } = await askPermission(() => select('allow-once'));
    expect(response).toEqual({ stopReason: 'end_turn' });
    expect(editor.updates).toEqual([
      { sessionUpdate: 'tool_call_update', toolCallId: 'call-9', status: 'failed' },
    ]);
  });

  it('is closed as failed when the turn was cancelled after the answer', async () => {
    const { editor, response } = await askPermission(() => select('allow-once'), {
      turn: endedTurn(executionResult('', true)),
    });
    expect(response).toEqual({ stopReason: 'cancelled' });
    expect(editor.updates).toEqual([
      { sessionUpdate: 'tool_call_update', toolCallId: 'call-9', status: 'failed' },
    ]);
  });

  it('is closed with the answer when the request names no call, and a later call of the tool gets its own row', async () => {
    const { editor } = await askPermission(() => select('allow-once'), {
      request: { executionId: undefined },
      after: (fake) => {
        fake.emit('tool_start', shell);
        fake.emit('tool_end', shellEnded('success'));
      },
    });
    expect(editor.permissionRequests[0]!.toolCall.toolCallId).toBe('permission-perm-1');
    expect(editor.updates).toEqual([
      { sessionUpdate: 'tool_call_update', toolCallId: 'permission-perm-1', status: 'completed' },
      row({ sessionUpdate: 'tool_call', toolCallId: 'call-9', status: 'in_progress' }),
      { sessionUpdate: 'tool_call_update', toolCallId: 'call-9', status: 'completed' },
    ]);
  });

  it('is closed with the answer when a background agent asked, so it cannot be taken by a later call', async () => {
    const requester = { kind: 'background-agent' as const, label: 'reviewer', taskId: 'task-1' };
    const { editor } = await askPermission(() => select('allow-once'), {
      request: { requester },
      after: (fake) => {
        fake.emit('tool_start', { ...shell, executionId: 'mine' });
        fake.emit('tool_end', shellEnded('success', 'mine'));
      },
    });
    expect(editor.updates).toEqual([
      { sessionUpdate: 'tool_call_update', toolCallId: 'permission-perm-1', status: 'completed' },
      row({ sessionUpdate: 'tool_call', toolCallId: 'mine', status: 'in_progress' }),
      { sessionUpdate: 'tool_call_update', toolCallId: 'mine', status: 'completed' },
    ]);
  });

  it('is closed as failed with the answer when a background agent asked and the editor refused', async () => {
    const { editor } = await askPermission(() => select('reject'), {
      request: { requester: { kind: 'background-agent', label: 'reviewer', taskId: 'task-1' } },
    });
    expect(editor.updates).toEqual([
      { sessionUpdate: 'tool_call_update', toolCallId: 'permission-perm-1', status: 'failed' },
    ]);
  });
});
