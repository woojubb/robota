import { createZodFunctionTool, type ToolParameters } from '@robota-sdk/agents';
import type { ZodTypeAny } from 'zod';
import type { AssignTaskParams, AssignTaskResult } from '../types.js';
import { createDynamicAssignTaskSchema, type DynamicAssignTaskSchemaType } from './schema.js';

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
 * Create AssignTask tool with dynamic schema based on available templates
 */
export function createAssignTaskTool(
    availableTemplates: TemplateInfo[],
    executor: AssignTaskExecutor
) {
    // Create dynamic schema with available templates
    const toolParametersSchema = createDynamicAssignTaskSchema(availableTemplates);

    // Create the tool instance with proper schema validation
    const toolInstance = createZodFunctionTool(
        'assignTask',
        createToolDescription(availableTemplates),
        toolParametersSchema as ZodTypeAny,
        async (parameters: ToolParameters) => {
            // Type-safe conversion using Zod's inferred type
            const validatedParams = toolParametersSchema.parse(parameters);
            const result = await executor(convertToAssignTaskParams(validatedParams));

            // Return formatted string result for LLM consumption
            return formatResultForLLM(result);
        }
    );

    return toolInstance;
}

/**
 * Convert validated parameters to AssignTaskParams format
 */
export function convertToAssignTaskParams(validated: DynamicAssignTaskSchemaType): AssignTaskParams {
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
 * Format AssignTaskResult for LLM consumption
 */
export function formatResultForLLM(result: AssignTaskResult): string {
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
    return convertToAssignTaskParams(validated);
} 