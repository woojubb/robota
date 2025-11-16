/**
 * Hierarchical Layout Engine
 * 
 * Implements hierarchical layout algorithm for workflow nodes.
 * Arranges nodes in levels based on their hierarchical relationships.
 */

import { AbstractLayoutEngine } from '../../abstracts/abstract-layout-engine';
import type {
    UniversalWorkflowNode,
    UniversalWorkflowEdge,
    UniversalLayoutConfig
} from '../workflow-converter/universal-types';
import type { LayoutCalculationOptions } from '../../interfaces/layout-engine';
import { SimpleLogger, SilentLogger } from '../../utils/simple-logger';

/**
 * Options specific to hierarchical layout
 */
export interface HierarchicalLayoutOptions {
    /** Minimum spacing between nodes */
    minNodeSpacing?: number;

    /** Minimum spacing between levels */
    minLevelSpacing?: number;

    /** Center alignment for levels with fewer nodes */
    centerAlign?: boolean;

    /** Avoid overlapping nodes */
    avoidOverlaps?: boolean;

    /** Maximum width for a single level */
    maxLevelWidth?: number;
}

/**
 * Node positioning information for layout calculation
 */
interface PositionedNode {
    node: UniversalWorkflowNode;
    level: number;
    order: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Hierarchical Layout Engine
 * 
 * Implements a hierarchical layout algorithm that:
 * - Organizes nodes by their level property
 * - Distributes nodes evenly within each level
 * - Supports multiple layout directions (TB, BT, LR, RL)
 * - Handles node sizing and spacing automatically
 * - Prevents overlaps and optimizes readability
 */
export class HierarchicalLayoutEngine extends AbstractLayoutEngine {
    readonly name = 'HierarchicalLayoutEngine';
    readonly version = '1.0.0';
    readonly algorithm = 'hierarchical';
    readonly supportedDirections: Array<'TB' | 'BT' | 'LR' | 'RL'> = ['TB', 'BT', 'LR', 'RL'];

    /** Layout-specific options */
    private readonly layoutOptions: HierarchicalLayoutOptions;

    /**
     * Constructor with dependency injection
     * 
     * @param logger - Logger instance (optional, defaults to SilentLogger)
     * @param options - Layout-specific options
     */
    constructor(
        logger?: SimpleLogger,
        options: HierarchicalLayoutOptions = {}
    ) {
        super({
            logger: logger || SilentLogger,
            enabled: true
        });

        this.layoutOptions = {
            minNodeSpacing: 100,
            minLevelSpacing: 150,
            centerAlign: true,
            avoidOverlaps: true,
            maxLevelWidth: 1200,
            ...options
        };

        this.logger.debug('HierarchicalLayoutEngine initialized', this.layoutOptions);
    }

    /**
     * Perform hierarchical layout calculation
     * 
     * @param nodes - Nodes to position
     * @param edges - Edges to consider (for relationship analysis)
     * @param config - Layout configuration
     * @param options - Additional layout options
     * @returns Promise resolving to positioned nodes
     */
    protected async performLayoutCalculation(
        nodes: UniversalWorkflowNode[],
        edges: UniversalWorkflowEdge[],
        config: UniversalLayoutConfig,
        options: LayoutCalculationOptions
    ): Promise<UniversalWorkflowNode[]> {
        this.logger.debug('Starting hierarchical layout calculation', {
            nodeCount: nodes.length,
            edgeCount: edges.length,
            direction: config.direction
        });

        if (nodes.length === 0) {
            return [];
        }

        // Create positioned node objects with initial sizing
        const positionedNodes = this.initializePositionedNodes(nodes, config);

        // Group nodes by hierarchical level
        const nodesByLevel = this.groupNodesByLevel(positionedNodes);

        // Calculate level positions
        const levelPositions = this.calculateLevelPositions(nodesByLevel, config);

        // Position nodes within each level
        this.positionNodesInLevels(nodesByLevel, levelPositions, config);

        // Apply direction-specific transformations
        this.applyDirectionalTransformation(positionedNodes, config.direction);

        // Handle overlaps if requested
        if (this.layoutOptions.avoidOverlaps) {
            this.resolveOverlaps(positionedNodes);
        }

        // Apply bounds constraints if provided
        if (options.bounds) {
            this.constrainToBounds(positionedNodes, options.bounds);
        }

        // Update original nodes with calculated positions
        const resultNodes = this.updateNodePositions(nodes, positionedNodes);

        this.logger.debug('Hierarchical layout calculation completed', {
            levelsProcessed: nodesByLevel.size,
            finalBounds: this.calculateLayoutBounds(positionedNodes)
        });

        return resultNodes;
    }

    /**
     * Initialize positioned node objects with sizing information
     */
    private initializePositionedNodes(
        nodes: UniversalWorkflowNode[],
        config: UniversalLayoutConfig
    ): PositionedNode[] {
        return nodes.map(node => ({
            node,
            level: node.level,
            order: node.position.order,
            x: 0,
            y: 0,
            width: node.dimensions?.width || 150,
            height: node.dimensions?.height || 50
        }));
    }

    /**
     * Group nodes by their hierarchical level
     */
    private groupNodesByLevel(positionedNodes: PositionedNode[]): Map<number, PositionedNode[]> {
        const nodesByLevel = new Map<number, PositionedNode[]>();

        for (const positionedNode of positionedNodes) {
            const level = positionedNode.level;
            if (!nodesByLevel.has(level)) {
                nodesByLevel.set(level, []);
            }
            nodesByLevel.get(level)!.push(positionedNode);
        }

        // Sort nodes within each level by their order
        for (const levelNodes of nodesByLevel.values()) {
            levelNodes.sort((a, b) => a.order - b.order);
        }

        return nodesByLevel;
    }

    /**
     * Calculate Y positions for each level
     */
    private calculateLevelPositions(
        nodesByLevel: Map<number, PositionedNode[]>,
        config: UniversalLayoutConfig
    ): Map<number, number> {
        const levelPositions = new Map<number, number>();
        const sortedLevels = Array.from(nodesByLevel.keys()).sort((a, b) => a - b);

        const levelSpacing = config.spacing.levelSpacing;
        let currentY = 0;

        for (const level of sortedLevels) {
            levelPositions.set(level, currentY);

            // Calculate the height needed for this level
            const levelNodes = nodesByLevel.get(level)!;
            const maxHeight = Math.max(...levelNodes.map(n => n.height));

            // Move to next level position
            currentY += maxHeight + levelSpacing;
        }

        return levelPositions;
    }

    /**
     * Position nodes within each level horizontally
     */
    private positionNodesInLevels(
        nodesByLevel: Map<number, PositionedNode[]>,
        levelPositions: Map<number, number>,
        config: UniversalLayoutConfig
    ): void {
        const nodeSpacing = config.spacing.nodeSpacing;

        for (const [level, levelNodes] of nodesByLevel) {
            const levelY = levelPositions.get(level)!;

            if (levelNodes.length === 1) {
                // Single node - center it
                levelNodes[0].x = 0;
                levelNodes[0].y = levelY;
                continue;
            }

            // Calculate total width needed for this level
            const totalNodeWidth = levelNodes.reduce((sum, node) => sum + node.width, 0);
            const totalSpacingWidth = (levelNodes.length - 1) * nodeSpacing;
            const totalWidth = totalNodeWidth + totalSpacingWidth;

            // Check if level exceeds maximum width
            const maxWidth = this.layoutOptions.maxLevelWidth!;
            let actualSpacing = nodeSpacing;

            if (totalWidth > maxWidth) {
                // Reduce spacing to fit within max width
                const availableSpacing = maxWidth - totalNodeWidth;
                actualSpacing = Math.max(
                    this.layoutOptions.minNodeSpacing!,
                    availableSpacing / (levelNodes.length - 1)
                );
            }

            // Position nodes from left to right
            let currentX = this.layoutOptions.centerAlign ?
                -(totalNodeWidth + (levelNodes.length - 1) * actualSpacing) / 2 : 0;

            for (const node of levelNodes) {
                node.x = currentX;
                node.y = levelY;
                currentX += node.width + actualSpacing;
            }
        }
    }

    /**
     * Apply direction-specific coordinate transformations
     */
    private applyDirectionalTransformation(
        positionedNodes: PositionedNode[],
        direction: UniversalLayoutConfig['direction']
    ): void {
        if (direction === 'TB') {
            // Top-to-bottom is the default, no transformation needed
            return;
        }

        for (const node of positionedNodes) {
            const { x, y } = node;

            switch (direction) {
                case 'BT': // Bottom-to-top
                    node.y = -y;
                    break;

                case 'LR': // Left-to-right
                    node.x = y;
                    node.y = x;
                    break;

                case 'RL': // Right-to-left
                    node.x = -y;
                    node.y = x;
                    break;
            }
        }
    }

    /**
     * Resolve node overlaps by adjusting positions
     */
    private resolveOverlaps(positionedNodes: PositionedNode[]): void {
        // Simple overlap resolution using separation
        const minSeparation = 10;

        for (let i = 0; i < positionedNodes.length; i++) {
            for (let j = i + 1; j < positionedNodes.length; j++) {
                const nodeA = positionedNodes[i];
                const nodeB = positionedNodes[j];

                // Check for overlap
                const overlapX = this.calculateOverlap(
                    nodeA.x, nodeA.x + nodeA.width,
                    nodeB.x, nodeB.x + nodeB.width
                );

                const overlapY = this.calculateOverlap(
                    nodeA.y, nodeA.y + nodeA.height,
                    nodeB.y, nodeB.y + nodeB.height
                );

                if (overlapX > 0 && overlapY > 0) {
                    // Resolve overlap by moving the second node
                    if (overlapX < overlapY) {
                        // Move horizontally
                        nodeB.x = nodeA.x + nodeA.width + minSeparation;
                    } else {
                        // Move vertically
                        nodeB.y = nodeA.y + nodeA.height + minSeparation;
                    }
                }
            }
        }
    }

    /**
     * Calculate overlap between two 1D ranges
     */
    private calculateOverlap(start1: number, end1: number, start2: number, end2: number): number {
        const overlapStart = Math.max(start1, start2);
        const overlapEnd = Math.min(end1, end2);
        return Math.max(0, overlapEnd - overlapStart);
    }

    /**
     * Constrain all nodes to fit within specified bounds
     */
    private constrainToBounds(
        positionedNodes: PositionedNode[],
        bounds: { width: number; height: number; padding: number }
    ): void {
        if (positionedNodes.length === 0) return;

        // Calculate current layout bounds
        const layoutBounds = this.calculateLayoutBounds(positionedNodes);

        // Calculate scale factors to fit within bounds
        const availableWidth = bounds.width - (2 * bounds.padding);
        const availableHeight = bounds.height - (2 * bounds.padding);

        const scaleX = availableWidth / layoutBounds.width;
        const scaleY = availableHeight / layoutBounds.height;
        const scale = Math.min(scaleX, scaleY, 1); // Don't scale up

        // Apply scaling and centering
        const centerX = bounds.width / 2;
        const centerY = bounds.height / 2;
        const layoutCenterX = layoutBounds.minX + (layoutBounds.width / 2);
        const layoutCenterY = layoutBounds.minY + (layoutBounds.height / 2);

        for (const node of positionedNodes) {
            // Scale relative to layout center
            const scaledX = (node.x - layoutCenterX) * scale;
            const scaledY = (node.y - layoutCenterY) * scale;

            // Position relative to bounds center
            node.x = centerX + scaledX;
            node.y = centerY + scaledY;
        }
    }

    /**
     * Calculate the bounds of the current layout
     */
    private calculateLayoutBounds(positionedNodes: PositionedNode[]): {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
        width: number;
        height: number;
    } {
        if (positionedNodes.length === 0) {
            return { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 };
        }

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        for (const node of positionedNodes) {
            minX = Math.min(minX, node.x);
            maxX = Math.max(maxX, node.x + node.width);
            minY = Math.min(minY, node.y);
            maxY = Math.max(maxY, node.y + node.height);
        }

        return {
            minX,
            maxX,
            minY,
            maxY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    /**
     * Update original nodes with calculated positions
     */
    private updateNodePositions(
        originalNodes: UniversalWorkflowNode[],
        positionedNodes: PositionedNode[]
    ): UniversalWorkflowNode[] {
        const positionMap = new Map<string, PositionedNode>();

        for (const positionedNode of positionedNodes) {
            positionMap.set(positionedNode.node.id, positionedNode);
        }

        return originalNodes.map(node => {
            const positioned = positionMap.get(node.id);

            if (positioned) {
                return {
                    ...node,
                    position: {
                        ...node.position,
                        x: positioned.x,
                        y: positioned.y
                    },
                    dimensions: {
                        ...node.dimensions,
                        width: positioned.width,
                        height: positioned.height
                    },
                    updatedAt: new Date()
                };
            }

            return node;
        });
    }

    /**
     * Enhanced configuration validation for hierarchical layout
     */
    override validateConfig(config: UniversalLayoutConfig): {
        isValid: boolean;
        errors: string[];
        warnings: string[];
    } {
        const result = super.validateConfig(config);

        // Additional hierarchical-specific validation
        if (config.algorithm !== 'hierarchical') {
            result.errors.push('Algorithm must be "hierarchical" for HierarchicalLayoutEngine');
        }

        if (config.spacing.nodeSpacing < this.layoutOptions.minNodeSpacing!) {
            result.warnings.push(
                `Node spacing (${config.spacing.nodeSpacing}) is below recommended minimum (${this.layoutOptions.minNodeSpacing})`
            );
        }

        if (config.spacing.levelSpacing < this.layoutOptions.minLevelSpacing!) {
            result.warnings.push(
                `Level spacing (${config.spacing.levelSpacing}) is below recommended minimum (${this.layoutOptions.minLevelSpacing})`
            );
        }

        return result;
    }

    /**
     * Get optimal configuration for hierarchical layout
     */
    override getOptimalConfig(
        nodes: UniversalWorkflowNode[],
        edges: UniversalWorkflowEdge[]
    ): UniversalLayoutConfig {
        const baseConfig = super.getOptimalConfig(nodes, edges);

        // Analyze node distribution across levels
        const levels = new Set(nodes.map(n => n.level));
        const avgNodesPerLevel = nodes.length / levels.size;

        // Adjust spacing based on node density
        const nodeSpacing = avgNodesPerLevel > 5 ? 80 : avgNodesPerLevel > 3 ? 100 : 120;
        const levelSpacing = levels.size > 5 ? 120 : 150;

        return {
            ...baseConfig,
            algorithm: 'hierarchical',
            spacing: {
                nodeSpacing,
                levelSpacing,
                groupSpacing: levelSpacing * 1.5
            }
        };
    }
}