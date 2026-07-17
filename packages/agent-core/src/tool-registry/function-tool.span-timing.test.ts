import { describe, it, expect } from 'vitest';

import { FunctionTool } from './function-tool';
import { SPAN_EVENTS } from '../event-service/span-events';

import type { ISpanCompletionEventData } from '../event-service/span-events';
import type {
  IBaseEventData,
  IEventContext,
  IEventService,
  TEventListener,
} from '../event-service';
import type { IToolSchema } from '../interfaces/provider';
import type { TToolParameters } from '../interfaces/tool';

/**
 * SELFHOST-004 P2 (TC-07) — the per-operation span source.
 *
 * `FunctionTool` already measures `executionTime` and the event-service already mints `span_…` ids,
 * but they were previously disconnected. These tests prove the JOIN: on execution the tool emits a
 * `SPAN_EVENTS.COMPLETED` event whose SINGLE payload carries `spanId` AND `durationMs` AND `op`
 * together (not each fact in isolation) — the correlatable unit a consuming layer turns into a record
 * span entry. They also pin the no-cycle invariant: the payload is raw scalars, referencing no
 * transport type, so `agent-core` depends on neither `agent-interface-transport` nor `agent-plugin`.
 */

/** Minimal capturing event service (records every emit). */
class CapturingEventService implements IEventService {
  readonly emitted: Array<{ eventType: string; data: IBaseEventData; context?: IEventContext }> =
    [];
  emit(eventType: string, data: IBaseEventData, context?: IEventContext): void {
    this.emitted.push({ eventType, data, context });
  }
  subscribe(_listener: TEventListener): void {
    // no-op: this fake captures at the emit boundary
  }
  unsubscribe(_listener: TEventListener): void {
    // no-op
  }
}

function makeTool(name: string): FunctionTool {
  const schema: IToolSchema = {
    name,
    description: 'span-timing tool',
    parameters: { type: 'object', properties: {}, required: [] },
  };
  return new FunctionTool(schema, async (p: TToolParameters) => JSON.stringify(p));
}

describe('SELFHOST-004 TC-07 — FunctionTool span-completion emit', () => {
  it('emits a SPAN_EVENTS.COMPLETED event whose payload JOINS spanId + durationMs + op', async () => {
    const events = new CapturingEventService();
    const tool = makeTool('lookup');
    tool.setEventService(events);

    await tool.execute({});

    const spans = events.emitted.filter((e) => e.eventType === SPAN_EVENTS.COMPLETED);
    expect(spans).toHaveLength(1);

    const payload = spans[0]!.data as ISpanCompletionEventData;
    // The JOIN: all three facts present together in the SAME payload object.
    expect(typeof payload.spanId).toBe('string');
    expect(payload.spanId.length).toBeGreaterThan(0);
    expect(typeof payload.durationMs).toBe('number');
    expect(payload.durationMs).toBeGreaterThanOrEqual(0);
    expect(payload.op).toBe('lookup');
  });

  it('does NOT emit a span event when no event service is injected (opt-in, production-safe)', async () => {
    const tool = makeTool('lookup');
    // no setEventService → the span emit path is skipped
    await expect(tool.execute({})).resolves.toMatchObject({ success: true });
  });

  it('carries the op name of the specific tool that ran', async () => {
    const events = new CapturingEventService();
    const tool = makeTool('search-web');
    tool.setEventService(events);

    await tool.execute({});

    const payload = events.emitted.find((e) => e.eventType === SPAN_EVENTS.COMPLETED)
      ?.data as ISpanCompletionEventData;
    expect(payload.op).toBe('search-web');
  });
});
