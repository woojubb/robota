import { afterEach, describe, expect, it, vi } from 'vitest';

import { createFakeSession, openSession, startTransport, textPrompt } from './acp-test-harness.js';

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
