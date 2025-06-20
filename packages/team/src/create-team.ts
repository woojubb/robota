import { TeamContainer } from './team-container';
import type { TeamContainerOptions } from './types';

/**
 * Create a Multi-Agent Team with Intelligent Collaboration Capabilities
 * 
 * @description
 * Creates a TeamContainer instance that provides intelligent multi-agent collaboration.
 * The team automatically delegates complex tasks to specialized temporary agents,
 * enabling sophisticated problem-solving through coordinated teamwork.
 * 
 * @param options - Configuration options for the team
 * @param options.baseRobotaOptions - Base configuration for all agents in the team
 * @param options.maxMembers - Maximum number of concurrent team members (optional)
 * @param options.debug - Enable debug logging (optional)
 * 
 * @returns A new TeamContainer instance ready for multi-agent collaboration
 * 
 * @example Simple Team Creation
 * ```typescript
 * import { createTeam } from '@robota-sdk/team';
 * import { OpenAIProvider } from '@robota-sdk/openai';
 * 
 * const team = createTeam({
 *   provider: new OpenAIProvider({
 *     apiKey: process.env.OPENAI_API_KEY,
 *     model: 'gpt-4'
 *   }),
 *   maxTokenLimit: 50000,
 *   logger: console
 * });
 * 
 * // Team automatically delegates complex multi-part requests
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
 *   baseRobotaOptions: {
 *     aiProviders: { 
 *       openai: openaiProvider,
 *       anthropic: anthropicProvider 
 *     },
 *     currentProvider: 'openai',
 *     currentModel: 'gpt-4',
 *     temperature: 0.7,
 *     maxTokens: 16000,
 *     maxTokenLimit: 100000
 *   },
 *   maxMembers: 10,
 *   debug: true
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
 * @see {@link TeamContainerOptions} - Available configuration options
 */
export function createTeam(options: TeamContainerOptions): TeamContainer {
    return new TeamContainer(options);
} 