import { z } from 'zod';

const MIN_DESCRIPTION_LENGTH = 10;
const MIN_SYSTEM_PROMPT_LENGTH = 50;
const MAX_TAGS = 10;
const MAX_TOKENS_LIMIT = 100000;

/**
 * Reusable type definitions for schema validation
 */

/**
 * Schema validation input type
 * Used for validating external data inputs before parsing
 */
export type TSchemaValidationInput = Record<string, string | number | boolean | Date | string[] | number[] | boolean[] | null | undefined> | string | number | boolean | null | undefined;

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
        .min(MIN_DESCRIPTION_LENGTH, 'Description must be at least 10 characters long'),

    llm_provider: z.string()
        .min(1, 'LLM provider is required')
        .regex(/^[a-z0-9_-]+$/, 'Provider name must contain only lowercase letters, numbers, underscores, and hyphens'),

    model: z.string()
        .min(1, 'Model name is required'),

    temperature: z.number()
        .min(0, 'Temperature must be >= 0')
        .max(1, 'Temperature must be <= 1'),

    system_prompt: z.string()
        .min(MIN_SYSTEM_PROMPT_LENGTH, 'System prompt must be at least 50 characters long'),

    tags: z.array(z.string())
        .min(1, 'At least one tag is required')
        .max(MAX_TAGS, 'Maximum 10 tags allowed'),

    version: z.string()
        .regex(/^\d+\.\d+\.\d+$/, 'Version must follow semantic versioning (x.y.z)')
        .optional(),

    maxTokens: z.number()
        .min(1)
        .max(MAX_TOKENS_LIMIT)
        .optional(),

    metadata: AgentTemplateMetadataSchema.optional()
}).strict();

/**
 * Type for validated agent template
 */
export type TValidatedAgentTemplate = z.infer<typeof AgentTemplateSchema>;

/**
 * Validate an agent template
 * 
 * @param template - Template to validate
 * @returns Validated template
 * @throws {z.ZodError} When validation fails
 */
export function validateAgentTemplate(template: TSchemaValidationInput): TValidatedAgentTemplate {
    return AgentTemplateSchema.parse(template);
}

/**
 * Safely validate an agent template with error handling
 * 
 * @param template - Template to validate
 * @returns Validation result with success flag and data or error
 */
export function safeValidateAgentTemplate(template: TSchemaValidationInput): {
    success: boolean;
    data?: TValidatedAgentTemplate;
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
 * Get formatted validation errors
 * 
 * @param error - Zod validation error
 * @returns Formatted error messages
 */
export function getValidationErrors(error: z.ZodError): string[] {
    return error.errors.map(err => {
        const path = err.path.length > 0 ? err.path.join('.') : 'root';
        return `${path}: ${err.message}`;
    });
} 