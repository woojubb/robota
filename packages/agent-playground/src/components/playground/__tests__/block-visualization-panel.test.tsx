import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { BlockVisualizationPanel } from '../block-visualization/block-visualization-panel';
import type { IPlaygroundBlockCollector } from '../../../lib/playground/block-tracking';
import type {
  IBlockMessage,
  IBlockMetadata,
  IBlockTreeNode,
  TBlockCollectionEvent,
  TBlockCollectionListener,
} from '../../../lib/playground/block-tracking/types';

interface ITestCollector extends IPlaygroundBlockCollector {
  listeners: TBlockCollectionListener[];
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
    byType: blocks.reduce<Record<string, number>>((counts, block) => {
      const type = block.blockMetadata.type;
      counts[type] = (counts[type] ?? 0) + 1;
      return counts;
    }, {}),
    byState: blocks.reduce<Record<string, number>>((counts, block) => {
      const state = block.blockMetadata.visualState;
      counts[state] = (counts[state] ?? 0) + 1;
      return counts;
    }, {}),
    rootBlocks: blocks.filter((block) => !block.blockMetadata.parentId).length,
  };
}

function createTreeNode(
  block: IBlockMessage,
  blockMap: Map<string, IBlockMessage>,
  parent?: IBlockTreeNode,
): IBlockTreeNode {
  const node: IBlockTreeNode = {
    block,
    children: [],
    parent,
  };

  node.children = block.blockMetadata.children
    .map((childId) => blockMap.get(childId))
    .filter((child): child is IBlockMessage => child !== undefined)
    .map((child) => createTreeNode(child, blockMap, node));

  return node;
}

function createBlockTree(blocks: IBlockMessage[]): IBlockTreeNode[] {
  const blockMap = new Map(blocks.map((block) => [block.blockMetadata.id, block]));

  return blocks
    .filter((block) => !block.blockMetadata.parentId)
    .map((block) => createTreeNode(block, blockMap));
}

function createCollector(blocks: IBlockMessage[]): ITestCollector {
  const listeners: TBlockCollectionListener[] = [];

  return {
    listeners,
    collectBlock: vi.fn((message: IBlockMessage) => {
      blocks.push(message);
      listeners.forEach((listener) => listener({ type: 'block_added', block: message }));
    }),
    updateBlock: vi.fn((blockId: string, updates: Partial<IBlockMetadata>) => {
      const block = blocks.find((item) => item.blockMetadata.id === blockId);
      if (!block) return;
      Object.assign(block.blockMetadata, updates);
      listeners.forEach((listener) => listener({ type: 'block_updated', blockId, updates }));
    }),
    updateRealTimeBlock: vi.fn((blockId: string, updates: Partial<IBlockMetadata>) => {
      const block = blocks.find((item) => item.blockMetadata.id === blockId);
      if (!block) return;
      Object.assign(block.blockMetadata, updates);
      listeners.forEach((listener) => listener({ type: 'block_updated', blockId, updates }));
    }),
    getBlocks: vi.fn(() => blocks),
    getBlocksByParent: vi.fn((parentId?: string) =>
      blocks.filter((block) => block.blockMetadata.parentId === parentId),
    ),
    getBlock: vi.fn((blockId: string) =>
      blocks.find((block) => block.blockMetadata.id === blockId),
    ),
    getBlockTree: vi.fn(() => createBlockTree(blocks)),
    removeBlock: vi.fn((blockId: string) => {
      const blockIndex = blocks.findIndex((block) => block.blockMetadata.id === blockId);
      if (blockIndex < 0) return;
      blocks.splice(blockIndex, 1);
      listeners.forEach((listener) => listener({ type: 'block_removed', blockId }));
    }),
    clearBlocks: vi.fn(() => {
      blocks.length = 0;
      listeners.forEach((listener) => listener({ type: 'blocks_cleared' }));
    }),
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

function emitCollectorEvent(collector: ITestCollector, event: TBlockCollectionEvent): void {
  collector.listeners.forEach((listener) => {
    listener(event);
  });
}

function clickTab(name: string): void {
  fireEvent.mouseDown(screen.getByRole('tab', { name }));
}

describe('BlockVisualizationPanel', () => {
  it('renders the tree shell and tabbed summary views from collector stats', () => {
    const blocks = [
      createBlock('running', { type: 'assistant', visualState: 'in_progress' }, 'Running block'),
      createBlock('completed', { visualState: 'completed' }, 'Completed block'),
      createBlock('error', { type: 'error', visualState: 'error' }, 'Error block'),
    ];
    const collector = createCollector(blocks);

    render(<BlockVisualizationPanel blockCollector={collector} height="400px" />);

    expect(screen.getByText('Block Visualization')).toBeInTheDocument();
    expect(screen.getByText('Real-time')).toBeInTheDocument();
    expect(screen.getByText('3 blocks')).toBeInTheDocument();
    expect(screen.getByText('1 running')).toBeInTheDocument();
    expect(screen.getByText('1 errors')).toBeInTheDocument();

    clickTab('Stats');

    const statsPanel = screen.getByRole('tabpanel');
    expect(within(statsPanel).getByText('Total Blocks')).toBeInTheDocument();
    expect(within(statsPanel).getByText('Running')).toBeInTheDocument();
    expect(within(statsPanel).getByText('Completed')).toBeInTheDocument();
    expect(within(statsPanel).getByText('Errors')).toBeInTheDocument();

    clickTab('Types');

    const typesPanel = screen.getByRole('tabpanel');
    expect(within(typesPanel).getByText('assistant')).toBeInTheDocument();
    expect(within(typesPanel).getByText('tool call')).toBeInTheDocument();
    expect(within(typesPanel).getByText('error')).toBeInTheDocument();
  });

  it('updates summary views when collector events are emitted', () => {
    const blocks = [
      createBlock('running', { type: 'assistant', visualState: 'in_progress' }, 'Running block'),
    ];
    const collector = createCollector(blocks);

    render(<BlockVisualizationPanel blockCollector={collector} />);
    clickTab('Stats');

    expect(screen.getByText('Total Blocks')).toBeInTheDocument();

    const completedBlock = createBlock(
      'completed',
      { visualState: 'completed' },
      'Completed block',
    );

    act(() => {
      blocks.push(completedBlock);
      emitCollectorEvent(collector, { type: 'block_added', block: completedBlock });
    });

    const statsPanel = screen.getByRole('tabpanel');
    expect(within(statsPanel).getByText('2')).toBeInTheDocument();
    expect(within(statsPanel).getByText('Completed')).toBeInTheDocument();
  });

  it('inspects the selected block and can clear the inspector selection', () => {
    const onBlockInspect = vi.fn();
    const inspectableBlock = createBlock(
      'inspectable',
      {
        level: 2,
        children: ['child'],
        executionContext: {
          toolName: 'calculator',
          executionId: 'exec-inspectable',
          timestamp: new Date('2026-05-05T12:00:00.000Z'),
          duration: 1250,
        },
        renderData: {
          result: { answer: 42 },
        },
      },
      'Inspectable content',
    );
    const collector = createCollector([inspectableBlock]);

    render(<BlockVisualizationPanel blockCollector={collector} onBlockInspect={onBlockInspect} />);

    fireEvent.click(screen.getByText('Inspectable content'));

    expect(onBlockInspect).toHaveBeenCalledWith(inspectableBlock);

    clickTab('Inspect');

    expect(screen.getByText('Block Inspector')).toBeInTheDocument();
    expect(screen.getByText('inspectable')).toBeInTheDocument();
    expect(screen.getByText('tool_call')).toBeInTheDocument();
    expect(screen.getByText('completed')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('calculator')).toBeInTheDocument();
    expect(screen.getByText('1.3s')).toBeInTheDocument();
    expect(screen.getByText('Inspectable content')).toBeInTheDocument();
    expect(screen.getByText(/"answer": 42/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '×' }));

    expect(screen.getByText('Select a block to inspect')).toBeInTheDocument();
  });
});
