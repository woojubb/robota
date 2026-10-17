import { afterEach, describe, expect, it } from 'vitest';

import {
  createFakeSession,
  endedTurn,
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

/** Runs one prompt whose turn asks for permission and waits for the session to be answered. */
async function askPermission(
  answer: () => RequestPermissionResponse | Promise<RequestPermissionResponse>,
  request: Partial<IPermissionRequestEvent> = {},
  { startTool = true }: { startTool?: boolean } = {},
) {
  let answered!: () => void;
  const wasAnswered = new Promise<void>((resolve) => (answered = resolve));
  const fake: IFakeSession = createFakeSession(async () => {
    if (startTool) fake.emit('tool_start', shell);
    fake.emit('permission_request', {
      id: 'perm-1',
      toolName: 'Shell',
      toolArgs: { command: 'rm -rf build' },
      canPersistProjectPermission: true,
      ...request,
    });
    await wasAnswered;
    return endedTurn();
  });
  fake.resolvePermission.mockImplementation(() => answered());
  const fixture = await startTransport(fake.session);
  open.push(fixture);
  fixture.editor.answerPermission(answer);
  const sessionId = await openSession(fixture.editor);
  await fixture.editor.connection.agent.request('session/prompt', {
    sessionId,
    prompt: textPrompt('clean up'),
  });
  return { fake, editor: fixture.editor, sessionId, fixture };
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

  it('asks about the started call, with the options the session can honour', async () => {
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
      canPersistProjectPermission: false,
    });
    expect(editor.permissionRequests[0]!.options.map((o) => o.optionId)).toEqual([
      'allow-once',
      'allow-session',
      'reject',
    ]);
    // An answer naming an option the request never listed widens nothing.
    expect(fake.resolvePermission).toHaveBeenCalledWith('perm-1', false, 'owner');
  });

  it('names the request when no call has started yet', async () => {
    const { editor } = await askPermission(() => select('reject'), {}, { startTool: false });
    expect(editor.permissionRequests[0]!.toolCall.toolCallId).toBe('permission-perm-1');
  });

  it('titles the request by the edited file and the background agent that asked', async () => {
    const { editor } = await askPermission(
      () => select('reject'),
      {
        toolName: 'Edit',
        toolArgs: { file_path: '/workspace/src/a.ts' },
        diffFile: 'src/a.ts',
        requester: { kind: 'background-agent', label: 'reviewer', taskId: 'task-1' },
      },
      { startTool: false },
    );
    expect(editor.permissionRequests[0]!.toolCall).toMatchObject({
      title: 'reviewer: Edit: src/a.ts',
      kind: 'edit',
    });
  });

  it('shows the editor a long command whole, in the title and in the raw input', async () => {
    const command = `echo start && ${'sleep 1 && '.repeat(30)}rm -rf build`;
    expect(command.length).toBeGreaterThan(120);
    const { editor } = await askPermission(
      () => select('reject'),
      { toolArgs: { command, description: 'clean' } },
      { startTool: false },
    );
    const { toolCall } = editor.permissionRequests[0]!;
    expect(toolCall.title).toBe(`Shell: ${command}`);
    expect(toolCall.rawInput).toEqual({ command, description: 'clean' });
  });

  it('keeps the line structure of a multi-line command in the title', async () => {
    const command = 'echo ok\nrm -rf build';
    const { editor } = await askPermission(
      () => select('reject'),
      { toolArgs: { command } },
      { startTool: false },
    );
    expect(editor.permissionRequests[0]!.toolCall.title).toBe(`Shell: ${command}`);
  });

  it("adds a shell request's working directory to the raw input", async () => {
    const { editor } = await askPermission(
      () => select('reject'),
      { toolArgs: { command: 'ls', workingDirectory: '../other' }, cwd: '/other' },
      { startTool: false },
    );
    expect(editor.permissionRequests[0]!.toolCall.rawInput).toEqual({
      command: 'ls',
      workingDirectory: '../other',
      cwd: '/other',
    });
  });

  it('sends an edit as a diff of the file, with its location', async () => {
    const toolArgs = { file_path: '/workspace/src/a.ts', old_string: 'b = 2', new_string: 'b = 3' };
    const { editor } = await askPermission(
      () => select('reject'),
      {
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
      { startTool: false },
    );
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
    const { editor } = await askPermission(
      () => select('reject'),
      {
        toolName: 'Write',
        toolArgs: { file_path: '/elsewhere/new.txt', content: 'one\ntwo' },
        diffFile: '/elsewhere/new.txt',
        diffLines: [
          { type: 'hunk', text: '@@ -0,0 +1,2 @@', lineNumber: 1 },
          { type: 'add', text: 'one', lineNumber: 1 },
          { type: 'add', text: 'two', lineNumber: 2 },
        ],
      },
      { startTool: false },
    );
    const [block] = editor.permissionRequests[0]!.toolCall.content!;
    expect(block).toEqual({ type: 'diff', path: '/elsewhere/new.txt', newText: 'one\ntwo' });
    expect(editor.permissionRequests[0]!.toolCall.locations).toEqual([
      { path: '/elsewhere/new.txt' },
    ]);
  });

  it('sends no diff or location for a request that has none', async () => {
    const { editor } = await askPermission(() => select('reject'), {}, { startTool: false });
    const { toolCall } = editor.permissionRequests[0]!;
    expect(toolCall).not.toHaveProperty('content');
    expect(toolCall).not.toHaveProperty('locations');
  });
});
