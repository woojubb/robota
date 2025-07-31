/**
 * Universal to React-Flow Converter
 * 
 * Purpose: Convert Universal Workflow Structure to React-Flow v12 format
 * Architecture: Strategy Pattern with BaseWorkflowConverter inheritance
 * Patterns: Facade, Single Responsibility, Interface Segregation
 */

import { BaseWorkflowConverter } from '../../abstracts/base-workflow-converter';
import type {
    WorkflowConverterInterface,
    WorkflowConversionOptions,
    WorkflowConversionResult
} from '../../interfaces/workflow-converter';
import type { SimpleLogger } from '../../utils/simple-logger';
import { SilentLogger } from '../../utils/simple-logger';
import type {
    UniversalWorkflowStructure,
    UniversalWorkflowNode,
    UniversalWorkflowEdge
} from '../workflow-converter/universal-types';
import type {
    ReactFlowData,
    ReactFlowNode,
    ReactFlowEdge,
    ReactFlowConverterConfig,
    ReactFlowConversionResult,
    ReactFlowConversionMetadata,
    NodeTypeMapping,
    EdgeTypeMapping,
    DEFAULT_NODE_TYPE_MAPPING,
    DEFAULT_EDGE_TYPE_MAPPING
} from './types';
import type { GenericMetadata } from '../../interfaces/base-types';

/**
 * Converts Universal Workflow Structure to React-Flow v12 format
 * 
 * Features:
 * - Type-safe conversion with branded types
 * - Configurable node/edge type mappings
 * - Theme and styling support
 * - Layout preservation and enhancement
 * - Metadata preservation and augmentation
 */
export class UniversalToReactFlowConverter
    extends BaseWorkflowConverter<UniversalWorkflowStructure, ReactFlowData>
    implements WorkflowConverterInterface<UniversalWorkflowStructure, ReactFlowData> {

    public readonly name = 'UniversalToReactFlowConverter';
    public readonly version = '1.0.0';
    public readonly expectedInputType = 'UniversalWorkflowStructure';
    public readonly expectedOutputType = 'ReactFlowData';

    private readonly config: ReactFlowConverterConfig;

    constructor(
        config: ReactFlowConverterConfig = {},
        logger: SimpleLogger = SilentLogger
    ) {
        super(logger);

        // Merge with defaults
        this.config = {
            // Layout defaults
            nodeSpacing: {
                horizontal: 150,
                vertical: 100
            },

            // Type mapping defaults
            nodeTypeMapping: { ...DEFAULT_NODE_TYPE_MAPPING, ...config.nodeTypeMapping },
            edgeTypeMapping: { ...DEFAULT_EDGE_TYPE_MAPPING, ...config.edgeTypeMapping },

            // Feature defaults
            enableAnimation: true,
            enableSelection: true,
            enableDeletion: false,
            fitViewOnLoad: true,

            // Performance defaults
            maxNodes: 1000,
            maxEdges: 2000,

            // Merge user config
            ...config
        };

        this.logger.debug('UniversalToReactFlowConverter initialized', {
            config: this.config
        });
    }

    /**
     * Convert Universal Workflow Structure to React-Flow Data
     */
    public async convert(
        input: UniversalWorkflowStructure,
        options: WorkflowConversionOptions = {}
    ): Promise<WorkflowConversionResult> {
        this.logger.info('Starting Universal to React-Flow conversion', {
            nodeCount: input.nodes.length,
            edgeCount: input.edges.length
        });

        try {
            // Validate input
            if (options.validateInput) {
                const validation = await this.validateInput(input);
                if (!validation.isValid) {
                    return this.createErrorResult(
                        `Input validation failed: ${validation.errors.join(', ')}`,
                        options
                    );
                }
            }

            // Perform conversion
            const reactFlowData = await this.performConversion(input, options);

            // Validate output
            if (options.validateOutput) {
                const validation = await this.validateOutput(reactFlowData);
                if (!validation.isValid) {
                    return this.createErrorResult(
                        `Output validation failed: ${validation.errors.join(', ')}`,
                        options
                    );
                }
            }

            // Create success result
            const result = this.createReactFlowSuccessResult(reactFlowData, input, options);

            this.logger.info('Universal to React-Flow conversion completed', {
                nodeCount: reactFlowData.nodes.length,
                edgeCount: reactFlowData.edges.length
            });

            return result;

        } catch (error) {
            this.logger.error('Universal to React-Flow conversion failed', { error });
            return this.createErrorResult(
                error instanceof Error ? error.message : 'Unknown conversion error',
                options
            );
        }
    }

    /**
     * Core conversion logic
     */
    private async performConversion(
        input: UniversalWorkflowStructure,
        options: WorkflowConversionOptions
    ): Promise<ReactFlowData> {

        // Check performance limits
        if (input.nodes.length > (this.config.maxNodes || 1000)) {
            throw new Error(`Node count ${input.nodes.length} exceeds maximum ${this.config.maxNodes}`);
        }

        if (input.edges.length > (this.config.maxEdges || 2000)) {
            throw new Error(`Edge count ${input.edges.length} exceeds maximum ${this.config.maxEdges}`);
        }

        // Convert nodes
        const reactFlowNodes = await this.convertNodes(input.nodes);

        // Convert edges
        const reactFlowEdges = await this.convertEdges(input.edges);

        // Prepare React-Flow data structure
        const reactFlowData: ReactFlowData = {
            nodes: reactFlowNodes,
            edges: reactFlowEdges,

            // Apply viewport settings
            viewport: {
                x: 0,
                y: 0,
                zoom: 1
            },

            // Apply theme if configured
            theme: this.config.theme,

            // Apply fit view settings
            fitView: this.config.fitViewOnLoad,
            fitViewOptions: {
                padding: 50,
                includeHiddenNodes: false,
                minZoom: 0.1,
                maxZoom: 2.0,
                duration: 300
            },

            // Preserve input metadata
            metadata: {
                ...input.metadata,
                conversionTimestamp: new Date(),
                converterName: this.name,
                converterVersion: this.version
            }
        };

        return reactFlowData;
    }

    /**
     * Convert Universal nodes to React-Flow nodes
     */
    private async convertNodes(universalNodes: UniversalWorkflowNode[]): Promise<ReactFlowNode[]> {
        this.logger.debug('Converting nodes to React-Flow format', {
            count: universalNodes.length
        });

        const reactFlowNodes: ReactFlowNode[] = [];

        for (const universalNode of universalNodes) {
            const reactFlowNode: ReactFlowNode = {
                id: universalNode.id,
                type: this.mapNodeType(universalNode.type),
                position: {
                    x: universalNode.position?.x || 0,
                    y: universalNode.position?.y || 0
                },
                data: {
                    label: universalNode.data.label || universalNode.id,
                    description: universalNode.data.description,
                    icon: this.getNodeIcon(universalNode.type),
                    toolName: universalNode.data.toolName,
                    status: universalNode.data.status,
                    executionId: universalNode.data.executionId,
                    metadata: universalNode.data.metadata
                },

                // Apply dimensions if available
                width: universalNode.dimensions?.width,
                height: universalNode.dimensions?.height,

                // Apply visual state
                selected: universalNode.visualState?.selected || false,
                draggable: universalNode.visualState?.draggable !== false,
                selectable: this.config.enableSelection !== false,
                deletable: this.config.enableDeletion === true,
                hidden: universalNode.visualState?.hidden || false,

                // Apply styling
                style: this.getNodeStyle(universalNode.type),
                className: this.getNodeClassName(universalNode.type)
            };

            reactFlowNodes.push(reactFlowNode);
        }

        return reactFlowNodes;
    }

    /**
     * Convert Universal edges to React-Flow edges
     */
    private async convertEdges(universalEdges: UniversalWorkflowEdge[]): Promise<ReactFlowEdge[]> {
        this.logger.debug('Converting edges to React-Flow format', {
            count: universalEdges.length
        });

        const reactFlowEdges: ReactFlowEdge[] = [];

        for (const universalEdge of universalEdges) {
            const reactFlowEdge: ReactFlowEdge = {
                id: universalEdge.id,
                source: universalEdge.source,
                target: universalEdge.target,
                sourceHandle: universalEdge.sourceHandle,
                targetHandle: universalEdge.targetHandle,
                type: this.mapEdgeType(universalEdge.type),

                // Apply visual properties
                animated: this.shouldAnimateEdge(universalEdge.type),
                hidden: universalEdge.visualState?.hidden || false,
                selected: universalEdge.visualState?.selected || false,
                selectable: this.config.enableSelection !== false,
                deletable: this.config.enableDeletion === true,

                // Apply data
                data: {
                    label: universalEdge.data?.label,
                    description: universalEdge.data?.description,
                    connectionType: universalEdge.type,
                    animated: this.shouldAnimateEdge(universalEdge.type),
                    metadata: universalEdge.data?.metadata
                },

                // Apply styling
                style: this.getEdgeStyle(universalEdge.type),
                className: this.getEdgeClassName(universalEdge.type)
            };

            reactFlowEdges.push(reactFlowEdge);
        }

        return reactFlowEdges;
    }

    /**
     * Map Universal node type to React-Flow node type
     */
    private mapNodeType(universalType: string): string {
        const mapping = this.config.nodeTypeMapping || DEFAULT_NODE_TYPE_MAPPING;
        return mapping[universalType] || mapping.default || 'robotaDefault';
    }

    /**
     * Map Universal edge type to React-Flow edge type
     */
    private mapEdgeType(universalType: string): string {
        const mapping = this.config.edgeTypeMapping || DEFAULT_EDGE_TYPE_MAPPING;
        return mapping[universalType] || mapping.default || 'robotaDefault';
    }

    /**
     * Get icon for node type
     */
    private getNodeIcon(nodeType: string): string {
        const iconMap: Record<string, string> = {
            'agent': '🤖',
            'tool_call': '⚡',
            'user_input': '👤',
            'response': '💬',
            'team': '👥',
            'group': '📦',
            'default': '⚪'
        };

        return iconMap[nodeType] || iconMap.default;
    }

    /**
     * Determine if edge should be animated
     */
    private shouldAnimateEdge(edgeType: string): boolean {
        if (!this.config.enableAnimation) {
            return false;
        }

        // Animate execution flows
        return edgeType === 'execution' || edgeType === 'data';
    }

    /**
     * Get node styling based on type and theme
     */
    private getNodeStyle(nodeType: string): Record<string, string | number> {
        const theme = this.config.theme;
        const baseStyle = {
            borderRadius: 8,
            fontSize: 12,
            fontWeight: 500,
            padding: 8
        };

        // Apply theme-specific styles
        if (theme?.nodeStyles?.[nodeType]) {
            return { ...baseStyle, ...theme.nodeStyles[nodeType] } as Record<string, string | number>;
        }

        return baseStyle;
    }

    /**
     * Get edge styling based on type and theme
     */
    private getEdgeStyle(edgeType: string): Record<string, string | number> {
        const theme = this.config.theme;
        const baseStyle = {
            strokeWidth: 2
        };

        // Apply theme-specific styles
        if (theme?.edgeStyles?.[edgeType]) {
            return { ...baseStyle, ...theme.edgeStyles[edgeType] } as Record<string, string | number>;
        }

        return baseStyle;
    }

    /**
     * Get CSS class name for node
     */
    private getNodeClassName(nodeType: string): string {
        return `react-flow-node-${nodeType}`;
    }

    /**
     * Get CSS class name for edge
     */
    private getEdgeClassName(edgeType: string): string {
        return `react-flow-edge-${edgeType}`;
    }

    /**
     * Create success result for React-Flow conversion
     */
    private createReactFlowSuccessResult(
        data: ReactFlowData,
        input: UniversalWorkflowStructure,
        options: WorkflowConversionOptions
    ): WorkflowConversionResult {

        const metadata: ReactFlowConversionMetadata & GenericMetadata = {
            // Base metadata
            timestamp: new Date(),
            version: this.version,

            // React-Flow specific metadata
            sourceFormat: 'UniversalWorkflow',
            targetFormat: 'ReactFlow',
            conversionTimestamp: new Date(),
            nodeCount: data.nodes.length,
            edgeCount: data.edges.length,
            layoutAlgorithm: this.config.theme?.colorMode || 'auto',
            theme: this.config.theme?.colorMode || 'light',
            converterVersion: this.version,

            // Include options if debugging enabled
            ...(options.includeDebug && options ? {
                options: {
                    includeDebug: options.includeDebug as boolean,
                    validateInput: options.validateInput as boolean,
                    validateOutput: options.validateOutput as boolean
                } as Record<string, boolean>
            } : {})
        };

        return {
            success: true,
            data,
            metadata
        };
    }
}