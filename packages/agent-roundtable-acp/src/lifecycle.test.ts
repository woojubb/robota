import { describe, expect, it } from 'vitest';

import { createFakeAgent, deferred } from './fake-agent';
import { acpParticipant } from './acp-participant';
import { CWD, executionOptions, openLease, participantFor, turnOf } from './test-support';

const reasonOf = (value: unknown): unknown => (value as { rejected: unknown }).rejected;

describe('host abort', () => {
  it('throws the abort reason with no partial text, and ends the session for later turns', async () => {
    const reason = new Error('the host stopped this run');
    const finishing = deferred();
    const finished = deferred();
    const fake = createFakeAgent({
      prompt: async (call) => {
        await call.chunk('partial words');
        await finishing.promise;
        await call.chunk(' and then more');
        // A round trip through the client: it has handled the chunk above before this answers.
        await call.requestPermission({
          toolCall: { toolCallId: 'sync' },
          options: [{ optionId: 'no', name: 'No', kind: 'reject_once' }],
        });
        finished.resolve();
        return { stopReason: 'end_turn' };
      },
    });
    const lease = await openLease(fake);
    const controller = new AbortController();
    const firstDelta = deferred();
    const deltas: string[] = [];
    const turn = lease.session
      .runTurn(
        turnOf(),
        executionOptions({
          signal: controller.signal,
          onDelta: async (text) => {
            deltas.push(text);
            firstDelta.resolve();
          },
        }),
      )
      .then(
        (outcome) => ({ resolved: outcome }),
        (rejected: unknown) => ({ rejected }),
      );
    await firstDelta.promise;
    controller.abort(reason);
    const result = await turn;
    expect(reasonOf(result)).toBe(reason);

    finishing.resolve();
    await finished.promise;
    // What the agent said after the abort reached nobody.
    expect(deltas).toEqual(['partial words']);

    const later = await lease.session
      .runTurn(turnOf([], { turnId: 'turn-2' }), executionOptions())
      .catch((error: unknown) => error);
    expect(later).toMatchObject({ code: 'session-dead' });
    expect(fake.prompts()).toHaveLength(1);
    await lease.release();
    expect(fake.closes()).toBe(1);
  });

  it('cancels a turn whose response settled alongside the abort', async () => {
    const reason = new Error('aborted while the last delta was delivered');
    const fake = createFakeAgent({
      prompt: async (call) => {
        await call.chunk('complete reply');
        return { stopReason: 'end_turn' };
      },
    });
    const lease = await openLease(fake);
    const controller = new AbortController();
    const result = await lease.session
      .runTurn(
        turnOf(),
        executionOptions({
          signal: controller.signal,
          onDelta: async () => {
            controller.abort(reason);
          },
        }),
      )
      .then(
        (outcome) => ({ resolved: outcome }),
        (rejected: unknown) => ({ rejected }),
      );
    expect(reasonOf(result)).toBe(reason);
    await expect(
      lease.session.runTurn(turnOf([], { turnId: 'turn-2' }), executionOptions()),
    ).rejects.toMatchObject({ code: 'session-dead' });
    await lease.release();
  });

  it('stops waiting for the last deltas when the host aborts after the response arrived', async () => {
    const reason = new Error('aborted while the last delta was still being delivered');
    const fake = createFakeAgent({
      prompt: async (call) => {
        await call.chunk('complete reply');
        return { stopReason: 'end_turn' };
      },
    });
    const lease = await openLease(fake);
    const controller = new AbortController();
    const deliveryStarted = deferred();
    const neverDelivered = deferred();
    const turn = lease.session
      .runTurn(
        turnOf(),
        executionOptions({
          signal: controller.signal,
          onDelta: async () => {
            deliveryStarted.resolve();
            await neverDelivered.promise;
          },
        }),
      )
      .then(
        (outcome) => ({ resolved: outcome }),
        (rejected: unknown) => ({ rejected }),
      );
    await deliveryStarted.promise;
    // The agent's answer is written; a round trip behind it returns only after the client has
    // handled that answer, so the turn is now waiting on its last delta alone.
    await fake.whenAgentWrote(
      (message) => message.result !== undefined && 'stopReason' in (message.result as object),
    );
    await fake.peer()!.request('session/request_permission', {
      sessionId: 'fake-session-1',
      toolCall: { toolCallId: 'sync' },
      options: [{ optionId: 'no', name: 'No', kind: 'reject_once' }],
    });
    controller.abort(reason);
    expect(reasonOf(await turn)).toBe(reason);
    await lease.release();
  });

  it('throws the abort reason without sending anything when the signal is already aborted', async () => {
    const reason = new Error('aborted before the turn started');
    const fake = createFakeAgent();
    const lease = await openLease(fake);
    const controller = new AbortController();
    controller.abort(reason);
    const error = await lease.session
      .runTurn(turnOf(), executionOptions({ signal: controller.signal }))
      .catch((rejected: unknown) => rejected);
    expect(error).toBe(reason);
    expect(fake.prompts()).toEqual([]);
    await lease.release();
  });
});

describe('one turn at a time', () => {
  it('refuses a second turn while one is running, and leaves the running one alone', async () => {
    const hold = deferred();
    const firstDelta = deferred();
    const fake = createFakeAgent({
      prompt: async (call) => {
        await call.chunk('the running turn');
        await hold.promise;
        return { stopReason: 'end_turn' };
      },
    });
    const lease = await openLease(fake);
    const first = lease.session.runTurn(
      turnOf(),
      executionOptions({
        onDelta: async () => {
          firstDelta.resolve();
        },
      }),
    );
    await firstDelta.promise;
    await expect(
      lease.session.runTurn(turnOf([], { turnId: 'turn-2' }), executionOptions()),
    ).rejects.toMatchObject({ code: 'turn-in-progress' });
    hold.resolve();
    expect(await first).toEqual({ kind: 'speak', content: 'the running turn' });
    expect(fake.prompts()).toHaveLength(1);
    // Once it has finished, the session takes the next turn.
    await lease.session.runTurn(turnOf([], { turnId: 'turn-3' }), executionOptions());
    expect(fake.prompts()).toHaveLength(2);
    await lease.release();
  });
});

describe('release', () => {
  it('is idempotent and ends the connection once', async () => {
    const fake = createFakeAgent();
    const lease = await openLease(fake);
    await Promise.all([lease.release(), lease.release()]);
    await lease.release();
    expect(fake.closes()).toBe(1);
  });

  it('refuses turns after it', async () => {
    const fake = createFakeAgent();
    const lease = await openLease(fake);
    await lease.release();
    await expect(lease.session.runTurn(turnOf(), executionOptions())).rejects.toMatchObject({
      code: 'session-released',
    });
    expect(fake.prompts()).toEqual([]);
  });

  it('fails a running turn rather than publishing from it', async () => {
    const started = deferred();
    const fake = createFakeAgent({
      prompt: async (call) => {
        await call.chunk('half a thought');
        started.resolve();
        return new Promise(() => {});
      },
    });
    const lease = await openLease(fake);
    const turn = lease.session.runTurn(turnOf(), executionOptions()).then(
      (outcome) => ({ resolved: outcome }),
      (rejected: unknown) => ({ rejected }),
    );
    await started.promise;
    await lease.release();
    expect(reasonOf(await turn)).toMatchObject({ code: 'connection-closed' });
  });

  it('reports a failed teardown to every caller and runs it once', async () => {
    const fake = createFakeAgent();
    const failure = new Error('the process would not stop');
    let attempts = 0;
    const participant = participantFor(fake, {
      launcher: {
        launch: async (context) => {
          const connection = await fake.launcher.launch(context);
          return {
            toAgent: connection.toAgent,
            fromAgent: connection.fromAgent,
            close: async () => {
              attempts += 1;
              await connection.close();
              throw failure;
            },
          };
        },
      },
    });
    const lease = await participant.factory.openSession({
      conversationId: 'c',
      participantId: 'acp',
    });
    await expect(lease.release()).rejects.toBe(failure);
    await expect(lease.release()).rejects.toBe(failure);
    expect(attempts).toBe(1);
  });
});

describe('participant declaration', () => {
  it('declares no model calls, no checkpoint and no continuation', async () => {
    const fake = createFakeAgent();
    const participant = participantFor(fake, { description: 'An outside agent' });
    expect(participant).toMatchObject({
      kind: 'agent',
      id: 'acp',
      description: 'An outside agent',
      runtime: { id: 'fixture/acp-agent', version: '1' },
    });
    expect(participant.factory.modelCalls).toBe('none');
    expect(participant.factory.supportsContinuation).toBeUndefined();
    expect(participant.factory.checkpointVersions).toBeUndefined();
    const lease = await participant.factory.openSession({
      conversationId: 'c',
      participantId: 'acp',
    });
    expect(lease.session.checkpoint).toBeUndefined();
    expect(lease.session.resumeTurn).toBeUndefined();
    await lease.release();
  });

  it('omits a description it was not given', () => {
    const participant = participantFor(createFakeAgent());
    expect('description' in participant).toBe(false);
  });

  it('opens a distinct connection for each session', async () => {
    const fake = createFakeAgent();
    const participant = participantFor(fake);
    const [first, second] = await Promise.all([
      participant.factory.openSession({ conversationId: 'c1', participantId: 'acp' }),
      participant.factory.openSession({ conversationId: 'c2', participantId: 'acp' }),
    ]);
    expect(fake.launches).toEqual([
      { conversationId: 'c1', participantId: 'acp' },
      { conversationId: 'c2', participantId: 'acp' },
    ]);
    await Promise.all([first.release(), second.release()]);
    expect(fake.closes()).toBe(2);
  });

  it.each([
    ['a relative working directory', { cwd: 'relative/dir' }],
    ['a zero startup timeout', { startupTimeoutMs: 0 }],
    ['a fractional startup timeout', { startupTimeoutMs: 1.5 }],
    ['a startup timeout no timer honors', { startupTimeoutMs: 2 ** 31 }],
    ['a startup timeout that is not a number', { startupTimeoutMs: Number.NaN }],
  ])('refuses %s', (_label, overrides) => {
    expect(() =>
      acpParticipant({
        id: 'acp',
        runtime: { id: 'fixture/acp-agent', version: '1' },
        cwd: CWD,
        launcher: createFakeAgent().launcher,
        ...overrides,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid-options' }));
  });
});
