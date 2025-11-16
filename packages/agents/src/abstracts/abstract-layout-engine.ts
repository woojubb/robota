/**
 * @fileoverview Abstract Layout Engine Base Class
 *
 * 🎯 ABSTRACT CLASS - DO NOT DEPEND ON CONCRETE IMPLEMENTATIONS
 *
 * Provides common functionality for layout engines (statistics, validation, logging).
 */
import type {
    LayoutEngineInterface,
    LayoutCalculationOptions,
    LayoutCalculationResult
} from '../interfaces/layout-engine';
import type { WorkflowConfig } from '../interfaces/workflow-converter';
import type {
    UniversalWorkflowNode,
    UniversalWorkflowEdge,
    UniversalLayoutConfig
} from '../services/workflow-converter/universal-types';
import type { AbstractLogger } from '../utils/abstract-logger';
import { DEFAULT_ABSTRACT_LOGGER } from '../utils/abstract-logger';

export interface BaseLayoutEngineOptions {
    enabled?: boolean;
    logger?: AbstractLogger;
    config?: WorkflowConfig;
}

interface LayoutEngineStats {
    totalCalculations: number;
    successfulCalculations: number;
    failedCalculations: number;
    totalProcessingTime: number;
    totalNodeCount: number;
    lastCalculationAt?: Date;
}

export abstract class AbstractLayoutEngine implements LayoutEngineInterface {
    abstract readonly name: string;
    abstract readonly version: string;
    abstract readonly algorithm: string;
    abstract readonly supportedDirections: Array<'TB' | 'BT' | 'LR' | 'RL'>;

    public enabled: boolean;
    protected readonly logger: AbstractLogger;
    protected readonly config: WorkflowConfig;

    private stats: LayoutEngineStats = {
        totalCalculations: 0,
        successfulCalculations: 0,
        failedCalculations: 0,
        totalProcessingTime: 0,
        totalNodeCount: 0
    };

    constructor(options: BaseLayoutEngineOptions = {}) {
        this.enabled = options.enabled ?? true;
        this.logger = options.logger || DEFAULT_ABSTRACT_LOGGER;
        this.config = options.config || {};

        this.logger.debug(`${this.constructor.name} initialized`, {
            enabled: this.enabled
        });
    }

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
            this.stats.totalCalculations++;
            this.stats.totalNodeCount += nodes.length;

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

            const positionedNodes = await this.performLayoutCalculation(nodes, edges, config, options);
            const bounds = this.calculateBounds(positionedNodes);

            const result = this.createSuccessResult(
                positionedNodes,
                bounds,
                startTime,
                nodes,
                edges,
                config,
                logger
            );

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

    protected abstract performLayoutCalculation(
        nodes: UniversalWorkflowNode[],
        edges: UniversalWorkflowEdge[],
        config: UniversalLayoutConfig,
        options: LayoutCalculationOptions
    ): Promise<UniversalWorkflowNode[]>;

    validateConfig(config: UniversalLayoutConfig): {
        isValid: boolean;
        errors: string[];
        warnings: string[];
    } {
        const errors: string[] = [];
        const warnings: string[] = [];

        if (!config.algorithm) {
            errors.push('Layout algorithm is required');
        }

        if (!config.direction) {
            errors.push('Layout direction is required');
        } else if (!this.supportedDirections.includes(config.direction)) {
            errors.push(`Direction '${config.direction}' is not supported by ${this.algorithm} algorithm`);
        }

        if (config.spacing) {
            if (config.spacing.nodeSpacing < 0) {
                errors.push('Node spacing must be non-negative');
            }
            if (config.spacing.levelSpacing < 0) {
                errors.push('Level spacing must be non-negative');
            }
        }

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

    supportsConfig(config: UniversalLayoutConfig): boolean {
        return config.algorithm === this.algorithm &&
            this.supportedDirections.includes(config.direction);
    }

    getOptimalConfig(
        nodes: UniversalWorkflowNode[],
        _edges: UniversalWorkflowEdge[]
    ): UniversalLayoutConfig {
        const nodeCount = nodes.length;
        const baseSpacing = nodeCount > 50 ? 60 : nodeCount > 20 ? 80 : 100;

        return {
            algorithm: this.algorithm,
            direction: 'TB',
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
            const width = node.dimensions?.width || 150;
            const height = node.dimensions?.height || 50;

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

    private createSuccessResult(
        nodes: UniversalWorkflowNode[],
        bounds: ReturnType<typeof this.calculateBounds>,
        startTime: number,
        originalNodes: UniversalWorkflowNode[],
        edges: UniversalWorkflowEdge[],
        config: UniversalLayoutConfig,
        _logger: AbstractLogger
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
                ...(config as unknown as Record<string, unknown>)
            }
        };
    }

    private createFailureResult(
        errors: string[],
        warnings: string[],
        startTime: number,
        nodes: UniversalWorkflowNode[],
        edges: UniversalWorkflowEdge[],
        _logger: AbstractLogger
    ): LayoutCalculationResult {
        const now = new Date();
        const processingTime = now.getTime() - startTime;

        return {
            nodes: [],
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
