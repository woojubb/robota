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
    ranksep: 80,
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
    ranksep: 50,
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

      // Update node positions based on layout results with handle offset correction
  const layoutedNodes: Node[] = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    const dimensions = getNodeDimensions(node.type);
    
    // Calculate position with proper centering and handle offset
    const x = nodeWithPosition.x - dimensions.width / 2;
    const y = nodeWithPosition.y - dimensions.height / 2;
    
    return {
      ...node,
      position: { x, y },
      // Ensure nodes have proper dimensions for React Flow
      style: {
        ...node.style,
        width: dimensions.width,
        height: dimensions.height
      },
      // Add computed dimensions to data for handle positioning
      data: {
        ...node.data,
        computedWidth: dimensions.width,
        computedHeight: dimensions.height
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