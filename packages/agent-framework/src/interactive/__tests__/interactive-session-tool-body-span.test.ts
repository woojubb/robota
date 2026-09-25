/**
 * A tool body's exported span is derived from the body ID core minted for it, so the parent a tool
 * propagated to its server is the span the exported trace contains.
 */
import { describe, expect, it, vi } from 'vitest';

import { ObservableEventService, spanIdFromMintedId, TOOL_BODY_EVENTS } from '@robota-sdk/agent-core';

import { collectSpanEntries } from '../interactive-session-execution.js';
import { InteractiveSession } from '../interactive-session.js';

import type { ILivePromptTraceBatch } from '@robota-sdk/agent-interface-analytics';

type TListener = (event: string, data: Record<string, unknown>) => void;

function createMockSession(run: (emit: TListener) => Promise<string>) {
  let listener: TListener | undefined;
  const emit: TListener = (event, data) => listener?.(event, data);
  return {
    run: vi.fn().mockImplementation(() => run(emit)),
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
}

describe('minted tool body spans', () => {
  it('collects the minted body ID beside the vendor call ID', () => {
    const bus = new ObservableEventService();
    const collector = collectSpanEntries(bus);
    const at = new Date().toISOString();
    const toolBodyId = globalThis.crypto.randomUUID();
    bus.emit(`tool.${TOOL_BODY_EVENTS.COMPLETED}`, {
      timestamp: new Date(), executionId: 'call-1', toolBodyId, startedAt: at, endedAt: at, outcome: 'success',
    });
    expect(collector.toolBodies).toEqual([
      { toolCallId: 'call-1', toolBodyId, startedAt: at, endedAt: at, outcome: 'success' },
    ]);
    collector.dispose();
  });

  it('exports each body under the span derived from its own minted ID, even for a repeated call ID', async () => {
    const bodyIds = [globalThis.crypto.randomUUID(), globalThis.crypto.randomUUID()];
    const mock = createMockSession(async (emit) => {
      const at = new Date().toISOString();
      for (const toolBodyId of bodyIds) {
        emit(`tool.${TOOL_BODY_EVENTS.COMPLETED}`, {
          executionId: 'call_0', toolBodyId, startedAt: at, endedAt: at, outcome: 'success',
        });
      }
      return 'response';
    });
    const enqueue = vi.fn();
    const session = new InteractiveSession({ session: mock as never, cwd: '/tmp', livePromptTrace: { enqueue } });

    await session.submit('prompt');

    const expected = bodyIds.map((id) => spanIdFromMintedId(id));
    expect(expected[0]).not.toBe(expected[1]);
    const persisted = session.getFullHistory()
      .filter((entry) => entry.type === 'tool-body-trace')
      .map((entry) => (entry.data as { spanId: string }).spanId);
    expect(persisted).toEqual(expected);
    expect(JSON.stringify(session.getFullHistory())).not.toContain(bodyIds[0]);
    const batch = enqueue.mock.calls[0]![0] as ILivePromptTraceBatch;
    const exported = batch.children.flatMap((child) => (child.kind === 'tool' ? [child.trace.spanId] : []));
    expect(exported).toEqual(expected);
  });

  it('counts a body without a minted ID as omitted rather than inventing its span', async () => {
    const mock = createMockSession(async (emit) => {
      const at = new Date().toISOString();
      emit(`tool.${TOOL_BODY_EVENTS.COMPLETED}`, { executionId: 'call_0', startedAt: at, endedAt: at, outcome: 'success' });
      emit(`tool.${TOOL_BODY_EVENTS.COMPLETED}`, {
        executionId: 'call_1', toolBodyId: 'not-hex-at-all', startedAt: at, endedAt: at, outcome: 'success',
      });
      return 'response';
    });
    const enqueue = vi.fn();
    const session = new InteractiveSession({ session: mock as never, cwd: '/tmp', livePromptTrace: { enqueue } });

    await session.submit('prompt');

    expect(session.getFullHistory().filter((entry) => entry.type === 'tool-body-trace')).toHaveLength(0);
    const batch = enqueue.mock.calls[0]![0] as ILivePromptTraceBatch;
    expect(batch.children.filter((child) => child.kind === 'tool')).toHaveLength(0);
    expect(batch.omittedChildren).toMatchObject({ tool: 2 });
  });
});
