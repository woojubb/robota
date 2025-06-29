import type { AssignTaskParams } from '../types.js';
import type { AssignTaskSchemaType, DynamicAssignTaskSchemaType } from './schema.js';

/**
 * Convert Zod schema type to AssignTaskParams type
 */
export function convertSchemaToParams(schema: AssignTaskSchemaType): AssignTaskParams {
    const params: AssignTaskParams = {
        jobDescription: schema.jobDescription
    };

    // Only add optional properties if they exist
    if (schema.context !== undefined) {
        params.context = schema.context;
    }

    if (schema.requiredTools !== undefined) {
        params.requiredTools = schema.requiredTools;
    }

    if (schema.priority !== undefined) {
        params.priority = schema.priority;
    }

    if (schema.agentTemplate !== undefined) {
        params.agentTemplate = schema.agentTemplate;
    }

    if (schema.allowFurtherDelegation !== undefined) {
        params.allowFurtherDelegation = schema.allowFurtherDelegation;
    }

    return params;
}

/**
 * Convert dynamic schema type to AssignTaskParams type
 */
export function convertDynamicSchemaToParams(schema: DynamicAssignTaskSchemaType): AssignTaskParams {
    return convertSchemaToParams(schema);
}

/**
 * Convert unknown parameters to AssignTaskParams with type safety
 */
export function convertUnknownToParams(parameters: Record<string, string | number | boolean | Array<string>>): AssignTaskParams {
    const params: AssignTaskParams = {
        jobDescription: String(parameters['jobDescription'])
    };

    // Only add optional properties if they exist and are valid
    if (parameters['context'] && typeof parameters['context'] === 'string') {
        params.context = parameters['context'];
    }

    if (Array.isArray(parameters['requiredTools'])) {
        params.requiredTools = parameters['requiredTools'].map(String);
    }

    if (parameters['priority'] && typeof parameters['priority'] === 'string') {
        const priority = parameters['priority'] as string;
        if (['low', 'medium', 'high', 'urgent'].includes(priority)) {
            params.priority = priority as 'low' | 'medium' | 'high' | 'urgent';
        }
    }

    if (parameters['agentTemplate'] && typeof parameters['agentTemplate'] === 'string') {
        params.agentTemplate = parameters['agentTemplate'];
    }

    if (parameters['allowFurtherDelegation'] !== undefined) {
        params.allowFurtherDelegation = Boolean(parameters['allowFurtherDelegation']);
    }

    return params;
}

/**
 * Validate and convert parameters to AssignTaskParams
 */
export function safeConvertUnknownToParams(parameters: Record<string, string | number | boolean | Array<string>>): {
    success: true;
    data: AssignTaskParams;
} | {
    success: false;
    error: string;
} {
    try {
        if (!parameters || typeof parameters !== 'object') {
            return {
                success: false,
                error: 'Parameters must be an object'
            };
        }

        if (!parameters['jobDescription'] || typeof parameters['jobDescription'] !== 'string') {
            return {
                success: false,
                error: 'jobDescription is required and must be a string'
            };
        }

        const convertedParams = convertUnknownToParams(parameters);
        return {
            success: true,
            data: convertedParams
        };
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error)
        };
    }
} 