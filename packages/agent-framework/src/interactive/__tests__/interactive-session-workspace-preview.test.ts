/**
 * #3186 — the main thread's row previews the conversation, not the name of the last record. The
 * last record is often bookkeeping (a usage observation), whose type name leaked into every
 * surface's activity list as "usage-observation".
 */

import { describe, expect, it } from 'vitest';

import { buildExecutionWorkspaceSnapshot } from '../interactive-session-workspace.js';

import type { IHistoryEntry } from '@robota-sdk/agent-core';

function snapshotPreview(history: IHistoryEntry[], streamingText = ''): string | undefined {
  const snapshot = buildExecutionWorkspaceSnapshot({
    sessionId: 's',
    execCtrl: { executing: false, pendingPrompt: null, streamingText },
    histTracker: { getHistory: () => history },
    bgTracker: { getTaskSnapshots: () => [], getGroupSnapshots: () => [] },
  });
  return snapshot.entries.find((entry) => entry.kind === 'main_thread')?.preview;
}

const at = new Date('2026-09-26T00:00:00Z');

describe('main-thread preview', () => {
  it('shows the last message of the conversation, past bookkeeping records', () => {
    expect(
      snapshotPreview([
        { id: '1', timestamp: at, category: 'chat', type: 'user', data: { role: 'user', content: 'hi' } },
        {
          id: '2',
          timestamp: at,
          category: 'chat',
          type: 'assistant',
          data: { role: 'assistant', content: 'PARITY-DEMO-OK' },
        },
        { id: '3', timestamp: at, category: 'event', type: 'usage-observation', data: {} },
      ]),
    ).toBe('PARITY-DEMO-OK');
  });

  it('prefers the reply being streamed, and is empty before any message', () => {
    expect(snapshotPreview([], 'thinking out loud')).toBe('thinking out loud');
    expect(snapshotPreview([{ id: '1', timestamp: at, category: 'event', type: 'x' }])).toBeUndefined();
  });
});
