import type { Node, Edge } from '@xyflow/react';

/**
 * Node Bundle - A group of nodes and their connecting edges
 */
export interface NodeBundle<TNode = Node, TEdge = Edge> {
    nodes: TNode[];
    edges: TEdge[];
    metadata: {
        bundleIndex: number;
        totalBundles: number;
        nodeCount: number;
        edgeCount: number;
    };
}

/**
 * Bundle Strategy - How to group nodes for progressive revelation
 */
export type BundleStrategy =
    | 'sequential'      // One node at a time in order
    | 'by-type'         // Group by node type (all agents, then all tools, etc.)
    | 'by-level'        // Group by execution level/depth
    | 'connected'       // Group connected components together
    | 'custom';         // Use custom bundling function

/**
 * Bundle Configuration
 */
export interface BundleConfig<TNode = Node, TEdge = Edge> {
    strategy: BundleStrategy;
    bundleSize: number;
    preserveConnections: boolean;
    customBundler?: CustomBundlerFunction<TNode, TEdge>;
}

/**
 * Custom Bundler Function Type
 */
export type CustomBundlerFunction<TNode = Node, TEdge = Edge> = (
    nodes: TNode[],
    edges: TEdge[],
    config: BundleConfig<TNode, TEdge>
) => NodeBundle<TNode, TEdge>[];

/**
 * Node Type Priority for React Flow Workflow Visualization
 * Lower numbers are revealed first
 */
const REACT_FLOW_NODE_TYPE_PRIORITY: Record<string, number> = {
    'user_message': 0,
    'agent_thinking': 1,
    'agent': 2,
    'tool_call': 3,
    'tool_call_response': 4,
    'tool_result': 5,
    'response': 6,
    'default': 999
};

/**
 * Sequential Node-Edge Bundler
 * Creates bundles with one node at a time plus its connecting edges
 */
export function createSequentialBundler<TNode extends { id: string }, TEdge extends { source: string; target: string }>(): CustomBundlerFunction<TNode, TEdge> {
    return (nodes: TNode[], edges: TEdge[], config: BundleConfig<TNode, TEdge>): NodeBundle<TNode, TEdge>[] => {
        const bundles: NodeBundle<TNode, TEdge>[] = [];

        for (let i = 0; i < nodes.length; i += config.bundleSize) {
            const bundleNodes = nodes.slice(i, i + config.bundleSize);
            const bundleNodeIds = new Set(bundleNodes.map(n => n.id));

            // Get all edges connecting to nodes in this bundle
            let bundleEdges: TEdge[];
            if (config.preserveConnections) {
                // Include edges where at least one end is in current or previous bundles
                const allPreviousNodeIds = new Set(nodes.slice(0, i + config.bundleSize).map(n => n.id));
                bundleEdges = edges.filter(edge =>
                    allPreviousNodeIds.has(edge.source) && allPreviousNodeIds.has(edge.target)
                );
            } else {
                // Only edges within current bundle
                bundleEdges = edges.filter(edge =>
                    bundleNodeIds.has(edge.source) && bundleNodeIds.has(edge.target)
                );
            }

            bundles.push({
                nodes: bundleNodes,
                edges: bundleEdges,
                metadata: {
                    bundleIndex: Math.floor(i / config.bundleSize),
                    totalBundles: Math.ceil(nodes.length / config.bundleSize),
                    nodeCount: bundleNodes.length,
                    edgeCount: bundleEdges.length
                }
            });
        }

        return bundles;
    };
}

/**
 * Type-Based Node Bundler for React Flow
 * Groups nodes by their type with priority ordering
 */
export function createTypeBundler(): CustomBundlerFunction<Node, Edge> {
    return (nodes: Node[], edges: Edge[], config: BundleConfig<Node, Edge>): NodeBundle<Node, Edge>[] => {
        // Sort nodes by type priority, then by original order
        const sortedNodes = [...nodes].sort((a, b) => {
            const priorityA = REACT_FLOW_NODE_TYPE_PRIORITY[a.type || 'default'] || 999;
            const priorityB = REACT_FLOW_NODE_TYPE_PRIORITY[b.type || 'default'] || 999;

            if (priorityA !== priorityB) {
                return priorityA - priorityB;
            }

            // Maintain original order within same type
            return nodes.indexOf(a) - nodes.indexOf(b);
        });

        // Group by type
        const typeGroups: Record<string, Node[]> = {};
        sortedNodes.forEach(node => {
            const nodeType = node.type || 'default';
            if (!typeGroups[nodeType]) {
                typeGroups[nodeType] = [];
            }
            typeGroups[nodeType].push(node);
        });

        // Create bundles from type groups
        const bundles: NodeBundle<Node, Edge>[] = [];
        let bundleIndex = 0;

        Object.entries(typeGroups).forEach(([nodeType, typeNodes]) => {
            for (let i = 0; i < typeNodes.length; i += config.bundleSize) {
                const bundleNodes = typeNodes.slice(i, i + config.bundleSize);
                const bundleNodeIds = new Set(bundleNodes.map(n => n.id));

                // Get edges for this bundle
                const bundleEdges = config.preserveConnections
                    ? edges.filter(edge => {
                        // Include if either end is in any previous bundle or current bundle
                        const allPreviousNodes = bundles.flatMap(b => b.nodes);
                        const allPreviousNodeIds = new Set([
                            ...allPreviousNodes.map(n => n.id),
                            ...bundleNodeIds
                        ]);
                        return allPreviousNodeIds.has(edge.source) && allPreviousNodeIds.has(edge.target);
                    })
                    : edges.filter(edge =>
                        bundleNodeIds.has(edge.source) && bundleNodeIds.has(edge.target)
                    );

                bundles.push({
                    nodes: bundleNodes,
                    edges: bundleEdges,
                    metadata: {
                        bundleIndex: bundleIndex++,
                        totalBundles: 0, // Will be set after all bundles are created
                        nodeCount: bundleNodes.length,
                        edgeCount: bundleEdges.length
                    }
                });
            }
        });

        // Update total bundles count
        bundles.forEach(bundle => {
            bundle.metadata.totalBundles = bundles.length;
        });

        return bundles;
    };
}

/**
 * Connected Components Bundler
 * Groups nodes that are connected together
 */
export function createConnectedBundler<TNode extends { id: string }, TEdge extends { source: string; target: string }>(): CustomBundlerFunction<TNode, TEdge> {
    return (nodes: TNode[], edges: TEdge[], config: BundleConfig<TNode, TEdge>): NodeBundle<TNode, TEdge>[] => {
        const nodeMap = new Map(nodes.map(n => [n.id, n]));
        const adjacencyList = new Map<string, Set<string>>();

        // Build adjacency list
        nodes.forEach(node => {
            adjacencyList.set(node.id, new Set());
        });

        edges.forEach(edge => {
            adjacencyList.get(edge.source)?.add(edge.target);
            adjacencyList.get(edge.target)?.add(edge.source);
        });

        // Find connected components using DFS
        const visited = new Set<string>();
        const components: string[][] = [];

        const dfs = (nodeId: string, component: string[]) => {
            if (visited.has(nodeId)) return;

            visited.add(nodeId);
            component.push(nodeId);

            adjacencyList.get(nodeId)?.forEach(neighborId => {
                if (!visited.has(neighborId)) {
                    dfs(neighborId, component);
                }
            });
        };

        nodes.forEach(node => {
            if (!visited.has(node.id)) {
                const component: string[] = [];
                dfs(node.id, component);
                if (component.length > 0) {
                    components.push(component);
                }
            }
        });

        // Create bundles from components
        const bundles: NodeBundle<TNode, TEdge>[] = [];
        let bundleIndex = 0;

        components.forEach(componentNodeIds => {
            // Split large components into smaller bundles
            for (let i = 0; i < componentNodeIds.length; i += config.bundleSize) {
                const bundleNodeIds = componentNodeIds.slice(i, i + config.bundleSize);
                const bundleNodes = bundleNodeIds.map(id => nodeMap.get(id)!).filter(Boolean);
                const bundleNodeIdSet = new Set(bundleNodeIds);

                const bundleEdges = edges.filter(edge =>
                    bundleNodeIdSet.has(edge.source) && bundleNodeIdSet.has(edge.target)
                );

                bundles.push({
                    nodes: bundleNodes,
                    edges: bundleEdges,
                    metadata: {
                        bundleIndex: bundleIndex++,
                        totalBundles: 0, // Will be set later
                        nodeCount: bundleNodes.length,
                        edgeCount: bundleEdges.length
                    }
                });
            }
        });

        // Update total bundles count
        bundles.forEach(bundle => {
            bundle.metadata.totalBundles = bundles.length;
        });

        return bundles;
    };
}

/**
 * Main Node-Edge Bundler Factory
 * Creates appropriate bundler based on strategy
 */
export function createNodeEdgeBundler<TNode extends { id: string }, TEdge extends { source: string; target: string }>(
    config: BundleConfig<TNode, TEdge>
): CustomBundlerFunction<TNode, TEdge> {
    switch (config.strategy) {
        case 'sequential':
            return createSequentialBundler<TNode, TEdge>();

        case 'by-type':
            // Type bundler is React Flow specific
            throw new Error('Bundling strategy "by-type" is React Flow specific. Use createReactFlowTypeBundler() instead.');

        case 'connected':
            return createConnectedBundler<TNode, TEdge>();

        case 'custom':
            if (!config.customBundler) {
                throw new Error('Custom bundler function is required when strategy is "custom"');
            }
            return config.customBundler;

        default:
            throw new Error(`Unsupported bundling strategy: ${String(config.strategy)}`);
    }
}

/**
 * React Flow Specific Type Bundler
 * Optimized for React Flow workflow visualization
 */
export function createReactFlowTypeBundler(): CustomBundlerFunction<Node, Edge> {
    return createTypeBundler();
}

/**
 * Default Bundle Configuration
 */
export const DEFAULT_BUNDLE_CONFIG: BundleConfig = {
    strategy: 'sequential',
    bundleSize: 1,
    preserveConnections: true
};
