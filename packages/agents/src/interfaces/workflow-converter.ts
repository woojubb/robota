/**
 * Workflow Converter Interface
 * 
 * Defines the contract for all workflow converters in the Robota SDK.
 * Follows Interface Segregation Principle by providing minimal, focused interface.
 * 
 * @template TInput - Input workflow data type
 * @template TOutput - Output workflow data type
 */

import { SimpleLogger } from '../utils/simple-logger';

import { GenericConfig, GenericMetadata, ConfigValue, MetadataValue } from './base-types';

/**
 * Workflow configuration - uses base type for cross-converter compatibility
 * Step 1: ❌ Can't assign number/boolean to ConfigValue directly (index signature conflict)
 * Step 2: ✅ ConfigValue already includes primitive types (number, boolean)
 * Step 3: ✅ Fix index signature to allow optional properties
 * Step 4: ✅ Use proper intersection type for compatibility
 */
export interface WorkflowConfig {
    // Workflow-specific config properties
    timeout?: number;
    retries?: number;
    validateInput?: boolean;
    validateOutput?: boolean;
    // Extend GenericConfig compatibility with proper typing
    [key: string]: ConfigValue | undefined;
}

/**
 * Workflow metadata - uses base type for cross-converter compatibility
 * Step 1: ❌ Can't assign Date/number/string to MetadataValue directly (index signature conflict)
 * Step 2: ✅ MetadataValue already includes Date, primitive types
 * Step 3: ✅ Fix index signature to allow optional properties  
 * Step 4: ✅ Use proper intersection type for compatibility
 */
export interface WorkflowMetadata {
    // Workflow-specific metadata properties
    convertedAt?: Date;
    processingTime?: number;
    executionId?: string;
    // Extend GenericMetadata compatibility with proper typing
    [key: string]: MetadataValue | undefined;
}

/**
 * Base workflow data constraint with flexible typing
 * All workflow data must extend this interface for type safety
 */
export interface WorkflowData {
    readonly __workflowType?: string;
    // eslint-disable-next-line @typescript-eslint/ban-types -- tried-alternatives, generic-constraint
    [key: string]: unknown;
}

/**
 * Conversion options for workflow transformations
 * Step 1: ❌ Can't assign WorkflowConversionOptions to MetadataValue (missing index signature)
 * Step 2: ✅ Add index signature to make it compatible with MetadataValue
 * Step 3: ✅ Maintain type safety while allowing metadata storage
 * Step 4: ✅ Use MetadataValue compatibility for dynamic properties
 */
export interface WorkflowConversionOptions {
    /** Include debug information in output */
    includeDebug?: boolean;

    /** Validate input before conversion */
    validateInput?: boolean;

    /** Validate output after conversion */
    validateOutput?: boolean;

    /** Custom logger for conversion process */
    logger?: SimpleLogger;

    /** Additional metadata to include */
    metadata?: WorkflowMetadata;

    /** Platform-specific options */
    platformOptions?: WorkflowConfig;

    /** Additional dynamic options compatible with MetadataValue */
    [key: string]: MetadataValue | SimpleLogger | WorkflowMetadata | WorkflowConfig | undefined;
}

/**
 * Conversion result with metadata and validation info
 */
export interface WorkflowConversionResult<TOutput> {
    /** Converted workflow data */
    data: TOutput;

    /** Conversion success status */
    success: boolean;

    /** Validation errors (if any) */
    errors: string[];

    /** Validation warnings (if any) */
    warnings: string[];

    /** Conversion metadata */
    metadata: {
        /** Conversion timestamp */
        convertedAt: Date;

        /** Processing time in milliseconds */
        processingTime: number;

        /** Input data statistics */
        inputStats: {
            nodeCount: number;
            edgeCount: number;
        };

        /** Output data statistics */
        outputStats: {
            nodeCount: number;
            edgeCount: number;
        };

        /** Converter name */
        converter: string;

        /** Converter version */
        version: string;

        /** Additional options */
        options?: WorkflowConversionOptions;

        /** Additional metadata using GenericMetadata */
    } & GenericMetadata;
}

/**
 * Workflow Converter Interface
 * 
 * Core interface for converting between different workflow representations.
 * All workflow converters must implement this interface.
 * 
 * @template TInput - Input workflow data type
 * @template TOutput - Output workflow data type
 */
export interface WorkflowConverterInterface<TInput extends WorkflowData, TOutput extends WorkflowData> {
    /** Converter name for identification */
    readonly name: string;

    /** Converter version */
    readonly version: string;

    /** Source format that this converter accepts */
    readonly sourceFormat: string;

    /** Target format that this converter produces */
    readonly targetFormat: string;

    /**
     * Convert workflow data from input format to output format
     * 
     * @param input - Input workflow data
     * @param options - Conversion options
     * @returns Promise resolving to conversion result
     */
    convert(input: TInput, options?: WorkflowConversionOptions): Promise<WorkflowConversionResult<TOutput>>;

    /**
     * Validate input data before conversion
     * 
     * @param input - Input workflow data
     * @returns Promise resolving to validation result
     */
    validateInput(input: TInput): Promise<{
        isValid: boolean;
        errors: string[];
        warnings: string[];
    }>;

    /**
     * Validate output data after conversion
     * 
     * @param output - Output workflow data
     * @returns Promise resolving to validation result
     */
    validateOutput(output: TOutput): Promise<{
        isValid: boolean;
        errors: string[];
        warnings: string[];
    }>;

    /**
     * Check if this converter supports the given input format
     * 
     * @param input - Input data to check
     * @returns True if converter can handle this input
     */
    canConvert(input: WorkflowData): input is TInput;

    /**
     * Get conversion statistics and metrics
     * 
     * @returns Converter performance metrics
     */
    getStats(): {
        totalConversions: number;
        successfulConversions: number;
        failedConversions: number;
        averageProcessingTime: number;
        lastConversionAt?: Date;
    };

    /**
     * Reset converter statistics
     */
    resetStats(): void;
}