/**
 * React-Flow Metadata Mapper
 * 
 * Purpose: Handle metadata conversion and mapping between Universal and React-Flow formats
 * Architecture: Strategy Pattern with type-safe metadata transformation
 * Patterns: Adapter, Strategy, Single Responsibility
 */

import type { SimpleLogger } from '../../utils/simple-logger';
import { SilentLogger } from '../../utils/simple-logger';
import type {
    GenericMetadata,
    MetadataValue,
    primitive
} from '../../interfaces/base-types';
import type {
    ReactFlowData,
    ReactFlowNode,
    ReactFlowEdge,
    ReactFlowNodeData,
    ReactFlowEdgeData,
    ReactFlowConversionMetadata
} from './types';
import type {
    UniversalWorkflowStructure,
    UniversalWorkflowNode,
    UniversalWorkflowEdge
} from '../workflow-converter/universal-types';

/**
 * Metadata mapping configuration
 */
export interface MetadataMappingConfig {
    // Node metadata mapping
    nodeMetadataFields?: string[];
    preserveNodeMetadata?: boolean;

    // Edge metadata mapping
    edgeMetadataFields?: string[];
    preserveEdgeMetadata?: boolean;

    // Workflow metadata mapping
    workflowMetadataFields?: string[];
    preserveWorkflowMetadata?: boolean;

    // Filtering options
    excludeFields?: string[];
    includeOnlyFields?: string[];

    // Transformation options
    flattenNested?: boolean;
    stringifyComplexTypes?: boolean;
}

/**
 * Metadata mapping result
 */
export interface MetadataMappingResult {
    success: boolean;
    data?: GenericMetadata;
    error?: string;
    warnings?: string[];
    mappedFields: string[];
    excludedFields: string[];
}

/**
 * React-Flow Metadata Mapper
 * 
 * Features:
 * - Type-safe metadata transformation
 * - Configurable field mapping and filtering
 * - Complex type handling (dates, objects, arrays)
 * - Validation and error handling
 * - Performance optimization for large datasets
 */
export class ReactFlowMetadataMapper {

    private readonly logger: SimpleLogger;
    private readonly config: MetadataMappingConfig;

    constructor(
        config: MetadataMappingConfig = {},
        logger: SimpleLogger = SilentLogger
    ) {
        this.logger = logger;
        this.config = {
            // Default configuration
            preserveNodeMetadata: true,
            preserveEdgeMetadata: true,
            preserveWorkflowMetadata: true,
            flattenNested: false,
            stringifyComplexTypes: true,
            ...config
        };

        this.logger.debug('ReactFlowMetadataMapper initialized', {
            config: this.config
        });
    }

    /**
     * Map Universal Workflow metadata to React-Flow format
     */
    public async mapWorkflowMetadata(
        universalWorkflow: UniversalWorkflowStructure
    ): Promise<MetadataMappingResult> {

        this.logger.debug('Mapping workflow metadata', {
            hasMetadata: !!universalWorkflow.metadata
        });

        try {
            if (!universalWorkflow.metadata) {
                return {
                    success: true,
                    data: {},
                    mappedFields: [],
                    excludedFields: []
                };
            }

            const mappingResult = await this.transformMetadata(
                universalWorkflow.metadata,
                this.config.workflowMetadataFields
            );

            // Add React-Flow specific metadata
            const reactFlowMetadata: GenericMetadata = {
                ...mappingResult.data,

                // Conversion tracking
                sourceFormat: 'UniversalWorkflow',
                targetFormat: 'ReactFlow',
                conversionTimestamp: new Date(),

                // Structure information
                nodeCount: universalWorkflow.nodes.length,
                edgeCount: universalWorkflow.edges.length,

                // Layout information
                hasLayoutConfig: !!universalWorkflow.layoutConfig,
                layoutAlgorithm: universalWorkflow.layoutConfig?.algorithm || 'auto'
            };

            return {
                ...mappingResult,
                data: reactFlowMetadata
            };

        } catch (error) {
            this.logger.error('Workflow metadata mapping failed', { error });
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown mapping error',
                mappedFields: [],
                excludedFields: []
            };
        }
    }

    /**
     * Map Universal Node metadata to React-Flow Node data
     */
    public async mapNodeMetadata(
        universalNode: UniversalWorkflowNode
    ): Promise<MetadataMappingResult> {

        this.logger.debug('Mapping node metadata', {
            nodeId: universalNode.id,
            hasMetadata: !!universalNode.data.metadata
        });

        try {
            const baseData: Partial<ReactFlowNodeData> = {
                label: universalNode.data.label || universalNode.id,
                description: universalNode.data.description,
                toolName: universalNode.data.toolName,
                status: universalNode.data.status,
                executionId: universalNode.data.executionId
            };

            if (!universalNode.data.metadata) {
                return {
                    success: true,
                    data: baseData as GenericMetadata,
                    mappedFields: Object.keys(baseData).filter(key => baseData[key as keyof typeof baseData] !== undefined),
                    excludedFields: []
                };
            }

            const mappingResult = await this.transformMetadata(
                universalNode.data.metadata,
                this.config.nodeMetadataFields
            );

            // Merge base data with transformed metadata
            const nodeData: ReactFlowNodeData = {
                ...baseData,
                metadata: mappingResult.data
            } as ReactFlowNodeData;

            return {
                ...mappingResult,
                data: nodeData as GenericMetadata
            };

        } catch (error) {
            this.logger.error('Node metadata mapping failed', {
                nodeId: universalNode.id,
                error
            });
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown mapping error',
                mappedFields: [],
                excludedFields: []
            };
        }
    }

    /**
     * Map Universal Edge metadata to React-Flow Edge data
     */
    public async mapEdgeMetadata(
        universalEdge: UniversalWorkflowEdge
    ): Promise<MetadataMappingResult> {

        this.logger.debug('Mapping edge metadata', {
            edgeId: universalEdge.id,
            hasMetadata: !!universalEdge.data?.metadata
        });

        try {
            const baseData: Partial<ReactFlowEdgeData> = {
                label: universalEdge.data?.label,
                description: universalEdge.data?.description,
                connectionType: universalEdge.type
            };

            if (!universalEdge.data?.metadata) {
                return {
                    success: true,
                    data: baseData as GenericMetadata,
                    mappedFields: Object.keys(baseData).filter(key => baseData[key as keyof typeof baseData] !== undefined),
                    excludedFields: []
                };
            }

            const mappingResult = await this.transformMetadata(
                universalEdge.data.metadata,
                this.config.edgeMetadataFields
            );

            // Merge base data with transformed metadata
            const edgeData: ReactFlowEdgeData = {
                ...baseData,
                metadata: mappingResult.data
            } as ReactFlowEdgeData;

            return {
                ...mappingResult,
                data: edgeData as GenericMetadata
            };

        } catch (error) {
            this.logger.error('Edge metadata mapping failed', {
                edgeId: universalEdge.id,
                error
            });
            return {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown mapping error',
                mappedFields: [],
                excludedFields: []
            };
        }
    }

    /**
     * Transform metadata with type safety and filtering
     */
    private async transformMetadata(
        metadata: GenericMetadata,
        allowedFields?: string[]
    ): Promise<MetadataMappingResult> {

        const mappedFields: string[] = [];
        const excludedFields: string[] = [];
        const warnings: string[] = [];
        const transformedData: GenericMetadata = {};

        // Process each metadata field
        for (const [key, value] of Object.entries(metadata)) {

            // Apply field filtering
            if (!this.shouldIncludeField(key, allowedFields)) {
                excludedFields.push(key);
                continue;
            }

            // Transform value based on type
            const transformResult = await this.transformMetadataValue(key, value);

            if (transformResult.success) {
                transformedData[key] = transformResult.value;
                mappedFields.push(key);

                if (transformResult.warning) {
                    warnings.push(transformResult.warning);
                }
            } else {
                excludedFields.push(key);
                if (transformResult.warning) {
                    warnings.push(transformResult.warning);
                }
            }
        }

        return {
            success: true,
            data: transformedData,
            mappedFields,
            excludedFields,
            warnings: warnings.length > 0 ? warnings : undefined
        };
    }

    /**
     * Transform individual metadata value with type safety
     */
    private async transformMetadataValue(
        key: string,
        value: MetadataValue
    ): Promise<{
        success: boolean;
        value?: MetadataValue;
        warning?: string;
    }> {

        // Handle null/undefined
        if (value === null || value === undefined) {
            return { success: true, value };
        }

        // Handle primitives (string, number, boolean)
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return { success: true, value };
        }

        // Handle Date objects
        if (value instanceof Date) {
            if (this.config.stringifyComplexTypes) {
                return {
                    success: true,
                    value: value.toISOString(),
                    warning: `Date field '${key}' converted to ISO string`
                };
            }
            return { success: true, value };
        }

        // Handle Error objects
        if (value instanceof Error) {
            return {
                success: true,
                value: value.message,
                warning: `Error field '${key}' converted to message string`
            };
        }

        // Handle Arrays
        if (Array.isArray(value)) {
            if (this.config.stringifyComplexTypes) {
                try {
                    const stringified = JSON.stringify(value);
                    return {
                        success: true,
                        value: stringified,
                        warning: `Array field '${key}' converted to JSON string`
                    };
                } catch (error) {
                    return {
                        success: false,
                        warning: `Failed to stringify array field '${key}': ${error}`
                    };
                }
            }

            // Keep as array if not stringifying
            return { success: true, value };
        }

        // Handle Objects
        if (typeof value === 'object') {
            if (this.config.flattenNested) {
                try {
                    const flattened = await this.flattenObject(value as Record<string, unknown>, key);
                    return {
                        success: true,
                        value: flattened,
                        warning: `Object field '${key}' flattened`
                    };
                } catch (error) {
                    return {
                        success: false,
                        warning: `Failed to flatten object field '${key}': ${error}`
                    };
                }
            }

            if (this.config.stringifyComplexTypes) {
                try {
                    const stringified = JSON.stringify(value);
                    return {
                        success: true,
                        value: stringified,
                        warning: `Object field '${key}' converted to JSON string`
                    };
                } catch (error) {
                    return {
                        success: false,
                        warning: `Failed to stringify object field '${key}': ${error}`
                    };
                }
            }

            // Keep as object if not transforming
            return { success: true, value };
        }

        // Unknown type
        return {
            success: false,
            warning: `Unknown type for field '${key}': ${typeof value}`
        };
    }

    /**
     * Flatten nested object structure
     */
    private async flattenObject(
        obj: Record<string, unknown>,
        prefix: string = ''
    ): Promise<Record<string, primitive>> {

        const flattened: Record<string, primitive> = {};

        for (const [key, value] of Object.entries(obj)) {
            const flatKey = prefix ? `${prefix}.${key}` : key;

            if (value === null || value === undefined) {
                flattened[flatKey] = String(value);
            } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                flattened[flatKey] = value;
            } else if (value instanceof Date) {
                flattened[flatKey] = value.toISOString();
            } else if (value instanceof Error) {
                flattened[flatKey] = value.message;
            } else if (Array.isArray(value)) {
                flattened[flatKey] = JSON.stringify(value);
            } else if (typeof value === 'object') {
                // Recursively flatten nested objects
                const nestedFlattened = await this.flattenObject(value as Record<string, unknown>, flatKey);
                Object.assign(flattened, nestedFlattened);
            } else {
                flattened[flatKey] = String(value);
            }
        }

        return flattened;
    }

    /**
     * Check if field should be included based on configuration
     */
    private shouldIncludeField(fieldName: string, allowedFields?: string[]): boolean {

        // Check exclude list first
        if (this.config.excludeFields?.includes(fieldName)) {
            return false;
        }

        // Check include-only list
        if (this.config.includeOnlyFields) {
            return this.config.includeOnlyFields.includes(fieldName);
        }

        // Check allowed fields for this specific operation
        if (allowedFields) {
            return allowedFields.includes(fieldName);
        }

        // Default to include
        return true;
    }

    /**
     * Create React-Flow conversion metadata
     */
    public createConversionMetadata(
        sourceData: UniversalWorkflowStructure,
        targetData: ReactFlowData,
        processingTime: number
    ): ReactFlowConversionMetadata {

        return {
            // Base metadata
            timestamp: new Date(),
            version: '1.0.0',

            // Conversion specific
            sourceFormat: 'UniversalWorkflow',
            targetFormat: 'ReactFlow',
            conversionTimestamp: new Date(),
            nodeCount: targetData.nodes.length,
            edgeCount: targetData.edges.length,
            layoutAlgorithm: sourceData.layoutConfig?.algorithm || 'auto',
            theme: 'light', // Default theme
            converterVersion: '1.0.0',

            // Processing information
            processingTimeMs: processingTime,
            sourceNodeCount: sourceData.nodes.length,
            sourceEdgeCount: sourceData.edges.length,

            // Quality metrics
            metadataPreservation: {
                workflow: !!sourceData.metadata,
                nodes: sourceData.nodes.filter(n => n.data.metadata).length,
                edges: sourceData.edges.filter(e => e.data?.metadata).length
            }
        };
    }

    /**
     * Validate metadata mapping configuration
     */
    public validateConfig(): { isValid: boolean; errors: string[] } {
        const errors: string[] = [];

        // Check for conflicting field configurations
        if (this.config.includeOnlyFields && this.config.excludeFields) {
            const overlap = this.config.includeOnlyFields.filter(field =>
                this.config.excludeFields?.includes(field)
            );

            if (overlap.length > 0) {
                errors.push(`Conflicting field configuration: ${overlap.join(', ')} in both include and exclude lists`);
            }
        }

        // Check for empty field lists
        if (this.config.includeOnlyFields?.length === 0) {
            errors.push('Include-only fields list is empty, no fields will be mapped');
        }

        return {
            isValid: errors.length === 0,
            errors
        };
    }
}