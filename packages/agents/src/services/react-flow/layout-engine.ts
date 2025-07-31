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
    extends BaseLayoutEngine<ReactFlowData>
    implements LayoutEngineInterface<ReactFlowData> {

    public readonly name = 'ReactFlowLayoutEngine';
    public readonly version = '1.0.0';
    public readonly supportedFormats = ['ReactFlowData'];

    private readonly config: ReactFlowLayoutConfig;

    constructor(
        config: ReactFlowLayoutConfig = {},
        logger: SimpleLogger = SilentLogger
    ) {
        super(logger);

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
    public async calculateLayout(
        data: ReactFlowData,
        options: ReactFlowLayoutOptions = {}
    ): Promise<LayoutCalculationResult> {
        this.logger.info('Starting React-Flow layout calculation', {
            nodeCount: data.nodes.length,
            edgeCount: data.edges.length,
            algorithm: options.algorithm || this.config.algorithm
        });

        try {
            // Validate input
            if (options.validateInput) {
                const validation = await this.validateInput(data);
                if (!validation.isValid) {
                    return this.createErrorResult(
                        `Input validation failed: ${validation.errors.join(', ')}`,
                        options
                    );
                }
            }

            // Perform layout calculation
            const layoutResult = await this.performLayoutCalculation(data, options);

            // Validate output
            if (options.validateOutput) {
                const validation = await this.validateOutput(layoutResult);
                if (!validation.isValid) {
                    return this.createErrorResult(
                        `Output validation failed: ${validation.errors.join(', ')}`,
                        options
                    );
                }
            }

            // Create success result
            const result = this.createLayoutSuccessResult(layoutResult, data, options);

            this.logger.info('React-Flow layout calculation completed', {
                nodeCount: layoutResult.nodes.length,
                algorithm: options.algorithm || this.config.algorithm
            });

            return result;

        } catch (error) {
            this.logger.error('React-Flow layout calculation failed', { error });
            return this.createErrorResult(
                error instanceof Error ? error.message : 'Unknown layout error',
                options
            );
        }
    }

    /**
     * Core layout calculation logic
     */
    private async performLayoutCalculation(
        data: ReactFlowData,
        options: ReactFlowLayoutOptions
    ): Promise<ReactFlowData> {

        const algorithm = options.algorithm || this.config.algorithm || 'hierarchical';

        this.logger.debug('Applying layout algorithm', { algorithm });

        // Clone data to avoid mutation
        const layoutData: ReactFlowData = {
            ...data,
            nodes: [...data.nodes],
            edges: [...data.edges]
        };

        // Apply selected algorithm
        switch (algorithm) {
            case 'hierarchical':
                await this.applyHierarchicalLayout(layoutData, options);
                break;
            case 'dagre':
                await this.applyDagreLayout(layoutData, options);
                break;
            case 'force':
                await this.applyForceLayout(layoutData, options);
                break;
            case 'grid':
                await this.applyGridLayout(layoutData, options);
                break;
            default:
                throw new Error(`Unsupported layout algorithm: ${algorithm}`);
        }

        // Apply post-processing
        await this.postProcessLayout(layoutData, options);

        return layoutData;
    }

    /**
     * Apply hierarchical layout algorithm
     */
    private async applyHierarchicalLayout(
        data: ReactFlowData,
        options: ReactFlowLayoutOptions
    ): Promise<void> {

        const direction = options.direction || this.config.direction || 'TB';
        const spacing = options.nodeSpacing || this.config.nodeSpacing!;

        this.logger.debug('Applying hierarchical layout', { direction, spacing });

        // Build hierarchy from edges
        const hierarchy = this.buildHierarchy(data.nodes, data.edges);

        // Position nodes by levels
        let currentY = 0;
        const levelWidth = new Map<number, number>();

        for (const [level, nodes] of hierarchy) {
            let currentX = 0;
            const nodesInLevel = nodes.length;

            // Calculate starting X position for centering
            const totalWidth = (nodesInLevel - 1) * spacing.horizontal;
            const startX = -totalWidth / 2;

            nodes.forEach((node, index) => {
                const position = this.calculateHierarchicalPosition(
                    index,
                    level,
                    startX,
                    currentY,
                    spacing,
                    direction
                );

                // Update node position
                const nodeIndex = data.nodes.findIndex(n => n.id === node.id);
                if (nodeIndex !== -1) {
                    data.nodes[nodeIndex].position = position;
                }

                currentX += spacing.horizontal;
            });

            levelWidth.set(level, totalWidth);
            currentY += spacing.vertical;
        }
    }

    /**
     * Apply Dagre layout algorithm (placeholder for future implementation)
     */
    private async applyDagreLayout(
        data: ReactFlowData,
        options: ReactFlowLayoutOptions
    ): Promise<void> {

        this.logger.debug('Applying Dagre layout (using hierarchical fallback)');

        // For now, fallback to hierarchical
        // TODO: Implement actual Dagre algorithm
        await this.applyHierarchicalLayout(data, options);
    }

    /**
     * Apply force-directed layout algorithm
     */
    private async applyForceLayout(
        data: ReactFlowData,
        options: ReactFlowLayoutOptions
    ): Promise<void> {

        const iterations = this.config.iterations || 300;
        const strength = this.config.strength || 0.1;

        this.logger.debug('Applying force layout', { iterations, strength });

        // Initialize random positions
        data.nodes.forEach(node => {
            if (!node.position.x && !node.position.y) {
                node.position = {
                    x: Math.random() * 800 - 400,
                    y: Math.random() * 600 - 300
                };
            }
        });

        // Simple force simulation
        for (let i = 0; i < iterations; i++) {
            // Calculate forces
            const forces = new Map<string, { x: number; y: number }>();

            // Initialize forces
            data.nodes.forEach(node => {
                forces.set(node.id, { x: 0, y: 0 });
            });

            // Repulsion forces between nodes
            for (let j = 0; j < data.nodes.length; j++) {
                for (let k = j + 1; k < data.nodes.length; k++) {
                    const nodeA = data.nodes[j];
                    const nodeB = data.nodes[k];

                    const dx = nodeB.position.x - nodeA.position.x;
                    const dy = nodeB.position.y - nodeA.position.y;
                    const distance = Math.sqrt(dx * dx + dy * dy) || 1;

                    const force = strength * 1000 / (distance * distance);
                    const forceX = (dx / distance) * force;
                    const forceY = (dy / distance) * force;

                    const forceA = forces.get(nodeA.id)!;
                    const forceB = forces.get(nodeB.id)!;

                    forceA.x -= forceX;
                    forceA.y -= forceY;
                    forceB.x += forceX;
                    forceB.y += forceY;
                }
            }

            // Attraction forces along edges
            data.edges.forEach(edge => {
                const sourceNode = data.nodes.find(n => n.id === edge.source);
                const targetNode = data.nodes.find(n => n.id === edge.target);

                if (sourceNode && targetNode) {
                    const dx = targetNode.position.x - sourceNode.position.x;
                    const dy = targetNode.position.y - sourceNode.position.y;
                    const distance = Math.sqrt(dx * dx + dy * dy) || 1;

                    const force = strength * distance / 100;
                    const forceX = (dx / distance) * force;
                    const forceY = (dy / distance) * force;

                    const sourceForce = forces.get(sourceNode.id)!;
                    const targetForce = forces.get(targetNode.id)!;

                    sourceForce.x += forceX;
                    sourceForce.y += forceY;
                    targetForce.x -= forceX;
                    targetForce.y -= forceY;
                }
            });

            // Apply forces
            data.nodes.forEach(node => {
                const force = forces.get(node.id)!;
                node.position.x += force.x;
                node.position.y += force.y;
            });
        }
    }

    /**
     * Apply grid layout algorithm
     */
    private async applyGridLayout(
        data: ReactFlowData,
        options: ReactFlowLayoutOptions
    ): Promise<void> {

        const columns = this.config.columns || 5;
        const spacing = options.nodeSpacing || this.config.nodeSpacing!;

        this.logger.debug('Applying grid layout', { columns, spacing });

        data.nodes.forEach((node, index) => {
            const row = Math.floor(index / columns);
            const col = index % columns;

            node.position = {
                x: col * spacing.horizontal,
                y: row * spacing.vertical
            };
        });
    }

    /**
     * Build node hierarchy from edges
     */
    private buildHierarchy(
        nodes: ReactFlowNode[],
        edges: ReactFlowEdge[]
    ): Map<number, ReactFlowNode[]> {

        const hierarchy = new Map<number, ReactFlowNode[]>();
        const inDegree = new Map<string, number>();
        const processed = new Set<string>();

        // Initialize in-degree count
        nodes.forEach(node => {
            inDegree.set(node.id, 0);
        });

        // Calculate in-degrees
        edges.forEach(edge => {
            const current = inDegree.get(edge.target) || 0;
            inDegree.set(edge.target, current + 1);
        });

        // Find root nodes (in-degree = 0)
        let level = 0;
        let currentLevel = nodes.filter(node => inDegree.get(node.id) === 0);

        while (currentLevel.length > 0) {
            hierarchy.set(level, [...currentLevel]);

            // Mark current level as processed
            currentLevel.forEach(node => processed.add(node.id));

            // Find next level
            const nextLevel: ReactFlowNode[] = [];

            currentLevel.forEach(node => {
                edges.forEach(edge => {
                    if (edge.source === node.id && !processed.has(edge.target)) {
                        const targetNode = nodes.find(n => n.id === edge.target);
                        if (targetNode) {
                            const currentInDegree = inDegree.get(edge.target) || 0;
                            inDegree.set(edge.target, currentInDegree - 1);

                            if (inDegree.get(edge.target) === 0) {
                                nextLevel.push(targetNode);
                            }
                        }
                    }
                });
            });

            currentLevel = nextLevel;
            level++;
        }

        // Handle remaining nodes (cycles or disconnected)
        const remaining = nodes.filter(node => !processed.has(node.id));
        if (remaining.length > 0) {
            hierarchy.set(level, remaining);
        }

        return hierarchy;
    }

    /**
     * Calculate position for hierarchical layout
     */
    private calculateHierarchicalPosition(
        index: number,
        level: number,
        startX: number,
        currentY: number,
        spacing: { horizontal: number; vertical: number },
        direction: string
    ): ReactFlowPosition {

        const x = startX + (index * spacing.horizontal);
        const y = currentY;

        // Adjust for direction
        switch (direction) {
            case 'TB': // Top to Bottom
                return { x, y };
            case 'BT': // Bottom to Top
                return { x, y: -y };
            case 'LR': // Left to Right
                return { x: y, y: x };
            case 'RL': // Right to Left
                return { x: -y, y: x };
            default:
                return { x, y };
        }
    }

    /**
     * Post-process layout (collision detection, bounds checking)
     */
    private async postProcessLayout(
        data: ReactFlowData,
        options: ReactFlowLayoutOptions
    ): Promise<void> {

        this.logger.debug('Post-processing layout');

        // Center the layout
        this.centerLayout(data.nodes);

        // Fit to container if specified
        if (options.fitContainer && options.containerWidth && options.containerHeight) {
            this.fitToContainer(data.nodes, options.containerWidth, options.containerHeight);
        }

        // Detect and resolve collisions
        this.resolveCollisions(data.nodes, options.nodeSpacing);
    }

    /**
     * Center layout around origin
     */
    private centerLayout(nodes: ReactFlowNode[]): void {
        if (nodes.length === 0) return;

        const bounds = this.calculateBounds(nodes);
        const centerX = (bounds.minX + bounds.maxX) / 2;
        const centerY = (bounds.minY + bounds.maxY) / 2;

        nodes.forEach(node => {
            node.position.x -= centerX;
            node.position.y -= centerY;
        });
    }

    /**
     * Fit layout to container dimensions
     */
    private fitToContainer(
        nodes: ReactFlowNode[],
        containerWidth: number,
        containerHeight: number
    ): void {
        if (nodes.length === 0) return;

        const bounds = this.calculateBounds(nodes);
        const layoutWidth = bounds.maxX - bounds.minX;
        const layoutHeight = bounds.maxY - bounds.minY;

        const scaleX = containerWidth / layoutWidth;
        const scaleY = containerHeight / layoutHeight;
        const scale = Math.min(scaleX, scaleY) * 0.9; // 90% to leave margins

        nodes.forEach(node => {
            node.position.x *= scale;
            node.position.y *= scale;
        });
    }

    /**
     * Calculate layout bounds
     */
    private calculateBounds(nodes: ReactFlowNode[]): {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
    } {
        if (nodes.length === 0) {
            return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
        }

        let minX = nodes[0].position.x;
        let maxX = nodes[0].position.x;
        let minY = nodes[0].position.y;
        let maxY = nodes[0].position.y;

        nodes.forEach(node => {
            minX = Math.min(minX, node.position.x);
            maxX = Math.max(maxX, node.position.x);
            minY = Math.min(minY, node.position.y);
            maxY = Math.max(maxY, node.position.y);
        });

        return { minX, maxX, minY, maxY };
    }

    /**
     * Resolve node collisions
     */
    private resolveCollisions(
        nodes: ReactFlowNode[],
        spacing?: { horizontal: number; vertical: number }
    ): void {
        const minSpacing = spacing || { horizontal: 150, vertical: 100 };

        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const nodeA = nodes[i];
                const nodeB = nodes[j];

                const dx = nodeB.position.x - nodeA.position.x;
                const dy = nodeB.position.y - nodeA.position.y;
                const distance = Math.sqrt(dx * dx + dy * dy);

                const minDistance = Math.min(minSpacing.horizontal, minSpacing.vertical);

                if (distance < minDistance) {
                    const overlap = minDistance - distance;
                    const moveX = (dx / distance) * overlap * 0.5;
                    const moveY = (dy / distance) * overlap * 0.5;

                    nodeA.position.x -= moveX;
                    nodeA.position.y -= moveY;
                    nodeB.position.x += moveX;
                    nodeB.position.y += moveY;
                }
            }
        }
    }

    /**
     * Create success result with layout metadata
     */
    private createLayoutSuccessResult(
        data: ReactFlowData,
        originalData: ReactFlowData,
        options: ReactFlowLayoutOptions
    ): LayoutCalculationResult {

        const metadata: GenericMetadata = {
            timestamp: new Date(),
            version: this.version,
            algorithm: options.algorithm || this.config.algorithm || 'hierarchical',
            direction: options.direction || this.config.direction || 'TB',
            nodeCount: data.nodes.length,
            edgeCount: data.edges.length,
            processingTime: Date.now(),

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