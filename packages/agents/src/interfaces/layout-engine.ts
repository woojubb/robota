/**
 * Layout Engine Interface
 * 
 * Defines the contract for layout calculation engines in the Robota SDK.
 * Follows Single Responsibility Principle by focusing only on position calculation.
 */

import type { UniversalWorkflowNode, UniversalWorkflowEdge, UniversalLayoutConfig } from '../services/workflow-converter/universal-types';
import { SimpleLogger } from '../utils/simple-logger';
import { GenericMetadata } from './generic-types';
import { WorkflowConfig } from './workflow-converter';

/**
 * Layout calculation options
 */
export interface LayoutCalculationOptions {
    /** Canvas bounds for layout */
    bounds?: {
        width: number;
        height: number;
        padding: number;
    };

    /** Preserve existing positions where possible */
    preservePositions?: boolean;

    /** Animation/transition support */
    enableAnimation?: boolean;

    /** Custom spacing overrides */
    spacingOverrides?: {
        nodeSpacing?: number;
        levelSpacing?: number;
        groupSpacing?: number;
    };

    /** Custom logger for layout process */
    logger?: SimpleLogger;

    /** Algorithm-specific options */
    algorithmOptions?: WorkflowConfig;
}

/**
 * Layout calculation result
 */
export interface LayoutCalculationResult {
    /** Updated nodes with calculated positions */
    nodes: UniversalWorkflowNode[];

    /** Layout success status */
    success: boolean;

    /** Layout errors (if any) */
    errors: string[];

    /** Layout warnings (if any) */
    warnings: string[];

    /** Layout metadata */
    metadata: {
        /** Layout calculation timestamp */
        calculatedAt: Date;

        /** Processing time in milliseconds */
        processingTime: number;

        /** Layout bounds used */
        bounds: {
            minX: number;
            maxX: number;
            minY: number;
            maxY: number;
            width: number;
            height: number;
        };

        /** Nodes processed */
        nodeCount: number;

        /** Edges considered */
        edgeCount: number;

        /** Algorithm used */
        algorithm: string;

        /** Engine name */
        engine: string;

        /** Engine version */
        version: string;

        /** Additional metadata using GenericMetadata */
    } & GenericMetadata;
}

/**
 * Layout Engine Interface
 * 
 * Core interface for calculating node positions in workflow visualizations.
 * All layout engines must implement this interface.
 */
export interface LayoutEngineInterface {
    /** Layout engine name for identification */
    readonly name: string;

    /** Layout engine version */
    readonly version: string;

    /** Layout algorithm type */
    readonly algorithm: string;

    /** Supported layout directions */
    readonly supportedDirections: Array<'TB' | 'BT' | 'LR' | 'RL'>;

    /**
     * Calculate positions for workflow nodes
     * 
     * @param nodes - Nodes to position
     * @param edges - Edges to consider for positioning
     * @param config - Layout configuration
     * @param options - Additional layout options
     * @returns Promise resolving to layout result
     */
    calculateLayout(
        nodes: UniversalWorkflowNode[],
        edges: UniversalWorkflowEdge[],
        config: UniversalLayoutConfig,
        options?: LayoutCalculationOptions
    ): Promise<LayoutCalculationResult>;

    /**
     * Validate layout configuration
     * 
     * @param config - Layout configuration to validate
     * @returns Validation result
     */
    validateConfig(config: UniversalLayoutConfig): {
        isValid: boolean;
        errors: string[];
        warnings: string[];
    };

    /**
     * Check if this engine supports the given configuration
     * 
     * @param config - Layout configuration to check
     * @returns True if engine can handle this configuration
     */
    supportsConfig(config: UniversalLayoutConfig): boolean;

    /**
     * Get optimal layout configuration for given data
     * 
     * @param nodes - Nodes to layout
     * @param edges - Edges to consider
     * @returns Recommended layout configuration
     */
    getOptimalConfig(
        nodes: UniversalWorkflowNode[],
        edges: UniversalWorkflowEdge[]
    ): UniversalLayoutConfig;

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
    };

    /**
     * Get layout engine statistics and metrics
     * 
     * @returns Engine performance metrics
     */
    getStats(): {
        totalCalculations: number;
        successfulCalculations: number;
        failedCalculations: number;
        averageProcessingTime: number;
        averageNodeCount: number;
        lastCalculationAt?: Date;
    };

    /**
     * Reset layout engine statistics
     */
    resetStats(): void;
}