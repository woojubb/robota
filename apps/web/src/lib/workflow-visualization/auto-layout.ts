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
    // Vertical workflow layout (default) - optimized for edge connections
    vertical: {
        rankdir: 'TB',
        align: 'UL',
        nodesep: 40,
        edgesep: 15,
        ranksep: 60, // Reduced from 80 to 60 for tighter vertical spacing
        marginx: 40,
        marginy: 40
    },

    // Horizontal workflow layout - optimized for wide displays
    horizontal: {
        rankdir: 'LR',
        align: 'UL',
        nodesep: 25,
        edgesep: 15,
        ranksep: 120,
        marginx: 40,
        marginy: 40
    },

    // Compact layout for dense workflows - tighter spacing
    compact: {
        rankdir: 'TB',
        align: 'UL',
        nodesep: 25,
        edgesep: 8,
        ranksep: 40, // Reduced from 50 to 40 for very tight vertical spacing
        marginx: 25,
        marginy: 25
    },

    // Spacious layout for presentations - wider spacing
    spacious: {
        rankdir: 'TB',
        align: 'UL',
        nodesep: 60,
        edgesep: 20,
        ranksep: 120,
        marginx: 60,
        marginy: 60
    }
};

/**
 * Node dimensions based on type with precise measurements
 */
const NODE_DIMENSIONS = {
    default: { width: 200, height: 80 },
    agent: { width: 220, height: 100 },
    agent_thinking: { width: 200, height: 80 },
    tool_call: { width: 180, height: 70 },
    tool_call_response: { width: 180, height: 70 },
    user_message: { width: 160, height: 60 },
    merge_results: { width: 200, height: 80 },
    response: { width: 180, height: 70 }
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
 * Get node dimensions based on type
 */
function getNodeDimensions(nodeType?: string): { width: number; height: number } {
    return NODE_DIMENSIONS[nodeType as keyof typeof NODE_DIMENSIONS] || NODE_DIMENSIONS.default;
}

/**
 * Apply Dagre layout to React Flow nodes and edges
 */
export function applyDagreLayout(
    nodes: Node[],
    edges: Edge[],
    config: LayoutConfig = LAYOUT_PRESETS.vertical
): { nodes: Node[]; edges: Edge[] } {

    // Create new dagre graph
    const dagreGraph = new dagre.graphlib.Graph();

    // Configure graph
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

    // Add nodes to dagre graph
    nodes.forEach((node) => {
        const dimensions = getNodeDimensions(node.type);
        dagreGraph.setNode(node.id, {
            width: dimensions.width,
            height: dimensions.height
        });
    });

    // Add edges to dagre graph
    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    // Run layout algorithm
    dagre.layout(dagreGraph);

    // Update node positions based on layout results with handle positioning
    const layoutedNodes: Node[] = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        const dimensions = getNodeDimensions(node.type);

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
            // Set dynamic handle positions based on layout direction
            sourcePosition,
            targetPosition,
            // Ensure nodes have proper width for React Flow (height auto)
            style: {
                ...node.style,
                width: dimensions.width
                // height removed - let content determine natural height
            },
            // Add computed dimensions and handle positions to data
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
        edges: edges // Edges don't need position updates
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
 * 노드 크기 기반 최적 간격 계산
 */
export function calculateOptimalSpacing(nodes: Node[]): Partial<LayoutConfig> {
    if (nodes.length === 0) return {};

    // 평균 노드 크기 계산
    const avgWidth = nodes.reduce((sum, node) =>
        sum + (node.data?.computedWidth || 200), 0) / nodes.length;
    const avgHeight = nodes.reduce((sum, node) =>
        sum + (node.data?.computedHeight || 80), 0) / nodes.length;

    // 크기에 따른 동적 간격 조정
    const nodesep = Math.max(40, avgWidth * 0.2);
    const ranksep = Math.max(60, avgHeight * 1.2);
    const edgesep = Math.max(15, avgWidth * 0.1);

    return {
        nodesep,
        ranksep,
        edgesep,
        marginx: Math.max(40, avgWidth * 0.3),
        marginy: Math.max(40, avgHeight * 0.5)
    };
}