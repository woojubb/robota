import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createFakeSession,
  endedTurn,
  executionResult,
  openSession,
  startTransport,
  textPrompt,
} from './acp-test-harness.js';

import type { IFakeSession } from './acp-test-harness.js';
import type { IAcpTransportOptions } from '../acp-types.js';
import type { IToolState } from '@robota-sdk/agent-interface-session';

const open: { stop(): Promise<void> }[] = [];
afterEach(async () => {
  while (open.length) await open.pop()!.stop();
});

async function start(fake: IFakeSession, overrides: Partial<IAcpTransportOptions> = {}) {
  const fixture = await startTransport(fake.session, overrides);
  open.push(fixture);
  const sessionId = await openSession(fixture.editor);
  const prompt = (text: string) =>
    fixture.editor.connection.agent.request('session/prompt', {
      sessionId,
      prompt: textPrompt(text),
    });
  return { fixture, sessionId, editor: fixture.editor, prompt };
}

const tool = (overrides: Partial<IToolState> = {}): IToolState => ({
  toolName: 'Read',
  firstArg: 'src/a.ts',
  isRunning: true,
  executionId: 'call-1',
  ...overrides,
});

function chunk(text: string) {
  return { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } };
}

describe('session/prompt streaming', () => {
  it('streams message chunks and tool calls, then ends the turn', async () => {
    const fake: IFakeSession = createFakeSession(async () => {
      fake.emit('text_delta', 'Hel');
      fake.emit('text_delta', 'lo');
      fake.emit('tool_start', tool());
      fake.emit('tool_end', tool({ isRunning: false, result: 'success' }));
      fake.emit('text_delta', ' there');
      return endedTurn(executionResult('Hello there'));
    });
    const { prompt, editor, sessionId } = await start(fake);

    await expect(prompt('read the file')).resolves.toEqual({ stopReason: 'end_turn' });

    expect(editor.updates).toEqual([
      chunk('Hel'),
      chunk('lo'),
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call-1',
        title: 'Read: src/a.ts',
        kind: 'read',
        status: 'in_progress',
      },
      { sessionUpdate: 'tool_call_update', toolCallId: 'call-1', status: 'completed' },
      chunk(' there'),
    ]);
    expect(fake.submit).toHaveBeenCalledWith('read the file', undefined, undefined, {
      signal: expect.any(AbortSignal),
      driverId: 'owner',
      surface: 'unknown',
    });
    expect(sessionId).toBe('robota-session-1');
  });

  it('uses the host-chosen driver and surface', async () => {
    const fake = createFakeSession();
    const { prompt } = await start(fake, { driverId: 'editor-1', surface: 'cli' });
    await prompt('hi');
    expect(fake.submit).toHaveBeenCalledWith('hi', undefined, undefined, {
      signal: expect.any(AbortSignal),
      driverId: 'editor-1',
      surface: 'cli',
    });
  });

  it.each([
    ['Read', 'read'],
    ['Glob', 'search'],
    ['Grep', 'search'],
    ['Edit', 'edit'],
    ['Write', 'edit'],
    ['Shell', 'execute'],
    ['WebFetch', 'fetch'],
    ['Agent', 'other'],
  ])('describes a %s call as kind %s', async (toolName, kind) => {
    const fake: IFakeSession = createFakeSession(async () => {
      fake.emit('tool_start', tool({ toolName, firstArg: '' }));
      return endedTurn();
    });
    const { prompt, editor } = await start(fake);
    await prompt('go');
    expect(editor.updates[0]).toMatchObject({ sessionUpdate: 'tool_call', title: toolName, kind });
  });

  it('marks a failed or denied call failed', async () => {
    const fake: IFakeSession = createFakeSession(async () => {
      fake.emit('tool_start', tool({ executionId: 'a' }));
      fake.emit('tool_end', tool({ executionId: 'a', isRunning: false, result: 'error' }));
      fake.emit('tool_start', tool({ executionId: 'b' }));
      fake.emit('tool_end', tool({ executionId: 'b', isRunning: false, result: 'denied' }));
      return endedTurn();
    });
    const { prompt, editor } = await start(fake);
    await prompt('go');
    expect(editor.updates.filter((u) => u.sessionUpdate === 'tool_call_update')).toEqual([
      { sessionUpdate: 'tool_call_update', toolCallId: 'a', status: 'failed' },
      { sessionUpdate: 'tool_call_update', toolCallId: 'b', status: 'failed' },
    ]);
  });

  it('numbers calls that carry no execution id from one per-session counter', async () => {
    const fake: IFakeSession = createFakeSession(async () => {
      fake.emit('tool_start', tool({ executionId: undefined, toolName: 'Read' }));
      fake.emit('tool_start', tool({ executionId: undefined, toolName: 'Grep' }));
      fake.emit('tool_end', tool({ executionId: undefined, toolName: 'Grep', result: 'success' }));
      fake.emit('tool_end', tool({ executionId: undefined, toolName: 'Read', result: 'success' }));
      return endedTurn();
    });
    const { prompt, editor } = await start(fake);
    await prompt('first');
    await prompt('second');
    const calls = editor.updates.filter((u) => u.sessionUpdate === 'tool_call');
    expect(calls.map((c) => c.toolCallId)).toEqual(['tool-1', 'tool-2', 'tool-3', 'tool-4']);
    // Each end finds the start of the same tool, not just the oldest open call.
    expect(
      editor.updates.filter((u) => u.sessionUpdate === 'tool_call_update').map((u) => u.toolCallId),
    ).toEqual(['tool-2', 'tool-1', 'tool-4', 'tool-3']);
  });

  it('gives the editor a call for an end that never started, and hides internal tools', async () => {
    const fake: IFakeSession = createFakeSession(async () => {
      fake.emit('tool_start', tool({ internal: true, executionId: 'hidden' }));
      fake.emit('tool_end', tool({ internal: true, executionId: 'hidden', result: 'success' }));
      fake.emit('tool_end', tool({ executionId: 'refused', result: 'denied' }));
      return endedTurn();
    });
    const { prompt, editor } = await start(fake);
    await prompt('go');
    expect(editor.updates).toEqual([
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'refused',
        title: 'Read: src/a.ts',
        kind: 'read',
        status: 'failed',
      },
    ]);
  });

  it('shortens a long argument in the call title', async () => {
    const fake: IFakeSession = createFakeSession(async () => {
      fake.emit('tool_start', tool({ toolName: 'Shell', firstArg: `echo ${'x'.repeat(500)}` }));
      return endedTurn();
    });
    const { prompt, editor } = await start(fake);
    await prompt('go');
    const [first] = editor.updates;
    expect(first).toMatchObject({ sessionUpdate: 'tool_call' });
    expect((first as { title: string }).title.length).toBeLessThanOrEqual(130);
    expect((first as { title: string }).title.endsWith('…')).toBe(true);
  });

  it('sends the whole reply once when the provider streamed nothing', async () => {
    const fake = createFakeSession(async () => endedTurn(executionResult('Whole reply')));
    const { prompt, editor } = await start(fake);
    await expect(prompt('hi')).resolves.toEqual({ stopReason: 'end_turn' });
    expect(editor.updates).toEqual([chunk('Whole reply')]);
  });

  it('does not repeat a reply that was streamed', async () => {
    const fake: IFakeSession = createFakeSession(async () => {
      fake.emit('text_delta', 'Streamed');
      return endedTurn(executionResult('Streamed'));
    });
    const { prompt, editor } = await start(fake);
    await prompt('hi');
    expect(editor.updates).toEqual([chunk('Streamed')]);
  });

  it('sends nothing for an empty reply', async () => {
    const fake = createFakeSession();
    const { prompt, editor } = await start(fake);
    await expect(prompt('hi')).resolves.toEqual({ stopReason: 'end_turn' });
    expect(editor.updates).toEqual([]);
  });

  it('listens only while the prompt runs, never to thinking or asks', async () => {
    let during: Record<string, number> = {};
    const fake: IFakeSession = createFakeSession(async () => {
      during = {
        text_delta: fake.listenerCount('text_delta'),
        permission_request: fake.listenerCount('permission_request'),
        ask_request: fake.listenerCount('ask_request'),
      };
      fake.emit('thinking', true);
      return endedTurn();
    });
    const { prompt, editor } = await start(fake);
    await prompt('hi');
    expect(during).toEqual({ text_delta: 1, permission_request: 1, ask_request: 0 });
    expect(fake.listenerCount('text_delta')).toBe(0);
    expect(fake.listenerCount('permission_request')).toBe(0);
    expect(fake.everSubscribed.has('ask_request')).toBe(false);
    expect(fake.everSubscribed.has('thinking')).toBe(false);
    expect(editor.updates).toEqual([]);
  });

  it('puts attached context after the typed message and lists referenced files', async () => {
    const fake = createFakeSession();
    const { fixture, sessionId } = await start(fake);
    await fixture.editor.connection.agent.request('session/prompt', {
      sessionId,
      prompt: [
        { type: 'text', text: 'Explain ' },
        { type: 'text', text: 'this' },
        {
          type: 'resource',
          resource: {
            uri: 'file:///workspace/a.md',
            text: 'has ``` inside',
            mimeType: 'text/markdown',
          },
        },
        { type: 'resource', resource: { uri: 'file:///workspace/b.png', blob: 'AAAA' } },
        { type: 'resource_link', uri: 'file:///workspace/c.ts', name: 'c.ts' },
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      ],
    });
    expect(fake.submit.mock.calls[0]![0]).toBe(
      [
        'Explain this',
        '',
        'Context from file:///workspace/a.md:',
        '````',
        'has ``` inside',
        '````',
        '',
        'Referenced resources:',
        '- file:///workspace/c.ts',
      ].join('\n'),
    );
  });

  it('refuses a prompt with no text', async () => {
    const fake = createFakeSession();
    const { fixture, sessionId } = await start(fake);
    await expect(
      fixture.editor.connection.agent.request('session/prompt', {
        sessionId,
        prompt: [{ type: 'text', text: '  ' }],
      }),
    ).rejects.toMatchObject({ code: -32602 });
    expect(fake.submit).not.toHaveBeenCalled();
  });

  it('refuses a second prompt while one is running', async () => {
    let finish!: () => void;
    const fake = createFakeSession(async () => {
      await new Promise<void>((resolve) => (finish = resolve));
      return endedTurn();
    });
    const { prompt } = await start(fake);
    const first = prompt('one');
    await vi.waitFor(() => expect(fake.submit).toHaveBeenCalledTimes(1));
    await expect(prompt('two')).rejects.toMatchObject({ code: -32602 });
    finish();
    await expect(first).resolves.toEqual({ stopReason: 'end_turn' });
    expect(fake.submit).toHaveBeenCalledTimes(1);
  });
});

describe('session/cancel', () => {
  it('aborts the session and answers the prompt cancelled', async () => {
    let end!: (result: ReturnType<typeof executionResult>) => void;
    const fake = createFakeSession(async () => {
      // Like a real idle session: submit resolves only once the turn has finished.
      const result = await new Promise<ReturnType<typeof executionResult>>(
        (resolve) => (end = resolve),
      );
      return endedTurn(result);
    });
    fake.abort.mockImplementation(() => end(executionResult('partial', true)));
    const { prompt, editor, sessionId } = await start(fake);

    const pending = prompt('long task');
    await vi.waitFor(() => expect(fake.submit).toHaveBeenCalled());
    await editor.connection.agent.notify('session/cancel', { sessionId });

    await expect(pending).resolves.toEqual({ stopReason: 'cancelled' });
    expect(fake.abort).toHaveBeenCalledTimes(1);
    expect(editor.updates).toEqual([]);
  });

  it('answers cancelled when the cancelled turn surfaces as a failure', async () => {
    let fail!: (error: Error) => void;
    const fake = createFakeSession(async () => ({
      turnId: 't',
      completed: new Promise((_resolve, reject) => (fail = reject)),
    }));
    fake.abort.mockImplementation(() => fail(new Error('aborted by the provider')));
    const { prompt, editor, sessionId, fixture } = await start(fake);

    const pending = prompt('long task');
    await vi.waitFor(() => expect(fake.submit).toHaveBeenCalled());
    await editor.connection.agent.notify('session/cancel', { sessionId });

    await expect(pending).resolves.toEqual({ stopReason: 'cancelled' });
    expect(fixture.deliveryErrors).toEqual([]);
  });

  it('answers cancelled when the submission never ran because it was cancelled', async () => {
    const fake = createFakeSession(async () => ({
      turnId: 't',
      completed: Promise.reject(
        Object.assign(new Error('cancelled'), { name: 'TurnNotRunError', reason: 'cancelled' }),
      ),
    }));
    const { prompt } = await start(fake);
    await expect(prompt('queued')).resolves.toEqual({ stopReason: 'cancelled' });
  });

  it('does not touch the session when no prompt is running', async () => {
    const fake = createFakeSession();
    const { editor, sessionId } = await start(fake);
    await editor.connection.agent.notify('session/cancel', { sessionId });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fake.abort).not.toHaveBeenCalled();
  });

  it('cancels the running turn when the editor goes away', async () => {
    let signal!: AbortSignal;
    const fake = createFakeSession(async (_text, _display, _raw, options) => {
      signal = options!.signal!;
      await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve()));
      return endedTurn(executionResult('', true));
    });
    const { prompt, editor } = await start(fake);
    void prompt('long task').catch(() => undefined);
    await vi.waitFor(() => expect(fake.submit).toHaveBeenCalled());
    editor.input.end();
    await vi.waitFor(() => expect(signal.aborted).toBe(true));
  });
});

describe('turn failures', () => {
  it.each([
    ['submit rejects', () => Promise.reject(new Error('401 invalid x-api-key sk-secret'))],
    [
      'the turn fails',
      () => Promise.resolve({ turnId: 't', completed: Promise.reject(new Error('401 sk-secret')) }),
    ],
  ])('replies with a fixed error and keeps the cause local when %s', async (_label, submit) => {
    const fake = createFakeSession(submit);
    const { prompt, fixture } = await start(fake);
    const failure = await prompt('hi').catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: -32603, message: 'Turn failed' });
    expect(JSON.stringify(failure)).not.toContain('sk-secret');
    expect(fixture.deliveryErrors).toHaveLength(1);
    expect(fixture.deliveryErrors[0]).toMatchObject({ context: 'turn' });
    expect(fixture.deliveryErrors[0]!.error.message).toContain('sk-secret');
  });

  it('says so when a submission was dropped without running', async () => {
    const fake = createFakeSession(async () => ({
      turnId: 't',
      completed: Promise.reject(
        Object.assign(new Error('dropped'), { name: 'TurnNotRunError', reason: 'dropped' }),
      ),
    }));
    const { prompt } = await start(fake);
    await expect(prompt('hi')).rejects.toMatchObject({ code: -32603, message: 'Turn was not run' });
  });

  it('reports a failed update write once and still finishes the turn', async () => {
    const fake: IFakeSession = createFakeSession(async () => {
      fake.emit('text_delta', 'a');
      fake.emit('text_delta', 'b');
      fake.emit('text_delta', 'c');
      return endedTurn(executionResult('abc'));
    });
    const { prompt, fixture } = await start(fake);
    // The editor's end of the pipe is gone: no update can be written.
    fixture.editor.output.destroy();
    await prompt('hi').catch(() => undefined);
    await vi.waitFor(() => expect(fixture.deliveryErrors.length).toBeGreaterThan(0));
    expect(fixture.deliveryErrors.filter((e) => e.context === 'session/update')).toHaveLength(1);
    expect(fake.submit).toHaveBeenCalledTimes(1);
  });
});
