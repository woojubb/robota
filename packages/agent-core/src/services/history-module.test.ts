import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventHistoryModule } from './history-module';
import { InMemoryHistoryStore } from './in-memory-history-store';
import type { IEventService } from '../interfaces/event-service';
import type { IEventHistoryRecord } from '../interfaces/history-module';

function createMockEventService(): IEventService {
  const listeners: Array<(...args: any[]) => void> = [];
  return {
    emit: vi.fn(),
    subscribe: vi.fn((listener: any) => {
      listeners.push(listener);
    }),
    unsubscribe: vi.fn((listener: any) => {
      const idx = listeners.indexOf(listener);
      if (idx !== -1) listeners.splice(idx, 1);
    }),
    _listeners: listeners,
  } as any;
}

function makeRecord(seq: number): IEventHistoryRecord {
  return {
    eventName: `test.event.${seq}`,
    sequenceId: seq,
    timestamp: new Date(),
    eventData: { timestamp: new Date() },
    context: {
      ownerType: 'agent',
      ownerId: `agent-${seq}`,
      ownerPath: [{ type: 'agent', id: `agent-${seq}` }],
    },
  };
}

describe('InMemoryHistoryStore', () => {
  let store: InMemoryHistoryStore;

  beforeEach(() => {
    store = new InMemoryHistoryStore();
  });

  it('appends and reads records', () => {
    store.append(makeRecord(1));
    store.append(makeRecord(2));
    const records = store.read(1);
    expect(records).toHaveLength(2);
  });

  it('throws on missing ownerPath', () => {
    expect(() =>
      store.append({
        eventName: 'test',
        sequenceId: 1,
        timestamp: new Date(),
        eventData: { timestamp: new Date() },
        context: { ownerType: 'x', ownerId: 'y', ownerPath: [] },
      }),
    ).toThrow('ownerPath is required');
  });

  it('throws on non-increasing sequenceId', () => {
    store.append(makeRecord(5));
    expect(() => store.append(makeRecord(3))).toThrow('sequenceId must increase');
  });

  it('reads with range', () => {
    store.append(makeRecord(1));
    store.append(makeRecord(2));
    store.append(makeRecord(3));
    const records = store.read(2, 2);
    expect(records).toHaveLength(1);
    expect(records[0].sequenceId).toBe(2);
  });

  it('readStream yields records in range', async () => {
    store.append(makeRecord(1));
    store.append(makeRecord(2));
    store.append(makeRecord(3));
    const records: IEventHistoryRecord[] = [];
    for await (const record of store.readStream(2, 3)) {
      records.push(record);
    }
    expect(records).toHaveLength(2);
  });

  it('readStream throws for fromSequenceId < 1', async () => {
    const iter = store.readStream(0)[Symbol.asyncIterator]();
    await expect(iter.next()).rejects.toThrow('fromSequenceId must be >= 1');
  });

  it('getSnapshot returns undefined initially', () => {
    expect(store.getSnapshot()).toBeUndefined();
  });

  it('saveSnapshot stores snapshot', () => {
    const snapshot = { lastSequenceId: 5, createdAt: new Date() };
    store.saveSnapshot(snapshot);
    expect(store.getSnapshot()).toEqual(snapshot);
  });
});

describe('EventHistoryModule', () => {
  let store: InMemoryHistoryStore;
  let eventService: ReturnType<typeof createMockEventService>;
  let module: EventHistoryModule;

  beforeEach(() => {
    store = new InMemoryHistoryStore();
    eventService = createMockEventService();
    module = new EventHistoryModule(store, eventService);
  });

  it('subscribes to events on construction', () => {
    expect(eventService.subscribe).toHaveBeenCalled();
  });

  it('appends records via the listener', () => {
    const listener = (eventService.subscribe as any).mock.calls[0][0];
    listener(
      'test.event',
      { timestamp: new Date() },
      { ownerType: 'agent', ownerId: 'a1', ownerPath: [{ type: 'agent', id: 'a1' }] },
    );
    const records = module.read(1);
    expect(records).toHaveLength(1);
    expect(records[0].eventName).toBe('test.event');
  });

  it('throws when listener receives event without ownerPath', () => {
    const listener = (eventService.subscribe as any).mock.calls[0][0];
    expect(() => listener('test', { timestamp: new Date() }, undefined)).toThrow(
      'Missing ownerPath',
    );
  });

  it('append delegates to store', () => {
    module.append(makeRecord(1));
    const records = module.read(1);
    expect(records).toHaveLength(1);
  });

  it('read delegates to store', () => {
    module.append(makeRecord(1));
    module.append(makeRecord(2));
    expect(module.read(1)).toHaveLength(2);
    expect(module.read(2)).toHaveLength(1);
  });

  it('readStream delegates to store', async () => {
    module.append(makeRecord(1));
    const records: IEventHistoryRecord[] = [];
    for await (const r of module.readStream(1)) {
      records.push(r);
    }
    expect(records).toHaveLength(1);
  });

  it('getSnapshot delegates to store', () => {
    expect(module.getSnapshot()).toBeUndefined();
  });

  it('detach unsubscribes from event service', () => {
    module.detach(eventService);
    expect(eventService.unsubscribe).toHaveBeenCalled();
  });
});
