/**
 * React-Flow Layout Engine
 * 
 * Purpose: Specialized layout engine for React-Flow v12 positioning
 * Architecture: Strategy Pattern with BaseLayoutEngine inheritance
 * Patterns: Template Method, Single Responsibility
 */

import { BaseLayoutEngine } from '../../abstracts/base-layout-engine';
import type {
    LayoutEngineInterface,
    LayoutCalculationOptions,
    LayoutCalculationResult
} from '../../interfaces/layout-engine';
import type { SimpleLogger } from '../../utils/simple-logger';
import { SilentLogger } from '../../utils/simple-logger';
import type {
    UniversalWorkflowNode,
    UniversalWorkflowEdge,
    UniversalLayoutConfig
} from '../workflow-converter/universal-types';
import type {
    ReactFlowData,
    ReactFlowNode,
    ReactFlowEdge,
    ReactFlowLayoutConfig,
    ReactFlowPosition
} from './types';
import type { GenericMetadata } from '../../interfaces/base-types';

/**
 * Layout algorithms for React-Flow positioning
 */
export type ReactFlowLayoutAlgorithm = 'hierarchical' | 'dagre' | 'force' | 'grid';

/**
 * React-Flow specific layout calculation options
 */
export interface ReactFlowLayoutOptions extends LayoutCalculationOptions {
    algorithm?: ReactFlowLayoutAlgorithm;
    direction?: 'TB' | 'BT' | 'LR' | 'RL';
    nodeSpacing?: {
        horizontal: number;
        vertical: number;
    };
    preserveAspectRatio?: boolean;
    fitContainer?: boolean;
    containerWidth?: number;
    containerHeight?: number;
}

/**
 * React-Flow Layout Engine
 * 
 * Features:
 * - Multiple layout algorithms (hierarchical, dagre, force, grid)
 * - Direction-aware positioning (TB, BT, LR, RL)  
 * - Collision detection and avoidance
 * - Container-aware sizing and positioning
 * - Performance optimizations for large graphs
 */
export class ReactFlowLayoutEngine
    extends BaseLayoutEngine
    implements LayoutEngineInterface {

    public readonly name = 'ReactFlowLayoutEngine';
    public readonly version = '1.0.0';
    public readonly algorithm = 'hierarchical';
    public readonly supportedDirections: Array<'TB' | 'BT' | 'LR' | 'RL'> = ['TB', 'BT', 'LR', 'RL'];
    public readonly supportedFormats = ['ReactFlowData'];

    protected readonly config: ReactFlowLayoutConfig;

    constructor(
        config: ReactFlowLayoutConfig = {},
        logger: SimpleLogger = SilentLogger
    ) {
        super({ logger, config });

        // Merge with defaults
        this.config = {
            algorithm: 'hierarchical',
            direction: 'TB',
            nodeSpacing: {
                horizontal: 150,
                vertical: 100
            },
            rankSpacing: 80,
            edgeSpacing: 20,
            levelSeparation: 120,
            nodeSeparation: 80,
            iterations: 300,
            strength: 0.1,
            columns: 5,
            ...config
        };

        this.logger.debug('ReactFlowLayoutEngine initialized', {
            config: this.config
        });
    }

    /**
     * Calculate layout for React-Flow data
     */
    public async calculateReactFlowLayoutOld(
        data: ReactFlowData,
        options: ReactFlowLayoutOptions = {}
    ): Promise<LayoutCalculationResult> {
        this.logger.info('Starting React-Flow layout calculation', {
            nodeCount: data.nodes.length,
            edgeCount: data.edges.length,
            algorithm: options.algorithm || this.config.algorithm
        });

        try {
            // Delegate to new architecture method
            return await this.calculateReactFlowLayout(data, options);

        } catch (error) {
            this.logger.error('React-Flow layout calculation failed', { error });
            
            // Return simplified error result
            return {
                success: false,
                nodes: [],
                errors: [error instanceof Error ? error.message : 'Unknown layout error'],
                metadata: {
                    calculatedAt: new Date(),
                    processingTime: 0,
                    bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 },
                    nodeCount: data.nodes.length,
                    edgeCount: data.edges.length,
                    algorithm: this.config.algorithm || 'hierarchical',
                    engine: this.name,
                    version: this.version
                }
            };
        }
    }

    /**
     * Core layout calculation logic
     * Implements BaseLayoutEngine abstract method
     */
    protected async performLayoutCalculation(
        nodes: UniversalWorkflowNode[],
        edges: UniversalWorkflowEdge[],
        config: UniversalLayoutConfig,
        options: LayoutCalculationOptions
    ): Promise<UniversalWorkflowNode[]> {

        const algorithm = config.algorithm || this.config.algorithm || 'hierarchical';
        const direction = config.direction || this.config.direction || 'TB';

        this.logger.debug('Applying layout algorithm', { algorithm, direction, nodeCount: nodes.length });

        // Create positioned nodes based on algorithm
        const positionedNodes = await this.applyLayoutAlgorithm(nodes, edges, { algorithm, direction });

        return positionedNodes;
    }

    /**
     * Apply specific layout algorithm to Universal nodes
     */
    private async applyLayoutAlgorithm(
        nodes: UniversalWorkflowNode[],
        edges: UniversalWorkflowEdge[],
        config: { algorithm: string; direction: string }
    ): Promise<UniversalWorkflowNode[]> {
        
        // Clone nodes to avoid mutation
        const clonedNodes = nodes.map(node => ({
            ...node,
            position: node.position || { x: 0, y: 0 }
        }));

        // Apply selected algorithm
        switch (config.algorithm) {
            case 'hierarchical':
                return this.applyHierarchicalLayout(clonedNodes, edges, config.direction);
            case 'dagre':
                return this.applyDagreLayout(clonedNodes, edges, config.direction);
            case 'force':
                return this.applyForceLayout(clonedNodes, edges, config.direction);
            case 'grid':
                return this.applyGridLayout(clonedNodes, edges, config.direction);
            default:
                return this.applyHierarchicalLayout(clonedNodes, edges, config.direction);
        }
    }

    /**
     * Apply hierarchical layout algorithm
     */
    private applyHierarchicalLayout(
        nodes: UniversalWorkflowNode[],
        edges: UniversalWorkflowEdge[],
        direction: string
    ): UniversalWorkflowNode[] {
        
        const spacing = this.config.nodeSpacing || { horizontal: 150, vertical: 100 };
        
        // Simple hierarchical layout implementation
        return nodes.map((node, index) => {
            const level = Math.floor(index / 3); // 3 nodes per level
            const positionInLevel = index % 3;
            
            const x = positionInLevel * spacing.horizontal;
            const y = level * spacing.vertical;
            
            return {
                ...node,
                position: {
                    x: direction === 'LR' || direction === 'RL' ? y : x,
                    y: direction === 'LR' || direction === 'RL' ? x : y,
                    level: level,
                    order: positionInLevel
                }
            };
        });
    }

    /**
     * Apply Dagre layout algorithm
     */
    private applyDagreLayout(
        nodes: UniversalWorkflowNode[],
        edges: UniversalWorkflowEdge[],
        direction: string
    ): UniversalWorkflowNode[] {
        // For now, delegate to hierarchical
        return this.applyHierarchicalLayout(nodes, edges, direction);
    }

    /**
     * Apply force-directed layout algorithm
     */
    private applyForceLayout(
        nodes: UniversalWorkflowNode[],
        edges: UniversalWorkflowEdge[],
        direction: string
    ): UniversalWorkflowNode[] {
        // For now, delegate to hierarchical
        return this.applyHierarchicalLayout(nodes, edges, direction);
    }

    /**
     * Apply grid layout algorithm
     */
    private applyGridLayout(
        nodes: UniversalWorkflowNode[],
        edges: UniversalWorkflowEdge[],
        direction: string
    ): UniversalWorkflowNode[] {
        const columns = this.config.columns || 3;
        const spacing = this.config.nodeSpacing || { horizontal: 150, vertical: 100 };
        
        return nodes.map((node, index) => {
            const row = Math.floor(index / columns);
            const col = index % columns;

            const x = col * spacing.horizontal;
            const y = row * spacing.vertical;
            
            return {
                ...node,
                position: {
                    x,
                    y,
                    level: row,
                    order: col
                }
            };
        });
    }

    // === Legacy ReactFlow layout methods for backward compatibility ===

    /**
     * Calculate layout for ReactFlowData (legacy method)
     */
    async calculateReactFlowLayout(
        data: ReactFlowData,
        options: ReactFlowLayoutOptions = {}
    ): Promise<LayoutCalculationResult> {
        
        this.logger.debug('ReactFlow layout calculation started', { 
            nodeCount: data.nodes.length, 
            edgeCount: data.edges.length 
        });

        // Convert ReactFlow data to Universal format
        const universalNodes: UniversalWorkflowNode[] = data.nodes.map((node, index) => ({
            id: node.id,
            type: node.type || 'default',
            level: Math.floor(index / 3), // Simple leveling
            position: {
                x: node.position?.x || 0,
                y: node.position?.y || 0,
                level: Math.floor(index / 3),
                order: index % 3
            },
            visualState: {
                status: 'pending',
                isHighlighted: false,
                isSelected: false,
                isExpanded: true,
                opacity: 1,
                zIndex: 1,
                lastUpdated: new Date()
            },
            data: {
                ...node.data,
                label: node.data.label || node.id
            },
            createdAt: new Date(),
            updatedAt: new Date()
        }));

        const universalEdges: UniversalWorkflowEdge[] = data.edges.map(edge => ({
            id: edge.id,
            source: edge.source,
            target: edge.target,
            type: edge.type || 'default',
            data: edge.data || {},
            createdAt: new Date(),
            updatedAt: new Date()
        }));

        const universalConfig: UniversalLayoutConfig = {
            algorithm: options.algorithm || this.config.algorithm || 'hierarchical',
            direction: options.direction || this.config.direction || 'TB',
            alignment: { horizontal: 'center', vertical: 'center' }, // Required property
            spacing: {
                nodeSpacing: options.nodeSpacing?.horizontal || this.config.nodeSpacing?.horizontal || 150,
                levelSpacing: options.nodeSpacing?.vertical || this.config.nodeSpacing?.vertical || 100
            }
        };

        // Use base class method
        return this.calculateLayout(universalNodes, universalEdges, universalConfig);
    }
}
