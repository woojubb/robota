/**
 * Base Layout Engine
 * 
 * Abstract base class for all layout engines in the Robota SDK.
 * Follows BaseModule pattern with enabled state, logger, and event emission.
 */

import {
    LayoutEngineInterface,
    LayoutCalculationOptions,
    LayoutCalculationResult
} from '../interfaces/layout-engine';
import { WorkflowConfig } from '../interfaces/workflow-converter';
import type {
    UniversalWorkflowNode,
    UniversalWorkflowEdge,
    UniversalLayoutConfig
} from '../types/universal-workflow-types';
import { SimpleLogger, SilentLogger } from '../utils/simple-logger';

/**
 * Base layout engine options following BaseModule pattern
 */
export interface BaseLayoutEngineOptions {
    /** Enable/disable the layout engine */
    enabled?: boolean;

    /** Custom logger instance */
    logger?: SimpleLogger;

    /** Engine-specific configuration */
    config?: WorkflowConfig;
}

/**
 * Layout engine statistics tracking
 */
interface LayoutEngineStats {
    totalCalculations: number;
    successfulCalculations: number;
    failedCalculations: number;
    totalProcessingTime: number;
    totalNodeCount: number;
    lastCalculationAt?: Date;
}

/**
 * Base Layout Engine Abstract Class
 * 
 * Provides common functionality for all layout engines:
 * - Statistics tracking
 * - Logging with dependency injection
 * - Error handling and validation
 * - Performance monitoring
 * - Enable/disable functionality
 * - Common layout utilities
 */
export abstract class BaseLayoutEngine implements LayoutEngineInterface {

    // Abstract properties that must be implemented by subclasses
    abstract readonly name: string;
    abstract readonly version: string;
    abstract readonly algorithm: string;
    abstract readonly supportedDirections: Array<'TB' | 'BT' | 'LR' | 'RL'>;

    /** Enable/disable state following BaseModule pattern */
    public enabled: boolean;

    /** Logger instance with dependency injection */
    protected readonly logger: SimpleLogger;

    /** Engine configuration */
    protected readonly config: WorkflowConfig;

    /** Statistics tracking */
    private stats: LayoutEngineStats = {
        totalCalculations: 0,
        successfulCalculations: 0,
        failedCalculations: 0,
        totalProcessingTime: 0,
        totalNodeCount: 0
    };

    /**
     * Constructor following BaseModule pattern
     * 
     * @param options - Layout engine configuration options
     */
    constructor(options: BaseLayoutEngineOptions = {}) {
        this.enabled = options.enabled ?? true;
        this.logger = options.logger || SilentLogger;
        this.config = options.config || {};

        this.logger.debug(`${this.constructor.name} initialized`, {
            enabled: this.enabled
        });
    }

    /**
     * Main layout calculation method with comprehensive error handling and metrics
     * 
     * @param nodes - Nodes to position
     * @param edges - Edges to consider for positioning
     * @param config - Layout configuration
     * @param options - Additional layout options
     * @returns Promise resolving to layout result
     */
    async calculateLayout(
        nodes: UniversalWorkflowNode[],
        edges: UniversalWorkflowEdge[],
        config: UniversalLayoutConfig,
        options: LayoutCalculationOptions = {}
    ): Promise<LayoutCalculationResult> {
        if (!this.enabled) {
            throw new Error(`Layout engine ${this.name} is disabled`);
        }

        const startTime = Date.now();
        const logger = options.logger || this.logger;

        logger.debug(`Starting layout calculation with ${this.algorithm}`, {
            nodeCount: nodes.length,
            edgeCount: edges.length,
            direction: config.direction
        });

        try {
            // Update statistics
            this.stats.totalCalculations++;
            this.stats.totalNodeCount += nodes.length;

            // Validate configuration
            const configValidation = this.validateConfig(config);
            if (!configValidation.isValid) {
                this.stats.failedCalculations++;
                return this.createFailureResult(
                    configValidation.errors,
                    configValidation.warnings,
                    startTime,
                    nodes,
                    edges,
                    logger
                );
            }

            // Check if engine supports this configuration
            if (!this.supportsConfig(config)) {
                this.stats.failedCalculations++;
                return this.createFailureResult(
                    [`Layout engine ${this.name} does not support the provided configuration`],
                    [],
                    startTime,
                    nodes,
                    edges,
                    logger
                );
            }

            // Perform the actual layout calculation (implemented by subclass)
            const positionedNodes = await this.performLayoutCalculation(nodes, edges, config, options);

            // Calculate final bounds
            const bounds = this.calculateBounds(positionedNodes);

            // Create success result
            const result = this.createSuccessResult(
                positionedNodes,
                bounds,
                startTime,
                nodes,
                edges,
                config,
                logger
            );

            // Update statistics
            this.stats.successfulCalculations++;
            this.stats.totalProcessingTime += result.metadata.processingTime;
            this.stats.lastCalculationAt = result.metadata.calculatedAt;

            logger.debug(`Layout calculation completed successfully`, {
                processingTime: result.metadata.processingTime,
                nodeCount: result.metadata.nodeCount,
                bounds: result.metadata.bounds
            });

            return result;

        } catch (error) {
            this.stats.failedCalculations++;
            const processingTime = Date.now() - startTime;

            logger.error(`Layout calculation failed`, {
                error: error instanceof Error ? error.message : String(error),
                processingTime
            });

            return this.createFailureResult(
                [error instanceof Error ? error.message : String(error)],
                [],
                startTime,
                nodes,
                edges,
                logger
            );
        }
    }

    /**
     * Abstract method for actual layout calculation logic
     * Must be implemented by subclasses
     * 
     * @param nodes - Nodes to position
     * @param edges - Edges to consider
     * @param config - Layout configuration
     * @param options - Layout options
     * @returns Promise resolving to positioned nodes
     */
    protected abstract performLayoutCalculation(
        nodes: UniversalWorkflowNode[],
        edges: UniversalWorkflowEdge[],
        config: UniversalLayoutConfig,
        options: LayoutCalculationOptions
    ): Promise<UniversalWorkflowNode[]>;

    /**
     * Default configuration validation (can be overridden by subclasses)
     * 
     * @param config - Layout configuration to validate
     * @returns Validation result
     */
    validateConfig(config: UniversalLayoutConfig): {
        isValid: boolean;
        errors: string[];
        warnings: string[];
    } {
        const errors: string[] = [];
        const warnings: string[] = [];

        // Check required fields
        if (!config.algorithm) {
            errors.push('Layout algorithm is required');
        }

        if (!config.direction) {
            errors.push('Layout direction is required');
        } else if (!this.supportedDirections.includes(config.direction)) {
            errors.push(`Direction '${config.direction}' is not supported by ${this.algorithm} algorithm`);
        }

        // Check spacing configuration
        if (config.spacing) {
            if (config.spacing.nodeSpacing < 0) {
                errors.push('Node spacing must be non-negative');
            }
            if (config.spacing.levelSpacing < 0) {
                errors.push('Level spacing must be non-negative');
            }
        }

        // Check bounds if provided
        if (config.bounds) {
            if (config.bounds.width <= 0 || config.bounds.height <= 0) {
                errors.push('Canvas bounds must have positive width and height');
            }
            if (config.bounds.padding < 0) {
                warnings.push('Negative padding may cause layout issues');
            }
        }

        return {
            isValid: errors.length === 0,
            errors,
            warnings
        };
    }

    /**
     * Default implementation for checking if engine supports configuration
     * Can be overridden by subclasses for specific requirements
     * 
     * @param config - Layout configuration to check
     * @returns True if engine can handle this configuration
     */
    supportsConfig(config: UniversalLayoutConfig): boolean {
        return config.algorithm === this.algorithm &&
            this.supportedDirections.includes(config.direction);
    }

    /**
     * Default optimal configuration generator
     * Can be overridden by subclasses for algorithm-specific optimization
     * 
     * @param nodes - Nodes to layout
     * @param edges - Edges to consider
     * @returns Recommended layout configuration
     */
    getOptimalConfig(
        nodes: UniversalWorkflowNode[],
        _edges: UniversalWorkflowEdge[]
    ): UniversalLayoutConfig {
        // Basic optimal configuration based on node count
        const nodeCount = nodes.length;
        const baseSpacing = nodeCount > 50 ? 60 : nodeCount > 20 ? 80 : 100;

        return {
            algorithm: this.algorithm,
            direction: 'TB', // Default to top-bottom
            spacing: {
                nodeSpacing: baseSpacing,
                levelSpacing: baseSpacing * 1.5,
                groupSpacing: baseSpacing * 2
            },
            alignment: {
                horizontal: 'center',
                vertical: 'top'
            },
            bounds: {
                width: Math.max(800, nodeCount * 120),
                height: Math.max(600, nodeCount * 80),
                padding: 50
            }
        };
    }

    /**
     * Calculate bounds for a set of positioned nodes
     * 
     * @param nodes - Positioned nodes
     * @returns Calculated bounds
     */
    calculateBounds(nodes: UniversalWorkflowNode[]): {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
        width: number;
        height: number;
    } {
        if (nodes.length === 0) {
            return {
                minX: 0,
                maxX: 0,
                minY: 0,
                maxY: 0,
                width: 0,
                height: 0
            };
        }

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        for (const node of nodes) {
            const x = node.position.x || 0;
            const y = node.position.y || 0;
            const width = node.dimensions?.width || 150; // Default node width
            const height = node.dimensions?.height || 50; // Default node height

            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x + width);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y + height);
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
     * Get layout engine statistics
     * 
     * @returns Engine performance metrics
     */
    getStats() {
        return {
            totalCalculations: this.stats.totalCalculations,
            successfulCalculations: this.stats.successfulCalculations,
            failedCalculations: this.stats.failedCalculations,
            averageProcessingTime: this.stats.totalCalculations > 0
                ? this.stats.totalProcessingTime / this.stats.totalCalculations
                : 0,
            averageNodeCount: this.stats.totalCalculations > 0
                ? this.stats.totalNodeCount / this.stats.totalCalculations
                : 0,
            lastCalculationAt: this.stats.lastCalculationAt
        };
    }

    /**
     * Reset layout engine statistics
     */
    resetStats(): void {
        this.stats = {
            totalCalculations: 0,
            successfulCalculations: 0,
            failedCalculations: 0,
            totalProcessingTime: 0,
            totalNodeCount: 0
        };

        this.logger.debug(`Statistics reset for layout engine ${this.name}`);
    }

    /**
     * Create success result with metadata
     */
    private createSuccessResult(
        nodes: UniversalWorkflowNode[],
        bounds: ReturnType<typeof this.calculateBounds>,
        startTime: number,
        originalNodes: UniversalWorkflowNode[],
        edges: UniversalWorkflowEdge[],
        config: UniversalLayoutConfig,
        _logger: SimpleLogger
    ): LayoutCalculationResult {
        const now = new Date();
        const processingTime = now.getTime() - startTime;

        return {
            nodes,
            success: true,
            errors: [],
            warnings: [],
            metadata: {
                calculatedAt: now,
                processingTime,
                bounds,
                nodeCount: nodes.length,
                edgeCount: edges.length,
                algorithm: this.algorithm as UniversalLayoutConfig['algorithm'],
                engine: this.name,
                version: this.version,
                config
            }
        };
    }

    /**
     * Create failure result with error information
     */
    private createFailureResult(
        errors: string[],
        warnings: string[],
        startTime: number,
        nodes: UniversalWorkflowNode[],
        edges: UniversalWorkflowEdge[],
        _logger: SimpleLogger
    ): LayoutCalculationResult {
        const now = new Date();
        const processingTime = now.getTime() - startTime;

        return {
            nodes: [], // Return empty nodes on failure
            success: false,
            errors,
            warnings,
            metadata: {
                calculatedAt: now,
                processingTime,
                bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, width: 0, height: 0 },
                nodeCount: 0,
                edgeCount: edges.length,
                algorithm: this.algorithm as UniversalLayoutConfig['algorithm'],
                engine: this.name,
                version: this.version
            }
        };
    }
}