/**
 * Base Visualization Generator Abstract Class
 * 
 * Purpose: Platform-agnostic abstract base for visualization generators
 * Architecture: Follows Robota SDK principles - provides common structure without platform dependencies
 * Features: Template method pattern for visualization generation with extensible platform support
 * 
 * Design Principles:
 * - Domain neutral: No specific platform keywords
 * - Interface segregation: Focused on visualization generation responsibilities
 * - Template method: Common workflow with customizable platform-specific steps
 * - Type safety: Constraint-based generics with proper validation
 */

import type { SimpleLogger } from '../utils/simple-logger';
import { SilentLogger } from '../utils/simple-logger';
import type { 
    UniversalWorkflowStructure, 
    UniversalWorkflowNode, 
    UniversalWorkflowEdge,
    UniversalPlatformConfig 
} from '../services/workflow-converter/universal-types';

/**
 * Base configuration for visualization generators
 */
export interface BaseVisualizationConfig {
    /** Platform identifier (e.g., 'diagram', 'chart', 'svg') */
    platform: string;
    
    /** Platform-specific configuration */
    platformConfig?: UniversalPlatformConfig;
    
    /** Logger instance for debugging */
    logger?: SimpleLogger;
    
    /** Additional metadata for the visualization */
    // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, runtime-dynamic
    metadata?: Record<string, unknown>;
}

/**
 * Result of visualization generation
 */
export interface VisualizationResult<TOutput = string> {
    /** Generated visualization output */
    output: TOutput;
    
    /** Success status */
    success: boolean;
    
    /** Error information if generation failed */
    error?: Error;
    
    /** Generation metadata and statistics */
    metadata: {
        /** Number of nodes processed */
        nodeCount: number;
        
        /** Number of edges processed */
        edgeCount: number;
        
        /** Generation timestamp */
        generatedAt: Date;
        
        /** Platform used for generation */
        platform: string;
        
        /** Generation duration in milliseconds */
        duration?: number;
        
        /** Additional platform-specific metadata */
        // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, platform-specific
        platformMetadata?: Record<string, unknown>;
    };
}

/**
 * Abstract base class for visualization generators
 * 
 * Implements template method pattern:
 * 1. Validate input workflow
 * 2. Prepare platform-specific data structures
 * 3. Generate visualization output
 * 4. Post-process and validate output
 * 5. Return standardized result
 */
export abstract class BaseVisualizationGenerator<
    TConfig extends BaseVisualizationConfig = BaseVisualizationConfig,
    TOutput = string
> {
    protected readonly config: TConfig;
    protected readonly logger: SimpleLogger;

    constructor(config: TConfig) {
        this.config = config;
        this.logger = config.logger || SilentLogger;
        
        // Validate configuration during construction
        this.validateConfiguration(config);
    }

    /**
     * Main visualization generation method (Template Method)
     * Orchestrates the entire generation process
     */
    async generateVisualization(workflow: UniversalWorkflowStructure): Promise<VisualizationResult<TOutput>> {
        const startTime = Date.now();
        
        try {
            this.logger.debug(`Starting visualization generation for platform: ${this.config.platform}`);
            
            // Step 1: Validate input
            this.validateWorkflow(workflow);
            
            // Step 2: Prepare platform-specific data
            const preparedData = await this.prepareVisualizationData(workflow);
            
            // Step 3: Generate visualization output
            const output = await this.generateVisualizationOutput(preparedData);
            
            // Step 4: Post-process output
            const processedOutput = await this.postProcessOutput(output);
            
            // Step 5: Create successful result
            const duration = Date.now() - startTime;
            const result = this.createSuccessResult(processedOutput, workflow, duration);
            
            this.logger.debug(`Visualization generation completed in ${duration}ms`);
            return result;
            
        } catch (error) {
            this.logger.error('Visualization generation failed:', error);
            return this.createErrorResult(error as Error, workflow, Date.now() - startTime);
        }
    }

    /**
     * Generate visualization from node array (convenience method)
     */
    async generateFromNodes(nodes: UniversalWorkflowNode[]): Promise<VisualizationResult<TOutput>> {
        // Create minimal workflow structure
        const workflow: UniversalWorkflowStructure = {
            __workflowType: 'UniversalWorkflowStructure',
            id: `generated-${Date.now()}`,
            nodes,
            edges: this.generateEdgesFromNodes(nodes),
            layout: {
                algorithm: 'hierarchical',
                direction: 'TB',
                spacing: { nodeSpacing: 150, levelSpacing: 100 },
                alignment: { horizontal: 'center', vertical: 'top' }
            },
            metadata: {
                createdAt: new Date(),
                updatedAt: new Date()
            }
        };
        
        return this.generateVisualization(workflow);
    }

    // ================================
    // Abstract Methods (Platform-specific implementation required)
    // ================================

    /**
     * Prepare platform-specific data structures from Universal workflow
     * 
     * @param workflow Universal workflow structure
     * @returns Platform-specific data ready for visualization generation
     */
    protected abstract prepareVisualizationData(
        workflow: UniversalWorkflowStructure
    ): Promise<unknown>;

    /**
     * Generate the actual visualization output from prepared data
     * 
     * @param preparedData Platform-specific prepared data
     * @returns Raw visualization output
     */
    protected abstract generateVisualizationOutput(
        preparedData: unknown
    ): Promise<TOutput>;

    /**
     * Get platform-specific empty visualization
     * Used when no workflow data is available
     */
    protected abstract getEmptyVisualization(): TOutput;

    // ================================
    // Virtual Methods (Optional platform-specific customization)
    // ================================

    /**
     * Post-process the generated output (optional customization)
     * 
     * @param output Raw visualization output
     * @returns Processed visualization output
     */
    protected async postProcessOutput(output: TOutput): Promise<TOutput> {
        // Default implementation: no post-processing
        return output;
    }

    /**
     * Validate platform-specific configuration (optional customization)
     * 
     * @param config Platform-specific configuration
     */
    protected validateConfiguration(config: TConfig): void {
        if (!config.platform) {
            throw new Error('Platform identifier is required');
        }
        
        this.logger.debug(`Configuration validated for platform: ${config.platform}`);
    }

    /**
     * Generate edges from node relationships (optional customization)
     * 
     * @param nodes Array of Universal workflow nodes
     * @returns Generated edges based on node relationships
     */
    protected generateEdgesFromNodes(nodes: UniversalWorkflowNode[]): UniversalWorkflowEdge[] {
        const edges: UniversalWorkflowEdge[] = [];
        
        nodes.forEach(node => {
            // Connect to parent if exists
            if (node.parentId) {
                const parentExists = nodes.some(n => n.id === node.parentId);
                if (parentExists) {
                    edges.push({
                        id: `${node.parentId}-${node.id}`,
                        source: node.parentId,
                        target: node.id,
                        type: 'sequence',
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });
                }
            }
            
            // Create level-based connections for nodes without explicit parents
            if (!node.parentId && node.position.level > 0) {
                const previousLevelNodes = nodes.filter(n => 
                    n.position.level === node.position.level - 1
                );
                
                if (previousLevelNodes.length > 0) {
                    // Connect to the closest node in the previous level
                    const closestNode = previousLevelNodes.reduce((closest, candidate) => {
                        const currentDistance = Math.abs(candidate.position.order - node.position.order);
                        const closestDistance = Math.abs(closest.position.order - node.position.order);
                        return currentDistance < closestDistance ? candidate : closest;
                    });
                    
                    edges.push({
                        id: `${closestNode.id}-${node.id}`,
                        source: closestNode.id,
                        target: node.id,
                        type: 'sequence',
                        createdAt: new Date(),
                        updatedAt: new Date()
                    });
                }
            }
        });
        
        return edges;
    }

    // ================================
    // Private Methods (Internal implementation)
    // ================================

    /**
     * Validate Universal workflow structure
     */
    private validateWorkflow(workflow: UniversalWorkflowStructure): void {
        if (!workflow) {
            throw new Error('Workflow is required');
        }
        
        if (!workflow.__workflowType || workflow.__workflowType !== 'UniversalWorkflowStructure') {
            throw new Error('Invalid workflow type');
        }
        
        if (!workflow.nodes || !Array.isArray(workflow.nodes)) {
            throw new Error('Workflow nodes are required and must be an array');
        }
        
        this.logger.debug(`Workflow validation passed: ${workflow.nodes.length} nodes, ${workflow.edges?.length || 0} edges`);
    }

    /**
     * Create successful result structure
     */
    private createSuccessResult(
        output: TOutput, 
        workflow: UniversalWorkflowStructure, 
        duration: number
    ): VisualizationResult<TOutput> {
        return {
            output,
            success: true,
            metadata: {
                nodeCount: workflow.nodes.length,
                edgeCount: workflow.edges?.length || 0,
                generatedAt: new Date(),
                platform: this.config.platform,
                duration,
                platformMetadata: this.config.platformConfig ? 
                    { ...this.config.platformConfig } : undefined
            }
        };
    }

    /**
     * Create error result structure
     */
    private createErrorResult(
        error: Error, 
        workflow: UniversalWorkflowStructure | null, 
        duration: number
    ): VisualizationResult<TOutput> {
        return {
            output: this.getEmptyVisualization(),
            success: false,
            error,
            metadata: {
                nodeCount: workflow?.nodes?.length || 0,
                edgeCount: workflow?.edges?.length || 0,
                generatedAt: new Date(),
                platform: this.config.platform,
                duration,
                platformMetadata: { error: error.message }
            }
        };
    }
}