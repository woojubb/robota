import { z } from 'zod';

/**
 * Zod schema for task assignment parameters
 */
export const assignTaskSchema = z.object({
    jobDescription: z.string().describe(
        'Clear, specific description of the job to be completed. Should provide enough detail for the specialist agent to understand the scope and deliverables expected.'
    ),
    context: z.string().optional().describe(
        'Additional context, constraints, or requirements for the job. Helps the specialist agent understand the broader context and any specific limitations or guidelines to follow.'
    ),
    requiredTools: z.array(z.string()).optional().describe(
        'List of tools the specialist agent might need for this task. If specified, the system will attempt to configure the agent with access to these tools.'
    ),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).default('medium').describe(
        'Priority level for the task, affecting resource allocation and urgency. Higher priority tasks may receive more resources or faster processing.'
    ),
    agentTemplate: z.string().optional().describe(
        'Name of the agent template to use for this task. If not specified, a dynamic agent will be created based on the job description.'
    ),
    allowFurtherDelegation: z.boolean().default(false).describe(
        'Whether the assigned agent can delegate parts of the task to other specialists if needed. Set true ONLY for very complex tasks requiring multiple specialized areas of expertise, false for focused execution.'
    )
});

/**
 * Infer TypeScript type from Zod schema
 */
export type AssignTaskSchemaType = z.infer<typeof assignTaskSchema>;

/**
 * Runtime validation function for task assignment parameters
 */
export function validateAssignTaskParams(input: Record<string, string | number | boolean | Array<string>>): AssignTaskSchemaType {
    return assignTaskSchema.parse(input);
}

/**
 * Safe validation function that returns result or error
 */
export function safeValidateAssignTaskParams(input: Record<string, string | number | boolean | Array<string>>): {
    success: true;
    data: AssignTaskSchemaType;
} | {
    success: false;
    error: z.ZodError;
} {
    const result = assignTaskSchema.safeParse(input);
    return result;
}

/**
 * Create a dynamic schema with available templates
 */
export function createDynamicAssignTaskSchema(availableTemplates: Array<{ id: string; description: string }>) {
    const templateDescriptions = availableTemplates.map(template =>
        `${template.id}: ${template.description}`
    ).join(', ');

    return assignTaskSchema.extend({
        agentTemplate: z.string().optional().describe(
            `Name of the agent template to use for this task. Available templates: ${templateDescriptions}. If not specified, a dynamic agent will be created based on the job description.`
        )
    });
}

/**
 * Type for dynamic schema with templates
 */
export type DynamicAssignTaskSchemaType = z.infer<ReturnType<typeof createDynamicAssignTaskSchema>>; 