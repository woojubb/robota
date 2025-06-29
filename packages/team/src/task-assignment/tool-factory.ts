import { createZodFunctionTool, type ToolParameters } from '@robota-sdk/agents';
import { z } from 'zod';
import type { AssignTaskParams, AssignTaskResult } from '../types.js';
import { createDynamicAssignTaskSchema } from './schema.js';
import { safeConvertUnknownToParams } from './type-converter.js';

/**
 * Interface for template information
 */
export interface TemplateInfo {
    id: string;
    description: string;
}

/**
 * Interface for AssignTask executor function
 */
export interface AssignTaskExecutor {
    (params: AssignTaskParams): Promise<AssignTaskResult>;
}

/**
 * Create ToolParameters compatible schema from AssignTaskParams schema
 */
function createToolParametersSchema(availableTemplates: TemplateInfo[]) {
    // Create a schema that extends ToolParameters (Record<string, ToolParameterValue>)
    return z.record(z.string(), z.union([
        z.string(),
        z.number(),
        z.boolean(),
        z.array(z.string()),
        z.record(z.string(), z.string())
    ])).transform((data) => {
        // Validate using our dynamic schema
        const assignTaskSchema = createDynamicAssignTaskSchema(availableTemplates);
        return assignTaskSchema.parse(data);
    });
}

/**
 * Create AssignTask tool with dynamic schema based on available templates
 */
export function createAssignTaskTool(
    availableTemplates: TemplateInfo[],
    executor: AssignTaskExecutor
) {
    // Create ToolParameters compatible schema
    const toolParametersSchema = createToolParametersSchema(availableTemplates);

    // Create the tool instance with proper type casting for createZodFunctionTool compatibility
    const toolInstance = createZodFunctionTool(
        'assignTask',
        createToolDescription(availableTemplates),
        toolParametersSchema,
        async (parameters: ToolParameters) => {
            // Use safe conversion to handle unknown parameters
            const conversionResult = safeConvertUnknownToParams(parameters);

            if (!conversionResult.success) {
                throw new Error(`Invalid task assignment parameters: ${conversionResult.error}`);
            }

            // Execute the task with validated parameters
            const result = await executor(conversionResult.data);

            // Return formatted string result for LLM consumption
            return formatResultForLLM(result);
        }
    );

    return toolInstance;
}

/**
 * Create tool description with available templates
 */
function createToolDescription(availableTemplates: TemplateInfo[]): string {
    const baseDescription = `Assign a specialized task to a temporary expert agent. Use this when the task requires specific expertise, complex analysis, or when breaking down work into specialized components would be beneficial. The expert agent will be created, complete the task, and be automatically cleaned up.`;

    const delegationGuidance = `Set allowFurtherDelegation=true ONLY for extremely complex tasks requiring multiple different areas of expertise, otherwise keep false for direct execution.`;

    const templateGuidance = availableTemplates.length > 0
        ? `Choose appropriate agentTemplate based on the nature of the work. Available templates: ${availableTemplates.map(t => t.id).join(', ')}.`
        : `A dynamic agent will be created based on the job description.`;

    return `${baseDescription} ${delegationGuidance} ${templateGuidance}`;
}

/**
 * Format task result for LLM consumption
 */
function formatResultForLLM(result: AssignTaskResult): string {
    const baseResult = `Task completed successfully by ${result.agentId}.\n\nResult:\n${result.result}`;

    const metadata = `\n\nExecution time: ${result.metadata.executionTime}ms`;

    const additionalInfo = [];

    if (result.metadata.tokensUsed) {
        additionalInfo.push(`Tokens used: ${result.metadata.tokensUsed}`);
    }

    if (result.metadata.agentExecutions) {
        additionalInfo.push(`Agent executions: ${result.metadata.agentExecutions}`);
    }

    if (result.metadata.agentSuccessRate !== undefined) {
        additionalInfo.push(`Success rate: ${(result.metadata.agentSuccessRate * 100).toFixed(1)}%`);
    }

    const additionalInfoStr = additionalInfo.length > 0
        ? `\n${additionalInfo.join(', ')}`
        : '';

    return `${baseResult}${metadata}${additionalInfoStr}`;
}

/**
 * Pure function to validate task assignment parameters using Zod
 */
export function validateTaskParams(
    parameters: Record<string, string | number | boolean | Array<string>>,
    availableTemplates: TemplateInfo[]
): AssignTaskParams {
    const schema = createDynamicAssignTaskSchema(availableTemplates);
    const validated = schema.parse(parameters);

    // Convert to AssignTaskParams format
    const params: AssignTaskParams = {
        jobDescription: validated.jobDescription
    };

    if (validated.context !== undefined) {
        params.context = validated.context;
    }

    if (validated.requiredTools !== undefined) {
        params.requiredTools = validated.requiredTools;
    }

    if (validated.priority !== undefined) {
        params.priority = validated.priority;
    }

    if (validated.agentTemplate !== undefined) {
        params.agentTemplate = validated.agentTemplate;
    }

    if (validated.allowFurtherDelegation !== undefined) {
        params.allowFurtherDelegation = validated.allowFurtherDelegation;
    }

    return params;
} 