/**
 * Base Workflow Converter
 * 
 * Abstract base class for all workflow converters in the Robota SDK.
 * Follows BaseModule pattern with enabled state, logger, and event emission.
 * 
 * @template TInput - Input workflow data type
 * @template TOutput - Output workflow data type
 */

import {
    WorkflowConverterInterface,
    WorkflowConversionOptions,
    WorkflowConversionResult,
    WorkflowData,
    WorkflowConfig
} from '../interfaces/workflow-converter';
import { SimpleLogger, SilentLogger } from '../utils/simple-logger';

/**
 * Base converter options following BaseModule pattern
 */
export interface BaseWorkflowConverterOptions {
    /** Enable/disable the converter */
    enabled?: boolean;

    /** Custom logger instance */
    logger?: SimpleLogger;

    /** Converter-specific configuration */
    config?: WorkflowConfig;
}

/**
 * Converter statistics tracking
 */
interface ConverterStats {
    totalConversions: number;
    successfulConversions: number;
    failedConversions: number;
    totalProcessingTime: number;
    lastConversionAt?: Date;
}

/**
 * Base Workflow Converter Abstract Class
 * 
 * Provides common functionality for all workflow converters:
 * - Statistics tracking
 * - Logging with dependency injection
 * - Error handling and validation
 * - Performance monitoring
 * - Enable/disable functionality
 * 
 * @template TInput - Input workflow data type
 * @template TOutput - Output workflow data type
 */
export abstract class BaseWorkflowConverter<TInput extends WorkflowData, TOutput extends WorkflowData>
    implements WorkflowConverterInterface<TInput, TOutput> {

    // Abstract properties that must be implemented by subclasses
    abstract readonly name: string;
    abstract readonly version: string;
    abstract readonly sourceFormat: string;
    abstract readonly targetFormat: string;

    /** Enable/disable state following BaseModule pattern */
    public enabled: boolean;

    /** Logger instance with dependency injection */
    protected readonly logger: SimpleLogger;

    /** Converter configuration */
    protected readonly config: WorkflowConfig;

    /** Statistics tracking */
    private stats: ConverterStats = {
        totalConversions: 0,
        successfulConversions: 0,
        failedConversions: 0,
        totalProcessingTime: 0
    };

    /**
     * Constructor following BaseModule pattern
     * 
     * @param options - Converter configuration options
     */
    constructor(options: BaseWorkflowConverterOptions = {}) {
        this.enabled = options.enabled ?? true;
        this.logger = options.logger || SilentLogger;
        this.config = options.config || {};

        this.logger.debug(`${this.constructor.name} initialized`, {
            enabled: this.enabled
        });
    }

    /**
     * Main conversion method with comprehensive error handling and metrics
     * 
     * @param input - Input workflow data
     * @param options - Conversion options
     * @returns Promise resolving to conversion result
     */
    async convert(input: TInput, options: WorkflowConversionOptions = {}): Promise<WorkflowConversionResult<TOutput>> {
        if (!this.enabled) {
            throw new Error(`Converter ${this.name} is disabled`);
        }

        const startTime = Date.now();
        const logger = options.logger || this.logger;

        logger.debug(`Starting conversion from ${this.sourceFormat} to ${this.targetFormat}`);

        try {
            // Update statistics
            this.stats.totalConversions++;

            // Validate input if requested
            if (options.validateInput) {
                const inputValidation = await this.validateInput(input);
                if (!inputValidation.isValid) {
                    this.stats.failedConversions++;
                    return this.createFailureResult(
                        inputValidation.errors,
                        inputValidation.warnings,
                        startTime,
                        input,
                        logger
                    );
                }
            }

            // Perform the actual conversion (implemented by subclass)
            const convertedData = await this.performConversion(input, options);

            // Validate output if requested
            if (options.validateOutput) {
                const outputValidation = await this.validateOutput(convertedData);
                if (!outputValidation.isValid) {
                    this.stats.failedConversions++;
                    return this.createFailureResult(
                        outputValidation.errors,
                        outputValidation.warnings,
                        startTime,
                        input,
                        logger
                    );
                }
            }

            // Create success result
            const result = this.createSuccessResult(convertedData, startTime, input, options);

            // Update statistics
            this.stats.successfulConversions++;
            this.stats.totalProcessingTime += result.metadata.processingTime;
            this.stats.lastConversionAt = result.metadata.convertedAt;

            logger.debug(`Conversion completed successfully`, {
                processingTime: result.metadata.processingTime,
                inputNodes: result.metadata.inputStats.nodeCount,
                outputNodes: result.metadata.outputStats.nodeCount
            });

            return result;

        } catch (error) {
            this.stats.failedConversions++;
            const processingTime = Date.now() - startTime;

            logger.error(`Conversion failed`, {
                error: error instanceof Error ? error.message : String(error),
                processingTime
            });

            return this.createFailureResult(
                [error instanceof Error ? error.message : String(error)],
                [],
                startTime,
                input,
                logger
            );
        }
    }

    /**
     * Abstract method for actual conversion logic
     * Must be implemented by subclasses
     * 
     * @param input - Input workflow data
     * @param options - Conversion options
     * @returns Promise resolving to converted data
     */
    protected abstract performConversion(input: TInput, options: WorkflowConversionOptions): Promise<TOutput>;

    /**
     * Default input validation (can be overridden by subclasses)
     * 
     * @param input - Input workflow data
     * @returns Promise resolving to validation result
     */
    async validateInput(input: TInput): Promise<{
        isValid: boolean;
        errors: string[];
        warnings: string[];
    }> {
        // Basic null/undefined check
        if (input == null) {
            return {
                isValid: false,
                errors: ['Input data is null or undefined'],
                warnings: []
            };
        }

        // Subclasses should override for specific validation
        return {
            isValid: true,
            errors: [],
            warnings: []
        };
    }

    /**
     * Default output validation (can be overridden by subclasses)
     * 
     * @param output - Output workflow data
     * @returns Promise resolving to validation result
     */
    async validateOutput(output: TOutput): Promise<{
        isValid: boolean;
        errors: string[];
        warnings: string[];
    }> {
        // Basic null/undefined check
        if (output == null) {
            return {
                isValid: false,
                errors: ['Output data is null or undefined'],
                warnings: []
            };
        }

        // Subclasses should override for specific validation
        return {
            isValid: true,
            errors: [],
            warnings: []
        };
    }

    /**
     * Default implementation for checking if converter can handle input
     * Should be overridden by subclasses for specific type checking
     * 
     * @param input - Input data to check
     * @returns True if converter can handle this input
     */
    canConvert(input: WorkflowData): input is TInput {
        // Basic existence check - subclasses should provide more specific logic
        return input != null;
    }

    /**
     * Get converter statistics
     * 
     * @returns Converter performance metrics
     */
    getStats() {
        return {
            totalConversions: this.stats.totalConversions,
            successfulConversions: this.stats.successfulConversions,
            failedConversions: this.stats.failedConversions,
            averageProcessingTime: this.stats.totalConversions > 0
                ? this.stats.totalProcessingTime / this.stats.totalConversions
                : 0,
            lastConversionAt: this.stats.lastConversionAt
        };
    }

    /**
     * Reset converter statistics
     */
    resetStats(): void {
        this.stats = {
            totalConversions: 0,
            successfulConversions: 0,
            failedConversions: 0,
            totalProcessingTime: 0
        };

        this.logger.debug(`Statistics reset for converter ${this.name}`);
    }

    /**
     * Create success result with metadata
     */
    protected createSuccessResult(
        data: TOutput,
        startTime: number,
        input: TInput,
        options: WorkflowConversionOptions
    ): WorkflowConversionResult<TOutput> {
        const now = new Date();
        const processingTime = now.getTime() - startTime;

        return {
            data,
            success: true,
            errors: [],
            warnings: [],
            metadata: {
                convertedAt: now,
                processingTime,
                // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, legacy-code
                inputStats: this.getDataStats(input as Record<string, unknown>),
                // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, legacy-code  
                outputStats: this.getDataStats(data as Record<string, unknown>),
                converter: this.name,
                version: this.version,
                // Step 1: ❌ Can't assign WorkflowConversionOptions to MetadataValue directly
                // Step 2: ✅ MetadataValue includes Record<string, MetadataValue> 
                // Step 3: ✅ Convert to MetadataValue-compatible format with proper types
                // Step 4: ✅ Preserve type safety while enabling storage
                ...(options.includeDebug && options ? {
                    options: {
                        includeDebug: options.includeDebug as boolean,
                        validateInput: options.validateInput as boolean,
                        validateOutput: options.validateOutput as boolean
                    } as Record<string, boolean>
                } : {})
            }
        };
    }

    /**
     * Create failure result with error information
     */
    protected createFailureResult(
        errors: string[],
        warnings: string[],
        startTime: number,
        input: TInput,
        _logger: SimpleLogger
    ): WorkflowConversionResult<TOutput> {
        const now = new Date();
        const processingTime = now.getTime() - startTime;

        return {
            // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, generic-constraint
            data: null as unknown as TOutput, // Type assertion for failed conversion
            success: false,
            errors,
            warnings,
            metadata: {
                convertedAt: now,
                processingTime,
                // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, legacy-code
                inputStats: this.getDataStats(input as Record<string, unknown>),
                outputStats: { nodeCount: 0, edgeCount: 0 },
                converter: this.name,
                version: this.version
            }
        };
    }

    /**
     * Extract basic statistics from workflow data
     * Can be overridden by subclasses for specific data formats
     */
    // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, legacy-code
    protected getDataStats(data: Record<string, unknown>): { nodeCount: number; edgeCount: number } {
        if (!data) {
            return { nodeCount: 0, edgeCount: 0 };
        }

        // Try to extract node and edge counts from common properties
        const nodeCount = Array.isArray(data.nodes) ? data.nodes.length :
            Array.isArray(data.node) ? data.node.length : 0;

        const edgeCount = Array.isArray(data.edges) ? data.edges.length :
            Array.isArray(data.connections) ? data.connections.length :
                Array.isArray(data.edge) ? data.edge.length : 0;

        return { nodeCount, edgeCount };
    }
}