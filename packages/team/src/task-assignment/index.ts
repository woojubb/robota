/**
 * Task Assignment Facade - Main entry point
 * 
 * This module implements the Facade pattern for task assignment functionality,
 * providing a clean interface with proper separation of concerns and type safety.
 */

// Import types first
import type { TemplateInfo, AssignTaskExecutor } from './tool-factory.js';
import { createAssignTaskTool, validateTaskParams } from './tool-factory.js';
import { safeConvertUnknownToParams } from './type-converter.js';

// Export types and schemas
export type {
    AssignTaskSchemaType,
    DynamicAssignTaskSchemaType
} from './schema.js';

export {
    assignTaskSchema,
    validateAssignTaskParams,
    safeValidateAssignTaskParams,
    createDynamicAssignTaskSchema
} from './schema.js';

// Export type converters
export {
    convertSchemaToParams,
    convertDynamicSchemaToParams,
    convertUnknownToParams,
    safeConvertUnknownToParams
} from './type-converter.js';

// Export tool factory
export type {
    TemplateInfo,
    AssignTaskExecutor
} from './tool-factory.js';

export {
    createAssignTaskTool,
    validateTaskParams
} from './tool-factory.js';

/**
 * Main facade function to create a complete task assignment system
 */
export function createTaskAssignmentFacade(
    availableTemplates: TemplateInfo[],
    executor: AssignTaskExecutor
) {
    // Create the tool with dynamic schema
    const tool = createAssignTaskTool(availableTemplates, executor);

    // Create validation function for the specific templates
    const validateParams = (parameters: Record<string, string | number | boolean | Array<string>>) =>
        validateTaskParams(parameters, availableTemplates);

    // Create safe validation function
    const safeValidateParams = (parameters: Record<string, string | number | boolean | Array<string>>) =>
        safeConvertUnknownToParams(parameters);

    return {
        tool,
        validateParams,
        safeValidateParams,
        availableTemplates: [...availableTemplates] // Immutable copy
    };
} 