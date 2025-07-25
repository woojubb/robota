import { createTeam } from '@robota-sdk/team';
import type { TeamOptions, TemplateInfo } from '@robota-sdk/team';
import type { AIProvider } from '@robota-sdk/agents';
import { UniversalToolFactory } from './universal-tool-factory';
import type { BlockDataCollector } from './block-tracking';
import type { SimpleLogger } from '@robota-sdk/agents';

/**
 * Playground Team Integration options
 */
export interface PlaygroundTeamIntegrationOptions {
    /** Block collector for tracking all team operations */
    blockCollector: BlockDataCollector;

    /** Logger for team operations */
    logger?: SimpleLogger;

    /** AI providers available to the team */
    aiProviders: AIProvider[];

    /** Maximum number of team members */
    maxMembers?: number;

    /** Debug mode */
    debug?: boolean;

    /** Custom tools to add to all agents */
    customTools?: any[];

    /** Leader template for the team */
    leaderTemplate?: string;
}

/**
 * Enhanced team creation result with block tracking
 */
export interface PlaygroundTeamResult {
    /** The created team instance */
    team: any; // Team type from @robota-sdk/team

    /** Universal tool factory used for this team */
    toolFactory: UniversalToolFactory;

    /** Block collector for tracking team operations */
    blockCollector: BlockDataCollector;

    /** Team container for direct access */
    teamContainer: any; // TeamContainer type
}

/**
 * Playground Team Integration
 * Manages team creation with automatic block tracking for all team operations
 * Integrates the Universal Hook system with team-based multi-agent workflows
 */
export class PlaygroundTeamIntegration {
    private readonly blockCollector: BlockDataCollector;
    private readonly logger?: SimpleLogger;
    private readonly toolFactory: UniversalToolFactory;

    constructor(options: {
        blockCollector: BlockDataCollector;
        logger?: SimpleLogger;
    }) {
        this.blockCollector = options.blockCollector;
        this.logger = options.logger;

        // Create universal tool factory for this integration
        this.toolFactory = new UniversalToolFactory({
            blockCollector: this.blockCollector,
            logger: this.logger,
            defaultLevel: 0,
            blockTypeMapping: {
                'assignTask': 'tool_call',
                'delegate_to_agent': 'tool_call'
            }
        });
    }

    /**
     * Create a team with automatic block tracking
     */
    async createTrackedTeam(options: PlaygroundTeamIntegrationOptions): Promise<PlaygroundTeamResult> {
        // Create team root block
        const teamRootBlock = this.blockCollector.createGroupBlock(
            'group',
            `🤖 Team: ${options.leaderTemplate || 'task_coordinator'}`,
            undefined, // No parent - this is a root block
            0 // Level 0
        );

        // Create child tool factory for this team
        const teamToolFactory = this.toolFactory.createChildFactory({
            parentBlockId: teamRootBlock.blockMetadata.id,
            level: 1,
            blockTypeMapping: {
                'assignTask': 'tool_call',
                'delegate_to_agent': 'tool_call'
            }
        });

        // Prepare team options with tracked tools
        const teamOptions: TeamOptions = {
            aiProviders: options.aiProviders,
            maxMembers: options.maxMembers,
            debug: options.debug,
            leaderTemplate: options.leaderTemplate,
            logger: options.logger,
            // Add custom tools with tracking
            tools: this.prepareTrackedTools(options.customTools || [], teamToolFactory)
        };

        // Create the team
        const team = createTeam(teamOptions);

        // Get team container for delegation tool creation
        const teamContainer = (team as any).getTeamContainer?.() || team;

        return {
            team,
            toolFactory: teamToolFactory,
            blockCollector: this.blockCollector,
            teamContainer
        };
    }

    /**
     * Prepare custom tools with block tracking
     */
    private prepareTrackedTools(
        customTools: any[],
        toolFactory: UniversalToolFactory
    ): any[] {
        return customTools.map(tool => {
            // If it's already a tool instance, return as-is
            // (ideally we'd wrap it, but that requires more complex logic)
            if (tool && typeof tool.execute === 'function') {
                return tool;
            }

            // If it's a tool configuration, create with tracking
            if (tool.type === 'function' && tool.schema && tool.executor) {
                return toolFactory.createFunctionTool(tool.schema, tool.executor);
            }

            if (tool.type === 'openapi' && tool.config) {
                return toolFactory.createOpenAPITool(tool.config);
            }

            if (tool.type === 'mcp' && tool.config && tool.schema) {
                return toolFactory.createMCPTool(tool.config, tool.schema);
            }

            // Return as-is if we can't process it
            return tool;
        });
    }

    /**
     * Execute a team task with block tracking
     */
    async executeTeamTask(
        team: any,
        task: string,
        options: {
            context?: string;
            priority?: 'low' | 'medium' | 'high' | 'urgent';
            parentBlockId?: string;
        } = {}
    ): Promise<string> {
        // Create task execution root block
        const taskBlock = this.blockCollector.createGroupBlock(
            'user',
            task,
            options.parentBlockId,
            options.parentBlockId ? 1 : 0
        );

        // Update block state to in progress
        this.blockCollector.updateBlock(taskBlock.blockMetadata.id, {
            visualState: 'in_progress'
        });

        try {
            // Execute the team task
            const result = await team.execute(task, {
                context: options.context,
                priority: options.priority
            });

            // Update block with success
            this.blockCollector.updateBlock(taskBlock.blockMetadata.id, {
                visualState: 'completed',
                renderData: {
                    result,
                    parameters: { task, context: options.context, priority: options.priority }
                }
            });

            // Create result block
            const resultBlock = this.blockCollector.createGroupBlock(
                'assistant',
                result,
                taskBlock.blockMetadata.id,
                1
            );

            this.blockCollector.updateBlock(resultBlock.blockMetadata.id, {
                visualState: 'completed'
            });

            return result;

        } catch (error) {
            // Update block with error
            this.blockCollector.updateBlock(taskBlock.blockMetadata.id, {
                visualState: 'error',
                renderData: {
                    error,
                    parameters: { task, context: options.context, priority: options.priority }
                }
            });

            // Create error block
            const errorBlock = this.blockCollector.createGroupBlock(
                'error',
                `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                taskBlock.blockMetadata.id,
                1
            );

            this.blockCollector.updateBlock(errorBlock.blockMetadata.id, {
                visualState: 'error',
                renderData: { error }
            });

            throw error;
        }
    }

    /**
     * Get team execution statistics
     */
    getTeamStats() {
        const stats = this.blockCollector.getStats();

        const teamBlocks = this.blockCollector.getBlocks().filter(
            block => block.blockMetadata.type === 'group' &&
                block.content.includes('🤖 Team:')
        );

        const taskBlocks = this.blockCollector.getBlocks().filter(
            block => block.blockMetadata.type === 'user'
        );

        const delegationBlocks = this.blockCollector.getBlocks().filter(
            block => block.blockMetadata.type === 'tool_call' &&
                block.blockMetadata.executionContext?.toolName === 'assignTask'
        );

        return {
            ...stats,
            teams: teamBlocks.length,
            tasks: taskBlocks.length,
            delegations: delegationBlocks.length
        };
    }

    /**
     * Clear all team-related blocks
     */
    clearTeamBlocks(): void {
        this.blockCollector.clearBlocks();
    }

    /**
     * Get the universal tool factory
     */
    getToolFactory(): UniversalToolFactory {
        return this.toolFactory;
    }

    /**
     * Get the block collector
     */
    getBlockCollector(): BlockDataCollector {
        return this.blockCollector;
    }
} 