import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IPlaygroundBlockCollector } from '../block-tracking/block-collector';
import type { IBlockMessage, IBlockTreeNode } from '../block-tracking/types';
import { generateComplexDemoData, generateDemoExecutionData } from '../demo-execution-data';

function createCollector(): {
  collector: IPlaygroundBlockCollector;
  collected: IBlockMessage[];
  clearCount: () => number;
} {
  const collected: IBlockMessage[] = [];
  let clears = 0;

  const collector: IPlaygroundBlockCollector = {
    collectBlock(message: IBlockMessage): void {
      collected.push(message);
    },
    updateBlock(): void {
      // Not used by demo data generation.
    },
    updateRealTimeBlock(): void {
      // Not used by demo data generation.
    },
    getBlocks(): IBlockMessage[] {
      return collected;
    },
    getBlocksByParent(): IBlockMessage[] {
      return [];
    },
    getBlock(): IBlockMessage | undefined {
      return undefined;
    },
    getBlockTree(): IBlockTreeNode[] {
      return [];
    },
    clearBlocks(): void {
      clears += 1;
      collected.length = 0;
    },
    generateBlockId(): string {
      return 'block_test';
    },
    createGroupBlock(): IBlockMessage {
      throw new Error('createGroupBlock is not used by demo data generation');
    },
    removeBlock(): void {
      // Not used by demo data generation.
    },
    getStats() {
      return {
        total: collected.length,
        byType: {},
        byState: {},
        rootBlocks: 0,
      };
    },
    addListener(): void {
      // Not used by demo data generation.
    },
    removeListener(): void {
      // Not used by demo data generation.
    },
  };

  return {
    collector,
    collected,
    clearCount: () => clears,
  };
}

describe('demo execution data', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('generates the stable demo block sequence and hierarchy', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));

    const { collector, collected, clearCount } = createCollector();

    generateDemoExecutionData(collector);

    expect(clearCount()).toBe(1);
    expect(collected.map((block) => block.blockMetadata.id)).toEqual([
      'user_001',
      'team_001',
      'agent_001',
      'tool_001',
      'tool_002',
      'llm_response_001',
    ]);
    expect(collected.map((block) => block.role)).toEqual([
      'user',
      'system',
      'assistant',
      'tool',
      'tool',
      'assistant',
    ]);
    expect(collected[2]?.blockMetadata.children).toEqual(['tool_001', 'tool_002']);
    expect(collected[5]?.blockMetadata.parentId).toBe('agent_001');
  });

  it('uses deterministic offsets from the generation time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-02T03:04:05.000Z'));

    const { collector, collected } = createCollector();

    generateDemoExecutionData(collector);

    expect(collected[0]?.timestamp?.toISOString()).toBe('2026-01-02T03:04:05.000Z');
    expect(collected[1]?.timestamp?.toISOString()).toBe('2026-01-02T03:04:05.200Z');
    expect(collected[3]?.timestamp?.toISOString()).toBe('2026-01-02T03:04:06.000Z');
    expect(collected[5]?.timestamp?.toISOString()).toBe('2026-01-02T03:04:18.000Z');
  });

  it('keeps complex demo generation behavior aligned with the regular demo', () => {
    const { collector, collected, clearCount } = createCollector();

    generateComplexDemoData(collector);

    expect(clearCount()).toBe(2);
    expect(collected).toHaveLength(6);
    expect(collected[0]?.blockMetadata.id).toBe('user_001');
  });
});
