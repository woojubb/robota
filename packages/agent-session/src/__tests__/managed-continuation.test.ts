import { describe, expect, it } from 'vitest';
import type { IManagedRunProvider, IToolSchema, TUniversalMessage } from '@robota-sdk/agent-core';
import { ManagedContinuation } from '../managed-continuation.js';

function provider(): IManagedRunProvider {
  return {
    kind: 'managed-run',
    name: 'unit',
    version: 'unit',
    continuation: 'live-process',
    validateConfig: () => true,
    run: async () => {
      throw new Error('not used');
    },
  };
}

const system: TUniversalMessage = {
  id: 'system',
  role: 'system',
  content: 'S',
  timestamp: new Date(0),
  state: 'complete',
};
const user: TUniversalMessage = {
  id: 'user',
  role: 'user',
  content: 'hi',
  timestamp: new Date(0),
  state: 'complete',
};
const tool: IToolSchema = {
  name: 'act',
  description: 'act',
  parameters: { type: 'object', properties: {} },
};

function commit(live: ManagedContinuation, p: IManagedRunProvider, settled: string[]): void {
  const fence = live.admit({
    sessionId: 'session',
    provider: p,
    model: 'm',
    history: [system],
    tools: [tool],
    hasStore: true,
  });
  live.begin(p);
  live.commit(fence, {
    provider: p,
    model: 'm',
    history: [system, user],
    tools: [tool],
    settledActions: settled,
    frameIds: [],
  });
}

function admit(
  live: ManagedContinuation,
  over: { provider: IManagedRunProvider; model?: string; tools?: IToolSchema[] },
) {
  return () =>
    live.admit({
      sessionId: 'session',
      provider: over.provider,
      model: over.model ?? 'm',
      history: [system, user],
      tools: over.tools ?? [tool],
      hasStore: true,
    });
}

describe('ManagedContinuation admission causes', () => {
  it('refuses a different provider, model and tool projection with distinct messages', () => {
    const live = new ManagedContinuation();
    const p = provider();
    commit(live, p, ['a1']);
    expect(admit(live, { provider: provider() })).toThrow(
      'Managed continuation belongs to a different provider',
    );
    expect(admit(live, { provider: p, model: 'other' })).toThrow(
      'Managed continuation belongs to a different model',
    );
    expect(admit(live, { provider: p, tools: [] })).toThrow(
      'Managed continuation tool projection changed',
    );
    expect(admit(live, { provider: p })().binding).toMatchObject({
      revision: 1,
      actionFrontier: ['a1'],
    });
  });

  it('does not turn a repeated settled action into a continuation', () => {
    const live = new ManagedContinuation();
    const p = provider();
    commit(live, p, ['a1', 'a1']);
    expect(admit(live, { provider: p })).toThrow('previous managed native connection ended');
  });
});
