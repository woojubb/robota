import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { FunctionTool, clearRegisteredToolProfiles } from '@robota-sdk/agent-core';
import type {
  IAIProvider,
  IRecoverableExecutionJournal,
  TExecutionJournalRecord,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import { createDefaultTools } from '@robota-sdk/agent-tool-defaults';
import {
  createRoundtable,
  loadRoundtable,
  MemoryConversationStore,
  type JsonValue,
  type ModelCallIntent,
  type ParticipantExecutionOptions,
  type ParticipantResponse,
  type ParticipantTurn,
  type RoundtableRegistry,
  type SharedMessage,
  type TurnServices,
} from '@robota-sdk/agent-roundtable';
import { createInProcessJournal } from './in-process-journal';
import { sessionParticipant, type SessionHostOptions } from './session-participant';

/** Build the `ParticipantResponse` a host would send back for one approval wait request. */
function approvalResponse(
  t: ParticipantTurn,
  request: { id: string; reason: string; data: unknown },
  responseId: string,
  approved: boolean,
): ParticipantResponse {
  return {
    request: {
      id: request.id,
      reason: request.reason,
      kind: 'approval',
      participantId: t.participantId,
      groupId: t.groupId,
      turnId: t.turnId,
      memberId: t.participantId,
      data: request.data as JsonValue,
    },
    responseId,
    response: { kind: 'approval', approved },
  };
}

afterEach(() => {
  clearRegisteredToolProfiles();
});

function noServices(): TurnServices {
  return { admitModelCall: async () => {}, recordUsage: async () => {} };
}

function limitedServices(maxCalls: number): TurnServices & { calls: ModelCallIntent[] } {
  const calls: ModelCallIntent[] = [];
  return {
    calls,
    admitModelCall: async (call) => {
      if (calls.length >= maxCalls) throw new Error('model-call limit reached');
      calls.push(call);
    },
    recordUsage: async () => {},
  };
}

function turn(overrides: Partial<ParticipantTurn> = {}): ParticipantTurn {
  return {
    conversationId: 'c1',
    participantId: 'p1',
    turnId: 't1',
    attemptId: 'a1',
    groupId: 'g1',
    context: { baseRevision: 0, messages: [] },
    ...overrides,
  };
}

function execOptions(
  overrides: Partial<ParticipantExecutionOptions> = {},
): ParticipantExecutionOptions {
  return {
    signal: new AbortController().signal,
    onDelta: async () => {},
    services: noServices(),
    ...overrides,
  };
}

function hostOptions(
  provider: IAIProvider,
  extra: Partial<SessionHostOptions> = {},
): SessionHostOptions {
  return {
    cwd: process.cwd(),
    tools: [],
    provider,
    systemMessage: 'Fixture host',
    model: 'test-model',
    autoCompactThreshold: false,
    ...extra,
  };
}

describe('sessionParticipant: speak path', () => {
  it('opens a distinct, isolated Session per conversation/participant pair', async () => {
    const a = createScriptedProvider([{ text: 'a says hi' }]);
    const b = createScriptedProvider([{ text: 'b says hi' }]);
    const participant = sessionParticipant({
      id: 'p',
      runtime: { id: 'fixture/session', version: '1' },
      createSessionOptions: async (ctx) =>
        hostOptions(ctx.participantId === 'A' ? a.provider : b.provider),
    });
    const leaseA = await participant.factory.openSession({
      conversationId: 'convA',
      participantId: 'A',
    });
    const leaseB = await participant.factory.openSession({
      conversationId: 'convB',
      participantId: 'B',
    });
    const outcomeA = await leaseA.session.runTurn(
      turn({ conversationId: 'convA', participantId: 'A' }),
      execOptions(),
    );
    const outcomeB = await leaseB.session.runTurn(
      turn({ conversationId: 'convB', participantId: 'B' }),
      execOptions(),
    );
    expect(outcomeA).toEqual({ kind: 'speak', content: 'a says hi' });
    expect(outcomeB).toEqual({ kind: 'speak', content: 'b says hi' });
    await leaseA.release();
    await leaseB.release();
  });

  it('rejects opening a second lease that reuses a still-held provider', async () => {
    const shared = createScriptedProvider([{ text: 'x' }]);
    const participant = sessionParticipant({
      id: 'p',
      runtime: { id: 'fixture/session', version: '1' },
      createSessionOptions: async () => hostOptions(shared.provider),
    });
    const lease = await participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    await expect(
      participant.factory.openSession({ conversationId: 'c', participantId: 'B' }),
    ).rejects.toMatchObject({ code: 'resource-reused' });
    await lease.release();
    await expect(
      participant.factory.openSession({ conversationId: 'c', participantId: 'B' }),
    ).resolves.toBeDefined();
  });

  it('sends the peer increment once, quoted, and never resends the purpose after the first turn', async () => {
    const scripted = createScriptedProvider([{ text: 'ack 1' }, { text: 'ack 2' }]);
    const participant = sessionParticipant({
      id: 'p',
      runtime: { id: 'fixture/session', version: '1' },
      createSessionOptions: async () => hostOptions(scripted.provider),
    });
    const lease = await participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    await lease.session.runTurn(
      turn({ purpose: 'Plan the launch', context: { baseRevision: 0, messages: [] } }),
      execOptions(),
    );
    const peerMessage: SharedMessage = {
      id: 'm1',
      participantId: 'peer',
      content: 'the peer said this',
      revision: 1,
      turnId: 't0',
      groupId: 'g0',
    };
    await lease.session.runTurn(
      turn({
        turnId: 't2',
        purpose: 'Plan the launch',
        context: { baseRevision: 1, messages: [peerMessage] },
      }),
      execOptions(),
    );
    const secondRequest = scripted.requests[1]!;
    const latestUserMessage = [...secondRequest].reverse().find((m) => m.role === 'user');
    expect(latestUserMessage?.content).toContain('the peer said this');
    expect((latestUserMessage?.content as string).match(/the peer said this/g)).toHaveLength(1);
    expect(latestUserMessage?.content).not.toContain('Plan the launch');
    await lease.release();
  });

  // Empty/whitespace-only-reply -> `yield` is a pure mapping (`toCompletionOutcome`, see
  // outcome.test.ts): the real execution pipeline discards a blank round and retries rather than
  // ever settling a Session turn on one, so it is not reachable through a full Session run here.

  it('delivers deltas to onDelta in order, fully drained before the outcome resolves', async () => {
    const scripted = createScriptedProvider([{ text: 'hello world' }]);
    const participant = sessionParticipant({
      id: 'p',
      runtime: { id: 'fixture/session', version: '1' },
      createSessionOptions: async () => hostOptions(scripted.provider),
    });
    const lease = await participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    const received: string[] = [];
    const outcome = await lease.session.runTurn(
      turn(),
      execOptions({
        onDelta: async (text) => {
          received.push(text);
        },
      }),
    );
    expect(received).toEqual(['hello world']);
    expect(outcome).toEqual({ kind: 'speak', content: 'hello world' });
    await lease.release();
  });

  it('throws the abort signal reason on cancellation, publishing no partial speak', async () => {
    const blocking: IAIProvider = {
      name: 'blocking',
      version: 'test',
      chat: () => new Promise(() => {}),
      generateResponse: async () => ({ content: '' }),
      supportsTools: () => true,
      validateConfig: () => true,
    };
    const participant = sessionParticipant({
      id: 'p',
      runtime: { id: 'fixture/session', version: '1' },
      createSessionOptions: async () => hostOptions(blocking),
    });
    const lease = await participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    const controller = new AbortController();
    const running = lease.session.runTurn(turn(), execOptions({ signal: controller.signal }));
    controller.abort(new Error('cancelled by host'));
    await expect(running).rejects.toThrow('cancelled by host');
    await lease.release();
  });

  // MUST 3: the run underneath RESOLVES on abort (agent-core CORE-027) with the text it had
  // committed so far, marked `interrupted` — it never rejects on its own, so a check only in
  // `catch` (the test above) misses this path entirely. A tool call combined with real text in the
  // SAME assistant message, whose own effect aborts mid round, reproduces exactly that: the round
  // loop stops after the tool with no further round, so that committed text resolves as the
  // execution's response while `signal.aborted` is already true.
  it('MUST 3: throws the abort reason instead of publishing text committed during a cancelled tool round', async () => {
    const controller = new AbortController();
    const provider: IAIProvider = {
      name: 'abort-mid-tool-round',
      version: 'test',
      async chat(): Promise<TUniversalMessage> {
        return {
          id: 'r1',
          role: 'assistant',
          content: 'partial reasoning before the abort',
          state: 'complete',
          timestamp: new Date(),
          toolCalls: [
            { id: 'call-1', type: 'function', function: { name: 'act', arguments: '{}' } },
          ],
        };
      },
      async generateResponse() {
        return { content: '' };
      },
      supportsTools: () => true,
      validateConfig: () => true,
    };
    const tool = new FunctionTool(
      { name: 'act', description: 'Fixture', parameters: { type: 'object', properties: {} } },
      async () => {
        controller.abort(new Error('cancelled mid tool round'));
        return 'tool done';
      },
    );
    const participant = sessionParticipant({
      id: 'p',
      runtime: { id: 'fixture/session', version: '1' },
      createSessionOptions: async () =>
        hostOptions(provider, {
          tools: [tool],
          permissions: { allow: ['act'], deny: [], ask: [] },
        }),
    });
    const lease = await participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    // The turn must reject rather than settle — settling (with any outcome at all) is what would
    // let this cancelled turn's text reach the shared transcript on the next run. Streamed deltas
    // (a live, ephemeral preview, delivered as the round produces them) are a separate contract
    // from the turn's final outcome and are not asserted here.
    await expect(
      lease.session.runTurn(turn(), execOptions({ signal: controller.signal })),
    ).rejects.toThrow('cancelled mid tool round');
    await lease.release();
  });

  it('releases exactly once: a second release() call is a harmless no-op', async () => {
    const scripted = createScriptedProvider([{ text: 'x' }]);
    const participant = sessionParticipant({
      id: 'p',
      runtime: { id: 'fixture/session', version: '1' },
      createSessionOptions: async () => hostOptions(scripted.provider),
    });
    const lease = await participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    await lease.release();
    await expect(lease.release()).resolves.toBeUndefined();
    // The resource guard was released exactly once: the same provider can be leased again.
    await expect(
      participant.factory.openSession({ conversationId: 'c', participantId: 'A' }),
    ).resolves.toBeDefined();
  });

  it('runs two participants in parallel: both dispatch to the provider before either resolves', async () => {
    let entered = 0;
    let releaseFirst!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    function barrierProvider(name: string, text: string): IAIProvider {
      return {
        name,
        version: 'test',
        async chat(): Promise<TUniversalMessage> {
          entered += 1;
          if (entered < 2) await gate;
          else releaseFirst();
          return {
            id: `${name}-1`,
            role: 'assistant',
            content: text,
            state: 'complete',
            timestamp: new Date(),
          };
        },
        async generateResponse() {
          return { content: '' };
        },
        supportsTools: () => true,
        validateConfig: () => true,
      };
    }
    const providerA = barrierProvider('a', 'from a');
    const providerB = barrierProvider('b', 'from b');
    const participantA = sessionParticipant({
      id: 'A',
      runtime: { id: 'fixture/session', version: '1' },
      createSessionOptions: async () => hostOptions(providerA),
    });
    const participantB = sessionParticipant({
      id: 'B',
      runtime: { id: 'fixture/session', version: '1' },
      createSessionOptions: async () => hostOptions(providerB),
    });
    const leaseA = await participantA.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    const leaseB = await participantB.factory.openSession({
      conversationId: 'c',
      participantId: 'B',
    });
    const [outcomeA, outcomeB] = await Promise.all([
      leaseA.session.runTurn(turn({ participantId: 'A' }), execOptions()),
      leaseB.session.runTurn(turn({ participantId: 'B' }), execOptions()),
    ]);
    expect(outcomeA).toEqual({ kind: 'speak', content: 'from a' });
    expect(outcomeB).toEqual({ kind: 'speak', content: 'from b' });
    await leaseA.release();
    await leaseB.release();
  });

  it('admits every provider call before dispatch: a spent limit stops a tool round before its second call', async () => {
    const scripted = createScriptedProvider([
      { toolCalls: [{ name: 'act', args: {} }] },
      { text: 'must not run' },
    ]);
    const tool = new FunctionTool(
      { name: 'act', description: 'Fixture', parameters: { type: 'object', properties: {} } },
      async () => 'ok',
    );
    const participant = sessionParticipant({
      id: 'p',
      runtime: { id: 'fixture/session', version: '1' },
      createSessionOptions: async () =>
        hostOptions(scripted.provider, {
          tools: [tool],
          permissions: { allow: ['act'], deny: [], ask: [] },
        }),
    });
    const lease = await participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    const services = limitedServices(1);
    let caught: unknown;
    try {
      await lease.session.runTurn(turn(), execOptions({ services }));
    } catch (error) {
      caught = error;
    }
    // The journal wraps the admission rejection (ExecutionJournalError); the original reason is its cause.
    expect((caught as { cause?: unknown })?.cause ?? caught).toMatchObject({
      message: 'model-call limit reached',
    });
    expect(scripted.requests).toHaveLength(1);
    await lease.release();
  });

  // MUST 4: `createDefaultTools` used to return the SAME `webFetchTool`/`webSearchTool` module
  // singletons on every call, so two sessionParticipants each built from it — even from two
  // entirely separate `createDefaultTools({cwd})` calls, sharing nothing on purpose — collided in
  // the resource guard the moment both were open at once.
  it('MUST 4: two participants each built from a separate createDefaultTools({cwd}) open together', async () => {
    const base = mkdtempSync(join(tmpdir(), 'roundtable-robota-default-tools-'));
    mkdirSync(join(base, 'A'));
    mkdirSync(join(base, 'B'));
    try {
      const a = createScriptedProvider([{ text: 'from a' }]);
      const b = createScriptedProvider([{ text: 'from b' }]);
      const participant = sessionParticipant({
        id: 'p',
        runtime: { id: 'fixture/session', version: '1' },
        createSessionOptions: async (ctx) =>
          hostOptions(ctx.participantId === 'A' ? a.provider : b.provider, {
            cwd: join(base, ctx.participantId),
            tools: createDefaultTools({ cwd: join(base, ctx.participantId) }),
          }),
      });
      const leaseA = await participant.factory.openSession({
        conversationId: 'c',
        participantId: 'A',
      });
      const leaseB = await participant.factory.openSession({
        conversationId: 'c',
        participantId: 'B',
      });
      const outcomeA = await leaseA.session.runTurn(turn({ participantId: 'A' }), execOptions());
      const outcomeB = await leaseB.session.runTurn(turn({ participantId: 'B' }), execOptions());
      expect(outcomeA).toEqual({ kind: 'speak', content: 'from a' });
      expect(outcomeB).toEqual({ kind: 'speak', content: 'from b' });
      await leaseA.release();
      await leaseB.release();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe('sessionParticipant: approval waits and checkpoints', () => {
  function approvalFixture(
    overrides: { journal?: Parameters<typeof sessionParticipant>[0]['journal'] } = {},
  ) {
    const scripted = createScriptedProvider([
      { toolCalls: [{ name: 'act', args: {} }] },
      { text: 'finished' },
    ]);
    const effect = vi.fn(async () => 'effect result');
    const tool = new FunctionTool(
      { name: 'act', description: 'Fixture', parameters: { type: 'object', properties: {} } },
      effect,
    );
    const participant = sessionParticipant({
      id: 'p',
      runtime: { id: 'fixture/session', version: '1' },
      createSessionOptions: async () =>
        hostOptions(scripted.provider, {
          tools: [tool],
          permissions: { allow: [], deny: [], ask: ['act'] },
        }),
      ...overrides,
    });
    return { scripted, effect, tool, participant };
  }

  it('maps an approval wait with the exact core identity, without running the effect', async () => {
    const f = approvalFixture();
    const lease = await f.participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    const outcome = await lease.session.runTurn(turn(), execOptions());
    expect(outcome.kind).toBe('wait');
    if (outcome.kind !== 'wait') throw new Error('expected wait');
    expect(outcome.requests).toHaveLength(1);
    expect(outcome.requests[0]).toMatchObject({
      kind: 'approval',
      data: { toolName: 'act', arguments: {} },
    });
    expect(typeof outcome.requests[0].id).toBe('string');
    const requestData = (outcome.requests[0] as unknown as { data: { executionId?: unknown } })
      .data;
    expect(requestData.executionId).toBeTruthy();
    expect(f.effect).not.toHaveBeenCalled();
    await lease.release();
  });

  it('resumes without new input and runs the effect exactly once', async () => {
    const f = approvalFixture();
    const lease = await f.participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    const t = turn();
    const waitOutcome = await lease.session.runTurn(t, execOptions());
    if (waitOutcome.kind !== 'wait') throw new Error('expected wait');
    const request = waitOutcome.requests[0] as unknown as {
      id: string;
      reason: string;
      data: unknown;
    };
    const responses = [approvalResponse(t, request, 'reply-1', true)];
    const finalOutcome = await lease.session.resumeTurn!(t, responses, execOptions());
    expect(finalOutcome).toEqual({ kind: 'speak', content: 'finished' });
    expect(f.effect).toHaveBeenCalledOnce();
    await lease.release();
  });

  // Optional: the SPEC claims "denying it completes the turn without ever entering the tool's
  // effect", but only the APPROVED half of that sentence had a test.
  it('completes the turn without running the effect when the approval is denied', async () => {
    const f = approvalFixture();
    const lease = await f.participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    const t = turn();
    const waitOutcome = await lease.session.runTurn(t, execOptions());
    if (waitOutcome.kind !== 'wait') throw new Error('expected wait');
    const request = waitOutcome.requests[0] as unknown as {
      id: string;
      reason: string;
      data: unknown;
    };
    const responses = [approvalResponse(t, request, 'reply-1', false)];
    const finalOutcome = await lease.session.resumeTurn!(t, responses, execOptions());
    expect(finalOutcome).toEqual({ kind: 'speak', content: 'finished' });
    expect(f.effect).not.toHaveBeenCalled();
    await lease.release();
  });

  // SHOULD 7: the default in-process journal never freed a settled execution's records. Once this
  // resume settles with no wait parked, the parked execution's records (message arrays included)
  // must be gone from the module-level store the default journal used underneath.
  it('SHOULD 7: drops the parked execution journal records once the resume settles', async () => {
    const f = approvalFixture();
    const lease = await f.participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    const t = turn();
    const waitOutcome = await lease.session.runTurn(t, execOptions());
    if (waitOutcome.kind !== 'wait') throw new Error('expected wait');
    const request = waitOutcome.requests[0] as unknown as {
      id: string;
      reason: string;
      data: { executionId: string };
    };
    const executionId = request.data.executionId;
    const checkpointDuringWait = await lease.session.checkpoint!();
    const sessionId = (checkpointDuringWait.data as Record<string, unknown>).sessionId as string;
    // Sanity: the parked execution really is journaled before it resolves.
    await expect(createInProcessJournal(sessionId).read(executionId)).resolves.not.toEqual([]);

    const responses = [approvalResponse(t, request, 'reply-1', true)];
    await lease.session.resumeTurn!(t, responses, execOptions());

    await expect(createInProcessJournal(sessionId).read(executionId)).resolves.toEqual([]);
    await lease.release();
  });

  it('rejects a mismatched response with identity-mismatch', async () => {
    const f = approvalFixture();
    const lease = await f.participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    const t = turn();
    const waitOutcome = await lease.session.runTurn(t, execOptions());
    if (waitOutcome.kind !== 'wait') throw new Error('expected wait');
    const responses = [
      approvalResponse(
        t,
        { id: 'not-the-real-request-id', reason: 'x', data: {} },
        'reply-1',
        true,
      ),
    ];
    await expect(lease.session.resumeTurn!(t, responses, execOptions())).rejects.toMatchObject({
      code: 'identity-mismatch',
    });
    await lease.release();
  });

  it('fails an unsupported wait kind with unsupported-wait, exposing no request', async () => {
    const scripted = createScriptedProvider([{ toolCalls: [{ name: 'act', args: {} }] }]);
    const base = new FunctionTool(
      { name: 'act', description: 'Fixture', parameters: { type: 'object', properties: {} } },
      async () => 'ok',
    );
    const tool = Object.assign(base, {
      executeWithAdmission: async (
        parameters: Parameters<typeof base.execute>[0],
        context: Parameters<typeof base.execute>[1],
      ) => {
        const continuation = (
          context as {
            continuation?: { request(prompt: { kind: string; data: unknown }): Promise<unknown> };
          }
        ).continuation;
        await continuation?.request({ kind: 'custom/other-wait', data: {} });
        return base.execute(parameters, context);
      },
    });
    const participant = sessionParticipant({
      id: 'p',
      runtime: { id: 'fixture/session', version: '1' },
      createSessionOptions: async () =>
        hostOptions(scripted.provider, {
          tools: [tool],
          permissions: { allow: ['act'], deny: [], ask: [] },
        }),
    });
    const lease = await participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    await expect(lease.session.runTurn(turn(), execOptions())).rejects.toMatchObject({
      code: 'unsupported-wait',
    });
    await lease.release();
  });

  it('rejects resuming when the journal has no records for the parked execution', async () => {
    const f = approvalFixture({ journal: () => freshJournal() });
    const lease = await f.participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    const t = turn();
    const waitOutcome = await lease.session.runTurn(t, execOptions());
    if (waitOutcome.kind !== 'wait') throw new Error('expected wait');
    const request = waitOutcome.requests[0] as unknown as {
      id: string;
      reason: string;
      data: unknown;
    };
    const responses = [approvalResponse(t, request, 'reply-1', true)];
    await expect(lease.session.resumeTurn!(t, responses, execOptions())).rejects.toMatchObject({
      code: 'journal-missing',
    });
    await lease.release();
  });

  it('restores a settled checkpoint with real Date timestamps, and rejects a cwd mismatch', async () => {
    const scripted = createScriptedProvider([{ text: 'first reply' }]);
    const participant = sessionParticipant({
      id: 'p',
      runtime: { id: 'fixture/session', version: '1' },
      createSessionOptions: async () => hostOptions(scripted.provider),
    });
    const lease = await participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
    });
    await lease.session.runTurn(turn(), execOptions());
    const checkpoint = await lease.session.checkpoint!();
    await lease.release();
    expect(checkpoint.version).toBe('robota-session/1');
    expect(JSON.stringify(checkpoint)).not.toMatch(/apiKey|api_key|secret/i);

    const restored = await participant.factory.openSession({
      conversationId: 'c',
      participantId: 'A',
      checkpoint,
    });
    expect(await restored.session.checkpoint!()).toEqual(checkpoint);
    await restored.release();

    await expect(
      participant.factory.openSession({
        conversationId: 'c',
        participantId: 'A',
        checkpoint: {
          ...checkpoint,
          data: { ...(checkpoint.data as Record<string, unknown>), cwd: '/different' },
        },
      }),
    ).rejects.toMatchObject({ code: 'checkpoint-invalid' });
  });
});

describe('sessionParticipant: loadRoundtable resumes a parked wait', () => {
  it('resumes the parked approval wait after a fresh Conversation reloads the same participant', async () => {
    const scripted = createScriptedProvider([
      { toolCalls: [{ name: 'act', args: {} }] },
      { text: 'resumed after reload' },
    ]);
    const effect = vi.fn(async () => 'effect result');
    const tool = new FunctionTool(
      { name: 'act', description: 'Fixture', parameters: { type: 'object', properties: {} } },
      effect,
    );
    const participant = sessionParticipant({
      id: 'p',
      runtime: { id: 'fixture/session', version: '1' },
      createSessionOptions: async () =>
        hostOptions(scripted.provider, {
          tools: [tool],
          permissions: { allow: [], deny: [], ask: ['act'] },
        }),
    });
    const store = new MemoryConversationStore();
    const room = createRoundtable({
      conversationId: 'reload-conv',
      store,
      participants: [participant],
      limits: { maxTurnsPerRun: 1 },
    });
    const waiting = await room.run();
    expect(waiting.status).toBe('waiting');
    if (waiting.status !== 'waiting') throw new Error('expected waiting');
    const request = waiting.requests[0];
    await room.dispose();

    const registry: RoundtableRegistry = {
      resolveParticipant: async () => ({
        reference: participant.runtime,
        factory: participant.factory,
      }),
    };
    const reloaded = await loadRoundtable({ conversationId: 'reload-conv', store, registry });
    await reloaded.resume({
      requestId: request.id,
      responseId: 'reply-1',
      expectedRevision: reloaded.snapshot().revision,
      response: { kind: 'approval', approved: true },
    });
    const result = await reloaded.run();
    expect(result.status === 'limited' || result.status === 'completed').toBe(true);
    expect(effect).toHaveBeenCalledOnce();
    expect(reloaded.snapshot().messages.some((m) => m.content === 'resumed after reload')).toBe(
      true,
    );
    await reloaded.dispose();
  });

  // Optional: renamed — this asserts the factory's OWN checkpointVersions includes the version of
  // the checkpoint it itself just produced. It never opens a mismatched factory, so it was never
  // a rejection test, despite its old name.
  it("lists its checkpoint's version in factory.checkpointVersions", async () => {
    const scripted = createScriptedProvider([{ text: 'x' }]);
    const original = sessionParticipant({
      id: 'p',
      runtime: { id: 'fixture/session', version: '1' },
      createSessionOptions: async () => hostOptions(scripted.provider),
    });
    const lease = await original.factory.openSession({ conversationId: 'c', participantId: 'A' });
    await lease.session.runTurn(turn(), execOptions());
    const checkpoint = await lease.session.checkpoint!();
    await lease.release();
    expect(original.factory.checkpointVersions).toContain(checkpoint.version);
  });
});

// Optional: `options.journal()` used to run OUTSIDE the guard that released the lease on failure,
// so a host factory that threw left the provider/tools permanently claimed — no later openSession
// over them could ever succeed again in this process.
describe('sessionParticipant: lease safety on openSession failure', () => {
  it('releases the lease when a host journal factory throws while opening', async () => {
    const scripted = createScriptedProvider([]);
    let calls = 0;
    const participant = sessionParticipant({
      id: 'p',
      runtime: { id: 'fixture/session', version: '1' },
      createSessionOptions: async () => hostOptions(scripted.provider),
      journal: () => {
        calls += 1;
        if (calls === 1) throw new Error('journal unavailable');
        return freshJournal();
      },
    });
    await expect(
      participant.factory.openSession({ conversationId: 'c', participantId: 'A' }),
    ).rejects.toThrow('journal unavailable');
    // The lease was released on failure: opening again over the same provider now succeeds, even
    // though the SAME participant (and so the same provider) is reused.
    await expect(
      participant.factory.openSession({ conversationId: 'c', participantId: 'A' }),
    ).resolves.toBeDefined();
  });
});

describe('sessionParticipant: cancellation while a delta is in flight', () => {
  it('ends the run cancelled and raises no unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);
    const controller = new AbortController();
    const provider: IAIProvider = {
      name: 'streamer',
      version: 'test',
      async chat(_messages, options): Promise<TUniversalMessage> {
        for (const chunk of ['one ', 'two ', 'three ']) {
          (options as { onTextDelta?: (text: string) => void } | undefined)?.onTextDelta?.(chunk);
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        if ((options as { signal?: AbortSignal } | undefined)?.signal?.aborted)
          throw (options as { signal: AbortSignal }).signal.reason;
        return {
          id: 'r1',
          role: 'assistant',
          content: 'one two three',
          state: 'complete',
          timestamp: new Date(),
        };
      },
      async generateResponse() {
        return { content: '' };
      },
      supportsTools: () => false,
      validateConfig: () => true,
    };
    const room = createRoundtable({
      conversationId: 'crash-probe-session',
      participants: [
        sessionParticipant({
          id: 'a',
          runtime: { id: 'fixture/session', version: '1' },
          createSessionOptions: async () => hostOptions(provider),
        }),
      ],
      limits: { maxTurnsPerRun: 1 },
      // Slow enough (an awaited host handler, e.g. writing a delta out to a socket) that a delta
      // pushed to the queue is still undelivered at the moment the run is cancelled.
      onEvent: async (event) => {
        if (event.type === 'delta') await new Promise((resolve) => setTimeout(resolve, 20));
      },
    });
    setTimeout(() => controller.abort(new Error('user pressed stop')), 8);
    const result = await room.run({ signal: controller.signal });
    // Long enough for a rejection any earlier link left unhandled to be reported.
    await new Promise((resolve) => setTimeout(resolve, 100));
    process.off('unhandledRejection', onUnhandledRejection);
    await room.dispose();
    expect(result.status).toBe('cancelled');
    expect(unhandled).toEqual([]);
  });
});

function freshJournal(): IRecoverableExecutionJournal {
  const records: TExecutionJournalRecord[] = [];
  return {
    append: async (record) => {
      records.push(record);
    },
    read: async () => [],
  };
}
