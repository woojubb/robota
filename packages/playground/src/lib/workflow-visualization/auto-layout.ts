/**
 * Auto Layout Utilities using Dagre
 * 
 * Provides automatic node positioning for React Flow using the Dagre layout algorithm
 */

import dagre from 'dagre';
import { Position, type Node, type Edge } from '@xyflow/react';
import type { IWorkflowEdge, IWorkflowNode } from '@robota-sdk/workflow';

/**
 * Layout configuration for different workflow types
 */
export interface ILayoutConfig {
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
export const LAYOUT_PRESETS: Record<string, ILayoutConfig> = {
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
 * Calculate dynamic node height based on content - more flexible sizing
 */
function calculateNodeHeight(node: Node): number {
    const data = node.data;
    let estimatedHeight = 60; // base height for header

    // Add height for content preview - allow more content for better visibility
    const contentCandidateKeys = ['userPrompt', 'userMessageContent', 'assistantMessage', 'contentPreview'] as const;
    let content: string | undefined;
    for (const key of contentCandidateKeys) {
        const value = data[key];
        if (typeof value === 'string' && value.length > 0) {
            content = value;
            break;
        }
    }

    if (typeof content === 'string') {

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
        data['hasQuestions'] === true ||
        data['containsUrgency'] === true ||
        data['hasCodeBlocks'] === true ||
        data['hasLinks'] === true ||
        data['isError'] === true ||
        data['hasStructuredData'] === true ||
        typeof data['aiProvider'] === 'string' ||
        Array.isArray(data['availableTools']) ||
        Array.isArray(data['toolSlots'])
    );
    if (hasIndicators) {
        estimatedHeight += 20; // reduced space for badge row
    }

    // Add extra height for complex nodes - properly account for tools and system message
    if (node.type === 'agent') {
        // Add height for tools list
        const tools = data['tools'];
        if (Array.isArray(tools)) {
            const toolsCount = tools.length;
            const toolsHeight = Math.min(toolsCount * 30, 150); // 30px per tool, max 150px
            estimatedHeight += toolsHeight;
        }

        // Add height for system message
        const systemMessage = data['systemMessage'];
        if (typeof systemMessage === 'string') {
            const messageLines = Math.ceil(systemMessage.length / 60); // ~60 chars per line
            const systemMessageHeight = Math.min(messageLines * 18, 200); // 18px per line, max 200px
            estimatedHeight += systemMessageHeight;
        }

        // Add extra spacing for section headers
        estimatedHeight += 40; // Space for "Model", "System Message", "Tools" headers
    }

    if (node.type === 'tool_call_response' && typeof data['toolName'] === 'string') {
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
    const actualWidth = node.data['actualWidth'];
    const actualHeight = node.data['actualHeight'];
    if (useActualDimensions && typeof actualWidth === 'number' && typeof actualHeight === 'number') {
        return {
            width: actualWidth,
            height: actualHeight
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
function calculateDynamicRanksep(nodes: Node[], config: ILayoutConfig, useActualDimensions: boolean): number {
    // With edge-based layout, we use a fixed gap
    // This is kept for compatibility but not actively used in the new layout
    return 100; // Fixed edge gap
}

/**
 * Apply Dagre layout to React Flow nodes and edges
 */
export function applyDagreLayout<TNode extends Node, TEdge extends Edge>(
    nodes: TNode[],
    edges: TEdge[],
    config: ILayoutConfig = LAYOUT_PRESETS.vertical,
    useActualDimensions = false
): { nodes: TNode[]; edges: TEdge[] } {

    // Keep a copy of the original edges, as we might modify them for layout
    const originalEdges: TEdge[] = [...edges];

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

    // Edge-based normalization for consistent edge lengths
    const FIXED_EDGE_GAP = 100; // Target edge length in pixels
    const isHorizontal = config.rankdir === 'LR' || config.rankdir === 'RL';

    // Edge-based layout calculation

    // Step 1: Calculate node depths (levels) in the graph
    const nodeDepths = new Map<string, number>();
    const visited = new Set<string>();

    function calculateDepth(nodeId: string, depth: number = 0) {
        if (visited.has(nodeId)) return;
        visited.add(nodeId);

        nodeDepths.set(nodeId, Math.max(nodeDepths.get(nodeId) || 0, depth));

        // Calculate depth for child nodes
        edges.filter(e => e.source === nodeId).forEach(edge => {
            calculateDepth(edge.target, depth + 1);
        });
    }

    // Find root nodes (nodes without parents) and start depth calculation
    nodes.forEach(node => {
        const hasParent = edges.some(e => e.target === node.id);
        if (!hasParent) {
            calculateDepth(node.id, 0);
        }
    });

    // Step 2: Calculate new positions based on parent-child relationships
    const newCenterByNodeId = new Map<string, { x: number; y: number }>();
    const nodePositions = new Map<string, number>(); // Store calculated positions

    // Group nodes by depth
    const depthGroups = new Map<number, string[]>();
    nodeDepths.forEach((depth, nodeId) => {
        const group = depthGroups.get(depth) || [];
        group.push(nodeId);
        depthGroups.set(depth, group);
    });

    // Process nodes depth by depth
    const sortedDepths = Array.from(depthGroups.keys()).sort((a, b) => a - b);

    sortedDepths.forEach(depth => {
        const nodesAtDepth = depthGroups.get(depth) || [];

        nodesAtDepth.forEach(nodeId => {
            const np = dagreGraph.node(nodeId) as { x?: number; y?: number } | undefined;
            if (!np || typeof np.x !== 'number' || typeof np.y !== 'number') return;

            const node = nodes.find(n => n.id === nodeId)!;
            const dims = getNodeDimensions(node, useActualDimensions);

            if (depth === 0) {
                // Root nodes keep their Dagre positions
                newCenterByNodeId.set(nodeId, { x: np.x, y: np.y });
                nodePositions.set(nodeId, isHorizontal ? np.x : np.y);
            } else {
                // Child nodes are positioned relative to their parents
                const parentEdges = edges.filter(e => e.target === nodeId);

                let newPosition: number;

                if (parentEdges.length === 1) {
                    // Single parent: position directly below/after parent
                    const parentId = parentEdges[0].source;
                    const parentNode = nodes.find(n => n.id === parentId)!;
                    const parentDims = getNodeDimensions(parentNode, useActualDimensions);
                    const parentPos = nodePositions.get(parentId) || 0;

                    // Calculate position: parent edge + fixed gap + half of child size
                    const parentEdge = parentPos + (isHorizontal ? parentDims.width : parentDims.height) / 2;
                    newPosition = parentEdge + FIXED_EDGE_GAP + (isHorizontal ? dims.width : dims.height) / 2;

                    // Debug removed in production
                } else {
                    // Multiple parents: position after the lowest/rightmost parent
                    let maxParentEdge = -Infinity;

                    parentEdges.forEach(edge => {
                        const parentId = edge.source;
                        const parentNode = nodes.find(n => n.id === parentId)!;
                        const parentDims = getNodeDimensions(parentNode, useActualDimensions);
                        const parentPos = nodePositions.get(parentId) || 0;
                        const parentEdge = parentPos + (isHorizontal ? parentDims.width : parentDims.height) / 2;
                        maxParentEdge = Math.max(maxParentEdge, parentEdge);
                    });

                    newPosition = maxParentEdge + FIXED_EDGE_GAP + (isHorizontal ? dims.width : dims.height) / 2;
                }

                // Store the new position
                nodePositions.set(nodeId, newPosition);

                // Set new center coordinates
                if (isHorizontal) {
                    newCenterByNodeId.set(nodeId, { x: newPosition, y: np.y });
                } else {
                    newCenterByNodeId.set(nodeId, { x: np.x, y: newPosition });
                }
            }
        });
    });

    // Update node positions based on normalized centers
    const layoutedNodes: TNode[] = nodes.map((node) => {
        const np = dagreGraph.node(node.id) as { x?: number; y?: number } | undefined;
        const dims = getNodeDimensions(node, useActualDimensions);

        // Determine handle positions based on layout direction
        const sourcePosition = isHorizontal ? Position.Right : Position.Bottom;
        const targetPosition = isHorizontal ? Position.Left : Position.Top;

        const newCenter = newCenterByNodeId.get(node.id);
        if (!newCenter || typeof newCenter.x !== 'number' || typeof newCenter.y !== 'number') {
            throw new Error('[NO-FALLBACK] Missing layout center for node');
        }
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

    // Debug removed in production

    return {
        nodes: layoutedNodes,
        edges: originalEdges // Return the original edges for correct rendering
    };
}

/**
 * Convert Universal Workflow Structure to React Flow format with auto layout
 */
export function convertUniversalToReactFlowWithLayout(
    workflow: { nodes: IWorkflowNode[]; edges: IWorkflowEdge[] },
    layoutPreset: keyof typeof LAYOUT_PRESETS = 'vertical'
): { nodes: Node[]; edges: Edge[] } {

    // Convert nodes to React Flow format
    const reactFlowNodes: Node[] = workflow.nodes.map((node) => ({
        id: node.id,
        type: node.type,
        position: { x: 0, y: 0 }, // Will be set by layout
        data: {
            ...node.data,
            label: node.data?.label ?? node.id
        }
    }));

    // Convert edges to React Flow format
    const reactFlowEdges: Edge[] = workflow.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        type: edge.type,
        label: edge.label
    }));

    // Apply layout
    return applyDagreLayout(reactFlowNodes, reactFlowEdges, LAYOUT_PRESETS[layoutPreset]);
}

/**
 * Apply layout to existing React Flow nodes and edges
 * @deprecated Use applyDagreLayout directly for better control
 */
export function layoutExistingFlow<TNode extends Node, TEdge extends Edge>(
    nodes: TNode[],
    edges: TEdge[],
    layoutPreset: keyof typeof LAYOUT_PRESETS = 'vertical'
): { nodes: TNode[]; edges: TEdge[] } {
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
 * Create layout config with optional overrides.
 */
export function createDynamicLayoutConfig(
    presetName: keyof typeof LAYOUT_PRESETS,
    customOverrides?: Partial<ILayoutConfig>
): ILayoutConfig {
    return {
        ...LAYOUT_PRESETS[presetName],
        ...customOverrides
    };
}

/**
 * Validate layout quality (basic overlap + edge endpoint existence).
 */
export function validateLayoutResult(
    nodes: Node[],
    edges: Edge[]
): { isValid: boolean; issues: string[] } {
    const issues: string[] = [];

    // Check node proximity (basic overlap proxy)
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

    // Validate edge endpoints exist
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
 * Calculate spacing overrides based on node dimensions.
 * Optimized to avoid excessive gaps for tall nodes.
 */
export function calculateOptimalSpacing(nodes: Node[]): Partial<ILayoutConfig> {
    if (nodes.length === 0) return {};

    // Compute actual node dimensions (prefer actualWidth/Height from data, otherwise compute).
    let totalWidth = 0;
    let totalHeight = 0;
    let maxHeight = 0;

    nodes.forEach(node => {
        const actualWidth = node.data['actualWidth'];
        const computedWidth = node.data['computedWidth'];
        const widthFromData =
            typeof actualWidth === 'number'
                ? actualWidth
                : typeof computedWidth === 'number'
                    ? computedWidth
                    : undefined;

        const actualHeight = node.data['actualHeight'];
        const computedHeight = node.data['computedHeight'];
        const heightFromData =
            typeof actualHeight === 'number'
                ? actualHeight
                : typeof computedHeight === 'number'
                    ? computedHeight
                    : undefined;

        const width = widthFromData ?? getNodeDimensions(node).width;
        const height = heightFromData ?? getNodeDimensions(node).height;

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