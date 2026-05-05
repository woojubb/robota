import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EVENT_EMITTER_EVENTS,
  type IEventEmitterEventData,
  type IEventEmitterHierarchicalEventData,
  type IEventEmitterPlugin,
  type TEventEmitterListener,
} from '@robota-sdk/agent-core';
import { ExecutionSubscriber } from '../execution-subscriber';
import type { IPlaygroundBlockCollector } from '../block-tracking/block-collector';
import type {
  IBlockMessage,
  IBlockTreeNode,
  IRealTimeBlockMetadata,
} from '../block-tracking/types';

type TEventName = Parameters<IEventEmitterPlugin['on']>[0];
type TTestEventData = Partial<IEventEmitterEventData> | Partial<IEventEmitterHierarchicalEventData>;

class EventEmitterDouble implements IEventEmitterPlugin {
  private listeners = new Map<TEventName, Map<string, TEventEmitterListener>>();
  private nextId = 0;

  on(eventType: TEventName, listener: TEventEmitterListener): string {
    this.nextId += 1;
    const id = `${eventType}:${this.nextId}`;
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Map());
    }
    this.listeners.get(eventType)?.set(id, listener);
    return id;
  }

  once(eventType: TEventName, listener: TEventEmitterListener): string {
    const id = this.on(eventType, async (event) => {
      this.off(eventType, id);
      await listener(event);
    });
    return id;
  }

  off(eventType: TEventName, handlerIdOrListener: string | TEventEmitterListener): boolean {
    const eventListeners = this.listeners.get(eventType);
    if (!eventListeners) return false;

    if (typeof handlerIdOrListener === 'string') {
      return eventListeners.delete(handlerIdOrListener);
    }

    for (const [id, listener] of eventListeners) {
      if (listener === handlerIdOrListener) {
        eventListeners.delete(id);
        return true;
      }
    }
    return false;
  }

  async emit(eventType: TEventName, eventData: TTestEventData = {}): Promise<void> {
    const event: IEventEmitterEventData = {
      type: eventType,
      timestamp: new Date(),
      ...eventData,
    };

    const eventListeners = Array.from(this.listeners.get(eventType)?.values() ?? []);
    for (const listener of eventListeners) {
      await listener(event);
    }
  }
}

interface ICollectorDouble {
  collector: IPlaygroundBlockCollector;
  collected: IBlockMessage[];
  realtimeUpdates: Array<{ blockId: string; updates: Partial<IRealTimeBlockMetadata> }>;
}

function createCollectorDouble(): ICollectorDouble {
  const collected: IBlockMessage[] = [];
  const realtimeUpdates: Array<{ blockId: string; updates: Partial<IRealTimeBlockMetadata> }> = [];

  const collector: IPlaygroundBlockCollector = {
    collectBlock(message: IBlockMessage): void {
      collected.push(message);
    },
    updateBlock(): void {
      // ExecutionSubscriber uses updateRealTimeBlock.
    },
    updateRealTimeBlock(blockId: string, updates: Partial<IRealTimeBlockMetadata>): void {
      realtimeUpdates.push({ blockId, updates });
    },
    getBlocks(): IBlockMessage[] {
      return collected;
    },
    getBlocksByParent(parentId?: string): IBlockMessage[] {
      return collected.filter((block) => block.blockMetadata.parentId === parentId);
    },
    getBlock(blockId: string): IBlockMessage | undefined {
      return collected.find((block) => block.blockMetadata.id === blockId);
    },
    getBlockTree(): IBlockTreeNode[] {
      return [];
    },
    clearBlocks(): void {
      collected.length = 0;
      realtimeUpdates.length = 0;
    },
    generateBlockId(): string {
      return 'collector_block';
    },
    createGroupBlock(): IBlockMessage {
      throw new Error('createGroupBlock is not used by ExecutionSubscriber');
    },
    removeBlock(): void {
      // Not used by ExecutionSubscriber.
    },
    getStats() {
      return {
        total: collected.length,
        byType: {},
        byState: {},
        rootBlocks: collected.filter((block) => !block.blockMetadata.parentId).length,
      };
    },
    addListener(): void {
      // Not used by ExecutionSubscriber.
    },
    removeListener(): void {
      // Not used by ExecutionSubscriber.
    },
  };

  return { collector, collected, realtimeUpdates };
}

describe('ExecutionSubscriber', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('converts tool lifecycle events into real-time tool blocks', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));
    vi.spyOn(Math, 'random').mockReturnValue(0.123456789);

    const emitter = new EventEmitterDouble();
    const { collector, collected, realtimeUpdates } = createCollectorDouble();
    const subscriber = new ExecutionSubscriber(collector);
    subscriber.initialize(emitter);

    await emitter.emit(EVENT_EMITTER_EVENTS.TOOL_BEFORE_EXECUTE, {
      executionId: 'tool-1',
      data: { toolName: 'search' },
      executionLevel: 2,
      executionPath: ['team', 'agent', 'search'],
      parentExecutionId: 'agent-1',
      rootExecutionId: 'team-1',
      realTimeData: {
        startTime: new Date('2026-01-02T03:04:05.000Z'),
        actualParameters: { query: 'robota' },
      },
    });

    expect(collected).toHaveLength(1);
    expect(collected[0]).toEqual(
      expect.objectContaining({
        role: 'tool',
        content: 'Executing search...',
        blockMetadata: expect.objectContaining({
          type: 'tool_call',
          level: 2,
          visualState: 'in_progress',
          toolParameters: { query: 'robota' },
          executionHierarchy: {
            parentExecutionId: 'agent-1',
            rootExecutionId: 'team-1',
            level: 2,
            path: ['team', 'agent', 'search'],
          },
        }),
      }),
    );

    vi.setSystemTime(new Date('2026-01-02T03:04:05.050Z'));
    await emitter.emit(EVENT_EMITTER_EVENTS.TOOL_AFTER_EXECUTE, {
      executionId: 'tool-1',
      executionLevel: 2,
      executionPath: ['team', 'agent', 'search'],
      realTimeData: {
        startTime: new Date('2026-01-02T03:04:05.000Z'),
        actualResult: { success: true, data: { answer: 'ok' } },
      },
    });

    expect(realtimeUpdates).toEqual([
      {
        blockId: collected[0]?.blockMetadata.id ?? '',
        updates: expect.objectContaining({
          visualState: 'completed',
          actualDuration: 50,
          toolResult: { answer: 'ok' },
          renderData: { result: { answer: 'ok' } },
        }),
      },
    ]);
  });

  it('captures tool progress updates with parsed execution steps', async () => {
    const emitter = new EventEmitterDouble();
    const { collector, collected, realtimeUpdates } = createCollectorDouble();
    const subscriber = new ExecutionSubscriber(collector);
    subscriber.initialize(emitter);

    await emitter.emit(EVENT_EMITTER_EVENTS.TOOL_BEFORE_EXECUTE, {
      executionId: 'tool-progress',
      data: { toolName: 'download' },
    });
    await emitter.emit(EVENT_EMITTER_EVENTS.TOOL_REALTIME, {
      executionId: 'tool-progress',
      data: {
        progress: 40,
        currentStep: 'Fetch metadata',
        estimatedDuration: 200,
        executionSteps: [
          { id: 'step-1', name: 'Fetch metadata', estimatedDuration: 50 },
          { id: 'bad-step', name: false, estimatedDuration: 'unknown' },
        ],
      },
    });

    expect(realtimeUpdates).toEqual([
      {
        blockId: collected[0]?.blockMetadata.id ?? '',
        updates: {
          toolProvidedData: {
            progress: 40,
            currentStep: 'Fetch metadata',
            estimatedDuration: 200,
            executionSteps: [
              {
                id: 'step-1',
                name: 'Fetch metadata',
                estimatedDuration: 50,
                description: 'Step 1',
              },
            ],
          },
        },
      },
    ]);
  });

  it('creates hierarchy blocks for team and agent execution lifecycle events', async () => {
    const emitter = new EventEmitterDouble();
    const { collector, collected, realtimeUpdates } = createCollectorDouble();
    const subscriber = new ExecutionSubscriber(collector);
    subscriber.initialize(emitter);

    await emitter.emit(EVENT_EMITTER_EVENTS.EXECUTION_START, {
      executionId: 'team-1',
      executionLevel: 0,
      executionPath: ['team'],
      rootExecutionId: 'team-1',
    });
    await emitter.emit(EVENT_EMITTER_EVENTS.EXECUTION_START, {
      executionId: 'agent-1',
      executionLevel: 1,
      executionPath: ['team', 'agent'],
      parentExecutionId: 'team-1',
      rootExecutionId: 'team-1',
    });
    await emitter.emit(EVENT_EMITTER_EVENTS.EXECUTION_COMPLETE, {
      executionId: 'agent-1',
    });

    const teamBlockId = collected[0]?.blockMetadata.id;
    const agentBlockId = collected[1]?.blockMetadata.id;

    expect(collected).toEqual([
      expect.objectContaining({
        role: 'system',
        content: 'Team execution started',
        blockMetadata: expect.objectContaining({ type: 'group', level: 0 }),
      }),
      expect.objectContaining({
        role: 'assistant',
        content: 'Agent processing...',
        blockMetadata: expect.objectContaining({
          type: 'assistant',
          level: 1,
          parentId: teamBlockId,
        }),
      }),
    ]);
    expect(realtimeUpdates).toEqual([
      {
        blockId: agentBlockId ?? '',
        updates: expect.objectContaining({ visualState: 'completed' }),
      },
    ]);
  });

  it('clears active executions on dispose so later completions are ignored', async () => {
    const emitter = new EventEmitterDouble();
    const { collector, realtimeUpdates } = createCollectorDouble();
    const subscriber = new ExecutionSubscriber(collector);
    subscriber.initialize(emitter);

    await emitter.emit(EVENT_EMITTER_EVENTS.TOOL_BEFORE_EXECUTE, {
      executionId: 'tool-1',
      data: { toolName: 'search' },
    });
    subscriber.dispose();
    await emitter.emit(EVENT_EMITTER_EVENTS.TOOL_AFTER_EXECUTE, {
      executionId: 'tool-1',
    });

    expect(realtimeUpdates).toEqual([]);
  });
});
