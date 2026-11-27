import type { PermissionOption } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';

import { createFakeAgent, deferred } from './fake-agent';
import type { AcpPermissionApprover, AcpPermissionRequest } from './permission';
import { executionOptions, openLease, turnOf } from './test-support';

const allowOnce: PermissionOption = { optionId: 'yes', name: 'Allow', kind: 'allow_once' };
const allowAlways: PermissionOption = {
  optionId: 'yes-always',
  name: 'Always',
  kind: 'allow_always',
};
const rejectOnce: PermissionOption = { optionId: 'no', name: 'Reject', kind: 'reject_once' };
const rejectAlways: PermissionOption = {
  optionId: 'no-always',
  name: 'Never',
  kind: 'reject_always',
};

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const outcomeOf = (value: unknown): unknown => (value as { outcome: unknown }).outcome;
const settled = (promise: Promise<unknown>) =>
  promise.then(
    (resolved) => ({ resolved }),
    (rejected: unknown) => ({ rejected }),
  );

/** Runs one turn in which the agent asks permission once, and returns what it was told. */
async function askedWith(
  options: PermissionOption[],
  approver: AcpPermissionApprover | undefined,
): Promise<unknown> {
  const answers: unknown[] = [];
  const fake = createFakeAgent({
    prompt: async (call) => {
      answers.push(await call.requestPermission({ toolCall: { toolCallId: 'tool-1' }, options }));
      return { stopReason: 'end_turn' };
    },
  });
  const lease = await openLease(fake, approver ? { approver } : {});
  await lease.session.runTurn(turnOf(), executionOptions());
  await lease.release();
  expect(answers).toHaveLength(1);
  return answers[0];
}

describe('approver mapping', () => {
  it('maps allow to the one-time allow option, never to one that remembers', async () => {
    const answer = await askedWith([allowAlways, allowOnce, rejectAlways, rejectOnce], {
      decide: () => 'allow',
    });
    expect(answer).toEqual({ outcome: { outcome: 'selected', optionId: 'yes' } });
  });

  it('maps reject to the one-time reject option, never to one that remembers', async () => {
    const answer = await askedWith([rejectAlways, allowOnce, allowAlways, rejectOnce], {
      decide: () => 'reject',
    });
    expect(answer).toEqual({ outcome: { outcome: 'selected', optionId: 'no' } });
  });

  it('accepts an answer that arrives later', async () => {
    const answer = await askedWith([allowOnce, rejectOnce], {
      decide: async () => {
        await flush();
        return 'allow';
      },
    });
    expect(answer).toEqual({ outcome: { outcome: 'selected', optionId: 'yes' } });
  });

  it('refuses an allow when no one-time allow option is offered', async () => {
    const answer = await askedWith([allowAlways, rejectAlways, rejectOnce], {
      decide: () => 'allow',
    });
    expect(answer).toEqual({ outcome: { outcome: 'selected', optionId: 'no' } });
  });

  it('cancels when only options that remember a decision are offered', async () => {
    expect(await askedWith([allowAlways, rejectAlways], { decide: () => 'allow' })).toEqual({
      outcome: { outcome: 'cancelled' },
    });
    expect(await askedWith([allowAlways, rejectAlways], { decide: () => 'reject' })).toEqual({
      outcome: { outcome: 'cancelled' },
    });
  });

  it.each([
    [
      'throws',
      () => {
        throw new Error('the approver broke');
      },
    ],
    ['rejects', () => Promise.reject(new Error('the approver broke'))],
    ['answers with something else', () => 'yes'],
    ['answers with a boolean', () => true],
    ['answers with nothing', () => undefined],
  ])('refuses when the approver %s', async (_label, decide) => {
    const answer = await askedWith([allowOnce, rejectOnce], {
      decide: decide as AcpPermissionApprover['decide'],
    });
    expect(answer).toEqual({ outcome: { outcome: 'selected', optionId: 'no' } });
  });

  it('refuses every request when no approver is given, whatever is offered', async () => {
    expect(await askedWith([allowOnce, allowAlways, rejectOnce], undefined)).toEqual({
      outcome: { outcome: 'selected', optionId: 'no' },
    });
  });
});

describe('what the approver is shown', () => {
  it('gets the conversation and participant ids and the tool call as the agent sent it', async () => {
    const seen: AcpPermissionRequest[] = [];
    const fake = createFakeAgent({
      prompt: async (call) => {
        await call.requestPermission({
          toolCall: {
            toolCallId: 'tool-7',
            title: 'Delete the build folder',
            kind: 'delete',
            rawInput: { path: '/work/space/build', recursive: true },
            locations: [{ path: '/work/space/build', line: 3 }, { path: '/work/space/other' }],
          },
          options: [allowOnce, rejectOnce],
        });
        await call.requestPermission({
          toolCall: { toolCallId: 'tool-8', title: null, kind: null, locations: null },
          options: [allowOnce, rejectOnce],
        });
        return { stopReason: 'end_turn' };
      },
    });
    const lease = await openLease(fake, {
      approver: {
        decide: (request) => {
          seen.push(request);
          return 'reject';
        },
      },
    });
    await lease.session.runTurn(turnOf(), executionOptions());
    await lease.release();
    expect(seen).toEqual([
      {
        conversationId: 'conversation-1',
        participantId: 'acp',
        toolCall: {
          id: 'tool-7',
          title: 'Delete the build folder',
          kind: 'delete',
          rawInput: { path: '/work/space/build', recursive: true },
          locations: [{ path: '/work/space/build', line: 3 }, { path: '/work/space/other' }],
        },
      },
      { conversationId: 'conversation-1', participantId: 'acp', toolCall: { id: 'tool-8' } },
    ]);
  });
});

describe('requests the approver never sees', () => {
  const request = (sessionId: string) => ({
    sessionId,
    toolCall: { toolCallId: 'tool-1' },
    options: [allowOnce, rejectOnce],
  });

  it('refuses a request outside a running turn', async () => {
    let asked = 0;
    const fake = createFakeAgent();
    const lease = await openLease(fake, {
      approver: {
        decide: () => {
          asked += 1;
          return 'allow';
        },
      },
    });
    const answer = await fake
      .peer()!
      .request('session/request_permission', request('fake-session-1'));
    expect(answer).toEqual({ outcome: { outcome: 'selected', optionId: 'no' } });
    expect(asked).toBe(0);
    await lease.release();
  });

  it('refuses a request for another session while this one runs a turn', async () => {
    let asked = 0;
    const answers: unknown[] = [];
    const fake = createFakeAgent({
      prompt: async (call) => {
        answers.push(
          await call.requestPermission({
            ...request('some-other-session'),
            toolCall: { toolCallId: 'x' },
          }),
        );
        return { stopReason: 'end_turn' };
      },
    });
    const lease = await openLease(fake, {
      approver: {
        decide: () => {
          asked += 1;
          return 'allow';
        },
      },
    });
    await lease.session.runTurn(turnOf(), executionOptions());
    expect(answers).toEqual([{ outcome: { outcome: 'selected', optionId: 'no' } }]);
    expect(asked).toBe(0);
    await lease.release();
  });
});

describe('requests still waiting on the approver', () => {
  /** An agent that asks twice at once and records both answers before it ends its turn. */
  function askingTwice() {
    const answers: unknown[] = [];
    const answered = deferred();
    const fake = createFakeAgent({
      prompt: async (call) => {
        const both = await Promise.all([
          call.requestPermission({
            toolCall: { toolCallId: 'a' },
            options: [allowOnce, rejectOnce],
          }),
          call.requestPermission({
            toolCall: { toolCallId: 'b' },
            options: [allowOnce, rejectOnce],
          }),
        ]);
        answers.push(...both);
        answered.resolve();
        return { stopReason: 'cancelled' };
      },
    });
    return { fake, answers, answered };
  }

  function pendingApprover() {
    const signals: AbortSignal[] = [];
    const lateAnswers: ((value: 'allow' | 'reject') => void)[] = [];
    const asked = deferred();
    const approver: AcpPermissionApprover = {
      decide: (_request, { signal }) => {
        signals.push(signal);
        if (signals.length === 2) asked.resolve();
        return new Promise((resolve) => lateAnswers.push(resolve));
      },
    };
    return { approver, signals, lateAnswers, asked };
  }

  it('cancels every pending request, aborts the signal and ignores a late answer on a host abort', async () => {
    const { fake, answers, answered } = askingTwice();
    const { approver, signals, lateAnswers, asked } = pendingApprover();
    const lease = await openLease(fake, { approver });
    const controller = new AbortController();
    const reason = new Error('the host stopped this run');
    const turn = settled(
      lease.session.runTurn(turnOf(), executionOptions({ signal: controller.signal })),
    );
    await asked.promise;
    expect(signals.every((signal) => !signal.aborted)).toBe(true);

    controller.abort(reason);
    expect(await turn).toEqual({ rejected: reason });
    await answered.promise;
    expect(answers).toEqual([
      { outcome: { outcome: 'cancelled' } },
      { outcome: { outcome: 'cancelled' } },
    ]);
    expect(signals.every((signal) => signal.aborted)).toBe(true);

    for (const answer of lateAnswers) answer('allow');
    await flush();
    expect(answers).toHaveLength(2);
    expect(outcomeOf(answers[0])).toEqual({ outcome: 'cancelled' });
    await lease.release();
  });

  it('cancels them when the session is released', async () => {
    const { fake } = askingTwice();
    const { approver, signals, asked } = pendingApprover();
    const lease = await openLease(fake, { approver });
    const turn = settled(lease.session.runTurn(turnOf(), executionOptions()));
    await asked.promise;
    await lease.release();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(await turn).toMatchObject({ rejected: { code: 'connection-closed' } });
  });

  it('aborts the signal when the connection dies', async () => {
    const { fake } = askingTwice();
    const { approver, signals, asked } = pendingApprover();
    const lease = await openLease(fake, { approver });
    const turn = settled(lease.session.runTurn(turnOf(), executionOptions()));
    await asked.promise;
    fake.crash();
    expect(await turn).toMatchObject({ rejected: { code: 'connection-closed' } });
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    await lease.release();
  });

  it('cancels a request that arrives after the turn was aborted, without asking the approver', async () => {
    const gate = deferred();
    const answers: unknown[] = [];
    const answered = deferred();
    const fake = createFakeAgent({
      prompt: async (call) => {
        await gate.promise;
        answers.push(
          await call.requestPermission({
            toolCall: { toolCallId: 'late' },
            options: [allowOnce, rejectOnce],
          }),
        );
        answered.resolve();
        return { stopReason: 'cancelled' };
      },
    });
    let asked = 0;
    const lease = await openLease(fake, {
      approver: {
        decide: () => {
          asked += 1;
          return 'allow';
        },
      },
    });
    const controller = new AbortController();
    const turn = settled(
      lease.session.runTurn(turnOf(), executionOptions({ signal: controller.signal })),
    );
    while (fake.prompts().length === 0) await flush();
    controller.abort(new Error('stop'));
    await turn;
    gate.resolve();
    await answered.promise;
    expect(answers).toEqual([{ outcome: { outcome: 'cancelled' } }]);
    expect(asked).toBe(0);
    await lease.release();
  });
});
