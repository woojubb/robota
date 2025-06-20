import { z } from 'zod';

/**
 * Zod schema for validating agent template metadata
 */
export const AgentTemplateMetadataSchema = z.object({
    type: z.enum(['builtin', 'custom']),
    author: z.string().optional(),
    createdAt: z.union([
        z.date(),
        z.string().transform((str) => new Date(str))
    ]).optional(),
    updatedAt: z.union([
        z.date(),
        z.string().transform((str) => new Date(str))
    ]).optional(),
    description: z.string().optional(),
    category: z.string().optional()
}).strict();

/**
 * Zod schema for validating agent templates
 */
export const AgentTemplateSchema = z.object({
    name: z.string()
        .min(1, 'Template name cannot be empty')
        .regex(/^[a-z0-9_-]+$/, 'Template name must contain only lowercase letters, numbers, underscores, and hyphens'),

    description: z.string()
        .min(10, 'Description must be at least 10 characters long'),

    llm_provider: z.string()
        .min(1, 'LLM provider is required')
        .regex(/^[a-z0-9_-]+$/, 'Provider name must contain only lowercase letters, numbers, underscores, and hyphens'),

    model: z.string()
        .min(1, 'Model name is required'),

    temperature: z.number()
        .min(0, 'Temperature must be >= 0')
        .max(1, 'Temperature must be <= 1'),

    system_prompt: z.string()
        .min(50, 'System prompt must be at least 50 characters long'),

    tags: z.array(z.string())
        .min(1, 'At least one tag is required')
        .max(10, 'Maximum 10 tags allowed'),

    version: z.string()
        .regex(/^\d+\.\d+\.\d+$/, 'Version must follow semantic versioning (x.y.z)')
        .optional(),

    maxTokens: z.number()
        .min(1)
        .max(100000)
        .optional(),

    metadata: AgentTemplateMetadataSchema.optional()
}).strict();

/**
 * Type inference from the Zod schema
 */
export type ValidatedAgentTemplate = z.infer<typeof AgentTemplateSchema>;
export type ValidatedAgentTemplateMetadata = z.infer<typeof AgentTemplateMetadataSchema>;

/**
 * Validate an agent template
 */
export function validateAgentTemplate(template: unknown): ValidatedAgentTemplate {
    return AgentTemplateSchema.parse(template);
}

/**
 * Safely validate an agent template with error handling
 */
export function safeValidateAgentTemplate(template: unknown): {
    success: boolean;
    data?: ValidatedAgentTemplate;
    error?: z.ZodError;
} {
    const result = AgentTemplateSchema.safeParse(template);

    if (result.success) {
        return { success: true, data: result.data };
    } else {
        return { success: false, error: result.error };
    }
}

/**
 * Get validation error messages as strings
 */
export function getValidationErrors(error: z.ZodError): string[] {
    return error.errors.map(err => `${err.path.join('.')}: ${err.message}`);
} 