#!/usr/bin/env tsx
/**
 * Workflow Connection Verification Script
 * 
 * Validates the integrity of workflow node connections in real-workflow-data.json
 * 
 * ⚠️  CRITICAL: VALIDATION RULES ARE IMMUTABLE AND CANNOT BE MODIFIED
 * ⚠️  These rules are the ABSOLUTE STANDARD for workflow integrity
 * ⚠️  Code must be modified to comply with these rules, NOT vice versa
 * 
 * VALIDATION RULES (FIXED):
 * 1. Start Node Rule: Exactly one node must have no incoming connections
 * 2. Intermediate Node Rule: All nodes except the start node must have incoming connections  
 * 3. Connectivity Rule: All nodes must form a single connected graph component
 * 4. Edge Reference Integrity Rule: All edge sources and targets must reference existing node IDs
 * 5. Single Incoming Connection Rule: Each node can have at most one incoming connection (except tool_result nodes)
 * 6. Tool Response Connection Rule: All tool_call_response nodes must connect to tool_result nodes
 * 7. Single Outgoing Connection Rule: Specified node types can have at most one outgoing connection
 * 8. No End Node Rule: Specified node types cannot be end nodes (must have outgoing connections)
 * 9. Agent Thinking No End Node Rule: Agent thinking nodes cannot be end nodes (must have outgoing connections)
 * 10. Timestamp Requirement Rule: All nodes and edges must have creation timestamp data
 * 11. Sequential Creation Order Rule: Node-edge creation must follow sequential flow order
 * 
 * NOTE: These rules ensure proper workflow structure where all nodes are connected
 * in a single graph with exactly one entry point (start node), and all references
 * are valid.
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Types for workflow data structure
interface WorkflowNode {
    id: string;
    type: string;
    data: {
        label: string;
        status?: string;
        [key: string]: unknown;
    };
    position: {
        x: number;
        y: number;
    };
    timestamp?: number; // Creation timestamp for sequential order validation
}

interface WorkflowEdge {
    id: string;
    source: string;
    target: string;
    type?: string;
    animated?: boolean;
    style?: {
        stroke?: string;
        strokeWidth?: number;
    };
    timestamp?: number; // Creation timestamp for sequential order validation
}

interface WorkflowData {
    nodes: WorkflowNode[];
    edges: WorkflowEdge[];
}

interface RealWorkflowFileData {
    metadata: {
        createdAt: string;
        updatedAt: string;
        metrics: {
            totalNodes: number;
            team2Nodes: number;
        };
        testType: string;
        sourceExample: string;
    };
    team2: WorkflowData;
}

interface ValidationResult {
    success: boolean;
    totalNodes: number;
    totalEdges: number;
    startNodes: string[];
    orphanNodes: string[];
    connectedComponents: number;
    invalidEdges: {
        missingSource: string[];
        missingTarget: string[];
    };
    multipleIncomingNodes: string[];
    unconnectedToolResponses: string[];
    multipleOutgoingNodes: string[];
    invalidEndNodes: string[];
    invalidAgentThinkingEndNodes: string[];
    missingTimestamps: {
        nodes: string[];
        edges: string[];
    };
    sequentialOrderViolations: {
        prematureNodes: string[];
        violationDetails: string[];
    };
    errors: string[];
    details: {
        nodeTypes: Record<string, number>;
        edgeTypes: Record<string, number>;
    };
}

class WorkflowConnectionVerifier {
    private data: WorkflowData | null = null;
    private dataFilePath: string;

    // Configuration for single outgoing connection rule
    private readonly SINGLE_OUTGOING_NODE_TYPES = ['tool_call'];

    // Configuration for no end node rule
    private readonly NO_END_NODE_TYPES = ['tool_call_response'];

    // Configuration for agent thinking no end node rule
    private readonly AGENT_THINKING_NO_END_NODE_TYPES = ['agent_thinking'];

    constructor(dataFilePath: string = '../data/real-workflow-data.json') {
        this.dataFilePath = path.resolve(__dirname, dataFilePath);
    }

    /**
     * Load and parse workflow data from JSON file
     */
    private loadWorkflowData(): boolean {
        try {
            if (!fs.existsSync(this.dataFilePath)) {
                console.error(`❌ File not found: ${this.dataFilePath}`);
                return false;
            }

            const fileContent = fs.readFileSync(this.dataFilePath, 'utf-8');
            const rawData = JSON.parse(fileContent);

            // Check if it's the new format with team2 wrapper
            if (rawData.team2) {
                this.data = rawData.team2 as WorkflowData;
            } else {
                // Fallback to direct format
                this.data = rawData as WorkflowData;
            }

            // Basic structure validation
            if (!this.data.nodes || !Array.isArray(this.data.nodes)) {
                console.error('❌ Invalid data structure: missing or invalid nodes array');
                return false;
            }

            if (!this.data.edges || !Array.isArray(this.data.edges)) {
                console.error('❌ Invalid data structure: missing or invalid edges array');
                return false;
            }

            return true;
        } catch (error) {
            console.error(`❌ Failed to load workflow data: ${error}`);
            return false;
        }
    }

    /**
     * Build adjacency lists for incoming and outgoing connections
     */
    private buildConnectionMaps(): { incoming: Map<string, string[]>, outgoing: Map<string, string[]> } {
        const incoming = new Map<string, string[]>();
        const outgoing = new Map<string, string[]>();

        // Initialize maps for all nodes
        this.data!.nodes.forEach(node => {
            incoming.set(node.id, []);
            outgoing.set(node.id, []);
        });

        // Populate connection maps from edges
        this.data!.edges.forEach(edge => {
            const sourceConnections = outgoing.get(edge.source) || [];
            sourceConnections.push(edge.target);
            outgoing.set(edge.source, sourceConnections);

            const targetConnections = incoming.get(edge.target) || [];
            targetConnections.push(edge.source);
            incoming.set(edge.target, targetConnections);
        });

        return { incoming, outgoing };
    }

    /**
     * Find connected components using DFS
     */
    private findConnectedComponents(outgoing: Map<string, string[]>, incoming: Map<string, string[]>): number {
        const visited = new Set<string>();
        let componentCount = 0;

        const dfs = (nodeId: string) => {
            if (visited.has(nodeId)) return;
            visited.add(nodeId);

            // Visit outgoing connections
            const outgoingNodes = outgoing.get(nodeId) || [];
            outgoingNodes.forEach(targetId => dfs(targetId));

            // Visit incoming connections (for undirected traversal)
            const incomingNodes = incoming.get(nodeId) || [];
            incomingNodes.forEach(sourceId => dfs(sourceId));
        };

        this.data!.nodes.forEach(node => {
            if (!visited.has(node.id)) {
                componentCount++;
                dfs(node.id);
            }
        });

        return componentCount;
    }

    /**
     * Collect statistics about node and edge types
     */
    private collectStatistics(): { nodeTypes: Record<string, number>, edgeTypes: Record<string, number> } {
        const nodeTypes: Record<string, number> = {};
        const edgeTypes: Record<string, number> = {};

        this.data!.nodes.forEach(node => {
            nodeTypes[node.type] = (nodeTypes[node.type] || 0) + 1;
        });

        this.data!.edges.forEach(edge => {
            const edgeType = edge.type || 'default';
            edgeTypes[edgeType] = (edgeTypes[edgeType] || 0) + 1;
        });

        return { nodeTypes, edgeTypes };
    }

    /**
     * Validate edge reference integrity
     */
    private validateEdgeReferences(): { missingSource: string[], missingTarget: string[] } {
        const nodeIds = new Set(this.data!.nodes.map(node => node.id));
        const missingSource: string[] = [];
        const missingTarget: string[] = [];

        this.data!.edges.forEach(edge => {
            if (!nodeIds.has(edge.source)) {
                missingSource.push(`Edge ${edge.id}: source '${edge.source}' not found in nodes`);
            }
            if (!nodeIds.has(edge.target)) {
                missingTarget.push(`Edge ${edge.id}: target '${edge.target}' not found in nodes`);
            }
        });

        return { missingSource, missingTarget };
    }

    /**
     * Perform comprehensive workflow validation
     */
    public verify(): ValidationResult {
        // Load data
        if (!this.loadWorkflowData() || !this.data) {
            return {
                success: false,
                totalNodes: 0,
                totalEdges: 0,
                startNodes: [],
                orphanNodes: [],
                connectedComponents: 0,
                invalidEdges: { missingSource: [], missingTarget: [] },
                multipleIncomingNodes: [],
                unconnectedToolResponses: [],
                multipleOutgoingNodes: [],
                invalidEndNodes: [],
                invalidAgentThinkingEndNodes: [],
                missingTimestamps: { nodes: [], edges: [] },
                sequentialOrderViolations: { prematureNodes: [], violationDetails: [] },
                errors: ['Failed to load workflow data'],
                details: { nodeTypes: {}, edgeTypes: {} }
            };
        }

        const { incoming, outgoing } = this.buildConnectionMaps();
        const errors: string[] = [];

        // Rule 1: Find start nodes (nodes with no incoming connections)
        const startNodes: string[] = [];
        this.data.nodes.forEach(node => {
            const incomingConnections = incoming.get(node.id) || [];
            if (incomingConnections.length === 0) {
                startNodes.push(node.id);
            }
        });

        // Validate start node rule
        if (startNodes.length === 0) {
            errors.push('No start node found (all nodes have incoming connections)');
        } else if (startNodes.length > 1) {
            errors.push(`Multiple start nodes found (${startNodes.length}): ${startNodes.join(', ')}`);
        }

        // Rule 2: Find orphan nodes (nodes other than start that have no incoming connections)
        const orphanNodes = startNodes.length <= 1 ? [] : startNodes.slice(1);

        // Rule 3: Check connectivity
        const connectedComponents = this.findConnectedComponents(outgoing, incoming);
        if (connectedComponents > 1) {
            errors.push(`Workflow has ${connectedComponents} disconnected components (should be 1)`);
        }

        // Rule 4: Validate edge reference integrity
        const invalidEdges = this.validateEdgeReferences();
        if (invalidEdges.missingSource.length > 0) {
            errors.push(`Edges with missing source nodes (${invalidEdges.missingSource.length})`);
        }
        if (invalidEdges.missingTarget.length > 0) {
            errors.push(`Edges with missing target nodes (${invalidEdges.missingTarget.length})`);
        }

        // Rule 5: Single Incoming Connection Rule (with tool_result exception)
        const multipleIncomingNodes: string[] = [];
        this.data.nodes.forEach(node => {
            const incomingConnections = incoming.get(node.id) || [];
            // Exception: tool_result nodes can have multiple incoming connections
            if (incomingConnections.length > 1 && node.type !== 'tool_result') {
                multipleIncomingNodes.push(node.id);
            }
        });

        if (multipleIncomingNodes.length > 0) {
            errors.push(`Nodes with multiple incoming connections (${multipleIncomingNodes.length}): ${multipleIncomingNodes.join(', ')}`);
        }

        // Rule 6: Tool Response Connection Rule
        const unconnectedToolResponses: string[] = [];
        this.data.nodes.forEach(node => {
            if (node.type === 'tool_call_response') {
                const outgoingConnections = outgoing.get(node.id) || [];
                const connectsToToolResult = outgoingConnections.some(targetId => {
                    const targetNode = this.data!.nodes.find(n => n.id === targetId);
                    return targetNode && targetNode.type === 'tool_result';
                });

                if (!connectsToToolResult) {
                    unconnectedToolResponses.push(node.id);
                }
            }
        });

        if (unconnectedToolResponses.length > 0) {
            errors.push(`tool_call_response nodes not connected to tool_result (${unconnectedToolResponses.length}): ${unconnectedToolResponses.join(', ')}`);
        }

        // Rule 7: Single Outgoing Connection Rule
        const multipleOutgoingNodes: string[] = [];
        this.data.nodes.forEach(node => {
            if (this.SINGLE_OUTGOING_NODE_TYPES.includes(node.type)) {
                const outgoingConnections = outgoing.get(node.id) || [];
                if (outgoingConnections.length > 1) {
                    multipleOutgoingNodes.push(node.id);
                }
            }
        });

        if (multipleOutgoingNodes.length > 0) {
            errors.push(`Nodes with multiple outgoing connections (${multipleOutgoingNodes.length}): ${multipleOutgoingNodes.join(', ')}`);
        }

        // Rule 8: No End Node Rule
        const invalidEndNodes: string[] = [];
        this.data.nodes.forEach(node => {
            if (this.NO_END_NODE_TYPES.includes(node.type)) {
                const outgoingConnections = outgoing.get(node.id) || [];
                if (outgoingConnections.length === 0) {
                    invalidEndNodes.push(node.id);
                }
            }
        });

        if (invalidEndNodes.length > 0) {
            errors.push(`Invalid end nodes (${invalidEndNodes.length}): ${invalidEndNodes.join(', ')}`);
        }

        // Rule 9: Agent Thinking No End Node Rule
        const invalidAgentThinkingEndNodes: string[] = [];
        this.data.nodes.forEach(node => {
            if (this.AGENT_THINKING_NO_END_NODE_TYPES.includes(node.type)) {
                const outgoingConnections = outgoing.get(node.id) || [];
                if (outgoingConnections.length === 0) {
                    invalidAgentThinkingEndNodes.push(node.id);
                }
            }
        });

        if (invalidAgentThinkingEndNodes.length > 0) {
            errors.push(`Agent thinking nodes as end nodes (${invalidAgentThinkingEndNodes.length}): ${invalidAgentThinkingEndNodes.join(', ')}`);
        }

        // Rule 10: Timestamp Requirement Rule
        const missingTimestamps = {
            nodes: [] as string[],
            edges: [] as string[]
        };

        this.data.nodes.forEach(node => {
            if (!node.timestamp || typeof node.timestamp !== 'number') {
                missingTimestamps.nodes.push(node.id);
            }
        });

        this.data.edges.forEach(edge => {
            if (!edge.timestamp || typeof edge.timestamp !== 'number') {
                missingTimestamps.edges.push(edge.id);
            }
        });

        if (missingTimestamps.nodes.length > 0 || missingTimestamps.edges.length > 0) {
            errors.push(`Missing timestamps - nodes: ${missingTimestamps.nodes.length}, edges: ${missingTimestamps.edges.length}`);
        }

        // Rule 11: Sequential Creation Order Rule
        // Only validates single-path sequential flows (Node A → Edge A-B → Node B → Edge B-C → Node C)
        // Does NOT validate parallel/fork patterns where multiple nodes are created simultaneously
        const sequentialOrderViolations = {
            prematureNodes: [] as string[],
            violationDetails: [] as string[]
        };

        // First check if all items have valid timestamps - if not, Rule 11 fails
        if (missingTimestamps.nodes.length > 0 || missingTimestamps.edges.length > 0) {
            sequentialOrderViolations.violationDetails.push('Cannot validate sequential order: missing timestamps detected');
            errors.push('Sequential order validation failed: missing timestamps detected');
        } else {
            // Sort all nodes and edges by timestamp for sequential analysis
            const allItems = [
                ...this.data.nodes.map(n => ({ type: 'node', id: n.id, timestamp: n.timestamp!, data: n })),
                ...this.data.edges.map(e => ({ type: 'edge', id: e.id, timestamp: e.timestamp!, data: e }))
            ].sort((a, b) => a.timestamp - b.timestamp);

            // Track which nodes have been created
            const createdNodes = new Set<string>();
            const connectedNodes = new Set<string>();

            for (const item of allItems) {
                if (item.type === 'node') {
                    createdNodes.add(item.id);
                } else if (item.type === 'edge') {
                    const edge = item.data as WorkflowEdge;

                    // Check if both source and target nodes exist before this edge
                    if (!createdNodes.has(edge.source) || !createdNodes.has(edge.target)) {
                        sequentialOrderViolations.violationDetails.push(
                            `Edge ${edge.id} created before required nodes (source: ${edge.source}, target: ${edge.target})`
                        );
                    }

                    connectedNodes.add(edge.source);
                    connectedNodes.add(edge.target);
                }
            }

            // Only check basic rule: edges must be created after their source and target nodes
            // Do NOT check for intermediate nodes in parallel/fork patterns
            for (const item of allItems) {
                if (item.type === 'edge') {
                    const edge = item.data as WorkflowEdge;
                    const sourceNode = this.data.nodes.find(n => n.id === edge.source);
                    const targetNode = this.data.nodes.find(n => n.id === edge.target);

                    if (sourceNode && targetNode) {
                        // Edge should be created after both source and target nodes
                        if (edge.timestamp! < sourceNode.timestamp! || edge.timestamp! < targetNode.timestamp!) {
                            sequentialOrderViolations.prematureNodes.push(edge.id);
                            sequentialOrderViolations.violationDetails.push(
                                `Edge ${edge.id} created before its nodes (edge: ${edge.timestamp}, source: ${sourceNode.timestamp}, target: ${targetNode.timestamp})`
                            );
                        }
                    }
                }
            }

            if (sequentialOrderViolations.prematureNodes.length > 0) {
                errors.push(`Sequential order violations (${sequentialOrderViolations.prematureNodes.length}): ${sequentialOrderViolations.prematureNodes.join(', ')}`);
            }
        }

        // Collect statistics
        const details = this.collectStatistics();

        const success = errors.length === 0;

        return {
            success,
            totalNodes: this.data.nodes.length,
            totalEdges: this.data.edges.length,
            startNodes,
            orphanNodes,
            connectedComponents,
            invalidEdges,
            multipleIncomingNodes,
            unconnectedToolResponses,
            multipleOutgoingNodes,
            invalidEndNodes,
            invalidAgentThinkingEndNodes,
            missingTimestamps,
            sequentialOrderViolations,
            errors,
            details
        };
    }

    /**
     * Display validation rules and criteria
     */
    private displayValidationRules(): void {
        console.log('📋 Validation Rules (IMMUTABLE):');
        console.log('-'.repeat(50));
        console.log('⚠️  CRITICAL: These rules CANNOT be modified');
        console.log('⚠️  Code must comply with these rules, not vice versa');
        console.log('');
        console.log('1. Start Node Rule: Exactly one node must have no incoming connections');
        console.log('2. Intermediate Node Rule: All nodes except the start node must have incoming connections');
        console.log('3. Connectivity Rule: All nodes must form a single connected graph component');
        console.log('4. Edge Reference Integrity Rule: All edge sources and targets must reference existing node IDs');
        console.log('5. Single Incoming Connection Rule: Each node can have at most one incoming connection (except tool_result nodes)');
        console.log('6. Tool Response Connection Rule: All tool_call_response nodes must connect to tool_result nodes');
        console.log(`7. Single Outgoing Connection Rule: Specified node types (${this.SINGLE_OUTGOING_NODE_TYPES.join(', ')}) can have at most one outgoing connection`);
        console.log(`8. No End Node Rule: Specified node types (${this.NO_END_NODE_TYPES.join(', ')}) cannot be end nodes (must have outgoing connections)`);
        console.log(`9. Agent Thinking No End Node Rule: Agent thinking nodes (${this.AGENT_THINKING_NO_END_NODE_TYPES.join(', ')}) cannot be end nodes (must have outgoing connections)`);
        console.log('10. Timestamp Requirement Rule: All nodes and edges must have creation timestamp data');
        console.log('11. Sequential Creation Order Rule: Node-edge creation must follow sequential flow order');
        console.log('');
    }

    /**
     * Format and display validation results
     */
    public displayResults(result: ValidationResult): void {
        console.log('\n🔍 Workflow Connection Verification');
        console.log('='.repeat(50));
        console.log(`📁 File: ${path.basename(this.dataFilePath)}`);
        console.log(`📊 Total nodes: ${result.totalNodes}`);
        console.log(`🔗 Total edges: ${result.totalEdges}`);
        console.log('');

        this.displayValidationRules();

        // Display validation results
        if (result.startNodes.length === 1) {
            console.log(`✅ PASSED: Single start node (${result.startNodes[0]})`);
        } else if (result.startNodes.length === 0) {
            console.log('❌ FAILED: No start node found');
        } else {
            console.log(`❌ FAILED: Multiple start nodes (${result.startNodes.length})`);
        }

        if (result.orphanNodes.length === 0) {
            console.log('✅ PASSED: No orphan nodes');
        } else {
            console.log(`❌ FAILED: ${result.orphanNodes.length} orphan nodes found`);
        }

        if (result.connectedComponents === 1) {
            console.log('✅ PASSED: Single connected component');
        } else {
            console.log(`❌ FAILED: ${result.connectedComponents} disconnected components`);
        }

        if (result.invalidEdges.missingSource.length === 0 && result.invalidEdges.missingTarget.length === 0) {
            console.log('✅ PASSED: All edge references are valid');
        } else {
            console.log(`❌ FAILED: Edge reference integrity violations`);
            if (result.invalidEdges.missingSource.length > 0) {
                console.log(`   Missing source nodes: ${result.invalidEdges.missingSource.length}`);
            }
            if (result.invalidEdges.missingTarget.length > 0) {
                console.log(`   Missing target nodes: ${result.invalidEdges.missingTarget.length}`);
            }
        }

        if (result.multipleIncomingNodes.length === 0) {
            console.log('✅ PASSED: All nodes have at most one incoming connection (tool_result exception applied)');
        } else {
            console.log(`❌ FAILED: ${result.multipleIncomingNodes.length} nodes have multiple incoming connections (excluding tool_result)`);
            result.multipleIncomingNodes.slice(0, 5).forEach(nodeId => {
                const node = this.data.nodes.find(n => n.id === nodeId);
                const incomingEdges = this.data.edges.filter(e => e.target === nodeId);
                console.log(`   🔴 Node: ${nodeId} (${node?.type || 'unknown'}) - ${incomingEdges.length} incoming connections`);
                incomingEdges.slice(0, 3).forEach(edge => {
                    console.log(`      ← From: ${edge.source} (${edge.type || 'no-type'})`);
                });
                if (incomingEdges.length > 3) {
                    console.log(`      ... and ${incomingEdges.length - 3} more incoming connections`);
                }
            });
            if (result.multipleIncomingNodes.length > 5) {
                console.log(`   ... and ${result.multipleIncomingNodes.length - 5} more nodes with multiple incoming connections`);
            }
        }

        if (result.unconnectedToolResponses.length === 0) {
            console.log('✅ PASSED: All tool_call_response nodes connect to tool_result nodes');
        } else {
            console.log(`❌ FAILED: ${result.unconnectedToolResponses.length} tool_call_response nodes not connected to tool_result`);
            result.unconnectedToolResponses.slice(0, 5).forEach(nodeId => {
                const node = this.data.nodes.find(n => n.id === nodeId);
                const outgoingEdges = this.data.edges.filter(e => e.source === nodeId);
                console.log(`   🔴 Node: ${nodeId} (${node?.type || 'unknown'}) - ${outgoingEdges.length} outgoing connections`);
                if (outgoingEdges.length > 0) {
                    outgoingEdges.slice(0, 3).forEach(edge => {
                        const targetNode = this.data.nodes.find(n => n.id === edge.target);
                        console.log(`      → To: ${edge.target} (${targetNode?.type || 'unknown'}) - NOT tool_result`);
                    });
                } else {
                    console.log(`      → No outgoing connections`);
                }
            });
            if (result.unconnectedToolResponses.length > 5) {
                console.log(`   ... and ${result.unconnectedToolResponses.length - 5} more unconnected tool_call_response nodes`);
            }
        }

        if (result.multipleOutgoingNodes.length === 0) {
            console.log(`✅ PASSED: All specified node types (${this.SINGLE_OUTGOING_NODE_TYPES.join(', ')}) have at most one outgoing connection`);
        } else {
            console.log(`❌ FAILED: ${result.multipleOutgoingNodes.length} nodes have multiple outgoing connections`);
            result.multipleOutgoingNodes.slice(0, 5).forEach(nodeId => {
                const node = this.data.nodes.find(n => n.id === nodeId);
                const outgoingEdges = this.data.edges.filter(e => e.source === nodeId);
                console.log(`   🔴 Node: ${nodeId} (${node?.type || 'unknown'}) - ${outgoingEdges.length} outgoing connections`);
                outgoingEdges.slice(0, 3).forEach(edge => {
                    const targetNode = this.data.nodes.find(n => n.id === edge.target);
                    console.log(`      → To: ${edge.target} (${targetNode?.type || 'unknown'}) via ${edge.type || 'no-type'}`);
                });
                if (outgoingEdges.length > 3) {
                    console.log(`      ... and ${outgoingEdges.length - 3} more outgoing connections`);
                }
            });
            if (result.multipleOutgoingNodes.length > 5) {
                console.log(`   ... and ${result.multipleOutgoingNodes.length - 5} more nodes with multiple outgoing connections`);
            }
        }

        if (result.invalidEndNodes.length === 0) {
            console.log(`✅ PASSED: All specified node types (${this.NO_END_NODE_TYPES.join(', ')}) have outgoing connections`);
        } else {
            console.log(`❌ FAILED: ${result.invalidEndNodes.length} nodes are invalid end nodes (must have outgoing connections)`);
            result.invalidEndNodes.slice(0, 5).forEach(nodeId => {
                const node = this.data.nodes.find(n => n.id === nodeId);
                console.log(`   🔴 Node: ${nodeId} (${node?.type || 'unknown'}) - End node (no outgoing connections)`);
                console.log(`      ⚠️  This node type (${node?.type}) must have at least one outgoing connection`);
            });
            if (result.invalidEndNodes.length > 5) {
                console.log(`   ... and ${result.invalidEndNodes.length - 5} more invalid end nodes`);
            }
        }

        if (result.invalidAgentThinkingEndNodes.length === 0) {
            console.log(`✅ PASSED: All agent thinking nodes (${this.AGENT_THINKING_NO_END_NODE_TYPES.join(', ')}) have outgoing connections`);
        } else {
            console.log(`❌ FAILED: ${result.invalidAgentThinkingEndNodes.length} agent thinking nodes are end nodes`);
            result.invalidAgentThinkingEndNodes.slice(0, 5).forEach(nodeId => {
                const node = this.data.nodes.find(n => n.id === nodeId);
                console.log(`   🔴 Node: ${nodeId} (${node?.type || 'unknown'}) - Agent thinking end node`);
                console.log(`      ⚠️  Agent thinking nodes must connect to response nodes`);
            });
            if (result.invalidAgentThinkingEndNodes.length > 5) {
                console.log(`   ... and ${result.invalidAgentThinkingEndNodes.length - 5} more invalid agent thinking end nodes`);
            }
        }

        if (result.missingTimestamps && result.missingTimestamps.nodes.length === 0 && result.missingTimestamps.edges.length === 0) {
            console.log('✅ PASSED: All nodes and edges have timestamp data');
        } else if (result.missingTimestamps) {
            console.log(`❌ FAILED: Missing timestamps - nodes: ${result.missingTimestamps.nodes.length}, edges: ${result.missingTimestamps.edges.length}`);
            if (result.missingTimestamps.nodes.length > 0) {
                console.log(`   Nodes without timestamps: ${result.missingTimestamps.nodes.slice(0, 5).join(', ')}${result.missingTimestamps.nodes.length > 5 ? '...' : ''}`);
            }
            if (result.missingTimestamps.edges.length > 0) {
                console.log(`   Edges without timestamps: ${result.missingTimestamps.edges.slice(0, 5).join(', ')}${result.missingTimestamps.edges.length > 5 ? '...' : ''}`);
            }
        } else {
            console.log('❌ FAILED: Cannot validate timestamps - data structure issue');
        }

        if (result.sequentialOrderViolations && result.sequentialOrderViolations.prematureNodes.length === 0 && result.sequentialOrderViolations.violationDetails.length === 0) {
            console.log('✅ PASSED: Sequential creation order maintained');
        } else if (result.sequentialOrderViolations) {
            console.log(`❌ FAILED: Sequential order validation failed`);
            if (result.sequentialOrderViolations.prematureNodes.length > 0) {
                console.log(`   🔴 ${result.sequentialOrderViolations.prematureNodes.length} sequential order violations detected`);

                // Show detailed violation analysis
                result.sequentialOrderViolations.prematureNodes.slice(0, 3).forEach(violation => {
                    const node = this.data.nodes.find(n => n.id === violation);
                    console.log(`   🔴 Node: ${violation} (${node?.type || 'unknown'})`);
                    console.log(`      ⏰ Created: ${node?.timestamp ? new Date(node.timestamp).toISOString() : 'No timestamp'}`);

                    // Find problematic edges
                    const incomingEdges = this.data.edges.filter(e => e.target === violation);
                    const outgoingEdges = this.data.edges.filter(e => e.source === violation);

                    if (incomingEdges.length > 0) {
                        console.log(`      📥 Incoming edges (${incomingEdges.length}):`);
                        incomingEdges.slice(0, 2).forEach(edge => {
                            const sourceNode = this.data.nodes.find(n => n.id === edge.source);
                            const edgeTime = edge.timestamp ? new Date(edge.timestamp).toISOString() : 'No timestamp';
                            const sourceTime = sourceNode?.timestamp ? new Date(sourceNode.timestamp).toISOString() : 'No timestamp';
                            console.log(`         ← ${edge.source} (${sourceNode?.type || 'unknown'}) | Edge: ${edgeTime} | Source: ${sourceTime}`);
                        });
                    }

                    if (outgoingEdges.length > 0) {
                        console.log(`      📤 Outgoing edges (${outgoingEdges.length}):`);
                        outgoingEdges.slice(0, 2).forEach(edge => {
                            const targetNode = this.data.nodes.find(n => n.id === edge.target);
                            const edgeTime = edge.timestamp ? new Date(edge.timestamp).toISOString() : 'No timestamp';
                            const targetTime = targetNode?.timestamp ? new Date(targetNode.timestamp).toISOString() : 'No timestamp';
                            console.log(`         → ${edge.target} (${targetNode?.type || 'unknown'}) | Edge: ${edgeTime} | Target: ${targetTime}`);
                        });
                    }
                    console.log('');
                });

                if (result.sequentialOrderViolations.prematureNodes.length > 3) {
                    console.log(`   ... and ${result.sequentialOrderViolations.prematureNodes.length - 3} more nodes with sequential order violations`);
                }
            }

            // Show violation details
            if (result.sequentialOrderViolations.violationDetails.length > 0) {
                console.log(`   📋 Violation Details:`);
                result.sequentialOrderViolations.violationDetails.slice(0, 5).forEach(detail => {
                    console.log(`      • ${detail}`);
                });
                if (result.sequentialOrderViolations.violationDetails.length > 5) {
                    console.log(`      ... and ${result.sequentialOrderViolations.violationDetails.length - 5} more violation details`);
                }
            }
        } else {
            console.log('❌ FAILED: Cannot validate sequential order - data structure issue');
        }

        console.log('');

        // Display node type breakdown
        console.log('📋 Node Types:');
        Object.entries(result.details.nodeTypes).forEach(([type, count]) => {
            console.log(`   ${type}: ${count}`);
        });

        console.log('');

        // Display errors if any
        if (result.errors.length > 0) {
            console.log('❌ Validation Errors:');
            result.errors.forEach((error, index) => {
                console.log(`   ${index + 1}. ${error}`);
            });
            console.log('');
        }

        // Display edge reference integrity violations if any
        if (result.invalidEdges.missingSource.length > 0 || result.invalidEdges.missingTarget.length > 0) {
            console.log('🔗 Edge Reference Integrity Violations:');
            if (result.invalidEdges.missingSource.length > 0) {
                console.log('   Missing Source Nodes:');
                result.invalidEdges.missingSource.forEach((violation, index) => {
                    console.log(`     ${index + 1}. ${violation}`);
                });
            }
            if (result.invalidEdges.missingTarget.length > 0) {
                console.log('   Missing Target Nodes:');
                result.invalidEdges.missingTarget.forEach((violation, index) => {
                    console.log(`     ${index + 1}. ${violation}`);
                });
            }
            console.log('');
        }

        // Final result
        if (result.success) {
            console.log('🎉 Workflow validation successful!');
        } else {
            console.log('💥 Workflow validation failed!');
            process.exit(1);
        }
    }
}

// Main execution
function main() {
    const verifier = new WorkflowConnectionVerifier();
    const result = verifier.verify();
    verifier.displayResults(result);
}

// Run verification if called directly (ES module compatibility)
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { WorkflowConnectionVerifier };
export type { ValidationResult };