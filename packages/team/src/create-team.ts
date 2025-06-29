import { TeamContainer } from './team-container';
import type { TeamContainerOptions, TeamOptions } from './types';

/**
 * Create a Multi-Agent Team with Template-Based Configuration
 * 
 * @description
 * Creates a TeamContainer instance using a simplified configuration interface.
 * Since agent templates define their own AI providers, models, and settings,
 * you only need to provide the AI providers and basic configuration.
 * The team automatically delegates complex tasks to specialized temporary agents,
 * enabling sophisticated problem-solving through coordinated teamwork.
 * 
 * @param options - Simplified configuration options for the team
 * @param options.aiProviders - AI providers available for templates to use
 * @param options.maxMembers - Maximum number of concurrent team members (optional)
 * @param options.debug - Enable debug logging (optional)
 * @param options.maxTokenLimit - Maximum token limit for conversations (optional)
 * @param options.logger - Logger for team operations (optional)
 * @param options.templateManager - Custom template manager (optional)
 * @param options.leaderTemplate - Template for team coordinator (optional)
 * 
 * @returns A new TeamContainer instance ready for multi-agent collaboration
 * 
 * @example Simple Team Creation
 * ```typescript
 * import { createTeam } from '@robota-sdk/team';
 * import { OpenAIProvider } from '@robota-sdk/openai';
 * import { AnthropicProvider } from '@robota-sdk/anthropic';
 * 
 * const team = createTeam({
 *   aiProviders: {
 *     openai: openaiProvider,
 *     anthropic: anthropicProvider
 *   },
 *   debug: true
 * });
 * 
 * // Templates automatically use their preferred providers and settings
 * const response = await team.execute(`
 *   Create a comprehensive business plan with:
 *   1) Market analysis
 *   2) Financial projections 
 *   3) Marketing strategy
 * `);
 * ```
 * 
 * @example Advanced Team Configuration
 * ```typescript
 * const team = createTeam({
 *   aiProviders: {
 *     openai: openaiProvider,
 *     anthropic: anthropicProvider,
 *     google: googleProvider
 *   },
 *   maxMembers: 10,
 *   maxTokenLimit: 100000,
 *   debug: true,
 *   logger: console,
 *   leaderTemplate: 'custom_coordinator'
 * });
 * 
 * // Team intelligently breaks down complex requests
 * const result = await team.execute(
 *   'Design a complete e-commerce platform including frontend, backend, database design, and deployment strategy'
 * );
 * 
 * // Monitor team performance
 * const stats = team.getStats();
 * console.log(`Created ${stats.totalAgentsCreated} specialized agents`);
 * ```
 * 
 * @see {@link TeamContainer} - The underlying team container class
 * @see {@link TeamOptions} - Available configuration options
 */
export function createTeam(options: TeamOptions): TeamContainer {
    // Get first available provider as default
    const providers = Object.keys(options.aiProviders);
    if (providers.length === 0) {
        throw new Error('At least one AI provider must be provided in aiProviders');
    }

    const defaultProvider = providers[0]!;
    const defaultModel = getDefaultModelForProvider(defaultProvider) || 'gpt-4o-mini';

    // Convert to full TeamContainerOptions
    const fullOptions: TeamContainerOptions = {
        baseRobotaOptions: {
            provider: defaultProvider,
            model: defaultModel,
            aiProviders: options.aiProviders,
            currentProvider: defaultProvider,
            currentModel: defaultModel,
            maxTokens: options.maxTokenLimit || 50000
        },
        maxMembers: options.maxMembers || 5,
        debug: options.debug || false,
        ...(options.customTemplates && { customTemplates: options.customTemplates }),
        ...(options.leaderTemplate && { leaderTemplate: options.leaderTemplate }),
        ...(options.logger && { logger: options.logger })
    };

    return new TeamContainer(fullOptions);
}

/**
 * Get default model for a provider
 */
function getDefaultModelForProvider(provider: string): string {
    switch (provider.toLowerCase()) {
        case 'openai':
            return 'gpt-4o-mini';
        case 'anthropic':
            return 'claude-3-5-sonnet-20241022';
        case 'google':
            return 'gemini-pro';
        default:
            return 'not_specified';
    }
} 