/**
 * Trusted trace context: the framework hands a prompt's own trace to its provider calls, and the
 * span a provider receives as its parent is the span the exported trace contains.
 */
import { describe, expect, it, vi } from 'vitest';

import { outboundTraceContextFor } from '@robota-sdk/agent-core';

import { InteractiveSession } from '../interactive-session.js';

import type { IRunTraceContext } from '@robota-sdk/agent-core';
import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';

const ORIGIN = 'https://api.example.com';
const CALL_ID = '123e4567-e89b-42d3-a456-426614174000';

type TListener = (event: string, data: Record<string, unknown>) => void;

function createMockSession(runImpl: (prompt: string, raw?: string, options?: { traceContext?: IRunTraceContext }) => Promise<string>) {
  let listener: TListener | undefined;
  const session = {
    run: vi.fn().mockImplementation(runImpl),
    abort: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getContextState: vi.fn().mockReturnValue({ usedPercentage: 10, usedTokens: 1000, maxTokens: 200000 }),
    clearHistory: vi.fn(),
    getPermissionMode: vi.fn().mockReturnValue('default'),
    setPermissionMode: vi.fn(),
    getProviderId: vi.fn().mockReturnValue('test-provider'),
    getModelId: vi.fn().mockReturnValue('test-model'),
    getEventService: vi.fn().mockReturnValue({
      subscribe: vi.fn((callback: TListener) => { listener = callback; }),
      unsubscribe: vi.fn(),
    }),
    getSessionId: vi.fn().mockReturnValue('session.1'),
    getSystemMessage: vi.fn().mockReturnValue('system'),
    getToolSchemas: vi.fn().mockReturnValue([]),
    getMessageCount: vi.fn().mockReturnValue(0),
    getSessionAllowedTools: vi.fn().mockReturnValue([]),
    compact: vi.fn(),
    injectMessage: vi.fn(),
    injectRawMessage: vi.fn(),
    syncContextFromHistory: vi.fn(),
  };
  return { session, emit: (event: string, data: Record<string, unknown>) => listener?.(event, data) };
}

describe('trusted trace context propagation', () => {
  it('gives the provider the trace and span the exported provider child carries', async () => {
    let seenTraceparent: string | undefined;
    const mock = createMockSession(async (_prompt, _raw, options) => {
      const traceContext = options?.traceContext;
      expect(traceContext?.allowedOrigins).toEqual([ORIGIN]);
      // What core hands an adapter for this call ID.
      seenTraceparent = outboundTraceContextFor(traceContext!, CALL_ID)?.traceparent;
      const at = new Date().toISOString();
      mock.emit('provider_call_completed', {
        startedAt: at, endedAt: at, outcome: 'success', round: 1, callId: CALL_ID,
        disposition: 'invoked', providerId: 'anthropic', modelId: 'm',
      });
      return 'response';
    });
    const enqueue = vi.fn();
    const session = new InteractiveSession({
      session: mock.session as never, cwd: '/tmp',
      livePromptTrace: { enqueue, traceContextPropagation: { allowedOrigins: [ORIGIN] } },
    });

    await session.submit('prompt');

    const batch = enqueue.mock.calls[0]![0] as ILivePromptTraceBatch;
    const provider = batch.children.find((child) => child.kind === 'provider');
    expect(provider?.kind).toBe('provider');
    const [, traceId, spanId] = seenTraceparent!.split('-');
    expect(batch.root.traceId).toBe(traceId);
    expect(provider!.kind === 'provider' && provider!.trace.spanId).toBe(spanId);
    expect(provider!.kind === 'provider' && provider!.trace.parentSpanId).toBe(batch.root.spanId);
    const options = mock.session.run.mock.calls[0]![2] as { traceContext: IRunTraceContext };
    expect(options.traceContext.parentSpanId).toBe(batch.root.spanId);
  });

  it('passes no trace context when propagation is not configured', async () => {
    for (const livePromptTrace of [undefined, { enqueue: vi.fn() }]) {
      const mock = createMockSession(async () => 'response');
      const session = new InteractiveSession({
        session: mock.session as never, cwd: '/tmp', ...(livePromptTrace ? { livePromptTrace } : {}),
      });
      await session.submit('prompt');
      const options = mock.session.run.mock.calls[0]![2] as Record<string, unknown> | undefined;
      expect(options?.['traceContext']).toBeUndefined();
    }
  });

  it('builds the prompt trace context when only subprocess classes are configured', async () => {
    const mock = createMockSession(async () => 'response');
    const enqueue = vi.fn();
    const session = new InteractiveSession({
      session: mock.session as never, cwd: '/tmp',
      livePromptTrace: { enqueue, traceContextPropagation: { allowedOrigins: [], subprocesses: ['shell', 'hooks'] } },
    });
    await session.submit('prompt');
    const options = mock.session.run.mock.calls[0]![2] as { traceContext: IRunTraceContext };
    const batch = enqueue.mock.calls[0]![0] as ILivePromptTraceBatch;
    expect(options.traceContext).toMatchObject({
      traceId: batch.root.traceId,
      parentSpanId: batch.root.spanId,
      allowedOrigins: [],
      subprocessClasses: ['shell', 'hooks'],
    });
    expect(options.traceContext.onPropagationUnavailable).toBeUndefined();
  });

  it('passes no trace context for an empty origin list and no subprocess class', async () => {
    const mock = createMockSession(async () => 'response');
    const session = new InteractiveSession({
      session: mock.session as never, cwd: '/tmp',
      livePromptTrace: { enqueue: vi.fn(), traceContextPropagation: { allowedOrigins: [], subprocesses: [] } },
    });
    await session.submit('prompt');
    const options = mock.session.run.mock.calls[0]![2] as Record<string, unknown> | undefined;
    expect(options?.['traceContext']).toBeUndefined();
  });

  it('reports a provider that cannot propagate once per process, by provider ID only', async () => {
    const onDiagnostic = vi.fn();
    const makeSession = () => {
      const mock = createMockSession(async (_prompt, _raw, options) => {
        options?.traceContext?.onPropagationUnavailable?.('trace-test-provider');
        options?.traceContext?.onPropagationUnavailable?.('trace-test-provider');
        return 'response';
      });
      return new InteractiveSession({
        session: mock.session as never, cwd: '/tmp',
        livePromptTrace: { enqueue: vi.fn(), onDiagnostic, traceContextPropagation: { allowedOrigins: [ORIGIN] } },
      });
    };
    const first = makeSession();
    await first.submit('one');
    await first.submit('two');
    await makeSession().submit('three');

    expect(onDiagnostic).toHaveBeenCalledOnce();
    const message = onDiagnostic.mock.calls[0]![0] as string;
    expect(message).toContain('trace-test-provider');
    expect(message).not.toMatch(/https?:|api\.example\.com|[0-9a-f]{16}/);
  });
});
