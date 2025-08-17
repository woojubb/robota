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

    // Add height for content preview - allow more content for better visibility
    if (data.userPrompt || data.userMessageContent || data.assistantMessage || data.contentPreview) {
        const content = data.userPrompt || data.userMessageContent || data.assistantMessage || data.contentPreview || '';

        // Allow more content to be visible
        const maxContentLength = 300; // Increased to show more content
        const truncatedContent = content.length > maxContentLength ? content.substring(0, maxContentLength) + '...' : content;

        // Calculate lines based on truncated content
        const charsPerLine = 40; // Slightly tighter character wrapping
        const lines = Math.ceil(truncatedContent.length / charsPerLine);

        // Allow more lines for better readability
        const lineHeight = 18; // Standard line height
        const maxLines = 8; // Allow up to 8 lines
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

    // Add extra height for complex nodes - properly account for tools and system message
    if (node.type === 'agent') {
        // Add height for tools list
        if (data.tools && Array.isArray(data.tools)) {
            const toolsCount = data.tools.length;
            const toolsHeight = Math.min(toolsCount * 30, 150); // 30px per tool, max 150px
            estimatedHeight += toolsHeight;
        }

        // Add height for system message
        if (data.systemMessage) {
            const messageLines = Math.ceil(data.systemMessage.length / 60); // ~60 chars per line
            const systemMessageHeight = Math.min(messageLines * 18, 200); // 18px per line, max 200px
            estimatedHeight += systemMessageHeight;
        }

        // Add extra spacing for section headers
        estimatedHeight += 40; // Space for "Model", "System Message", "Tools" headers
    }

    if (node.type === 'tool_call_response' && data.toolName) {
        estimatedHeight += 18; // reduced extra space for tool details
    }

    // Height limits - allow taller nodes for full content display
    const minHeight = 70; // Slightly reduced minimum
    const maxHeight = 800; // Increased to accommodate tools and system prompts

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
 * Calculate dynamic ranksep based on actual node heights
 */
function calculateDynamicRanksep(nodes: Node[], config: LayoutConfig, useActualDimensions: boolean): number {
    const BASE_GAP = 50; // Minimum gap between ranks
    let maxNodeHeight = 0;

    // Find the maximum node height
    nodes.forEach(node => {
        const dims = getNodeDimensions(node, useActualDimensions);
        maxNodeHeight = Math.max(maxNodeHeight, dims.height);
    });

    // If we have actual dimensions and tall nodes, use dynamic spacing
    if (useActualDimensions && maxNodeHeight > 200) {
        // For tall nodes, ensure enough space
        return Math.max(config.ranksep, BASE_GAP);
    }

    // Otherwise use the configured ranksep
    return config.ranksep;
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

    // Calculate dynamic ranksep based on node heights
    const dynamicRanksep = calculateDynamicRanksep(nodes, config, useActualDimensions);

    // Configure graph with dynamic spacing
    dagreGraph.setDefaultEdgeLabel(() => ({}));
    dagreGraph.setGraph({
        rankdir: config.rankdir,
        align: config.align,
        nodesep: config.nodesep,
        edgesep: config.edgesep,
        ranksep: dynamicRanksep,
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

    // Baseline normalization per rank to honor node heights and keep constant inter-rank spacing
    // Group nodes by rank coordinate (center y for TB/BT, center x for LR/RL)
    type RankGroup = {
        key: number; // original center coordinate used for grouping
        nodeIds: string[];
        maxExtent: number; // max height for TB/BT, max width for LR/RL
    };

    const isHorizontal = config.rankdir === 'LR' || config.rankdir === 'RL';
    const groupMap = new Map<number, RankGroup>();
    const COORD_EPSILON = 1; // tolerance for grouping by coordinate

    // Build groups with max extent
    nodes.forEach((node) => {
        const np: any = dagreGraph.node(node.id);
        if (!np) return;
        const dims = getNodeDimensions(node, useActualDimensions);
        const center = isHorizontal ? np.x : np.y;
        // Quantize to reduce floating noise for grouping
        const key = Math.round(center / COORD_EPSILON) * COORD_EPSILON;
        const group = groupMap.get(key) || { key, nodeIds: [], maxExtent: 0 };
        group.nodeIds.push(node.id);
        group.maxExtent = Math.max(group.maxExtent, isHorizontal ? dims.width : dims.height);
        groupMap.set(key, group);
    });

    // Sort groups by original coordinate order (top-to-bottom or left-to-right)
    const groups = Array.from(groupMap.values()).sort((a, b) => a.key - b.key);

    // Compute new centers with constant spacing based on config.ranksep
    const newCenterByNodeId = new Map<string, { x: number; y: number }>();
    let prevBaseline = NaN; // bottom (TB) or right (LR) baseline of previous rank

    for (let i = 0; i < groups.length; i++) {
        const g = groups[i];

        // Determine this group's new baseline start based on previous group's baseline + ranksep
        let newGroupCenterCoord: number;
        if (i === 0) {
            // Anchor first group near its original center to reduce drift
            newGroupCenterCoord = g.key;
            const baseline = isHorizontal
                ? newGroupCenterCoord + g.maxExtent / 2
                : newGroupCenterCoord + g.maxExtent / 2;
            prevBaseline = baseline;
        } else {
            const newTopOrLeft = prevBaseline + dynamicRanksep; // dynamic gap between groups
            newGroupCenterCoord = newTopOrLeft + g.maxExtent / 2;
            prevBaseline = newTopOrLeft + g.maxExtent; // update baseline for next rank
        }

        // Assign new centers for nodes in this group
        g.nodeIds.forEach((id) => {
            const np: any = dagreGraph.node(id);
            if (!np) return;
            const dimsNode = nodes.find((n) => n.id === id)!;
            const dims = getNodeDimensions(dimsNode, useActualDimensions);
            const originalCenterOther = isHorizontal ? np.y : np.x; // keep cross-axis center
            const xCenter = isHorizontal ? newGroupCenterCoord : originalCenterOther;
            const yCenter = isHorizontal ? originalCenterOther : newGroupCenterCoord;
            newCenterByNodeId.set(id, { x: xCenter, y: yCenter });
        });
    }

    // Update node positions based on normalized centers
    const layoutedNodes: Node[] = nodes.map((node) => {
        const np: any = dagreGraph.node(node.id);
        const dims = getNodeDimensions(node, useActualDimensions);

        // Determine handle positions based on layout direction
        const sourcePosition = isHorizontal ? 'right' : 'bottom';
        const targetPosition = isHorizontal ? 'left' : 'top';

        const newCenter = newCenterByNodeId.get(node.id) || { x: np.x, y: np.y };
        const x = newCenter.x - dims.width / 2;
        const y = newCenter.y - dims.height / 2;

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
                computedWidth: dims.width,
                computedHeight: dims.height,
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