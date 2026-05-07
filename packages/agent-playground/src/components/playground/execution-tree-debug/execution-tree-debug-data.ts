import type { IPlaygroundBlockCollector } from '../../../lib/playground/block-tracking';
import type {
  IBlockMessage,
  IRealTimeBlockMessage,
  IRealTimeBlockMetadata,
} from '../../../lib/playground/block-tracking/types';
import { CONTENT_PREVIEW_LENGTH } from './constants';
import type { IDebugTreeNode, IExecutionTreeDebugData, IExecutionTreeDebugStats } from './types';

type TRawBlockBadgeVariant = 'default' | 'destructive' | 'secondary' | 'outline';
type TDebugContent =
  | string
  | number
  | boolean
  | null
  | readonly TDebugContent[]
  | { readonly [key: string]: TDebugContent };

export interface IRawBlockDebugData {
  id: string;
  type: string;
  toolName?: string;
  parentId?: string;
  level?: number;
  path?: string[];
  startTime?: string;
  duration?: number;
  content: string;
}

function isRealTimeBlockMessage(block: IBlockMessage): block is IRealTimeBlockMessage {
  return 'startTime' in block.blockMetadata || 'executionHierarchy' in block.blockMetadata;
}

function createDebugTreeNode(metadata: IRealTimeBlockMetadata, isClient: boolean): IDebugTreeNode {
  return {
    id: metadata.id,
    type: metadata.type,
    state: metadata.visualState,
    toolName: metadata.executionContext?.toolName,
    level: metadata.executionHierarchy?.level ?? 0,
    parentId: metadata.parentId,
    startTime: isClient && metadata.startTime ? metadata.startTime.toISOString() : undefined,
    endTime: isClient && metadata.endTime ? metadata.endTime.toISOString() : undefined,
    duration: metadata.actualDuration,
    executionPath: metadata.executionHierarchy?.path,
    children: [],
  };
}

function sortNodesByTime(nodes: IDebugTreeNode[]): void {
  nodes.sort((a, b) => {
    const aTime = a.startTime ? new Date(a.startTime).getTime() : 0;
    const bTime = b.startTime ? new Date(b.startTime).getTime() : 0;
    return aTime - bTime;
  });

  nodes.forEach((node) => {
    if (node.children.length > 0) {
      sortNodesByTime(node.children);
    }
  });
}

function buildDebugTree(realTimeBlocks: IRealTimeBlockMessage[], isClient: boolean) {
  const rootNodes: IDebugTreeNode[] = [];
  const nodeMap = new Map<string, IDebugTreeNode>();

  realTimeBlocks.forEach((block) => {
    const metadata = block.blockMetadata;
    nodeMap.set(metadata.id, createDebugTreeNode(metadata, isClient));
  });

  realTimeBlocks.forEach((block) => {
    const metadata = block.blockMetadata;
    const node = nodeMap.get(metadata.id);
    if (!node) return;

    const parentId = metadata.parentId;
    if (parentId && nodeMap.has(parentId)) {
      const parentNode = nodeMap.get(parentId);
      parentNode?.children.push(node);
    } else {
      rootNodes.push(node);
    }
  });

  sortNodesByTime(rootNodes);

  return rootNodes;
}

function countVisualState(
  blocks: IRealTimeBlockMessage[],
  state: IRealTimeBlockMetadata['visualState'],
): number {
  return blocks.filter((block) => block.blockMetadata.visualState === state).length;
}

function createDebugStats(
  realTimeBlocks: IRealTimeBlockMessage[],
  rootNodes: IDebugTreeNode[],
): IExecutionTreeDebugStats {
  return {
    totalBlocks: realTimeBlocks.length,
    rootNodes: rootNodes.length,
    pending: countVisualState(realTimeBlocks, 'pending'),
    inProgress: countVisualState(realTimeBlocks, 'in_progress'),
    completed: countVisualState(realTimeBlocks, 'completed'),
    error: countVisualState(realTimeBlocks, 'error'),
  };
}

export function buildExecutionTreeDebugData(
  blockCollector: IPlaygroundBlockCollector,
  isClient: boolean,
): IExecutionTreeDebugData {
  const allBlocks = blockCollector.getBlocks();
  const realTimeBlocks = allBlocks.filter(isRealTimeBlockMessage);
  const debugTree = buildDebugTree(realTimeBlocks, isClient);

  return {
    debugTree,
    rawBlocks: realTimeBlocks,
    stats: createDebugStats(realTimeBlocks, debugTree),
  };
}

export function getRawBlockBadgeVariant(
  visualState: IRealTimeBlockMetadata['visualState'],
): TRawBlockBadgeVariant {
  if (visualState === 'completed') return 'default';
  if (visualState === 'error') return 'destructive';
  if (visualState === 'in_progress') return 'secondary';
  return 'outline';
}

function createContentPreview(content: TDebugContent): string {
  if (typeof content === 'string') {
    return (
      content.substring(0, CONTENT_PREVIEW_LENGTH) +
      (content.length > CONTENT_PREVIEW_LENGTH ? '...' : '')
    );
  }

  if (content) {
    return JSON.stringify(content).substring(0, CONTENT_PREVIEW_LENGTH) + '...';
  }

  return '';
}

export function createRawBlockDebugData(block: IRealTimeBlockMessage): IRawBlockDebugData {
  const metadata = block.blockMetadata;

  return {
    id: metadata.id,
    type: metadata.type,
    toolName: metadata.executionContext?.toolName,
    parentId: metadata.parentId,
    level: metadata.executionHierarchy?.level,
    path: metadata.executionHierarchy?.path,
    startTime: metadata.startTime?.toISOString(),
    duration: metadata.actualDuration,
    content: createContentPreview(block.content),
  };
}
