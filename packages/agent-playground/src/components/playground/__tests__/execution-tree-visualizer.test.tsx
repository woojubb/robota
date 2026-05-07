import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ExecutionTreeVisualizer } from '../execution-tree-visualizer';
import type {
  IBlockMessage,
  IBlockMetadata,
  IBlockTreeNode,
  IRealTimeBlockMessage,
  IRealTimeBlockMetadata,
  TBlockCollectionListener,
} from '../../../lib/playground/block-tracking/types';
import type { IPlaygroundBlockCollector } from '../../../lib/playground/block-tracking/block-collector';

interface ITestCollector extends IPlaygroundBlockCollector {
  clearBlocks: ReturnType<typeof vi.fn>;
  updateRealTimeBlock: ReturnType<typeof vi.fn>;
}

function createRealTimeBlock(
  id: string,
  metadataOverrides: Partial<IRealTimeBlockMetadata> = {},
): IRealTimeBlockMessage {
  const startTime = metadataOverrides.startTime ?? new Date('2026-05-05T12:00:00.000Z');
  const toolName = metadataOverrides.executionContext?.toolName ?? id;

  return {
    role: 'tool',
    content: `content:${id}`,
    timestamp: startTime,
    blockMetadata: {
      id,
      type: 'tool_call',
      level: 0,
      children: [],
      isExpanded: true,
      visualState: 'completed',
      startTime,
      actualDuration: 1500,
      executionContext: {
        toolName,
        executionId: id,
        timestamp: startTime,
      },
      executionHierarchy: {
        level: 0,
        path: [toolName],
      },
      ...metadataOverrides,
    },
  };
}

function createCollector(blocks: IRealTimeBlockMessage[]): ITestCollector {
  return {
    addListener: vi.fn((_listener: TBlockCollectionListener) => undefined),
    removeListener: vi.fn((_listener: TBlockCollectionListener) => undefined),
    collectBlock: vi.fn((_message: IBlockMessage) => undefined),
    updateBlock: vi.fn((_blockId: string, _updates: Partial<IBlockMetadata>) => undefined),
    getBlocks: vi.fn(() => blocks as unknown as IBlockMessage[]),
    getBlocksByParent: vi.fn((_parentId?: string) => []),
    clearBlocks: vi.fn(),
    generateBlockId: vi.fn(() => 'block-test-id'),
    createGroupBlock: vi.fn(
      (
        _type: 'user' | 'assistant' | 'tool_call' | 'group',
        _content: string,
        _parentId?: string,
        _level?: number,
      ) => createRealTimeBlock('group') as unknown as IBlockMessage,
    ),
    getStats: vi.fn(() => ({
      total: blocks.length,
      byType: {},
      byState: {},
      rootBlocks: blocks.filter((block) => !block.blockMetadata.parentId).length,
    })),
    updateRealTimeBlock: vi.fn(),
    getBlock: vi.fn((blockId: string) => {
      return blocks.find((block) => block.blockMetadata.id === blockId) as
        | IBlockMessage
        | undefined;
    }),
    removeBlock: vi.fn((_blockId: string) => undefined),
    getBlockTree: vi.fn((): IBlockTreeNode[] => []),
  };
}

function getFirstTextMatch(text: string): HTMLElement {
  return screen.getAllByText(text)[0] as HTMLElement;
}

describe('ExecutionTreeVisualizer', () => {
  it('renders empty execution state and clears through the collector', () => {
    const collector = createCollector([]);

    render(<ExecutionTreeVisualizer blockCollector={collector} />);

    expect(screen.getByText('Execution Tree')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('No Executions')).toBeInTheDocument();
    expect(
      screen.getByText('Real-time execution blocks will appear here as tools run'),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /clear/i }));

    expect(collector.clearBlocks).toHaveBeenCalledTimes(1);
  });

  it('calculates status counts and duration summary from real-time blocks', () => {
    const collector = createCollector([
      createRealTimeBlock('pending', { visualState: 'pending', actualDuration: undefined }),
      createRealTimeBlock('active', { visualState: 'in_progress', actualDuration: undefined }),
      createRealTimeBlock('done', { visualState: 'completed', actualDuration: 2500 }),
      createRealTimeBlock('failed', { visualState: 'error', actualDuration: undefined }),
    ]);

    render(<ExecutionTreeVisualizer blockCollector={collector} />);

    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('1 active')).toBeInTheDocument();
    expect(screen.getByText('1 done')).toBeInTheDocument();
    expect(screen.getByText('1 failed')).toBeInTheDocument();
    expect(screen.getByText('Total Duration: 2.5s')).toBeInTheDocument();
    expect(screen.getByText('Avg Duration: 2.5s')).toBeInTheDocument();
  });

  it('renders a sorted hierarchy, applies filters, and notifies block selection', () => {
    const onBlockSelect = vi.fn();
    const firstRoot = createRealTimeBlock('first-root', {
      startTime: new Date('2026-05-05T11:59:59.000Z'),
      executionContext: { toolName: 'FirstRoot', executionId: 'first-root', timestamp: new Date() },
      executionHierarchy: { level: 0, path: ['FirstRoot'] },
    });
    const parent = createRealTimeBlock('parent', {
      executionContext: { toolName: 'ParentTool', executionId: 'parent', timestamp: new Date() },
      executionHierarchy: { level: 0, path: ['ParentTool'] },
    });
    const child = createRealTimeBlock('child', {
      parentId: 'parent',
      executionContext: { toolName: 'ChildTool', executionId: 'child', timestamp: new Date() },
      executionHierarchy: { level: 1, path: ['ParentTool', 'ChildTool'] },
    });
    const filtered = createRealTimeBlock('filtered', {
      executionContext: {
        toolName: 'FilteredTool',
        executionId: 'filtered',
        timestamp: new Date(),
      },
    });
    const collector = createCollector([parent, filtered, child, firstRoot]);

    render(
      <ExecutionTreeVisualizer
        blockCollector={collector}
        blockFilter={(block) => block.blockMetadata.id !== 'filtered'}
        onBlockSelect={onBlockSelect}
      />,
    );

    const firstRootTitle = getFirstTextMatch('FirstRoot');
    const parentTitle = getFirstTextMatch('ParentTool');
    expect(firstRootTitle.compareDocumentPosition(parentTitle)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(getFirstTextMatch('ChildTool')).toBeInTheDocument();
    expect(screen.queryAllByText('FilteredTool')).toHaveLength(0);

    fireEvent.click(parentTitle);

    expect(onBlockSelect).toHaveBeenCalledWith(parent);
  });

  it('updates collector expansion state when a parent block is toggled', () => {
    const parent = createRealTimeBlock('parent', {
      children: ['child'],
      executionContext: { toolName: 'ParentTool', executionId: 'parent', timestamp: new Date() },
    });
    const child = createRealTimeBlock('child', {
      parentId: 'parent',
      executionContext: { toolName: 'ChildTool', executionId: 'child', timestamp: new Date() },
      executionHierarchy: { level: 1, path: ['ParentTool', 'ChildTool'] },
    });
    const collector = createCollector([parent, child]);

    render(<ExecutionTreeVisualizer blockCollector={collector} />);

    const buttons = screen.getAllByRole('button');
    fireEvent.click(buttons[1]);

    expect(collector.updateRealTimeBlock).toHaveBeenCalledWith('parent', { isExpanded: false });
  });
});
