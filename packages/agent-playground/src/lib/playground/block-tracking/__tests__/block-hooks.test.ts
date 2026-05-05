import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ILogger, IToolExecutionContext, TToolParameters } from '@robota-sdk/agent-core';
import {
  createBlockTrackingHooks,
  createDelegationTrackingHooks,
  type IToolHooks,
} from '../block-hooks';
import type { IBlockDataCollector, IBlockMessage, IBlockMetadata } from '../types';

interface ICollectorDouble {
  collector: IBlockDataCollector;
  collected: IBlockMessage[];
  updates: Array<{ blockId: string; updates: Partial<IBlockMetadata> }>;
}

function createCollectorDouble(): ICollectorDouble {
  const collected: IBlockMessage[] = [];
  const updates: Array<{ blockId: string; updates: Partial<IBlockMetadata> }> = [];
  let idCounter = 0;

  const collector: IBlockDataCollector = {
    collectBlock(message: IBlockMessage): void {
      collected.push(message);
    },
    updateBlock(blockId: string, blockUpdates: Partial<IBlockMetadata>): void {
      updates.push({ blockId, updates: blockUpdates });
    },
    getBlocks(): IBlockMessage[] {
      return collected;
    },
    getBlocksByParent(parentId?: string): IBlockMessage[] {
      return collected.filter((block) => block.blockMetadata.parentId === parentId);
    },
    clearBlocks(): void {
      collected.length = 0;
      updates.length = 0;
    },
    generateBlockId(): string {
      idCounter += 1;
      return `block_${idCounter}`;
    },
    createGroupBlock(
      type: 'user' | 'assistant' | 'tool_call' | 'group',
      content: string,
      parentId?: string,
      level: number = 0,
    ): IBlockMessage {
      return {
        role: 'system',
        content,
        blockMetadata: {
          id: collector.generateBlockId(),
          type,
          level,
          parentId,
          children: [],
          isExpanded: true,
          visualState: 'pending',
        },
      };
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
      // Not used by block hook tests.
    },
    removeListener(): void {
      // Not used by block hook tests.
    },
  };

  return { collector, collected, updates };
}

function createLoggerDouble(): ILogger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    log: vi.fn(),
    group: vi.fn(),
    groupEnd: vi.fn(),
  };
}

function createContext(toolName: string, parameters: TToolParameters): IToolExecutionContext {
  return {
    toolName,
    parameters,
    executionId: `${toolName}-execution`,
  };
}

async function startToolExecution(
  hooks: IToolHooks,
  toolName: string,
  parameters: TToolParameters,
): Promise<IToolExecutionContext> {
  const context = createContext(toolName, parameters);
  await hooks.beforeExecute(toolName, parameters, context);
  return context;
}

describe('block tracking hooks', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('creates a tool call block and updates it with a result block on completion', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));

    const parameters = { query: 'robota' };
    const { collector, collected, updates } = createCollectorDouble();
    const hooks = createBlockTrackingHooks(collector, createLoggerDouble(), {
      parentBlockId: 'parent_block',
      level: 2,
      blockTypeMapping: { search: 'tool_result' },
    });

    const context = await startToolExecution(hooks, 'search', parameters);

    expect(collected).toHaveLength(1);
    expect(collected[0]).toEqual(
      expect.objectContaining({
        role: 'assistant',
        content: '🔧 search',
        blockMetadata: expect.objectContaining({
          id: 'block_1',
          type: 'tool_result',
          level: 2,
          parentId: 'parent_block',
          visualState: 'in_progress',
          renderData: { parameters },
        }),
      }),
    );

    vi.setSystemTime(new Date('2026-01-02T03:04:05.150Z'));
    await hooks.afterExecute('search', parameters, { ok: true }, context);

    expect(updates).toEqual([
      {
        blockId: 'block_1',
        updates: expect.objectContaining({
          visualState: 'completed',
          executionContext: expect.objectContaining({ duration: 150 }),
          renderData: { parameters, result: { ok: true } },
        }),
      },
    ]);
    expect(collected[1]).toEqual(
      expect.objectContaining({
        role: 'system',
        content: JSON.stringify({ ok: true }, null, 2),
        blockMetadata: expect.objectContaining({
          id: 'block_2',
          type: 'tool_result',
          level: 3,
          parentId: 'block_1',
          visualState: 'completed',
        }),
      }),
    );
  });

  it('updates the tool call and creates an error block when execution fails', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));

    const parameters = { path: 'README.md' };
    const { collector, collected, updates } = createCollectorDouble();
    const hooks = createBlockTrackingHooks(collector, createLoggerDouble());
    const context = await startToolExecution(hooks, 'readFile', parameters);

    vi.setSystemTime(new Date('2026-01-02T03:04:05.025Z'));
    const error = new Error('file not found');
    await hooks.onError('readFile', parameters, error, context);

    expect(updates).toEqual([
      {
        blockId: 'block_1',
        updates: expect.objectContaining({
          visualState: 'error',
          executionContext: expect.objectContaining({ duration: 25 }),
          renderData: { parameters, error },
        }),
      },
    ]);
    expect(collected[1]).toEqual(
      expect.objectContaining({
        role: 'system',
        content: '❌ Error: file not found',
        blockMetadata: expect.objectContaining({
          id: 'block_2',
          type: 'error',
          level: 1,
          parentId: 'block_1',
          visualState: 'error',
        }),
      }),
    );
  });

  it('warns and skips completion updates when no execution id is available', async () => {
    const logger = createLoggerDouble();
    const { collector, collected, updates } = createCollectorDouble();
    const hooks = createBlockTrackingHooks(collector, logger);

    await hooks.afterExecute('search', {}, 'result', {
      toolName: 'search',
      parameters: {},
    });

    expect(collected).toEqual([]);
    expect(updates).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      '⚠️ Block tracking: No executionId found for afterExecute',
    );
  });

  it('creates delegation hooks with the expected block metadata options', async () => {
    const parameters = { task: 'summarize' };
    const { collector, collected } = createCollectorDouble();
    const hooks = createDelegationTrackingHooks(collector, createLoggerDouble(), {
      parentBlockId: 'team_block',
      level: 1,
    });

    await hooks.beforeExecute(
      'delegate_to_agent',
      parameters,
      createContext('delegate_to_agent', parameters),
    );

    expect(collected).toEqual([
      expect.objectContaining({
        content: '🔧 delegate_to_agent',
        blockMetadata: expect.objectContaining({
          type: 'tool_call',
          parentId: 'team_block',
          level: 1,
        }),
      }),
    ]);
  });
});
