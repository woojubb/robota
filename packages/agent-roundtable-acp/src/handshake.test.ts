import { afterEach, describe, expect, it, vi } from 'vitest';

import { AcpParticipantError } from './errors';
import { createFakeAgent, deferred } from './fake-agent';
import { CWD, executionOptions, openLease, participantFor, turnOf } from './test-support';

afterEach(() => {
  vi.useRealTimers();
});

describe('handshake', () => {
  it('sends exactly initialize and session/new, with no capability and no unstable field', async () => {
    const fake = createFakeAgent();
    const lease = await openLease(fake);
    expect(fake.wire.map((message) => message.method)).toEqual(['initialize', 'session/new']);
    // Parsed from the wire, so a field the SDK adds or a handler hides would show up here.
    expect(fake.wire[0].params).toStrictEqual({ protocolVersion: 1, clientCapabilities: {} });
    expect(fake.wire[1].params).toStrictEqual({ cwd: CWD, mcpServers: [] });
    expect(fake.launches).toEqual([{ conversationId: 'conversation-1', participantId: 'acp' }]);
    await lease.release();
  });

  it('sends the session id and one text block in a prompt, and nothing else', async () => {
    const fake = createFakeAgent({ sessionId: 'session-xyz' });
    const lease = await openLease(fake);
    await lease.session.runTurn(turnOf([], { purpose: 'Plan' }), executionOptions());
    const [prompt] = fake.wire.filter((message) => message.method === 'session/prompt');
    expect(prompt.params).toStrictEqual({
      sessionId: 'session-xyz',
      prompt: [{ type: 'text', text: 'Purpose: Plan' }],
    });
    // The whole conversation with the agent: no cancel, no extra notification, no capability call.
    expect(fake.wire.map((message) => message.method)).toEqual([
      'initialize',
      'session/new',
      'session/prompt',
    ]);
    await lease.release();
  });

  it('ignores unstable fields an agent returns', async () => {
    const fake = createFakeAgent({
      prompt: async (call) => {
        await call.chunk('fine');
        return {
          stopReason: 'end_turn',
          usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
          _meta: { anything: true },
        };
      },
    });
    const lease = await openLease(fake);
    const outcome = await lease.session.runTurn(turnOf(), executionOptions());
    expect(outcome).toEqual({ kind: 'speak', content: 'fine' });
    await lease.release();
  });

  it('fails on a protocol version other than 1 and ends the connection', async () => {
    const fake = createFakeAgent({ protocolVersion: 2 });
    const error = await openLease(fake).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(AcpParticipantError);
    expect(error).toMatchObject({ code: 'protocol-version-mismatch' });
    expect(fake.closes()).toBe(1);
    expect(fake.wire.map((message) => message.method)).toEqual(['initialize']);
  });

  it.each([
    ['initialize', { initialize: 'fail' as const }],
    ['session/new', { newSession: 'fail' as const }],
  ])('fails the open and ends the connection when %s is refused', async (_method, behavior) => {
    const fake = createFakeAgent(behavior);
    await expect(openLease(fake)).rejects.toMatchObject({ code: 'handshake-failed' });
    expect(fake.closes()).toBe(1);
  });

  it('fails the open when the agent names no session', async () => {
    const fake = createFakeAgent({ sessionId: '' });
    await expect(openLease(fake)).rejects.toMatchObject({ code: 'handshake-failed' });
    expect(fake.closes()).toBe(1);
  });

  it('passes a launcher failure through untouched', async () => {
    const failure = new Error('could not start');
    const participant = participantFor(createFakeAgent(), {
      launcher: {
        launch: async () => {
          throw failure;
        },
      },
    });
    await expect(
      participant.factory.openSession({ conversationId: 'c', participantId: 'acp' }),
    ).rejects.toBe(failure);
  });
});

describe('startup timeout', () => {
  it.each([
    ['initialize', { initialize: 'hang' as const }],
    ['session/new', { newSession: 'hang' as const }],
  ])('ends a connection whose agent never answers %s', async (_method, behavior) => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fake = createFakeAgent(behavior);
    const opening = openLease(fake, { startupTimeoutMs: 5_000 });
    const outcome = opening.catch((reason: unknown) => reason);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fake.closes()).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toMatchObject({ code: 'startup-timeout' });
    expect(fake.closes()).toBe(1);
  });

  it('ends a connection that arrives after the bound has passed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const gate = deferred();
    const fake = createFakeAgent({}, { launchGate: gate.promise });
    const outcome = openLease(fake, { startupTimeoutMs: 1_000 }).catch((reason: unknown) => reason);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await outcome).toMatchObject({ code: 'startup-timeout' });
    expect(fake.closes()).toBe(0);
    gate.resolve();
    await fake.whenClosed();
    // The late connection was ended before any handshake message left.
    expect(fake.wire).toEqual([]);
  });

  it('does not end a connection that opened within the bound', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const fake = createFakeAgent();
    const lease = await openLease(fake, { startupTimeoutMs: 1_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fake.closes()).toBe(0);
    await lease.release();
  });
});

describe('what the client side offers the agent', () => {
  it('answers an agent request it did not advertise as an unknown method', async () => {
    const fake = createFakeAgent({
      prompt: async (call) => {
        const attempts = await Promise.allSettled([
          call.peer.request('fs/read_text_file', { sessionId: call.sessionId, path: '/etc/hosts' }),
          call.peer.request('terminal/create', { sessionId: call.sessionId, command: 'ls' }),
        ]);
        await call.chunk(
          attempts
            .map((attempt) =>
              attempt.status === 'rejected'
                ? String((attempt.reason as { code: number }).code)
                : 'ok',
            )
            .join(','),
        );
        return { stopReason: 'end_turn' };
      },
    });
    const lease = await openLease(fake);
    const outcome = await lease.session.runTurn(turnOf(), executionOptions());
    expect(outcome).toEqual({ kind: 'speak', content: '-32601,-32601' });
    await lease.release();
  });

  it('rejects a permission request with the one-time reject option', async () => {
    const answers: unknown[] = [];
    const fake = createFakeAgent({
      prompt: async (call) => {
        answers.push(
          await call.requestPermission({
            toolCall: { toolCallId: 'tool-1' },
            options: [
              { optionId: 'yes-always', name: 'Always', kind: 'allow_always' },
              { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
              { optionId: 'no-always', name: 'Never', kind: 'reject_always' },
              { optionId: 'no', name: 'Reject', kind: 'reject_once' },
            ],
          }),
        );
        return { stopReason: 'end_turn' };
      },
    });
    const lease = await openLease(fake);
    await lease.session.runTurn(turnOf(), executionOptions());
    expect(answers).toEqual([{ outcome: { outcome: 'selected', optionId: 'no' } }]);
    await lease.release();
  });

  it('cancels a permission request that offers no one-time reject option, never allowing it', async () => {
    const answers: unknown[] = [];
    const fake = createFakeAgent({
      prompt: async (call) => {
        answers.push(
          await call.requestPermission({
            toolCall: { toolCallId: 'tool-1' },
            options: [
              { optionId: 'yes-always', name: 'Always', kind: 'allow_always' },
              { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
              { optionId: 'no-always', name: 'Never', kind: 'reject_always' },
            ],
          }),
        );
        return { stopReason: 'end_turn' };
      },
    });
    const lease = await openLease(fake);
    await lease.session.runTurn(turnOf(), executionOptions());
    expect(answers).toEqual([{ outcome: { outcome: 'cancelled' } }]);
    await lease.release();
  });

  it('rejects a permission request that arrives outside any turn', async () => {
    const fake = createFakeAgent();
    const lease = await openLease(fake);
    const peer = fake.peer();
    const answer = await peer!.request('session/request_permission', {
      sessionId: 'fake-session-1',
      toolCall: { toolCallId: 'tool-1' },
      options: [
        { optionId: 'yes', name: 'Allow', kind: 'allow_once' },
        { optionId: 'no', name: 'Reject', kind: 'reject_once' },
      ],
    });
    expect(answer).toEqual({ outcome: { outcome: 'selected', optionId: 'no' } });
    await lease.release();
  });
});
