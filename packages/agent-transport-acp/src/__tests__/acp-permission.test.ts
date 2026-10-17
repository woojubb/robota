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
});
