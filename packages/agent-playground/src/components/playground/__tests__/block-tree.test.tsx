import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BlockTree } from '../block-visualization/block-tree';
import type {
  IBlockDataCollector,
  IBlockMessage,
  IBlockMetadata,
  TBlockCollectionListener,
} from '../../../lib/playground/block-tracking/types';

interface ITestCollector extends IBlockDataCollector {
  listeners: TBlockCollectionListener[];
  clearBlocks: ReturnType<typeof vi.fn>;
  getBlocks: ReturnType<typeof vi.fn>;
  getStats: ReturnType<typeof vi.fn>;
  updateBlock: ReturnType<typeof vi.fn>;
}

function createBlock(
  id: string,
  metadataOverrides: Partial<IBlockMetadata> = {},
  content = `content:${id}`,
): IBlockMessage {
  const timestamp = new Date('2026-05-05T12:00:00.000Z');

  return {
    role: 'tool',
    content,
    timestamp,
    blockMetadata: {
      id,
      type: 'tool_call',
      level: 0,
      children: [],
      isExpanded: true,
      visualState: 'completed',
      executionContext: {
        toolName: id,
        executionId: id,
        timestamp,
      },
      ...metadataOverrides,
    },
  };
}

function createStats(blocks: IBlockMessage[]) {
  return {
    total: blocks.length,
    byType: {},
    byState: blocks.reduce<Record<string, number>>((counts, block) => {
      const state = block.blockMetadata.visualState;
      counts[state] = (counts[state] ?? 0) + 1;
      return counts;
    }, {}),
    rootBlocks: blocks.filter((block) => !block.blockMetadata.parentId).length,
  };
}

function createCollector(blocks: IBlockMessage[]): ITestCollector {
  const listeners: TBlockCollectionListener[] = [];

  return {
    listeners,
    collectBlock: vi.fn((_message: IBlockMessage) => undefined),
    updateBlock: vi.fn((_blockId: string, _updates: Partial<IBlockMetadata>) => undefined),
    getBlocks: vi.fn(() => blocks),
    getBlocksByParent: vi.fn((_parentId?: string) => []),
    clearBlocks: vi.fn(() => undefined),
    generateBlockId: vi.fn(() => 'block-test-id'),
    createGroupBlock: vi.fn(
      (
        _type: 'user' | 'assistant' | 'tool_call' | 'group',
        _content: string,
        _parentId?: string,
        _level?: number,
      ) => createBlock('group'),
    ),
    getStats: vi.fn(() => createStats(blocks)),
    addListener: vi.fn((listener: TBlockCollectionListener) => {
      listeners.push(listener);
    }),
    removeListener: vi.fn((listener: TBlockCollectionListener) => {
      const listenerIndex = listeners.indexOf(listener);
      if (listenerIndex >= 0) {
        listeners.splice(listenerIndex, 1);
      }
    }),
  };
}

function emitCollectorEvent(
  collector: ITestCollector,
  event: Parameters<TBlockCollectionListener>[0],
): void {
  collector.listeners.forEach((listener) => {
    listener(event);
  });
}

describe('BlockTree', () => {
  it('renders stats badges and toggles debug metadata visibility', () => {
    const runningBlock = createBlock('running', { visualState: 'in_progress' }, 'Running block');
    const errorBlock = createBlock('error', { type: 'error', visualState: 'error' }, 'Error block');
    const collector = createCollector([runningBlock, errorBlock]);

    render(<BlockTree blockCollector={collector} showDebug={false} />);

    expect(screen.getByText('2 blocks')).toBeInTheDocument();
    expect(screen.getByText('1 running')).toBeInTheDocument();
    expect(screen.getByText('1 errors')).toBeInTheDocument();
    expect(screen.queryByText('ID: running')).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button')[0] as HTMLElement);

    expect(screen.getByText('ID: running')).toBeInTheDocument();
    expect(screen.getByText('ID: error')).toBeInTheDocument();
  });

  it('builds child hierarchy, toggles expansion, and notifies block selection', () => {
    const onBlockSelect = vi.fn();
    const parent = createBlock('parent', { children: ['child'] }, 'Parent block');
    const child = createBlock('child', { parentId: 'parent', level: 1 }, 'Child block');
    const collector = createCollector([parent, child]);

    render(<BlockTree blockCollector={collector} onBlockSelect={onBlockSelect} />);

    expect(screen.getByText('Parent block')).toBeInTheDocument();
    expect(screen.queryByText('Child block')).not.toBeInTheDocument();

    const parentToggle = screen.getAllByRole('button')[2] as HTMLElement;
    fireEvent.click(parentToggle);
    fireEvent.click(parentToggle);

    expect(collector.updateBlock).toHaveBeenCalledWith('parent', { isExpanded: false });
    expect(collector.updateBlock).toHaveBeenCalledWith('parent', { isExpanded: true });
    expect(screen.getByText('Child block')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Child block'));

    expect(onBlockSelect).toHaveBeenCalledWith(child);
  });

  it('updates from collector events and clears expanded state', () => {
    const parent = createBlock('parent', { children: ['child'] }, 'Parent block');
    const child = createBlock('child', { parentId: 'parent', level: 1 }, 'Child block');
    const blocks = [parent];
    const collector = createCollector(blocks);

    render(<BlockTree blockCollector={collector} />);

    expect(screen.queryByText('Child block')).not.toBeInTheDocument();

    act(() => {
      blocks.push(child);
      emitCollectorEvent(collector, { type: 'block_added', block: child });
    });

    expect(screen.getByText('Child block')).toBeInTheDocument();

    act(() => {
      blocks.length = 0;
      emitCollectorEvent(collector, { type: 'blocks_cleared' });
    });

    expect(screen.getByText('No blocks yet')).toBeInTheDocument();
  });
});
