/**
 * SELFHOST-004 P6: the LIVE span→history path over a real event bus (not a constructed record).
 *
 * `collectSpanEntries` subscribes to a session's `ObservableEventService`; a `FunctionTool` wired to
 * that same bus emits `SPAN_EVENTS.COMPLETED` on execution, and the collector projects it into a
 * record span entry via `createSpanEntry`. This proves the emit → collect → entry chain that the
 * interactive turn drains onto `history` — the piece P1–P5 built the seam for but did not yet wire.
 */

import { describe, it, expect } from 'vitest';

import { FunctionTool, ObservableEventService } from '@robota-sdk/agent-core';

import { collectSpanEntries } from '../interactive-session-execution.js';

import type { IToolSchema } from '@robota-sdk/agent-core';

function makeTool(name: string): FunctionTool {
  const schema: IToolSchema = {
    name,
    description: 'span tool',
    parameters: { type: 'object', properties: {}, required: [] },
  };
  return new FunctionTool(schema, async () => 'ok');
}

describe('SELFHOST-004 P6 — collectSpanEntries over a live bus', () => {
  it('captures a span entry when a bus-wired tool executes', async () => {
    const bus = new ObservableEventService();
    const collector = collectSpanEntries(bus);

    const tool = makeTool('read');
    tool.setEventService(bus);
    await tool.execute({});

    expect(collector.entries).toHaveLength(1);
    expect(collector.entries[0]).toMatchObject({ category: 'event', type: 'span' });
    expect(collector.entries[0]?.data?.op).toBe('read');
    expect(typeof collector.entries[0]?.data?.durationMs).toBe('number');

    collector.dispose();
  });

  it('collects spans from multiple tool executions in order', async () => {
    const bus = new ObservableEventService();
    const collector = collectSpanEntries(bus);

    const read = makeTool('read');
    const grep = makeTool('grep');
    read.setEventService(bus);
    grep.setEventService(bus);
    await read.execute({});
    await grep.execute({});

    expect(collector.entries.map((e) => e.data?.op)).toEqual(['read', 'grep']);
    collector.dispose();
  });

  it('stops collecting after dispose (no leaked listener)', async () => {
    const bus = new ObservableEventService();
    const collector = collectSpanEntries(bus);
    const tool = makeTool('read');
    tool.setEventService(bus);

    await tool.execute({});
    expect(collector.entries).toHaveLength(1);

    collector.dispose();
    await tool.execute({});
    expect(collector.entries).toHaveLength(1); // unchanged — unsubscribed
  });

  it('ignores non-span events on the bus', () => {
    const bus = new ObservableEventService();
    const collector = collectSpanEntries(bus);

    bus.emit('some_other_event', { timestamp: new Date() });

    expect(collector.entries).toHaveLength(0);
    collector.dispose();
  });
});
