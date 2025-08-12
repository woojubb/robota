/**
 * Auto Layout Utilities using Dagre
 * 
 * Provides automatic node positioning for React Flow using the Dagre layout algorithm
 */

import dagre from 'dagre';
import type { Node, Edge } from '@xyflow/react';
import type { UniversalWorkflowNode, UniversalWorkflowEdge } from '@robota-sdk/agents';

/**
 * Layout configuration for different workflow types
 */
export interface LayoutConfig {
    rankdir: 'TB' | 'BT' | 'LR' | 'RL'; // Top-Bottom, Bottom-Top, Left-Right, Right-Left
    align?: 'UL' | 'UR' | 'DL' | 'DR'; // Up-Left, Up-Right, Down-Left, Down-Right  
    nodesep: number; // Separation between nodes in same rank
    edgesep: number; // Separation between edges
    ranksep: number; // Separation between ranks
    marginx: number; // Horizontal margin
    marginy: number; // Vertical margin
}

/**
 * Default layout configurations for different scenarios
 */
export const LAYOUT_PRESETS: Record<string, LayoutConfig> = {
    // Vertical workflow layout (default) - balanced spacing regardless of max node height
    vertical: {
        rankdir: 'TB',
        align: 'UL',
        nodesep: 70, // Moderate fixed spacing
        edgesep: 25, // Fixed edge spacing
        ranksep: 140, // Reasonable vertical spacing
        marginx: 50,
        marginy: 50
    },

    // Horizontal workflow layout - optimized for wide displays
    horizontal: {
        rankdir: 'LR',
        align: 'UL',
        nodesep: 60, // Fixed vertical separation
        edgesep: 25, // Fixed edge spacing
        ranksep: 220, // Horizontal spacing for content width
        marginx: 50,
        marginy: 50
    },

    // Compact layout for dense workflows - tight but readable spacing
    compact: {
        rankdir: 'TB',
        align: 'UL',
        nodesep: 50, // Compact but sufficient spacing
        edgesep: 20, // Minimal edge spacing
        ranksep: 100, // Tight vertical spacing
        marginx: 30,
        marginy: 30
    },

    // Spacious layout for presentations - generous but not excessive spacing
    spacious: {
        rankdir: 'TB',
        align: 'UL',
        nodesep: 100, // Generous spacing
        edgesep: 30, // Comfortable edge spacing
        ranksep: 200, // Spacious but reasonable vertical spacing
        marginx: 70,
        marginy: 70
    }
};

/**
 * Base node dimensions - used as starting point for calculations
 */
const BASE_NODE_DIMENSIONS = {
    width: 192, // Matches current w-48 (48 * 4px)
    height: 80  // Base minimum height
};

/**
 * Handle offset corrections for better edge connections
 */
const HANDLE_OFFSET = {
    top: 4,    // Offset from top edge for input handles
    bottom: 4, // Offset from bottom edge for output handles
    side: 4    // Offset from side edges for side handles
};

/**
 * Calculate dynamic node height based on content - more flexible sizing
 */
function calculateNodeHeight(node: Node): number {
    const data = node.data;
    let estimatedHeight = 60; // base height for header

    // Add height for content preview - limited to keep nodes compact
    if (data.userPrompt || data.userMessageContent || data.assistantMessage || data.contentPreview) {
        const content = data.userPrompt || data.userMessageContent || data.assistantMessage || data.contentPreview || '';

        // Truncate content to keep nodes at reasonable height
        const maxContentLength = 120; // Limit content to ~120 characters
        const truncatedContent = content.length > maxContentLength ? content.substring(0, maxContentLength) + '...' : content;

        // Calculate lines based on truncated content
        const charsPerLine = 40; // Slightly tighter character wrapping
        const lines = Math.ceil(truncatedContent.length / charsPerLine);

        // Limit to maximum 3 lines for compact display
        const lineHeight = 16; // Slightly smaller line height
        const maxLines = 3; // Keep it compact at 3 lines max
        const contentHeight = Math.min(lines * lineHeight, maxLines * lineHeight);

        estimatedHeight += contentHeight;
    }

    // Add height for badges/indicators - more compact
    const hasIndicators = (
        data.hasQuestions || data.containsUrgency || data.hasCodeBlocks ||
        data.hasLinks || data.isError || data.hasStructuredData ||
        data.aiProvider || data.availableTools || data.toolSlots
    );
    if (hasIndicators) {
        estimatedHeight += 20; // reduced space for badge row
    }

    // Add extra height for complex nodes - more compact
    if (node.type === 'agent' && (data.availableTools || data.toolSlots)) {
        estimatedHeight += 18; // reduced extra space for tool info
    }

    if (node.type === 'tool_call_response' && data.toolName) {
        estimatedHeight += 18; // reduced extra space for tool details
    }

    // Compact height limits - keep nodes reasonably sized
    const minHeight = 70; // Slightly reduced minimum
    const maxHeight = 400; // Allow taller nodes while keeping an upper bound for layout calculations

    return Math.max(minHeight, Math.min(estimatedHeight, maxHeight));
}

/**
 * Get dynamic node dimensions based on content and actual measurements
 */
function getNodeDimensions(node: Node, useActualDimensions = false): { width: number; height: number } {
    // Use actual measured dimensions if available
    if (useActualDimensions && node.data.actualWidth && node.data.actualHeight) {
        return {
            width: node.data.actualWidth,
            height: node.data.actualHeight
        };
    }

    // Fallback to calculated dimensions
    return {
        width: BASE_NODE_DIMENSIONS.width,
        height: calculateNodeHeight(node)
    };
}

/**
 * Apply Dagre layout to React Flow nodes and edges
 */
export function applyDagreLayout(
    nodes: Node[],
    edges: Edge[],
    config: LayoutConfig = LAYOUT_PRESETS.vertical,
    useActualDimensions = false
): { nodes: Node[]; edges: Edge[] } {

    // Keep a copy of the original edges, as we might modify them for layout
    const originalEdges = [...edges];

    // Create new dagre graph
    const dagreGraph = new dagre.graphlib.Graph();

    // Configure graph with provided (fixed) spacing only
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({
        rankdir: config.rankdir,
        align: config.align,
        nodesep: config.nodesep,
        edgesep: config.edgesep,
        ranksep: config.ranksep,
        marginx: config.marginx,
        marginy: config.marginy
    });

    // Add nodes to dagre graph with dynamic dimensions
    nodes.forEach((node) => {
        const dimensions = getNodeDimensions(node, useActualDimensions);
        dagreGraph.setNode(node.id, {
            width: dimensions.width,
            height: dimensions.height
        });
    });

    // Add original edges to the graph
    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    // For nodes with multiple parents, introduce a dummy node to guide the layout
    const childToParents = new Map<string, string[]>();
    edges.forEach((e) => {
        const parents = childToParents.get(e.target) || [];
        parents.push(e.source);
        childToParents.set(e.target, parents);
    });

    childToParents.forEach((parents, childId) => {
        if (parents.length > 1) {
            const dummyNodeId = `dummy-join-for-${childId}`;

            // Add a small, invisible dummy node
            dagreGraph.setNode(dummyNodeId, { width: 1, height: 1 });

            // Reroute edges from parents to the dummy node
            parents.forEach(parentId => {
                dagreGraph.removeEdge(parentId, childId);
                dagreGraph.setEdge(parentId, dummyNodeId);
            });

            // Connect the dummy node to the original child
            dagreGraph.setEdge(dummyNodeId, childId);
        }
    });

    // Run layout algorithm
    dagre.layout(dagreGraph);

    // Update node positions based on layout results, ignoring dummy nodes
    const layoutedNodes: Node[] = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        const dimensions = getNodeDimensions(node, useActualDimensions);

        // Determine handle positions based on layout direction
        const isHorizontal = config.rankdir === 'LR' || config.rankdir === 'RL';
        const sourcePosition = isHorizontal ? 'right' : 'bottom';
        const targetPosition = isHorizontal ? 'left' : 'top';

        // Calculate position with proper centering (Dagre uses center-center, React Flow uses top-left)
        const x = nodeWithPosition.x - dimensions.width / 2;
        const y = nodeWithPosition.y - dimensions.height / 2;

        return {
            ...node,
            position: { x, y },
            sourcePosition,
            targetPosition,
            style: {
                ...node.style
            },
            data: {
                ...node.data,
                computedWidth: dimensions.width,
                computedHeight: dimensions.height,
                sourcePosition,
                targetPosition
            }
        };
    });

    return {
        nodes: layoutedNodes,
        edges: originalEdges // Return the original edges for correct rendering
    };
}

/**
 * Convert Universal Workflow Structure to React Flow format with auto layout
 */
export function convertUniversalToReactFlowWithLayout(
    workflow: { nodes: UniversalWorkflowNode[]; edges: UniversalWorkflowEdge[] },
    layoutPreset: keyof typeof LAYOUT_PRESETS = 'vertical'
): { nodes: Node[]; edges: Edge[] } {

    // Convert nodes to React Flow format
    const reactFlowNodes: Node[] = workflow.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: { x: 0, y: 0 }, // Will be set by layout
        data: {
            label: node.data?.label || node.id,
            ...node.data
        },
        style: {
            ...node.visualState?.style
        }
    }));

    // Convert edges to React Flow format
    const reactFlowEdges: Edge[] = workflow.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type || 'default',
        label: edge.label,
        style: {
            ...edge.visualState?.style
        }
    }));

    // Apply layout
    return applyDagreLayout(reactFlowNodes, reactFlowEdges, LAYOUT_PRESETS[layoutPreset]);
}

/**
 * Apply layout to existing React Flow nodes and edges
 * @deprecated Use applyDagreLayout directly for better control
 */
export function layoutExistingFlow(
    nodes: Node[],
    edges: Edge[],
    layoutPreset: keyof typeof LAYOUT_PRESETS = 'vertical'
): { nodes: Node[]; edges: Edge[] } {
    return applyDagreLayout(nodes, edges, LAYOUT_PRESETS[layoutPreset]);
}

/**
 * Calculate optimal layout preset based on workflow characteristics
 */
export function suggestOptimalLayout(
    nodes: Node[],
    edges: Edge[]
): keyof typeof LAYOUT_PRESETS {
    const nodeCount = nodes.length;
    const avgConnectionsPerNode = edges.length / Math.max(nodeCount, 1);

    // Dense workflows benefit from compact layout
    if (nodeCount > 15 || avgConnectionsPerNode > 2.5) {
        return 'compact';
    }

    // Wide workflows benefit from horizontal layout
    if (nodeCount > 8 && avgConnectionsPerNode < 1.5) {
        return 'horizontal';
    }

    // Presentation scenarios
    if (nodeCount <= 6) {
        return 'spacious';
    }

    // Default to vertical for most cases
    return 'vertical';
}

/**
 * 동적 레이아웃을 위한 설정 생성
 */
export function createDynamicLayoutConfig(
    presetName: keyof typeof LAYOUT_PRESETS,
    customOverrides?: Partial<LayoutConfig>
): LayoutConfig {
    return {
        ...LAYOUT_PRESETS[presetName],
        ...customOverrides
    };
}

/**
 * 레이아웃 품질 검증 함수
 */
export function validateLayoutResult(
    nodes: Node[],
    edges: Edge[]
): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];

    // 노드 겹침 검사
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const node1 = nodes[i];
            const node2 = nodes[j];
            const distance = Math.sqrt(
                Math.pow(node1.position.x - node2.position.x, 2) +
                Math.pow(node1.position.y - node2.position.y, 2)
            );
            if (distance < 100) {
                issues.push(`Nodes ${node1.id} and ${node2.id} are too close (distance: ${distance.toFixed(1)})`);
            }
        }
    }

    // 엣지 연결 검증
    edges.forEach(edge => {
        const sourceNode = nodes.find(n => n.id === edge.source);
        const targetNode = nodes.find(n => n.id === edge.target);

        if (!sourceNode) {
            issues.push(`Edge ${edge.id}: source node ${edge.source} not found`);
        }
        if (!targetNode) {
            issues.push(`Edge ${edge.id}: target node ${edge.target} not found`);
        }
    });

    return {
        isValid: issues.length === 0,
        issues
    };
}

/**
 * 노드 크기 기반 최적 간격 계산 - 긴 노드 높이에 최적화
 */
export function calculateOptimalSpacing(nodes: Node[]): Partial<LayoutConfig> {
    if (nodes.length === 0) return {};

    // 실제 노드 크기 계산 (actualWidth/Height 우선, 없으면 계산)
    let totalWidth = 0;
    let totalHeight = 0;
    let maxHeight = 0;

    nodes.forEach(node => {
        const width = node.data?.actualWidth || node.data?.computedWidth || getNodeDimensions(node).width;
        const height = node.data?.actualHeight || node.data?.computedHeight || getNodeDimensions(node).height;

        totalWidth += width;
        totalHeight += height;
        maxHeight = Math.max(maxHeight, height);
    });

    const avgWidth = totalWidth / nodes.length;
    const avgHeight = totalHeight / nodes.length;

    // Horizontal spacing: keep within a reasonable fixed bound
    const nodesep = Math.max(60, Math.min(100, avgWidth * 0.3));

    // Vertical spacing (rank separation): tighten using average height only
    // Clamp to avoid excessive gaps for tall nodes while preventing overcrowding
    const unclampedRanksep = avgHeight * 0.4 + 40; // softer scaling than previous 1.2x
    const ranksep = Math.max(90, Math.min(220, unclampedRanksep));

    // Edge separation: small fixed window
    const edgesep = Math.max(25, Math.min(35, avgWidth * 0.15));

    // Margins scale mildly with average dimensions
    const extraMargin = maxHeight > 500 ? 80 : maxHeight > 200 ? 40 : 0;

    return {
        nodesep: Math.round(nodesep),
        ranksep: Math.round(ranksep),
        edgesep: Math.round(edgesep),
        marginx: Math.max(50, avgWidth * 0.4) + extraMargin,
        marginy: Math.max(50, avgHeight * 0.6) + extraMargin
    };
}