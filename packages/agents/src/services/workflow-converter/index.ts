/**
 * Workflow to Universal Converter
 * 
 * Converts existing WorkflowStructure to UniversalWorkflowStructure format.
 * Follows Robota SDK architecture principles with dependency injection and logging.
 */

import { BaseWorkflowConverter } from '../../abstracts/base-workflow-converter';
import type { WorkflowStructure } from '../real-time-workflow-builder';
import type { WorkflowData } from '../../interfaces/workflow-converter';
import { NodeTypeMapping, EdgeTypeMapping, WorkflowStatusMapping, EdgeStyleMapping, NodeIconMapping, NodeColorMapping, EdgeColorMapping } from './types';
import type { WorkflowNode, WorkflowConnection } from '../workflow-event-subscriber';
import type {
    UniversalWorkflowStructure,
    UniversalWorkflowNode,
    UniversalWorkflowEdge,
    UniversalVisualState
} from './universal-types';
import {
    UNIVERSAL_NODE_TYPES,
    UNIVERSAL_EDGE_TYPES
} from './universal-types';
import type { WorkflowConversionOptions } from '../../interfaces/workflow-converter';
import { SimpleLogger, SilentLogger } from '../../utils/simple-logger';

/**
 * Options specific to WorkflowToUniversal conversion
 */
export interface WorkflowToUniversalOptions {
    /** Auto-calculate positions if not provided */
    autoCalculatePositions?: boolean;

    /** Default node dimensions */
    defaultNodeDimensions?: {
        width: number;
        height: number;
    };

    /** Layout spacing configuration */
    spacing?: {
        nodeSpacing: number;
        levelSpacing: number;
    };

    /** Include original workflow metadata */
    preserveOriginalMetadata?: boolean;
}

/**
 * Workflow to Universal Converter
 * 
 * Converts Robota WorkflowStructure to platform-agnostic UniversalWorkflowStructure.
 * Implements single responsibility principle by focusing only on this conversion.
 */
export class WorkflowToUniversalConverter extends BaseWorkflowConverter<WorkflowStructure, UniversalWorkflowStructure> {
    readonly name = 'WorkflowToUniversalConverter';
    readonly version = '1.0.0';
    readonly sourceFormat = 'robota-workflow';
    readonly targetFormat = 'universal-workflow';

    /** Conversion-specific options */
    private readonly conversionOptions: WorkflowToUniversalOptions;

    /**
     * Constructor with dependency injection
     * 
     * @param logger - Logger instance (optional, defaults to SilentLogger)
     * @param options - Conversion-specific options
     */
    constructor(
        logger?: SimpleLogger,
        options: WorkflowToUniversalOptions = {}
    ) {
        super({
            logger: logger || SilentLogger,
            enabled: true
        });

        this.conversionOptions = {
            autoCalculatePositions: true,
            defaultNodeDimensions: { width: 150, height: 50 },
            spacing: { nodeSpacing: 100, levelSpacing: 150 },
            preserveOriginalMetadata: true,
            ...options
        };

        this.logger.debug('WorkflowToUniversalConverter initialized', this.conversionOptions);
    }

    /**
     * Perform the actual conversion from WorkflowStructure to UniversalWorkflowStructure
     * 
     * @param input - WorkflowStructure to convert
     * @param options - Conversion options
     * @returns Promise resolving to UniversalWorkflowStructure
     */
    protected async performConversion(
        input: WorkflowStructure,
        _options: WorkflowConversionOptions
    ): Promise<UniversalWorkflowStructure> {
        this.logger.debug('Starting WorkflowStructure to Universal conversion', {
            nodeCount: input.nodes?.length || 0,
            connectionCount: input.connections?.length || 0,
            branchCount: input.branches?.length || 0
        });

        // Convert nodes
        const universalNodes = await this.convertNodes(input.nodes || []);

        // Convert connections to edges
        const universalEdges = await this.convertConnections(input.connections || []);

        // Calculate positions if requested
        if (this.conversionOptions.autoCalculatePositions) {
            await this.calculateNodePositions(universalNodes);
        }

        // Create universal workflow structure
        const universalWorkflow: UniversalWorkflowStructure = {
            __workflowType: 'UniversalWorkflowStructure',
            id: this.generateWorkflowId(input),
            name: (input.metadata as Record<string, unknown>)?.name as string || 'Converted Workflow',
            description: (input.metadata as Record<string, unknown>)?.description as string || 'Converted from Robota WorkflowStructure',
            version: '1.0.0',

            nodes: universalNodes,
            edges: universalEdges,

            layout: {
                algorithm: 'hierarchical',
                direction: 'TB',
                spacing: this.conversionOptions.spacing!,
                alignment: {
                    horizontal: 'center',
                    vertical: 'top'
                }
            },

            metadata: {
                createdAt: new Date(),
                updatedAt: new Date(),
                metrics: {
                    totalNodes: universalNodes.length,
                    totalEdges: universalEdges.length
                },
                category: 'robota-workflow',
                tags: ['converted', 'robota'],

                // Preserve original metadata if requested
                ...(this.conversionOptions.preserveOriginalMetadata && input.metadata ? {
                    originalMetadata: input.metadata as Record<string, unknown>
                } : {})
            },

            validation: {
                isValid: true,
                errors: [],
                warnings: [],
                lastValidated: new Date()
            }
        };

        this.logger.debug('Conversion completed', {
            universalNodes: universalNodes.length,
            universalEdges: universalEdges.length
        });

        return universalWorkflow;
    }

    /**
     * Type guard for WorkflowNode
     */
    private isWorkflowNode(obj: unknown): obj is Record<string, unknown> {
        return obj != null && typeof obj === 'object';
    }

    /**
     * Convert WorkflowNodes to UniversalWorkflowNodes
     */
    private async convertNodes(workflowNodes: WorkflowNode[]): Promise<UniversalWorkflowNode[]> {
        const universalNodes: UniversalWorkflowNode[] = [];

        for (let i = 0; i < workflowNodes.length; i++) {
            const node = workflowNodes[i];

            const universalNode: UniversalWorkflowNode = {
                id: node.id || `node-${i}`,
                type: this.mapNodeType(node.type),
                parentId: node.parentId,
                level: node.level || 0,

                position: {
                    level: node.level || 0,
                    order: i,
                    x: 0, // Will be calculated later if autoCalculatePositions is true
                    y: 0
                },

                dimensions: this.conversionOptions.defaultNodeDimensions,

                visualState: this.createVisualState(node),

                data: {
                    label: this.generateNodeLabel(node),
                    description: node.data?.description,

                    // Copy original data fields
                    eventType: node.data?.eventType,
                    sourceId: node.data?.sourceId,
                    sourceType: node.data?.sourceType,
                    toolName: node.data?.toolName,
                    agentTemplate: node.data?.agentTemplate,
                    executionId: node.data?.executionId,
                    parentExecutionId: node.data?.parentExecutionId,
                    parameters: node.data?.parameters,
                    result: node.data?.result,
                    metadata: node.data?.metadata,

                    // Visual customization
                    icon: this.getNodeIcon(node.type),
                    color: this.getNodeColor(node.type),

                    // Platform extensions
                    extensions: {
                        robota: {
                            originalType: node.type,
                            originalData: node.data
                        }
                    }
                },

                interaction: {
                    selectable: true,
                    draggable: true,
                    deletable: false,
                    clickable: true
                },

                createdAt: typeof node.timestamp === 'number' ? new Date(node.timestamp) : (node.timestamp || new Date()),
                updatedAt: new Date()
            };

            universalNodes.push(universalNode);
        }

        return universalNodes;
    }

    /**
     * Convert WorkflowConnections to UniversalWorkflowEdges
     */
    private async convertConnections(connections: WorkflowConnection[]): Promise<UniversalWorkflowEdge[]> {
        const universalEdges: UniversalWorkflowEdge[] = [];

        for (let i = 0; i < connections.length; i++) {
            const connection = connections[i];

            const universalEdge: UniversalWorkflowEdge = {
                id: `edge-${connection.fromId}-${connection.toId}-${i}`,
                source: connection.fromId,
                target: connection.toId,
                type: this.mapConnectionType(connection.type),
                label: connection.label,

                style: {
                    type: this.getEdgeStyleType(connection.type as string),
                    animated: this.shouldAnimateEdge(connection.type as string),
                    strokeColor: this.getEdgeColor(connection.type as string)
                },

                data: {
                    executionOrder: i,

                    extensions: {
                        robota: {
                            originalType: connection.type,
                            originalConnection: connection
                        }
                    }
                },

                createdAt: new Date(),
                updatedAt: new Date(),
                timestamp: Date.now() // timestamp는 number 타입으로 통일
            };

            universalEdges.push(universalEdge);
        }

        return universalEdges;
    }

    /**
     * Calculate node positions using hierarchical layout
     */
    private async calculateNodePositions(nodes: UniversalWorkflowNode[]): Promise<void> {
        // Group nodes by level
        const nodesByLevel = new Map<number, UniversalWorkflowNode[]>();

        for (const node of nodes) {
            const level = node.level;
            if (!nodesByLevel.has(level)) {
                nodesByLevel.set(level, []);
            }
            nodesByLevel.get(level)!.push(node);
        }

        // Calculate positions level by level
        const spacing = this.conversionOptions.spacing!;

        for (const [level, levelNodes] of nodesByLevel) {
            const y = level * spacing.levelSpacing;
            const totalWidth = (levelNodes.length - 1) * spacing.nodeSpacing;
            const startX = -totalWidth / 2; // Center horizontally

            for (let i = 0; i < levelNodes.length; i++) {
                const node = levelNodes[i];
                node.position.x = startX + (i * spacing.nodeSpacing);
                node.position.y = y;
                node.position.order = i;
            }
        }

        this.logger.debug('Node positions calculated', {
            levels: nodesByLevel.size,
            totalNodes: nodes.length
        });
    }

    /**
     * Generate workflow ID from input structure
     */
    private generateWorkflowId(input: WorkflowStructure): string {
        // Use metadata ID if available, otherwise generate one
        if ((input.metadata as Record<string, unknown>)?.executionId) {
            return `workflow-${(input.metadata as Record<string, unknown>).executionId}`;
        }

        // Generate ID based on timestamp and node count
        const timestamp = Date.now();
        const nodeCount = input.nodes?.length || 0;
        return `workflow-${timestamp}-${nodeCount}`;
    }

    /**
     * Create visual state for a node
     */
    private createVisualState(node: WorkflowNode): UniversalVisualState {
        return {
            status: this.mapNodeStatus(node.status),
            emphasis: 'normal',
            lastUpdated: new Date()
        };
    }

    /**
     * Generate a human-readable label for a node
     */
    private generateNodeLabel(node: WorkflowNode): string {
        if (node.data?.toolName) {
            return `${node.type}: ${node.data.toolName}`;
        }

        if (node.data?.agentTemplate) {
            return `${node.type}: ${node.data.agentTemplate}`;
        }

        return node.type || 'Unknown Node';
    }

    /**
     * Map Robota node types to Universal node types
     */
    private mapNodeType(robotaType: string): string {
        const typeMap: NodeTypeMapping = {
            'user_input': UNIVERSAL_NODE_TYPES.USER_INPUT,
            'output': UNIVERSAL_NODE_TYPES.OUTPUT,
            'agent': UNIVERSAL_NODE_TYPES.AGENT,
            'sub_agent': UNIVERSAL_NODE_TYPES.AGENT, // 🎯 통합: sub_agent → agent
            'tools_container': UNIVERSAL_NODE_TYPES.TOOLS_CONTAINER,
            'tool_definition': UNIVERSAL_NODE_TYPES.TOOL_DEFINITION,
            'agent_thinking': UNIVERSAL_NODE_TYPES.AGENT_THINKING,
            'tool_call': UNIVERSAL_NODE_TYPES.TOOL_CALL,
            'sub_tool_call': UNIVERSAL_NODE_TYPES.TOOL_CALL, // 🎯 통합: sub_tool_call → tool_call
            'merge_results': UNIVERSAL_NODE_TYPES.MERGE_RESULTS,
            'sub_merge': UNIVERSAL_NODE_TYPES.MERGE_RESULTS, // 🎯 통합: sub_merge → merge_results
            'final_response': UNIVERSAL_NODE_TYPES.RESPONSE, // 🎯 통합: final_response → response
            'response': UNIVERSAL_NODE_TYPES.RESPONSE
        };

        return typeMap[robotaType] || robotaType;
    }

    /**
     * Map Robota connection types to Universal edge types
     */
    private mapConnectionType(robotaType: string): string {
        const typeMap: EdgeTypeMapping = {
            'has_tools': UNIVERSAL_EDGE_TYPES.HAS_TOOLS,
            'contains': UNIVERSAL_EDGE_TYPES.CONTAINS,
            'receives': UNIVERSAL_EDGE_TYPES.RECEIVES,
            'processes': UNIVERSAL_EDGE_TYPES.PROCESSES,
            'executes': UNIVERSAL_EDGE_TYPES.EXECUTES,
            'branch': UNIVERSAL_EDGE_TYPES.BRANCH,
            'result': UNIVERSAL_EDGE_TYPES.RESULT,
            'analyze': UNIVERSAL_EDGE_TYPES.ANALYZE,
            'spawn': UNIVERSAL_EDGE_TYPES.EXECUTES, // 🎯 통합: spawn → executes
            'delegate': UNIVERSAL_EDGE_TYPES.PROCESSES, // 🎯 통합: delegate → processes
            'return': UNIVERSAL_EDGE_TYPES.RETURN,
            'consolidate': UNIVERSAL_EDGE_TYPES.PROCESSES, // 🎯 통합: consolidate → processes
            'final': UNIVERSAL_EDGE_TYPES.FINAL,
            'deliver': UNIVERSAL_EDGE_TYPES.DELIVER
        };

        return typeMap[robotaType] || robotaType;
    }

    /**
     * Map Robota node status to Universal visual status
     */
    private mapNodeStatus(robotaStatus: unknown): UniversalVisualState['status'] {
        const statusMap: WorkflowStatusMapping = {
            'pending': 'pending',
            'running': 'running',
            'completed': 'completed',
            'error': 'error',
            'failed': 'error'
        };

        // Type guard to ensure robotaStatus is a string
        const statusKey = typeof robotaStatus === 'string' ? robotaStatus : 'pending';
        return statusMap[statusKey] || 'pending';
    }

    /**
     * Get icon for node type
     */
    private getNodeIcon(nodeType: string): string {
        const iconMap: NodeIconMapping = {
            'user_input': '👤',
            'agent': '🤖',
            'sub_agent': '🔧',
            'tool_call': '⚡',
            'tool_definition': '🛠️',
            'agent_thinking': '💭',
            'merge_results': '🔀',
            'final_response': '💬',
            'output': '📤'
        };

        return iconMap[nodeType] || '⚪';
    }

    /**
     * Get color for node type
     */
    private getNodeColor(nodeType: string): string {
        const colorMap: NodeColorMapping = {
            'user_input': '#4CAF50',
            'agent': '#2196F3',
            'sub_agent': '#FF9800',
            'tool_call': '#9C27B0',
            'agent_thinking': '#607D8B',
            'merge_results': '#795548',
            'final_response': '#E91E63',
            'output': '#4CAF50'
        };

        return colorMap[nodeType] || '#9E9E9E';
    }

    /**
     * Get edge style type
     */
    private getEdgeStyleType(connectionType: string): 'default' | 'straight' | 'step' | 'smoothstep' | 'bezier' {
        const styleMap: EdgeStyleMapping = {
            'executes': 'straight',
            'processes': 'step',
            'branch': 'smoothstep',
            'return': 'bezier'
        };

        return styleMap[connectionType] || 'default';
    }

    /**
     * Check if edge should be animated
     */
    private shouldAnimateEdge(connectionType: string): boolean {
        const animatedTypes = ['executes', 'processes', 'spawn'];
        return animatedTypes.includes(connectionType);
    }

    /**
     * Get edge color
     */
    private getEdgeColor(connectionType: string): string {
        const colorMap: EdgeColorMapping = {
            'executes': '#2196F3',
            'processes': '#4CAF50',
            'branch': '#FF9800',
            'return': '#9C27B0',
            'error': '#F44336'
        };

        return colorMap[connectionType] || '#9E9E9E';
    }

    /**
     * Enhanced input validation for WorkflowStructure
     */
    override async validateInput(input: WorkflowStructure): Promise<{
        isValid: boolean;
        errors: string[];
        warnings: string[];
    }> {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Call parent validation first
        const parentValidation = await super.validateInput(input);
        errors.push(...parentValidation.errors);
        warnings.push(...parentValidation.warnings);

        // Specific WorkflowStructure validation
        if (!input.nodes && !input.connections) {
            errors.push('WorkflowStructure must have either nodes or connections');
        }

        if (input.nodes && !Array.isArray(input.nodes)) {
            errors.push('WorkflowStructure.nodes must be an array');
        }

        if (input.connections && !Array.isArray(input.connections)) {
            errors.push('WorkflowStructure.connections must be an array');
        }

        // Check for orphaned connections
        if (input.nodes && input.connections) {
            const nodeIds = new Set(input.nodes.map(n => n.id));
            for (const conn of input.connections) {
                if (!nodeIds.has(conn.fromId)) {
                    warnings.push(`Connection references unknown node: ${conn.fromId}`);
                }
                if (!nodeIds.has(conn.toId)) {
                    warnings.push(`Connection references unknown node: ${conn.toId}`);
                }
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Check if this converter can handle the input
     */
    override canConvert(input: WorkflowData): input is WorkflowStructure {
        if (!input || typeof input !== 'object') {
            return false;
        }

        const obj = input;

        // Check for WorkflowStructure signature
        return (
            (Array.isArray(obj.nodes) || obj.nodes === undefined) &&
            (Array.isArray(obj.connections) || obj.connections === undefined) &&
            (Array.isArray(obj.branches) || obj.branches === undefined) &&
            (typeof obj.metadata === 'object' || obj.metadata === undefined)
        );
    }
}