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
 */

import { Robota } from '@robota-sdk/agents';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { createTeam, type TeamOptions } from '@robota-sdk/team';
import { PlaygroundHistoryPlugin, type PlaygroundVisualizationData, type ConversationEvent } from './plugins/playground-history-plugin';

// Re-export types for external use
export type { PlaygroundVisualizationData, ConversationEvent } from './plugins/playground-history-plugin';
import { PlaygroundWebSocketClient } from './websocket-client';
import { RemoteExecutor } from '@robota-sdk/remote';

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
 * Follows Facade Pattern - simple interface with essential methods only
 */
export class PlaygroundExecutor {
    private isInitialized = false;
    private mode: 'agent' | 'team' | null = null;
    private currentAgent: Robota | null = null;
    private currentTeam: PlaygroundTeamInstance | null = null;
    private historyPlugin: PlaygroundHistoryPlugin;
    private websocketClient: PlaygroundWebSocketClient | null = null;

    constructor(
        private serverUrl: string,
        private authToken: string
    ) {
        // Create playground history plugin for visualization
        this.historyPlugin = new PlaygroundHistoryPlugin({
            maxEvents: 1000,
            visualizationMode: 'blocks',
            enableRealTimeSync: true,
            websocketUrl: this.serverUrl
        });
    }

    /**
     * Initialize the executor
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            // Initialize history plugin
            await this.historyPlugin.initialize();

            // Initialize WebSocket connection for real-time features
            this.websocketClient = new PlaygroundWebSocketClient(this.serverUrl, this.authToken);
            await this.websocketClient.connect();

            this.isInitialized = true;
        } catch (error) {
            throw new Error(`PlaygroundExecutor initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
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
     * Create and configure an agent (Facade method)
     */
    async createAgent(config: PlaygroundAgentConfig): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        // Create AI providers with remote executor
        const aiProviders = this.createProvidersWithExecutor();

        // Create actual Robota agent with proper configuration
        this.currentAgent = new Robota({
            name: config.name,
            aiProviders: aiProviders as any,
            defaultModel: config.defaultModel,
            plugins: [this.historyPlugin as any],
            tools: (config.tools || []) as any
        });

        this.setMode('agent');
    }

    /**
     * Create and configure a team (Facade method)
     */
    async createTeam(config: PlaygroundTeamConfig): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        // Create AI providers with remote executor for the team
        const aiProviders = this.createProvidersWithExecutor();

        // Create team instance with real AI providers
        this.currentTeam = new PlaygroundTeamInstance(config, aiProviders, this.historyPlugin);
        await this.currentTeam.initialize();

        this.setMode('team');
    }

    /**
     * Execute a prompt (Facade method)
     */
    async run(prompt: string): Promise<PlaygroundExecutionResult> {
        if (!this.isInitialized) {
            throw new Error('PlaygroundExecutor not initialized');
        }

        const startTime = Date.now();

        try {
            let response: string;
            let toolsExecuted: string[] = [];

            if (this.mode === 'agent' && this.currentAgent) {
                response = await this.currentAgent.run(prompt);

            } else if (this.mode === 'team' && this.currentTeam) {
                const result = await this.currentTeam.execute(prompt);
                response = result.response;
                toolsExecuted = result.toolsExecuted || [];

            } else {
                throw new Error(`No ${this.mode} configured for execution`);
            }

            const duration = Date.now() - startTime;

            return {
                success: true,
                response,
                duration,
                toolsExecuted,
                visualizationData: this.getVisualizationData()
            };

        } catch (error) {
            const duration = Date.now() - startTime;

            return {
                success: false,
                response: 'Execution failed',
                duration,
                error: error instanceof Error ? error : new Error(String(error)),
                visualizationData: this.getVisualizationData()
            };
        }
    }

    /**
     * Execute with streaming response (Facade method)
     */
    async *runStream(prompt: string): AsyncGenerator<string, PlaygroundExecutionResult> {
        if (!this.isInitialized) {
            throw new Error('PlaygroundExecutor not initialized');
        }

        const startTime = Date.now();
        let fullResponse = '';
        let toolsExecuted: string[] = [];

        try {
            if (this.mode === 'agent' && this.currentAgent) {
                for await (const chunk of this.currentAgent.runStream(prompt)) {
                    fullResponse += chunk;
                    yield chunk;
                }
            } else if (this.mode === 'team' && this.currentTeam) {
                for await (const chunk of this.currentTeam.executeStream(prompt)) {
                    fullResponse += chunk;
                    yield chunk;
                }
            } else {
                throw new Error(`No ${this.mode} configured for execution`);
            }

            const duration = Date.now() - startTime;

            return {
                success: true,
                response: fullResponse,
                duration,
                toolsExecuted,
                visualizationData: this.getVisualizationData()
            };

        } catch (error) {
            const duration = Date.now() - startTime;

            return {
                success: false,
                response: fullResponse || 'Stream execution failed',
                duration,
                error: error instanceof Error ? error : new Error(String(error)),
                visualizationData: this.getVisualizationData()
            };
        }
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
                this.websocketClient.disconnect();
                this.websocketClient = null;
            }

            await this.historyPlugin.dispose();

            this.mode = null;
            this.isInitialized = false;

        } catch (error) {
            throw new Error(`PlaygroundExecutor disposal failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // Essential Helper Methods (Facade Pattern - only core functionality)

    /**
     * Get conversation history (Facade essential method)
     */
    getHistory(): ConversationEvent[] {
        return this.historyPlugin.getVisualizationData().events;
    }

    /**
     * Clear conversation history (Facade essential method)
     */
    clearHistory(): void {
        this.historyPlugin.clearHistory();
    }

    /**
     * Get plugin statistics (internal helper)
     */
    getVisualizationData(): PlaygroundVisualizationData {
        return this.historyPlugin.getVisualizationData();
    }

    /**
     * Set current mode (internal configuration)
     */
    private setMode(mode: PlaygroundMode): void {
        this.mode = mode;
        this.historyPlugin.setMode(mode);
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
 * PlaygroundTeamInstance - Facade for TeamContainer
 * 
 * Follows Robota SDK Architecture Principles:
 * - Facade Pattern: Simple wrapper around TeamContainer
 * - Type Safety: Uses correct TeamOptions
 * - Dependency Injection: Logger and AI provider injection
 * - Single Responsibility: Team execution only
 */
class PlaygroundTeamInstance {
    private teamContainer: any = null; // TeamContainer from @robota-sdk/team
    private isInitialized = false;

    constructor(
        private config: PlaygroundTeamConfig,
        private aiProviders: AIProvider[], // Use actual AI providers instead of agents
        private historyPlugin: PlaygroundHistoryPlugin
    ) { }

    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            // Create team using actual Robota Team library with correct options
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

            console.log('Team initialized successfully:', this.config.name);

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

            // Execute using actual team container streaming
            for await (const chunk of this.teamContainer.executeStream(prompt)) {
                yield chunk;
            }

            // Record team streaming success
            this.historyPlugin.recordEvent({
                type: 'assistant_response',
                content: 'Team streaming completed',
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