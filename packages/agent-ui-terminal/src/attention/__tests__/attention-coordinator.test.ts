import { describe, expect, it } from 'vitest';

import { AttentionCoordinator } from '../attention-coordinator.js';

import type { IAttentionSource, TAttentionListener } from '../attention-tracker.js';
import type { IExecutionWorkspaceSnapshot } from '@robota-sdk/agent-interface-execution';

class FakeSource implements IAttentionSource {
  attended = true;
  readonly source = 'focus' as const;
  private readonly listeners = new Set<TAttentionListener>();
  subscribe(listener: TAttentionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  lost(at: string): void {
    this.attended = false;
    for (const listener of this.listeners) listener({ kind: 'lost', at });
  }
  returned(at: string): void {
    this.attended = true;
    for (const listener of this.listeners) listener({ kind: 'returned', at });
  }
  get listenerCount(): number {
    return this.listeners.size;
  }
}

function snapshot(
  entries: ReadonlyArray<{ id: string; state: 'working' | 'completed' | 'failed' }>,
) {
  return {
    sessionId: 's1',
    updatedAt: '2026-01-01T00:00:00.000Z',
    entries: entries.map((entry) => ({
      id: entry.id,
      sourceId: entry.id,
      kind: 'background_task' as const,
      origin: { kind: 'slash_command' as const, sessionId: 's1' },
      status: 'running' as const,
      state: entry.state,
      title: entry.id,
      unread: false,
      attention: 'none' as const,
      visibility: 'default' as const,
      updatedAt: '2026-01-01T00:00:00.000Z',
      controls: ['select' as const],
    })),
  } satisfies IExecutionWorkspaceSnapshot;
}

describe('AttentionCoordinator (SCREEN-1992 TC-02 wiring)', () => {
  it('pushes one recap per unattended interval from the channel events it is fed', () => {
    const source = new FakeSource();
    const recaps: string[] = [];
    const coordinator = new AttentionCoordinator({ source, onRecap: (line) => recaps.push(line) });
    coordinator.wire();
    coordinator.wire();
    expect(source.listenerCount).toBe(1);

    source.lost('2026-01-01T00:00:00.000Z');
    coordinator.onTurnSource('agent-wakeup');
    coordinator.onComplete();
    coordinator.onNeedsInput();
    coordinator.onWorkspaceSnapshot(snapshot([{ id: 'task:a', state: 'working' }]));
    coordinator.onWorkspaceSnapshot(snapshot([{ id: 'task:a', state: 'failed' }]));
    source.returned('2026-01-01T00:03:00.000Z');
    expect(recaps).toEqual(['While away 3m: 1 turn finished (1 wake) · 1 needs input · 1 failed']);

    // Attended activity is never recapped.
    coordinator.onComplete();
    source.lost('2026-01-01T00:10:00.000Z');
    source.returned('2026-01-01T00:11:00.000Z');
    expect(recaps).toHaveLength(1);

    coordinator.unwire();
    expect(source.listenerCount).toBe(0);
  });

  it('starts an interval immediately when wired while the user is already away', () => {
    const source = new FakeSource();
    source.attended = false;
    const recaps: string[] = [];
    const coordinator = new AttentionCoordinator({
      source,
      onRecap: (line) => recaps.push(line),
      now: () => Date.parse('2026-01-01T00:00:00.000Z'),
    });
    coordinator.wire();
    coordinator.onTurnSource('user');
    coordinator.onComplete();
    source.returned('2026-01-01T00:05:00.000Z');
    expect(recaps).toEqual(['While away 5m: 1 turn finished']);
  });
});
