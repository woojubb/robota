import { describe, expect, it } from 'vitest';

import { createSpanEntry } from '../interactive-session-execution.js';

import type { ISpanCompletionEventData } from '@robota-sdk/agent-core';

/**
 * SELFHOST-004 P2 (TC-07) — the record-side projection.
 *
 * `createSpanEntry` is the ONLY place the `agent-core` span-completion event becomes a record-side
 * `IHistoryEntry<ISpanEntry>`. These tests prove the JOIN survives the projection (spanId + op +
 * durationMs travel together into `data`) and that the entry is classified so the read-model reducer
 * can find it (`category: 'event'`, `type: 'span'`). Because this builder lives in `agent-framework`
 * (which already depends on transport), `agent-core` never depends on `agent-interface-transport`.
 */
describe('SELFHOST-004 TC-07 — createSpanEntry projects the span-completion event', () => {
  const event: ISpanCompletionEventData = {
    timestamp: new Date('2026-07-18T00:00:00.000Z'),
    spanId: 'span_abc123',
    op: 'search-web',
    durationMs: 42,
  };

  it('builds an IHistoryEntry<ISpanEntry> whose data JOINS spanId + op + durationMs', () => {
    const entry = createSpanEntry(event);

    expect(entry.category).toBe('event');
    expect(entry.type).toBe('span');
    expect(entry.data).toEqual({ spanId: 'span_abc123', op: 'search-web', durationMs: 42 });
  });

  it('mints a unique entry id and stamps a timestamp (mirrors the usage-summary entry)', () => {
    const a = createSpanEntry(event);
    const b = createSpanEntry(event);

    expect(a.id).toMatch(/^span_/);
    expect(a.id).not.toBe(b.id);
    expect(a.timestamp).toBeInstanceOf(Date);
  });

  it('preserves the exact numeric duration (no rounding) and the source span id', () => {
    const entry = createSpanEntry({ ...event, spanId: 'span_xyz', durationMs: 0 });

    expect(entry.data?.spanId).toBe('span_xyz');
    expect(entry.data?.durationMs).toBe(0);
  });
});
