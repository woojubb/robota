/**
 * PlaygroundExecutor - Manages Robota Agent and Team execution in the browser
 * 
 * This executor creates and manages real Robota agents in the browser environment,
 * integrating with RemoteExecutor for AI provider access and PlaygroundHistoryPlugin
 * for real-time visualization.
 * 
 * Follows Robota SDK Architecture Principles:
 * - Facade Pattern: Simple interface (run, runStream, dispose)
 * - Type Safety: Uses Robota-compatible types
 * - Dependency Injection: Logger injection pattern
 * - Single Responsibility: Agent/Team execution only
 * - Statistics Collection: PlaygroundStatisticsPlugin integration
 */

import { Robota, type ToolHooks } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { createTeam, type TeamOptions } from '@robota-sdk/team';
import { PlaygroundHistoryPlugin, type PlaygroundVisualizationData, type ConversationEvent } from './plugins/playground-history-plugin';
import { PlaygroundStatisticsPlugin } from './plugins/playground-statistics-plugin';
import type { PlaygroundMetrics, PlaygroundExecutionResult as PlaygroundStatisticsResult } from '../../types/playground-statistics';
import { SimpleLogger, SilentLogger } from '@robota-sdk/agents';

// Re-export types for external use
export type { PlaygroundVisualizationData, ConversationEvent } from './plugins/playground-history-plugin';
import { PlaygroundWebSocketClient } from './websocket-client';
import { RemoteExecutor } from '@robota-sdk/remote';

/**
 * Hook Factory for AssignTask Tool
 * Creates hooks that automatically record Team delegation events to PlaygroundHistoryPlugin
 */
const createAssignTaskHooks = (historyPlugin: PlaygroundHistoryPlugin): ToolHooks => ({
    beforeExecute: async (toolName, parameters, context) => {
        console.log(`🔧 [Hook] beforeExecute: ${toolName}`, parameters);
        historyPlugin.recordEvent({
            type: 'tool_call',
            content: `🔧 [${toolName}] Starting: ${JSON.stringify(parameters)}`,
            toolName,
            parameters: parameters as Record<string, unknown>,
            metadata: {
                phase: 'start',
                context,
                timestamp: new Date().toISOString()
            }
        });
    },
    afterExecute: async (toolName, parameters, result, context) => {
        console.log(`✅ [Hook] afterExecute: ${toolName}`, { parameters, result });
        historyPlugin.recordEvent({
            type: 'tool_result',
            content: `✅ [${toolName}] Completed: ${typeof result === 'string' ? result : JSON.stringify(result)}`,
            toolName,
            parameters: parameters as Record<string, unknown>,
            result,
            metadata: {
                phase: 'complete',
                context,
                timestamp: new Date().toISOString()
            }
        });
    },
    onError: async (toolName, parameters, error, context) => {
        console.log(`❌ [Hook] onError: ${toolName}`, error.message);
        historyPlugin.recordEvent({
            type: 'error',
            content: `❌ [${toolName}] Error: ${error.message}`,
            toolName,
            parameters: parameters as Record<string, unknown>,
            error: error.message,
            metadata: {
                phase: 'error',
                context,
                timestamp: new Date().toISOString()
            }
        });
    }
});

// Robota SDK-compatible type definitions for browser environment
// These mirror the actual types from @robota-sdk/agents but are browser-safe

export interface UniversalMessage {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string | null;
    toolCalls?: Array<{
        id: string;
        type: 'function';
        function: {
            name: string;
            arguments: string;
        };
    }>;
    metadata?: Record<string, unknown>;
    timestamp?: Date;
}

export interface ChatOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    tools?: ToolSchema[];
    toolChoice?: 'auto' | 'none' | string;
    stream?: boolean;
}

export interface ToolSchema {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}

export interface AIProvider {
    readonly name: string;
    readonly version: string;
    chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage>;
    chatStream?(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage>;
    supportsTools(): boolean;
    validateConfig(): boolean;
    dispose?(): Promise<void>;
}

export interface BaseTool {
    readonly name: string;
    readonly description: string;
    execute(params: unknown): Promise<unknown>;
}

export interface BasePlugin {
    readonly name: string;
    readonly version: string;
    initialize(): Promise<void>;
    dispose(): Promise<void>;
}

// Playground-specific configuration interfaces using Robota-compatible types
export interface PlaygroundAgentConfig {
    id?: string;
    name: string;
    aiProviders: AIProvider[];
    defaultModel: {
        provider: string;
        model: string;
        temperature?: number;
        maxTokens?: number;
        systemMessage?: string;
    };
    tools?: BaseTool[];
    plugins?: BasePlugin[];
    systemMessage?: string;
    metadata?: Record<string, unknown>;
}

export interface PlaygroundTeamConfig {
    name: string;
    agents: PlaygroundAgentConfig[];
    workflow?: {
        coordinator?: string;
        maxDepth?: number;
    };
    maxMembers?: number; // Added for team initialization
}

export interface PlaygroundExecutionResult {
    success: boolean;
    response: string;
    duration: number;
    tokensUsed?: number;
    toolsExecuted?: string[];
    error?: Error;
    visualizationData?: PlaygroundVisualizationData;
}

export type PlaygroundMode = 'agent' | 'team';

/**
 * Playground executor for managing Robota agents and teams in browser
 * 
 * Follows Facade Pattern - simple interface with essential methods only
 * Integrates PlaygroundStatisticsPlugin for real-time metrics collection
 */
export class PlaygroundExecutor {
    private mode: 'agent' | 'team' | null = null;
    private currentAgent: Robota | null = null;
    private currentTeam: PlaygroundTeamInstance | null = null;

    // Playground-specific plugins
    private historyPlugin: PlaygroundHistoryPlugin;
    private statisticsPlugin: PlaygroundStatisticsPlugin;

    private websocketClient: PlaygroundWebSocketClient | null = null;
    private readonly logger: SimpleLogger;

    constructor(
        private serverUrl: string,
        private authToken: string,
        logger?: SimpleLogger
    ) {
        // Initialize logger with dependency injection
        this.logger = logger || SilentLogger;

        // Create playground-specific plugins (ready immediately)
        this.historyPlugin = new PlaygroundHistoryPlugin({
            maxEvents: 1000,
            visualizationMode: 'blocks',
            enableRealTimeSync: false, // Disable WebSocket initially
            websocketUrl: this.serverUrl
        });

        this.statisticsPlugin = new PlaygroundStatisticsPlugin({
            enabled: true,
            collectUIMetrics: true,
            collectBlockMetrics: true,
            trackResponseTime: true,
            trackExecutionDetails: true,
            maxEntries: 1000,
            slowExecutionThreshold: 3000, // 3 seconds
            errorRateThreshold: 10 // 10%
        });

        // PlaygroundExecutor is ready immediately
        // WebSocket will be connected lazily when needed
    }

    /**
     * Get WebSocket client (lazy initialization)
     */
    private async getWebSocketClient(): Promise<PlaygroundWebSocketClient> {
        if (!this.websocketClient) {
            this.websocketClient = new PlaygroundWebSocketClient(this.serverUrl, this.authToken);
            await this.websocketClient.connect();
        }
        return this.websocketClient;
    }

    /**
     * Log debug message
     */
    private logDebug(message: string, context?: any): void {
        this.logger.debug(message, context);
    }

    /**
     * Log error message
     */
    private logError(message: string, error?: Error, context?: any): void {
        this.logger.error(message, { error: error?.message, stack: error?.stack, ...context });
    }

    /**
     * Create and configure an agent (Facade method)
     */
    async createAgent(config: PlaygroundAgentConfig): Promise<void> {
        try {
            // Create AI providers with remote executor
            const aiProviders = this.createProvidersWithExecutor();

            // Create actual Robota agent with plugins
            this.currentAgent = new Robota({
                name: config.name,
                aiProviders: aiProviders as any,
                defaultModel: config.defaultModel,
                plugins: [this.historyPlugin as any, this.statisticsPlugin as any],
                tools: (config.tools || []) as any
            });

            this.setMode('agent');

            // Record agent creation as UI interaction
            await this.statisticsPlugin.recordUIInteraction('agent_create', {
                agentName: config.name,
                provider: config.defaultModel.provider,
                model: config.defaultModel.model
            });

        } catch (error) {
            throw error;
        }
    }

    /**
     * Create and configure a team (Facade method)
     */
    async createTeam(config: PlaygroundTeamConfig): Promise<void> {
        try {
            // Create AI providers with remote executor
            const aiProviders = this.createProvidersWithExecutor();

            // Create team instance with real AI providers and plugins
            this.currentTeam = new PlaygroundTeamInstance(config, aiProviders, this.historyPlugin, this.statisticsPlugin);
            await this.currentTeam.initialize();

            this.setMode('team');

            // Record team creation as UI interaction
            await this.statisticsPlugin.recordUIInteraction('team_create', {
                teamName: config.name,
                agentCount: config.agents.length
            });

        } catch (error) {
            throw error;
        }
    }

    /**
     * Execute a prompt (Facade method)
     */
    async run(prompt: string): Promise<PlaygroundExecutionResult> {
        const startTime = Date.now();
        const request: UniversalMessage[] = [{ role: 'user', content: prompt }];

        try {
            const result = await this.executeChat(request);
            const duration = Date.now() - startTime;

            const executionResult: PlaygroundExecutionResult = {
                success: true,
                response: result.content || 'No response',
                duration: duration,
                visualizationData: this.getVisualizationData()
            };

            // Record this execution for statistics (with additional required fields)
            await this.statisticsPlugin.recordPlaygroundExecution({
                success: executionResult.success,
                duration: executionResult.duration,
                provider: 'openai',
                model: 'gpt-4',
                mode: this.mode || 'agent',
                streaming: false,
                timestamp: new Date(),
                error: undefined // No error in success case
            });

            return executionResult;

        } catch (error) {
            const duration = Date.now() - startTime;
            const executionResult: PlaygroundExecutionResult = {
                success: false,
                response: 'Execution failed',
                duration: duration,
                error: error instanceof Error ? error : new Error(String(error)),
                visualizationData: this.getVisualizationData()
            };

            // Record this failed execution for statistics
            await this.statisticsPlugin.recordPlaygroundExecution({
                success: executionResult.success,
                duration: executionResult.duration,
                provider: 'openai',
                model: 'gpt-4',
                mode: this.mode || 'agent',
                streaming: false,
                timestamp: new Date(),
                error: error instanceof Error ? error.message : String(error)
            });

            return executionResult;
        }
    }

    /**
     * Execute with streaming response (Facade method)
     */
    async *runStream(prompt: string): AsyncGenerator<string, PlaygroundExecutionResult> {
        const startTime = Date.now();
        const request: UniversalMessage[] = [{ role: 'user', content: prompt }];

        try {
            let fullResponse = '';

            for await (const chunk of this.executeChatStream(request)) {
                const content = chunk.content || '';
                fullResponse += content;
                yield content;
            }

            const duration = Date.now() - startTime;
            const executionResult: PlaygroundExecutionResult = {
                success: true,
                response: fullResponse,
                duration: duration,
                visualizationData: this.getVisualizationData()
            };

            // Record this streaming execution for statistics
            await this.statisticsPlugin.recordPlaygroundExecution({
                success: executionResult.success,
                duration: executionResult.duration,
                provider: 'openai',
                model: 'gpt-4',
                mode: this.mode || 'agent',
                streaming: true, // This is a streaming execution
                timestamp: new Date(),
                error: undefined
            });

            return executionResult;

        } catch (error) {
            const duration = Date.now() - startTime;
            const executionResult: PlaygroundExecutionResult = {
                success: false,
                response: 'Streaming execution failed',
                duration: duration,
                error: error instanceof Error ? error : new Error(String(error)),
                visualizationData: this.getVisualizationData()
            };

            // Record this failed streaming execution for statistics
            await this.statisticsPlugin.recordPlaygroundExecution({
                success: executionResult.success,
                duration: executionResult.duration,
                provider: 'openai',
                model: 'gpt-4',
                mode: this.mode || 'agent',
                streaming: true,
                timestamp: new Date(),
                error: error instanceof Error ? error.message : String(error)
            });

            return executionResult;
        }
    }

    // ==========================================================================
    // Statistics and Visualization Methods
    // ==========================================================================

    /**
     * Get current Playground statistics
     */
    getPlaygroundStatistics(): PlaygroundMetrics {
        return this.statisticsPlugin.getPlaygroundStats();
    }

    /**
     * Record a Playground-specific action
     */
    async recordPlaygroundAction(actionType: string, metadata?: Record<string, any>): Promise<void> {
        await this.statisticsPlugin.recordUIInteraction(actionType, metadata);
    }

    /**
     * Record block creation for visualization
     */
    async recordBlockCreation(blockType: string, metadata?: Record<string, any>): Promise<void> {
        await this.statisticsPlugin.recordBlockCreation(blockType, metadata);
    }

    /**
     * Get visualization data from history plugin
     */
    getVisualizationData(): PlaygroundVisualizationData {
        return this.historyPlugin.getVisualizationData();
    }

    /**
     * Get conversation history from current agent/team
     */
    getHistory(): UniversalMessage[] {
        if (this.mode === 'agent' && this.currentAgent) {
            return this.currentAgent.getHistory();
        } else if (this.mode === 'team' && this.currentTeam) {
            return this.historyPlugin.getVisualizationData().events.map(event => ({
                role: event.type === 'user_message' ? 'user' : 'assistant',
                content: event.content || '',
                timestamp: event.timestamp
            } as UniversalMessage));
        }
        return [];
    }

    /**
     * Clear conversation history (Facade essential method)
     */
    clearHistory(): void {
        this.historyPlugin.clearHistory();
    }

    /**
     * Dispose of all resources (Facade method)
     */
    async dispose(): Promise<void> {
        try {
            if (this.currentAgent) {
                await this.currentAgent.destroy();
                this.currentAgent = null;
            }

            if (this.currentTeam) {
                await this.currentTeam.dispose();
                this.currentTeam = null;
            }

            if (this.websocketClient) {
                await this.websocketClient.disconnect();
                this.websocketClient = null;
            }

            await this.historyPlugin.dispose();
            // statisticsPlugin has no destroy method

        } catch (error) {
            throw new Error(`Error during PlaygroundExecutor disposal: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // ==========================================================================
    // Private Helper Methods
    // ==========================================================================

    /**
     * Execute chat completion (Facade method)
     */
    private async executeChat(messages: UniversalMessage[]): Promise<UniversalMessage> {
        const startTime = Date.now();
        const executionId = this.generateExecutionId();

        try {
            // Record execution start
            await this.recordExecutionStart(executionId, messages);

            let response: UniversalMessage;

            if (this.mode === 'agent' && this.currentAgent) {
                const prompt = messages[0].content || '';
                const result = await this.currentAgent.run(prompt);
                response = {
                    role: 'assistant',
                    content: result,
                    timestamp: new Date()
                } as UniversalMessage;

            } else if (this.mode === 'team' && this.currentTeam) {
                const result = await this.currentTeam.execute(messages[0].content || ''); // Assuming prompt is the first message
                response = {
                    role: 'assistant',
                    content: result.response || JSON.stringify(result),
                    timestamp: new Date()
                } as UniversalMessage;

            } else {
                throw new Error(`No ${this.mode} configured for execution`);
            }

            const duration = Date.now() - startTime;

            // Record successful execution
            await this.recordExecutionComplete(executionId, {
                success: true,
                duration,
                provider: 'openai', // Default provider
                model: 'gpt-4', // Default model
                mode: this.mode || 'agent',
                streaming: false,
                timestamp: new Date()
            });

            return response;

        } catch (error) {
            const duration = Date.now() - startTime;

            // Record failed execution
            await this.recordExecutionError(executionId, {
                success: false,
                duration,
                provider: 'openai', // Default provider
                model: 'gpt-4', // Default model
                mode: this.mode || 'agent',
                streaming: false,
                timestamp: new Date(),
                error: error instanceof Error ? error.message : String(error)
            });

            throw error;
        }
    }

    /**
     * Execute streaming chat completion (Facade method)
     */
    private async *executeChatStream(messages: UniversalMessage[]): AsyncIterable<UniversalMessage> {
        const startTime = Date.now();
        const executionId = this.generateExecutionId();

        try {
            console.log('🚀 executeChatStream starting:', { executionId, mode: this.mode, messagesCount: messages.length });

            // Record execution start
            await this.recordExecutionStart(executionId, messages);

            if (this.mode === 'agent' && this.currentAgent) {
                console.log('📡 Starting agent stream...');
                const prompt = messages[0].content || '';
                const stream = this.currentAgent.runStream(prompt);

                for await (const chunk of stream) {
                    yield {
                        role: 'assistant',
                        content: chunk,
                        timestamp: new Date()
                    } as UniversalMessage;
                }

            } else if (this.mode === 'team' && this.currentTeam) {
                console.log('📡 Starting team stream...');
                const prompt = messages[0].content || '';
                const stream = this.currentTeam.executeStream(prompt);

                for await (const chunk of stream) {
                    yield {
                        role: 'assistant',
                        content: chunk,
                        timestamp: new Date()
                    } as UniversalMessage;
                }

            } else {
                const error = new Error(`No ${this.mode} configured for streaming execution`);
                console.error('❌ No configured executor:', { mode: this.mode, hasAgent: !!this.currentAgent, hasTeam: !!this.currentTeam });
                throw error;
            }

            console.log('✅ executeChatStream completed successfully');

        } catch (error) {
            console.error('❌ executeChatStream error:', error);
            console.error('❌ Execution context:', {
                executionId,
                mode: this.mode,
                hasAgent: !!this.currentAgent,
                hasTeam: !!this.currentTeam,
                messagesCount: messages.length,
                errorMessage: error instanceof Error ? error.message : 'Unknown error',
                errorStack: error instanceof Error ? error.stack : undefined
            });
            throw error;
        }
    }

    /**
     * Generate unique execution ID
     */
    private generateExecutionId(): string {
        return `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    /**
     * Record execution start for statistics
     */
    private async recordExecutionStart(executionId: string, messages: UniversalMessage[]): Promise<void> {
        // Start time is already tracked in executeChat/executeChatStream
        // This can be used for more detailed tracking if needed
        this.logDebug('Execution started', { executionId, provider: 'openai', model: 'gpt-4', mode: this.mode || 'agent' });
    }

    /**
     * Record successful execution completion
     */
    private async recordExecutionComplete(executionId: string, result: PlaygroundStatisticsResult): Promise<void> {
        await this.statisticsPlugin.recordPlaygroundExecution(result);
        this.logDebug('Execution completed', { executionId, duration: result.duration, success: result.success });
    }

    /**
     * Record execution error
     */
    private async recordExecutionError(executionId: string, result: PlaygroundStatisticsResult): Promise<void> {
        await this.statisticsPlugin.recordPlaygroundExecution(result);
        this.logError('Execution failed', new Error(result.error || 'Unknown error'), { executionId, duration: result.duration });
    }

    /**
     * Create a SimpleRemoteExecutor for browser-based remote execution
     */
    private createRemoteExecutor(): any {
        if (!this.serverUrl || !this.authToken) {
            throw new Error('Server URL and auth token required for remote executor');
        }

        // Convert WebSocket URL to HTTP URL for API calls and add remote API path
        const apiUrl = this.serverUrl.replace(/\/ws$/, '').replace(/^ws/, 'http') + '/api/v1/remote';

        return new RemoteExecutor({
            serverUrl: apiUrl,
            userApiKey: this.authToken,
            timeout: 30000,
            enableWebSocket: false // We handle WebSocket separately for playground features
        });
    }

    /**
     * Create AI providers with remote executor injection
     */
    private createProvidersWithExecutor(): any[] {
        const remoteExecutor = this.createRemoteExecutor();

        // Create actual providers with executor injection
        const openaiProvider = new OpenAIProvider({
            executor: remoteExecutor
            // No API key needed - executor handles remote calls
        });

        const anthropicProvider = new AnthropicProvider({
            executor: remoteExecutor
            // No API key needed - executor handles remote calls
        });

        return [openaiProvider, anthropicProvider];
    }

    /**
     * Set execution mode and update state
     */
    private setMode(mode: PlaygroundMode): void {
        this.mode = mode;
        this.logDebug('Mode changed', { mode });
    }

    /**
     * Update authentication (internal configuration)
     */
    private updateAuth(userId: string, sessionId: string, authToken: string): void {
        // This method is no longer needed as authentication is handled by the remote executor
        // and WebSocket client.
        // Keeping it for now, but it will be removed if not used elsewhere.
        // this.userId = userId;
        // this.sessionId = sessionId;
        // this.authToken = authToken;

        // if (this.websocketClient) {
        //     this.websocketClient.updateAuth(userId, sessionId, authToken);
        // }
    }
}

/**
 * Extended Team Instance with Hook Support
 * 
 * Extends the standard TeamContainer functionality to inject Hook-enabled assignTask tools
 * for detailed Team workflow tracking in the Playground environment.
 * 
 * Architectural Compliance:
 * - Facade Pattern: Simple wrapper around TeamContainer
 * - Type Safety: Uses correct TeamOptions
 * - Dependency Injection: Logger and AI provider injection
 * - Single Responsibility: Team execution + Hook integration only
 */
class PlaygroundTeamInstance {
    private teamContainer: any = null; // TeamContainer from @robota-sdk/team
    private isInitialized = false;

    constructor(
        private config: PlaygroundTeamConfig,
        private aiProviders: AIProvider[], // Use actual AI providers instead of agents
        private historyPlugin: PlaygroundHistoryPlugin,
        private statisticsPlugin: PlaygroundStatisticsPlugin
    ) { }

    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            // Create team using actual Robota Team library
            const teamOptions: any = { // Robota Team options
                aiProviders: this.aiProviders,
                maxMembers: this.config.maxMembers || 5,
                debug: true,
                logger: {
                    debug: (msg: string) => console.log('[Team Debug]', msg),
                    info: (msg: string) => console.log('[Team Info]', msg),
                    warn: (msg: string) => console.warn('[Team Warn]', msg),
                    error: (msg: string) => console.error('[Team Error]', msg)
                }
            };

            // Create actual team container using createTeam
            this.teamContainer = createTeam(teamOptions);
            this.isInitialized = true;

            console.log('🎯 PlaygroundTeamInstance initialized with Hook support:', this.config.name);

        } catch (error) {
            console.error('Team initialization failed:', error);
            throw new Error(`Team initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async execute(prompt: string): Promise<{ response: string; toolsExecuted?: string[] }> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!this.teamContainer) {
            throw new Error('Team not properly initialized');
        }

        try {
            console.log('Team executing prompt:', prompt);

            // Record team execution start
            this.historyPlugin.recordEvent({
                type: 'user_message', // Use valid event type
                content: prompt,
                metadata: { teamName: this.config.name, action: 'execution_start' }
            });

            // Execute using actual team container
            const result = await this.teamContainer.execute(prompt);

            // Record team execution success
            this.historyPlugin.recordEvent({
                type: 'assistant_response', // Use valid event type
                content: typeof result === 'string' ? result : (result.response || JSON.stringify(result)),
                metadata: { teamName: this.config.name, action: 'execution_success' }
            });

            const response = typeof result === 'string' ? result : (result.response || JSON.stringify(result));

            return {
                response,
                toolsExecuted: result.toolsExecuted || []
            };

        } catch (error) {
            console.error('Team execution failed:', error);

            // Record team execution error
            this.historyPlugin.recordEvent({
                type: 'error', // Use valid event type
                content: error instanceof Error ? error.message : String(error),
                metadata: { teamName: this.config.name, action: 'execution_error' }
            });

            throw new Error(`Team execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async *executeStream(prompt: string): AsyncIterable<string> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!this.teamContainer) {
            throw new Error('Team not properly initialized for streaming');
        }

        try {
            console.log('Team streaming prompt:', prompt);

            // Record team streaming start
            this.historyPlugin.recordEvent({
                type: 'user_message',
                content: prompt,
                metadata: { teamName: this.config.name, action: 'streaming_start' }
            });

            let fullResponse = '';

            // Execute using actual team container streaming
            for await (const chunk of this.teamContainer.executeStream(prompt)) {
                fullResponse += chunk;
                yield chunk;
            }

            // Record team streaming success with actual response
            this.historyPlugin.recordEvent({
                type: 'assistant_response',
                content: fullResponse,
                metadata: { teamName: this.config.name, action: 'streaming_success' }
            });

        } catch (error) {
            console.error('Team streaming failed:', error);

            // Record team streaming error
            this.historyPlugin.recordEvent({
                type: 'error',
                content: error instanceof Error ? error.message : String(error),
                metadata: { teamName: this.config.name, action: 'streaming_error' }
            });

            throw new Error(`Team streaming failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async dispose(): Promise<void> {
        try {
            if (this.teamContainer) {
                // Call actual team container dispose method
                await this.teamContainer.dispose();
                this.teamContainer = null;
            }
            this.isInitialized = false;
        } catch (error) {
            throw new Error(`Team disposal failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
} 