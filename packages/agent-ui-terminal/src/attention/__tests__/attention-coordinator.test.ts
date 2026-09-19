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
  entries: ReadonlyArray<{
    id: string;
    state: 'working' | 'completed' | 'failed';
    kind?: 'main_thread' | 'background_task';
  }>,
) {
  return {
    sessionId: 's1',
    updatedAt: '2026-01-01T00:00:00.000Z',
    entries: entries.map((entry) => ({
      id: entry.id,
      sourceId: entry.id,
      kind: entry.kind ?? ('background_task' as const),
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

    // Before the interval: an idle main thread and a task that already finished.
    coordinator.onWorkspaceSnapshot(
      snapshot([
        { id: 'main:s1', state: 'completed', kind: 'main_thread' },
        { id: 'task:done', state: 'completed' },
        { id: 'task:a', state: 'working' },
      ]),
    );
    source.lost('2026-01-01T00:00:00.000Z');
    coordinator.onTurnSource('agent-wakeup');
    coordinator.onWorkspaceSnapshot(
      snapshot([
        { id: 'main:s1', state: 'working', kind: 'main_thread' },
        { id: 'task:done', state: 'completed' },
        { id: 'task:a', state: 'working' },
      ]),
    );
    coordinator.onComplete();
    coordinator.onNeedsInput();
    coordinator.onWorkspaceSnapshot(
      snapshot([
        { id: 'main:s1', state: 'completed', kind: 'main_thread' },
        { id: 'task:done', state: 'completed' },
        { id: 'task:a', state: 'failed' },
      ]),
    );
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

  it('never reports the main thread finishing a turn as a completed entry', () => {
    const source = new FakeSource();
    const recaps: string[] = [];
    const coordinator = new AttentionCoordinator({ source, onRecap: (line) => recaps.push(line) });
    coordinator.wire();
    // The user leaves mid-turn: the main thread is `working` when attention is lost …
    coordinator.onWorkspaceSnapshot(
      snapshot([{ id: 'main:s1', state: 'working', kind: 'main_thread' }]),
    );
    source.lost('2026-01-01T00:00:00.000Z');
    coordinator.onTurnSource('user');
    coordinator.onComplete();
    // … and idle (`completed`) when they return. That is the turn, already counted, not an entry.
    coordinator.onWorkspaceSnapshot(
      snapshot([{ id: 'main:s1', state: 'completed', kind: 'main_thread' }]),
    );
    source.returned('2026-01-01T00:02:00.000Z');
    expect(recaps).toEqual(['While away 2m: 1 turn finished']);
  });
});
