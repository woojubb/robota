/**
 * Provider options interface
 */
export interface ProviderOptions {
    model: string;
    temperature?: number;
    maxTokens?: number;
    stopSequences?: string[];
    streamMode?: boolean;
}

/**
 * Run options interface
 */
export interface RunOptions {
    systemPrompt?: string;
    functionCallMode?: string; // 'auto' | 'force' | 'disabled'
    forcedFunction?: string;
    forcedArguments?: Record<string, unknown>;
    temperature?: number;
    maxTokens?: number;
}

/**
 * Agent template definition for predefined specialized roles
 * 
 * @description
 * Defines a reusable template for creating specialized agents with specific roles,
 * optimized LLM providers, models, and system prompts. Templates allow consistent
 * creation of expert agents for common tasks like summarization, review,
 * creative ideation, and domain research.
 * 
 * @example
 * ```typescript
 * const summarizerTemplate: AgentTemplate = {
 *   name: 'summarizer',
 *   description: 'Expert in document summarization and key point extraction',
 *   llm_provider: 'openai',
 *   model: 'gpt-4o-mini',
 *   temperature: 0.3,
 *   system_prompt: 'You are an expert summarization specialist...',
 *   tags: ['analysis', 'summarization', 'extraction']
 * };
 * ```
 */
export interface AgentTemplate {
    /** 
     * Unique identifier for the template (e.g., 'summarizer', 'creative_ideator').
     * Used to reference the template in agent creation and team configuration.
     */
    name: string;

    /** 
     * Human-readable description of the template's role and capabilities.
     * Helps users understand when to use this template and what it specializes in.
     */
    description: string;

    /** 
     * LLM provider optimized for this template's tasks.
     * Examples: 'openai', 'anthropic', 'google', 'azure-openai'
     */
    llm_provider: string;

    /** 
     * Specific model optimized for this template's role.
     * Examples: 'gpt-4', 'gpt-4o-mini', 'claude-3-5-sonnet-20241022', 'gemini-pro'
     */
    model: string;

    /** 
     * Temperature setting optimized for the template's tasks.
     * Range: 0.0 (deterministic) to 1.0 (creative)
     * - Low (0.0-0.3): Factual tasks, analysis, summarization
     * - Medium (0.4-0.6): Balanced tasks, research, explanation
     * - High (0.7-1.0): Creative tasks, brainstorming, ideation
     */
    temperature: number;

    /** 
     * Specialized system prompt that defines the agent's role, expertise,
     * and behavioral guidelines. Should be optimized for the template's
     * specific domain and expected tasks.
     */
    system_prompt: string;

    /** 
     * Classification tags for organizing and filtering templates.
     * Examples: ['analysis', 'creative', 'review', 'research', 'execution']
     * Helps with template discovery and automated selection.
     */
    tags: string[];

    /** 
     * Optional maximum tokens for responses from this template.
     * If not specified, uses the system's default maxTokens setting.
     */
    maxTokens?: number;

    /** 
     * Optional list of tools that this template typically requires.
     * Helps the system automatically provision appropriate tools.
     */
    requiredTools?: string[];

    /** 
     * Template version for managing updates and compatibility.
     * Follows semantic versioning (e.g., '1.0.0', '1.2.1')
     */
    version?: string;

    /** 
     * Metadata about the template including creation date, author, etc.
     * Useful for template management and attribution.
     */
    metadata?: {
        /** When this template was created */
        createdAt?: Date;
        /** Who created this template */
        author?: string;
        /** Last update timestamp */
        updatedAt?: Date;
        /** Whether this is a built-in or custom template */
        type?: 'builtin' | 'custom';
    };
}

/**
 * Agent configuration for creating specialized agents
 */
export interface AgentConfig {
    /** AI provider to use (e.g., 'openai', 'anthropic', 'google') */
    provider: string;
    /** Model name to use */
    model: string;
    /** System prompt for the agent */
    systemPrompt?: string;
    /** Maximum tokens for responses */
    maxTokens?: number;
    /** Temperature for response generation */
    temperature?: number;
}

/**
 * Configuration for creating a task-specific agent using templates
 */
export interface AgentCreationConfig {
    /** Template name to use (optional) */
    templateName?: string;
    /** Task description for dynamic agent creation */
    taskDescription?: string;
    /** Required tools for the task */
    requiredTools?: string[];
    /** Agent configuration overrides */
    agentConfig?: Partial<AgentConfig>;
} 