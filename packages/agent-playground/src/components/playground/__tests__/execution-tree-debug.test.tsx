import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExecutionTreeDebug } from '../execution-tree-debug';
import type { IPlaygroundBlockCollector } from '../../../lib/playground/block-tracking';
import type {
  IBlockMessage,
  IBlockMetadata,
  IBlockTreeNode,
  IRealTimeBlockMessage,
  IRealTimeBlockMetadata,
  TBlockCollectionListener,
} from '../../../lib/playground/block-tracking/types';

const demoDataMocks = vi.hoisted(() => ({
  generateDemoExecutionData: vi.fn(),
  generateComplexDemoData: vi.fn(),
}));

vi.mock('../../../lib/playground/demo-execution-data', () => demoDataMocks);

const webLoggerMock = vi.hoisted(() => ({
  WebLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../lib/web-logger', () => webLoggerMock);

interface ITestCollector extends IPlaygroundBlockCollector {
  clearBlocks: ReturnType<typeof vi.fn>;
  collectBlock: ReturnType<typeof vi.fn>;
}

function createRealTimeBlock(
  id: string,
  metadataOverrides: Partial<IRealTimeBlockMetadata> = {},
  content = `content:${id}`,
): IRealTimeBlockMessage {
  const startTime = metadataOverrides.startTime ?? new Date('2026-05-05T12:00:00.000Z');
  const toolName = metadataOverrides.executionContext?.toolName ?? id;

  return {
    role: 'tool',
    content,
    timestamp: startTime,
    blockMetadata: {
      id,
      type: 'tool_call',
      level: metadataOverrides.executionHierarchy?.level ?? 0,
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
    collectBlock: vi.fn((message: IBlockMessage) => {
      blocks.push(message as IRealTimeBlockMessage);
    }),
    updateBlock: vi.fn((_blockId: string, _updates: Partial<IBlockMetadata>) => undefined),
    updateRealTimeBlock: vi.fn(
      (_blockId: string, _updates: Partial<IRealTimeBlockMetadata>) => undefined,
    ),
    getBlocks: vi.fn(() => blocks as IBlockMessage[]),
    getBlocksByParent: vi.fn((_parentId?: string) => []),
    clearBlocks: vi.fn(() => {
      blocks.length = 0;
    }),
    generateBlockId: vi.fn(() => 'block-test-id'),
    createGroupBlock: vi.fn(
      (
        _type: 'user' | 'assistant' | 'tool_call' | 'group',
        _content: string,
        _parentId?: string,
        _level?: number,
      ) => createRealTimeBlock('group') as IBlockMessage,
    ),
    getStats: vi.fn(() => ({
      total: blocks.length,
      byType: {},
      byState: {},
      rootBlocks: blocks.filter((block) => !block.blockMetadata.parentId).length,
    })),
    getBlock: vi.fn((blockId: string) => {
      return blocks.find((block) => block.blockMetadata.id === blockId) as
        | IBlockMessage
        | undefined;
    }),
    removeBlock: vi.fn((_blockId: string) => undefined),
    getBlockTree: vi.fn((): IBlockTreeNode[] => []),
  };
}

describe('ExecutionTreeDebug', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty debug panes and clears through the collector', () => {
    const collector = createCollector([]);

    render(<ExecutionTreeDebug blockCollector={collector} refreshInterval={0} />);

    expect(screen.getByText('Execution Tree Debug')).toBeInTheDocument();
    expect(screen.getByText('0 blocks')).toBeInTheDocument();
    expect(screen.getByText('0 roots')).toBeInTheDocument();
    expect(screen.getByText('No execution blocks yet')).toBeInTheDocument();
    expect(screen.getByText('No blocks collected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /clear/i }));

    expect(collector.clearBlocks).toHaveBeenCalledTimes(1);
  });

  it('builds tree and raw block debug output from real-time block metadata', () => {
    const longContent = 'x'.repeat(120);
    const parent = createRealTimeBlock('parent', {
      visualState: 'in_progress',
      executionContext: {
        toolName: 'ParentTool',
        executionId: 'parent',
        timestamp: new Date('2026-05-05T12:00:00.000Z'),
      },
      executionHierarchy: { level: 0, path: ['ParentTool'] },
    });
    const child = createRealTimeBlock('child', {
      parentId: 'parent',
      visualState: 'error',
      executionContext: {
        toolName: 'ChildTool',
        executionId: 'child',
        timestamp: new Date('2026-05-05T12:00:01.000Z'),
      },
      executionHierarchy: { level: 1, path: ['ParentTool', 'ChildTool'] },
    });
    const completed = createRealTimeBlock(
      'completed',
      {
        visualState: 'completed',
        executionContext: {
          toolName: 'CompletedTool',
          executionId: 'completed',
          timestamp: new Date('2026-05-05T12:00:02.000Z'),
        },
        executionHierarchy: { level: 0, path: ['CompletedTool'] },
      },
      longContent,
    );
    const collector = createCollector([parent, child, completed]);

    const { container } = render(
      <ExecutionTreeDebug blockCollector={collector} refreshInterval={0} />,
    );

    expect(screen.getByText('3 blocks')).toBeInTheDocument();
    expect(screen.getByText('2 roots')).toBeInTheDocument();
    expect(screen.getByText('1 active')).toBeInTheDocument();
    expect(screen.getByText('1 done')).toBeInTheDocument();
    expect(screen.getByText('1 failed')).toBeInTheDocument();
    expect(screen.getByText('Raw Blocks (3)')).toBeInTheDocument();

    const debugText = container.textContent ?? '';
    expect(debugText).toContain('"toolName": "ParentTool"');
    expect(debugText).toContain('"toolName": "ChildTool"');
    expect(debugText).toContain('"parentId": "parent"');
    expect(debugText).toContain('"path": [');
    expect(debugText).toContain(`${'x'.repeat(100)}...`);
  });

  it('generates simple and complex demo data through debug controls', () => {
    const collector = createCollector([]);

    render(<ExecutionTreeDebug blockCollector={collector} refreshInterval={0} />);

    fireEvent.click(screen.getByRole('button', { name: /generate demo/i }));
    fireEvent.click(screen.getByRole('button', { name: /complex demo/i }));

    expect(collector.collectBlock).toHaveBeenCalledTimes(1);
    expect(demoDataMocks.generateDemoExecutionData).toHaveBeenCalledWith(collector);
    expect(demoDataMocks.generateComplexDemoData).toHaveBeenCalledWith(collector);
    expect(webLoggerMock.WebLogger.info).toHaveBeenCalledWith('Demo data generated successfully');
    expect(webLoggerMock.WebLogger.info).toHaveBeenCalledWith(
      'Complex demo data generated successfully',
    );
  });
});
