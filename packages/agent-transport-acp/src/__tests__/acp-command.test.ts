import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeSession, openSession, startTransport, textPrompt } from './acp-test-harness.js';

import type { IFakeSession } from './acp-test-harness.js';

const open: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.stop();
});

async function start(executeCommand?: (text: string, signal: AbortSignal) => Promise<string>) {
  const fake = createFakeSession();
  const fixture = await startTransport(fake.session, executeCommand ? { executeCommand } : {});
  open.push(fixture);
  const sessionId = await openSession(fixture.editor);
  const prompt = (text: string) =>
    fixture.editor.connection.agent.request('session/prompt', {
      sessionId,
      prompt: textPrompt(text),
    });
  return { fake, fixture, editor: fixture.editor, prompt, sessionId };
}

describe('slash-command prompts', () => {
  it('runs the command through the host and streams its output as one message', async () => {
    const executeCommand = vi.fn(async () => 'Commands:\n/help\n/model');
    const { fake, editor, prompt } = await start(executeCommand);

    await expect(prompt('/help')).resolves.toEqual({ stopReason: 'end_turn' });

    expect(executeCommand).toHaveBeenCalledWith('/help', expect.any(AbortSignal));
    expect(editor.updates).toEqual([
      {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Commands:\n/help\n/model' },
      },
    ]);
    expect(fake.submit).not.toHaveBeenCalled();
  });

  it('recognises a command after leading whitespace, and not a slash inside the message', async () => {
    const executeCommand = vi.fn(async () => 'ok');
    const { fake, prompt } = await start(executeCommand);
    await prompt('  /model');
    expect(executeCommand).toHaveBeenCalledWith('  /model', expect.any(AbortSignal));
    await prompt('what does /etc/hosts hold?');
    expect(executeCommand).toHaveBeenCalledTimes(1);
    expect(fake.submit).toHaveBeenCalledTimes(1);
  });

  it('says commands are unavailable when the host supplies none', async () => {
    const { fake, editor, prompt } = await start();
    await expect(prompt('/help')).resolves.toEqual({ stopReason: 'end_turn' });
    expect(editor.updates).toEqual([
      {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Slash commands are not available in this host.' },
      },
    ]);
    expect(fake.submit).not.toHaveBeenCalled();
  });

  it('sends nothing for a command with no output', async () => {
    const { editor, prompt } = await start(async () => '');
    await expect(prompt('/clear')).resolves.toEqual({ stopReason: 'end_turn' });
    expect(editor.updates).toEqual([]);
  });

  it('fails with a fixed error and keeps the cause local when the command throws', async () => {
    const { fixture, prompt } = await start(async () => {
      throw new Error('disk path /home/me/secret');
    });
    const failure = await prompt('/boom').catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: -32603, message: 'Command failed' });
    expect(JSON.stringify(failure)).not.toContain('secret');
    expect(fixture.deliveryErrors).toHaveLength(1);
    expect(fixture.deliveryErrors[0]).toMatchObject({ context: 'command' });
  });

  it('cancels a running command through the signal it was given', async () => {
    let seen!: AbortSignal;
    const { editor, prompt, sessionId, fake } = await start(
      (_text, signal) =>
        new Promise<string>((_resolve, reject) => {
          seen = signal;
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const pending = prompt('/loop');
    await vi.waitFor(() => expect(seen).toBeDefined());
    await editor.connection.agent.notify('session/cancel', { sessionId });
    await expect(pending).resolves.toEqual({ stopReason: 'cancelled' });
    expect(seen.aborted).toBe(true);
    expect(fake.abort).toHaveBeenCalled();
  });
});

describe('a command that runs a model turn', () => {
  const shell = { toolName: 'Shell', firstArg: 'ls', isRunning: true, executionId: 'call-1' };

  /** A skill command: asks the editor, runs a tool and streams its reply, then returns that reply as its output. */
  function skillCommand(getFake: () => IFakeSession, reply = 'Reviewed.') {
    return async () => {
      const fake = getFake();
      const answered = new Promise<void>((resolve) =>
        fake.resolvePermission.mockImplementation(() => resolve()),
      );
      fake.emit('permission_request', {
        id: 'perm-1',
        toolName: 'Shell',
        toolArgs: { command: 'ls' },
        executionId: 'call-1',
      });
      await answered;
      fake.emit('tool_start', shell);
      fake.emit('tool_end', { ...shell, isRunning: false, result: 'success' });
      fake.emit('text_delta', reply);
      return reply;
    };
  }

  it('asks the editor and streams its rows and text like a normal turn, without repeating the reply', async () => {
    let fake!: IFakeSession;
    const started = await start(skillCommand(() => fake));
    fake = started.fake;
    started.editor.answerPermission(() => ({
      outcome: { outcome: 'selected', optionId: 'allow-once' },
    }));

    await expect(started.prompt('/review')).resolves.toEqual({ stopReason: 'end_turn' });

    expect(started.editor.permissionRequests).toHaveLength(1);
    expect(started.editor.permissionRequests[0]!.toolCall).toMatchObject({
      toolCallId: 'call-1',
      title: 'Shell: ls',
    });
    expect(fake.resolvePermission).toHaveBeenCalledWith('perm-1', true, 'owner');
    expect(started.editor.updates).toEqual([
      expect.objectContaining({
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call-1',
        status: 'in_progress',
      }),
      { sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed' },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Reviewed.' } },
    ]);
    expect(fake.submit).not.toHaveBeenCalled();
  });

  it('shows the output of a command whose turn did not stream', async () => {
    let fake!: IFakeSession;
    const started = await start(async () => {
      fake.emit('tool_start', shell);
      fake.emit('tool_end', { ...shell, isRunning: false, result: 'success' });
      return 'Whole reply';
    });
    fake = started.fake;
    await started.prompt('/review');
    expect(started.editor.updates.at(-1)).toEqual({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'Whole reply' },
    });
  });

  it('listens only while the command runs', async () => {
    let fake!: IFakeSession;
    let during = -1;
    const started = await start(async () => {
      during = fake.listenerCount('permission_request');
      throw new Error('boom');
    });
    fake = started.fake;
    await started.prompt('/review').catch(() => undefined);
    expect(during).toBe(1);
    expect(fake.listenerCount('permission_request')).toBe(0);
    expect(fake.listenerCount('text_delta')).toBe(0);
  });
});
