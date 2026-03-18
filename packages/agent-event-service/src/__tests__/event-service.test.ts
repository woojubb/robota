import { describe, expect, it, vi } from 'vitest';
import type {
  IBaseEventData,
  IEventContext,
  IEventService,
  IEventServiceOwnerBinding,
  TEventListener,
} from '../interfaces';
import {
  bindEventServiceOwner,
  bindWithOwnerPath,
  composeEventName,
  DefaultEventService,
  ObservableEventService,
  StructuredEventService,
} from '../event-service';
// Test constants (mirrors EXECUTION_EVENTS and EXECUTION_EVENT_PREFIX from @robota-sdk/agent-core)
const EXECUTION_EVENT_PREFIX = 'execution' as const;
const EXECUTION_EVENTS = {
  START: 'start',
  COMPLETE: 'complete',
  ERROR: 'error',
} as const;

class MockEventService implements IEventService {
  public events: Array<{ eventType: string; data: IBaseEventData; context?: IEventContext }> = [];
  private listeners = new Set<TEventListener>();

  emit(eventType: string, data: IBaseEventData, context?: IEventContext): void {
    this.events.push({ eventType, data, context });
    for (const listener of this.listeners) {
      listener(eventType, data, context);
    }
  }

  subscribe(listener: TEventListener): void {
    this.listeners.add(listener);
  }

  unsubscribe(listener: TEventListener): void {
    this.listeners.delete(listener);
  }
}

const binding: IEventServiceOwnerBinding = {
  ownerType: 'execution',
  ownerId: 'exec_1',
  ownerPath: [{ type: 'execution', id: 'exec_1' }],
};

const eventData: IBaseEventData = {
  timestamp: new Date(0),
};

describe('event-service', () => {
  const executionStartEvent = composeEventName(EXECUTION_EVENT_PREFIX, EXECUTION_EVENTS.START);
  const executionCompleteEvent = composeEventName(
    EXECUTION_EVENT_PREFIX,
    EXECUTION_EVENTS.COMPLETE,
  );

  it('composeEventName should compose owner prefix and local name', () => {
    expect(composeEventName('execution', 'start')).toBe('execution.start');
  });

  it('composeEventName should reject invalid owner/local names', () => {
    expect(() => composeEventName('', 'start')).toThrow('ownerType is required');
    expect(() => composeEventName('execution.root', 'start')).toThrow("must not contain '.'");
    expect(() => composeEventName('execution', '')).toThrow('local event name is required');
    expect(() => composeEventName('execution', 'start.now')).toThrow("must not contain '.'");
  });

  it('StructuredEventService should emit full event name with bound context', () => {
    const base = new MockEventService();
    const service = new StructuredEventService(base, binding);
    const context: IEventContext = {
      ownerType: 'ignored',
      ownerId: 'ignored',
      ownerPath: [{ type: 'tool', id: 'tool_1' }],
    };

    service.emit('start', eventData, context);

    expect(base.events).toHaveLength(1);
    expect(base.events[0]?.eventType).toBe(executionStartEvent);
    expect(base.events[0]?.context).toMatchObject({
      ownerType: 'execution',
      ownerId: 'exec_1',
      ownerPath: [{ type: 'execution', id: 'exec_1' }],
      depth: 1,
    });
    expect(base.events[0]?.context?.spanId).toMatch(/^span_/);
  });

  it('StructuredEventService should reject dotted local event names', () => {
    const base = new MockEventService();
    const service = new StructuredEventService(base, binding);
    expect(() => service.emit('execution.start', eventData)).toThrow("must not contain '.'");
  });

  it('bind helpers should return scoped services', () => {
    const base = new MockEventService();
    const a = bindWithOwnerPath(base, binding);
    const b = bindEventServiceOwner(base, binding);

    a.emit('start', eventData);
    b.emit('complete', eventData);

    expect(base.events.map((item) => item.eventType)).toEqual([
      executionStartEvent,
      executionCompleteEvent,
    ]);
  });

  it('ObservableEventService should notify subscribed listeners', () => {
    const service = new ObservableEventService();
    const listener = vi.fn();
    service.subscribe(listener);
    service.emit(executionStartEvent, eventData, {
      ownerType: 'execution',
      ownerId: 'exec_1',
      ownerPath: [{ type: 'execution', id: 'exec_1' }],
    });

    expect(listener).toHaveBeenCalledTimes(1);
    service.unsubscribe(listener);
    service.emit(executionCompleteEvent, eventData);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('DefaultEventService should be no-op', () => {
    const service = new DefaultEventService();
    expect(() => service.emit(executionStartEvent, eventData)).not.toThrow();
  });
});
