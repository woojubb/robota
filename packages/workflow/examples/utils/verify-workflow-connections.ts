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
 * 5. Join Pattern Validation Rule: Multiple incoming connections must follow valid join patterns
 * 6. Tool Response Connection Rule: All tool_call_response nodes must connect to tool_result nodes
 * 7. Fork Pattern Validation Rule: Multiple outgoing connections must follow valid fork patterns (tool_call must have single path)
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

// ES module support
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Types for verification input (React Flow export structure)
interface IVerificationWorkflowNode {
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

interface IVerificationWorkflowEdge {
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

interface IVerificationWorkflowData {
    nodes: IVerificationWorkflowNode[];
    edges: IVerificationWorkflowEdge[];
}

interface IRealWorkflowFileData {
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
    team2: IVerificationWorkflowData;
}

interface IWorkflowVerificationResult {
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
    private data: IVerificationWorkflowData | null = null;
    private dataFilePath: string;

    // Configuration for single outgoing connection rule
    private readonly SINGLE_OUTGOING_NODE_TYPES = ['tool_call'];

    // Configuration for no end node rule
    private readonly NO_END_NODE_TYPES = ['tool_call_response', 'tool_response'];

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
                this.data = rawData.team2 as IVerificationWorkflowData;
            } else {
                // Fallback to direct format
                this.data = rawData as IVerificationWorkflowData;
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
     * Validate connection type restrictions (Rule 12)
     */
    private validateConnectionTypes(): string[] {
        const violations: string[] = [];

        this.data!.edges.forEach(edge => {
            const sourceNode = this.data!.nodes.find(n => n.id === edge.source);
            const targetNode = this.data!.nodes.find(n => n.id === edge.target);

            if (!sourceNode || !targetNode) return;

            // Check for forbidden connection types
            if (edge.type === 'calls') {
                violations.push(`Edge ${edge.id}: 'calls' type is forbidden (use 'executes' instead)`);
            }

            if (edge.type === 'consolidates') {
                violations.push(`Edge ${edge.id}: 'consolidates' type is forbidden (use 'analyze' instead)`);
            }

            // Check for forbidden agent → thinking direct connections
            if (sourceNode.type === 'agent' && targetNode.type === 'agent_thinking' && edge.type === 'processes') {
                violations.push(`Edge ${edge.id}: direct agent → thinking 'processes' connection is forbidden`);
            }
        });

        return violations;
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
    public verify(): IWorkflowVerificationResult {
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

        // Rule 5: Join Pattern Validation (Updated for Fork/Join Architecture)
        const multipleIncomingNodes: string[] = [];
        this.data.nodes.forEach(node => {
            const incomingConnections = incoming.get(node.id) || [];

            if (incomingConnections.length > 1) {
                // ✅ Valid Join Patterns:
                const isValidJoin = this.isValidJoinPattern(node, incomingConnections);

                if (!isValidJoin) {
                    multipleIncomingNodes.push(node.id);
                }
            }
        });

        if (multipleIncomingNodes.length > 0) {
            errors.push(`Nodes with multiple incoming connections (${multipleIncomingNodes.length}): ${multipleIncomingNodes.join(', ')}`);
        }

        // Rule 6: Tool Response Connection Rule
        const unconnectedToolResponses: string[] = [];
        this.data.nodes.forEach(node => {
            if (node.type === 'tool_call_response' || node.type === 'tool_response') {
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

        // Rule 7: Fork Pattern Validation (Updated for Fork/Join Architecture)
        const multipleOutgoingNodes: string[] = [];
        this.data.nodes.forEach(node => {
            const outgoingConnections = outgoing.get(node.id) || [];

            if (outgoingConnections.length > 1) {
                // ✅ Valid Fork Patterns:
                const isValidFork = this.isValidForkPattern(node, outgoingConnections);

                if (!isValidFork) {
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
        // Validates single-path sequential flows and required fork-join order in a domain-neutral way
        const sequentialOrderViolations = {
            prematureNodes: [] as string[],
            violationDetails: [] as string[]
        };

        // First check if all items have valid timestamps - if not, Rule 11 fails
        if (missingTimestamps.nodes.length > 0 || missingTimestamps.edges.length > 0) {
            sequentialOrderViolations.violationDetails.push('Cannot validate sequential order: missing timestamps detected');
            errors.push('Sequential order validation failed: missing timestamps detected');
        } else {
            // Domain-neutral sequential rule (no artificial timestamp constraints):
            // For every edge, require edge.timestamp >= max(source.timestamp, target.timestamp)
            for (const edge of this.data!.edges) {
                const sourceNode = this.data!.nodes.find(n => n.id === edge.source) || null;
                const targetNode = this.data!.nodes.find(n => n.id === edge.target) || null;
                if (!sourceNode || !targetNode) continue;
                const sourceTime = sourceNode.timestamp;
                const targetTime = targetNode.timestamp;
                const edgeTime = edge.timestamp;
                if (typeof sourceTime !== 'number' || typeof targetTime !== 'number' || typeof edgeTime !== 'number') {
                    sequentialOrderViolations.prematureNodes.push(edge.id);
                    sequentialOrderViolations.violationDetails.push(`Missing timestamps for strict order on edge ${edge.id}`);
                    continue;
                }
                const latestNodeTime = Math.max(sourceTime, targetTime);
                if (edgeTime < latestNodeTime) {
                    sequentialOrderViolations.prematureNodes.push(edge.id);
                    sequentialOrderViolations.violationDetails.push(
                        `Order violation on edge ${edge.id}: edge (${edgeTime}) before latest node time (${latestNodeTime})`
                    );
                }
            }
            if (sequentialOrderViolations.prematureNodes.length > 0) {
                errors.push(`Sequential order violations (${sequentialOrderViolations.prematureNodes.length}): ${sequentialOrderViolations.prematureNodes.join(', ')}`);
            }

            // Extra fork-join checks required by user specification (still domain-neutral via types and edges):
            // 1) Agent Response (delegated agents) must exist before its Tool Response and be connected via 'result'
            // 2) Tool Result must exist after all Tool Responses under the same thinking path and connect from each via 'result'
            // 3) Next Agent 0 Thinking (round 2) must be after Tool Result and connected via 'analyze'
            const violationsFJ = this.validateForkJoinTemporalOrder();
            if (violationsFJ.length > 0) {
                violationsFJ.forEach(v => sequentialOrderViolations.violationDetails.push(v));
                errors.push(`Fork/Join temporal order violations (${violationsFJ.length})`);
            }
        }

        // Domain-neutral: no extra fork/join-specific temporal checks

        // Rule 12: Connection Type Restriction Rule
        const connectionTypeViolations = this.validateConnectionTypes();
        if (connectionTypeViolations.length > 0) {
            errors.push(`Connection type restrictions violated (${connectionTypeViolations.length}): ${connectionTypeViolations.join(', ')}`);
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
        console.log('5. Join Pattern Validation Rule: Multiple incoming connections must follow valid join patterns (tool_result aggregation, agent_thinking join, etc.)');
        console.log('6. Tool Response Connection Rule: All tool_call_response nodes must connect to tool_result nodes');
        console.log('7. Fork Pattern Validation Rule: Multiple outgoing connections must follow valid fork patterns (agent_thinking fork, agent fork, user_message fork; tool_call must have single path)');
        console.log(`8. No End Node Rule: Specified node types (${this.NO_END_NODE_TYPES.join(', ')}) cannot be end nodes (must have outgoing connections)`);
        console.log(`9. Agent Thinking No End Node Rule: Agent thinking nodes (${this.AGENT_THINKING_NO_END_NODE_TYPES.join(', ')}) cannot be end nodes (must have outgoing connections)`);
        console.log('10. Timestamp Requirement Rule: All nodes and edges must have creation timestamp data');
        console.log('11. Sequential Creation Order Rule: Node-edge creation must follow sequential flow order');
        console.log('12. Connection Type Restriction Rule: Only allowed connection types per relationship (no calls, no consolidates, no agent→thinking direct)');
        console.log('');
    }

    /**
     * Format and display validation results
     */
    public displayResults(result: IWorkflowVerificationResult): void {
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
                const node = this.data!.nodes.find(n => n.id === nodeId);
                const incomingEdges = this.data!.edges.filter(e => e.target === nodeId);
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
                const node = this.data!.nodes.find(n => n.id === nodeId);
                const outgoingEdges = this.data!.edges.filter(e => e.source === nodeId);
                console.log(`   🔴 Node: ${nodeId} (${node?.type || 'unknown'}) - ${outgoingEdges.length} outgoing connections`);
                if (outgoingEdges.length > 0) {
                    outgoingEdges.slice(0, 3).forEach(edge => {
                        const targetNode = this.data!.nodes.find(n => n.id === edge.target);
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
                const node = this.data!.nodes.find(n => n.id === nodeId);
                const outgoingEdges = this.data!.edges.filter(e => e.source === nodeId);
                console.log(`   🔴 Node: ${nodeId} (${node?.type || 'unknown'}) - ${outgoingEdges.length} outgoing connections`);
                outgoingEdges.slice(0, 3).forEach(edge => {
                    const targetNode = this.data!.nodes.find(n => n.id === edge.target);
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
                const node = this.data!.nodes.find(n => n.id === nodeId);
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
                const node = this.data!.nodes.find(n => n.id === nodeId);
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
                    const edge = this.data!.edges.find(e => e.id === violation);
                    const edgeType = edge && edge.type ? edge.type : 'unknown';
                    console.log(`   🔴 Edge: ${violation} (${edgeType})`);
                    const edgeCreated = edge && typeof edge.timestamp === 'number' ? new Date(edge.timestamp).toISOString() : 'No timestamp';
                    console.log(`      ⏰ Created: ${edgeCreated}`);

                    if (edge) {
                        const sourceNode = this.data!.nodes.find(n => n.id === edge.source);
                        const targetNode = this.data!.nodes.find(n => n.id === edge.target);

                        console.log(`      📍 Edge details:`);
                        const sourceTimeIso = sourceNode && typeof sourceNode.timestamp === 'number' ? new Date(sourceNode.timestamp).toISOString() : 'No timestamp';
                        const targetTimeIso = targetNode && typeof targetNode.timestamp === 'number' ? new Date(targetNode.timestamp).toISOString() : 'No timestamp';
                        console.log(`         Source: ${edge.source} (${sourceNode ? sourceNode.type : 'unknown'}) | ⏰ ${sourceTimeIso}`);
                        console.log(`         Target: ${edge.target} (${targetNode ? targetNode.type : 'unknown'}) | ⏰ ${targetTimeIso}`);
                        const edgeTimeIso = typeof edge.timestamp === 'number' ? new Date(edge.timestamp).toISOString() : 'No timestamp';
                        console.log(`         Edge: ${edge.id} | ⏰ ${edgeTimeIso}`);

                        if (sourceNode && typeof sourceNode.timestamp === 'number' && targetNode && typeof targetNode.timestamp === 'number' && typeof edge.timestamp === 'number') {
                            const edgeTime = edge.timestamp;
                            const sourceTime = sourceNode.timestamp;
                            const targetTime = targetNode.timestamp;
                            if (edgeTime < sourceTime) {
                                console.log(`         🚨 VIOLATION: Edge created ${sourceTime - edgeTime}ms before source node`);
                            }
                            if (edgeTime < targetTime) {
                                console.log(`         🚨 VIOLATION: Edge created ${targetTime - edgeTime}ms before target node`);
                            }
                            const maxNodeTime = Math.max(sourceTime, targetTime);
                            if (edgeTime >= maxNodeTime) {
                                const diff = edgeTime - maxNodeTime;
                                console.log(`         ✅ Rule compliant: Edge created ${diff}ms after latest node`);
                            }
                        }
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

        // Rule 12: Connection Type Restrictions
        const hasConnectionTypeViolations = result.errors.some(error => error.includes('Connection type restrictions violated'));
        if (!hasConnectionTypeViolations) {
            console.log('✅ PASSED: Connection type restrictions followed');
        } else {
            console.log('❌ FAILED: Connection type restrictions violated');
            const connectionViolation = result.errors.find(error => error.includes('Connection type restrictions violated'));
            if (connectionViolation) {
                console.log(`   ${connectionViolation}`);
            }
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

    /**
     * 🔀 Fork/Join 패턴 인식: 워크플로우의 경로 그룹을 식별
     */
    private identifyPathGroups(): Map<string, string[]> {
        const pathGroups = new Map<string, string[]>();
        const visitedNodes = new Set<string>();

        // Start nodes (no incoming edges) 찾기
        const startNodes = this.data!.nodes.filter(node =>
            !this.data!.edges.some(edge => edge.target === node.id)
        );

        // 각 시작 노드에서 경로 추적
        startNodes.forEach((startNode, index) => {
            const pathId = `path_${index}`;
            const nodesInPath: string[] = [];
            this.traversePath(startNode.id, nodesInPath, visitedNodes, pathGroups, pathId);
        });

        return pathGroups;
    }

    /**
     * 🚶‍♂️ 경로 추적: DFS로 경로상의 모든 노드 추적
     */
    private traversePath(
        nodeId: string,
        currentPath: string[],
        visitedNodes: Set<string>,
        pathGroups: Map<string, string[]>,
        pathId: string
    ): void {
        if (visitedNodes.has(nodeId)) {
            // 이미 방문한 노드 (join 포인트) - 새로운 경로 시작
            return;
        }

        currentPath.push(nodeId);
        visitedNodes.add(nodeId);

        // 현재 경로를 pathGroups에 저장
        if (!pathGroups.has(pathId)) {
            pathGroups.set(pathId, []);
        }
        pathGroups.get(pathId)!.push(nodeId);

        // 다음 노드들 찾기
        const outgoingEdges = this.data!.edges.filter(edge => edge.source === nodeId);

        if (outgoingEdges.length === 0) {
            // 끝 노드
            return;
        } else if (outgoingEdges.length === 1) {
            // 단일 경로 계속
            this.traversePath(outgoingEdges[0].target, currentPath, visitedNodes, pathGroups, pathId);
        } else {
            // Fork 패턴 - 각 분기를 별도 경로로 처리
            outgoingEdges.forEach((edge, branchIndex) => {
                const branchPathId = `${pathId}_fork_${branchIndex}`;
                const newPath = [...currentPath];
                this.traversePath(edge.target, newPath, new Set(visitedNodes), pathGroups, branchPathId);
            });
        }
    }

    /**
 * 🔍 순차적 엣지 판별: 같은 경로 내의 순차적 연결인지 확인
 */
    private isSequentialEdgeInSamePath(edge: IVerificationWorkflowEdge, pathGroups: Map<string, string[]>): boolean {
        // 같은 경로 그룹에서 source → target 순서로 있는지 확인
        for (const [pathId, nodes] of pathGroups.entries()) {
            const sourceIndex = nodes.indexOf(edge.source);
            const targetIndex = nodes.indexOf(edge.target);

            if (sourceIndex !== -1 && targetIndex !== -1) {
                // 같은 경로에 있으면서 source가 target보다 먼저 나오는 경우
                return sourceIndex < targetIndex;
            }
        }

        // Fork/Join 패턴이거나 서로 다른 경로 - 순차적이지 않음
        return false;
    }

    /**
     * 🔀 Valid Join Pattern Recognition (Rule 5)
     */
    private isValidJoinPattern(node: any, incomingConnections: string[]): boolean {
        // Find actual edges for analysis
        const incomingEdges = this.data!.edges.filter(edge =>
            incomingConnections.includes(edge.source) && edge.target === node.id
        );

        // ✅ tool_result: aggregation pattern (multiple tool_response → tool_result)
        if (node.type === 'tool_result') {
            return incomingEdges.every(edge => edge.type === 'result' || edge.type === 'consolidates');
        }

        // ✅ agent_thinking: join pattern (agent + user_message → thinking) OR (agent + tool_result → thinking)
        if (node.type === 'agent_thinking') {
            const edgeTypes = incomingEdges
                .map(e => e.type)
                .filter((t): t is string => typeof t === 'string');
            return edgeTypes.every(type => ['processes', 'analyze'].includes(type));
        }

        // ✅ tool_call: semantic duplication (thinking → calls + executes)
        if (node.type === 'tool_call') {
            const edgeTypes = incomingEdges
                .map(e => e.type)
                .filter((t): t is string => typeof t === 'string');
            const hasCallsAndExecutes = edgeTypes.includes('calls') && edgeTypes.includes('executes');
            const sameSource = new Set(incomingEdges.map(e => e.source)).size === 1;
            return hasCallsAndExecutes && sameSource;
        }

        // ✅ tool_call_response: join pattern (multiple sources can trigger responses)
        if (node.type === 'tool_call_response') {
            return true; // Allow multiple incoming for responses
        }

        // ❌ Other node types should have single incoming
        return false;
    }

    /**
     * 🔀 Valid Fork Pattern Recognition (Rule 7)
     */
    private isValidForkPattern(node: any, outgoingConnections: string[]): boolean {
        // Find actual edges for analysis
        const outgoingEdges = this.data!.edges.filter(edge =>
            edge.source === node.id && outgoingConnections.includes(edge.target)
        );

        // ❌ tool_call: NO fork pattern allowed (must have single execution path)
        if (node.type === 'tool_call') {
            return false; // tool_call nodes must have exactly one outgoing connection
        }

        // ✅ agent_thinking: fork pattern (thinking → multiple tool_calls)
        if (node.type === 'agent_thinking') {
            const edgeTypes = outgoingEdges
                .map(e => e.type)
                .filter((t): t is string => typeof t === 'string');
            return edgeTypes.every(type => ['calls', 'executes', 'consolidates'].includes(type));
        }

        // ✅ agent: fork pattern (agent → multiple thinking nodes or responses)
        if (node.type === 'agent') {
            return true; // Allow agents to have multiple outgoing connections
        }

        // ✅ user_message: fork pattern (user message can trigger multiple processes)
        if (node.type === 'user_message') {
            return true; // Allow user messages to have multiple outgoing connections
        }

        // ❌ Other node types should have single outgoing
        return false;
    }

    /**
     * Enforce temporal order: All tool_response under a thinking must be created before tool_result,
     * and tool_result must be created before the next agent_thinking (via analyze edge).
     */
    private validateForkJoinTemporalOrder(): string[] {
        const violations: string[] = [];
        const nodes = this.data!.nodes;
        const edges = this.data!.edges;

        // Index helpers
        const nodeById = new Map(nodes.map(n => [n.id, n] as const));
        const edgesFrom = new Map<string, IVerificationWorkflowEdge[]>();
        edges.forEach(e => {
            const arr = edgesFrom.get(e.source) || [];
            arr.push(e);
            edgesFrom.set(e.source, arr);
        });

        // Find all tool_result nodes and their parent thinking
        const toolResults = nodes.filter(n => n.type === 'tool_result');
        for (const tr of toolResults) {
            const parentThinkingId = (tr as any).data?.parentThinkingNodeId as string | undefined;
            if (!parentThinkingId) continue;
            const parentThinking = nodeById.get(parentThinkingId);
            if (!parentThinking) continue;

            // Collect tool_responses that belong to this thinking via originalEvent.path parentPath equality
            const toolResponses = nodes.filter(n => n.type === 'tool_call_response' && this.belongsToThinking(n, parentThinkingId));

            // 1) All tool_response must be created before tool_result
            for (const resp of toolResponses) {
                if (typeof resp.timestamp === 'number' && typeof tr.timestamp === 'number') {
                    if (resp.timestamp >= tr.timestamp) {
                        violations.push(`Tool response '${resp.id}' (⏰ ${resp.timestamp}) was created after tool_result '${tr.id}' (⏰ ${tr.timestamp}) for thinking '${parentThinkingId}'`);
                    }
                }
            }

            // 2) tool_result must be created before next agent_thinking (analyze edge target)
            const analyzeEdges = (edgesFrom.get(tr.id) || []).filter((e: IVerificationWorkflowEdge) => e.type === 'analyze');
            for (const ae of analyzeEdges) {
                const nextThinking = nodeById.get(ae.target);
                if (nextThinking && typeof tr.timestamp === 'number' && typeof nextThinking.timestamp === 'number') {
                    if (tr.timestamp >= nextThinking.timestamp) {
                        violations.push(`Tool result '${tr.id}' (⏰ ${tr.timestamp}) was created after or at same time as next thinking '${nextThinking.id}' (⏰ ${nextThinking.timestamp})`);
                    }
                }
            }
        }

        return violations;
    }

    /**
     * Check if a tool_response node belongs to the specified thinking by comparing
     * its originalEvent.path parentPath with [root, thinkingId].
     */
    private belongsToThinking(node: IVerificationWorkflowNode, thinkingId: string): boolean {
        const pathArr = ((node as any).data?.extensions?.robota?.originalEvent?.path ?? (node as any).data?.path) as unknown;
        if (!Array.isArray(pathArr) || pathArr.length < 2) return false;
        const parentPath = pathArr.slice(0, -1);
        // ParentPath must end with the thinkingId (root can vary)
        return parentPath[parentPath.length - 1] === thinkingId;
    }
}

// Main execution
function main() {
    const verifier = new WorkflowConnectionVerifier();
    const result = verifier.verify();
    verifier.displayResults(result);
}

// Run verification if called directly (ES module support)
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export { WorkflowConnectionVerifier };
export type { IWorkflowVerificationResult };