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

import { PlaygroundHistoryPlugin, type PlaygroundVisualizationData, type ConversationEvent } from './plugins/playground-history-plugin';

// Re-export types for external use
export type { PlaygroundVisualizationData, ConversationEvent } from './plugins/playground-history-plugin';
import { PlaygroundWebSocketClient } from './websocket-client';

// Import actual Robota Team library
import { createTeam, type TeamOptions } from '@robota-sdk/team';

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
    private mode: PlaygroundMode = 'agent';
    private currentAgent: PlaygroundRobotaInstance | null = null;
    private currentTeam: PlaygroundTeamInstance | null = null;
    private historyPlugin: PlaygroundHistoryPlugin;
    private websocketClient: PlaygroundWebSocketClient | null = null;
    private isInitialized = false;

    constructor(
        private serverUrl: string,
        private userId?: string,
        private sessionId?: string,
        private authToken?: string
    ) {
        // Initialize history plugin with WebSocket support
        this.historyPlugin = new PlaygroundHistoryPlugin({
            websocketUrl: serverUrl,
            enableRealTimeSync: true,
            maxEvents: 1000
        });
    }

    /**
     * Initialize the executor (Facade method)
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            await this.historyPlugin.initialize();

            if (this.userId && this.sessionId && this.authToken) {
                this.websocketClient = new PlaygroundWebSocketClient(
                    this.serverUrl,
                    this.userId,
                    this.sessionId,
                    this.authToken
                );
                await this.websocketClient.connect();
            }

            this.isInitialized = true;
        } catch (error) {
            throw new Error(`PlaygroundExecutor initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    /**
     * Create and configure a single agent (Facade method)
     */
    async createAgent(config: PlaygroundAgentConfig): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        const remoteProvider = await this.createRemoteProvider();

        this.currentAgent = new PlaygroundRobotaInstance({
            ...config,
            aiProviders: [remoteProvider],
            plugins: [this.historyPlugin, ...(config.plugins || [])]
        });

        await this.currentAgent.initialize();

        this.setMode('agent');
    }

    /**
     * Create and configure a team (Facade method)
     */
    async createTeam(config: PlaygroundTeamConfig): Promise<void> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        // Create AI providers for the team (not agent instances)
        const remoteProvider = await this.createRemoteProvider();
        const aiProviders: AIProvider[] = [remoteProvider];

        // Create team instance with AI providers, not agent instances
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
                const result = await this.currentAgent.run(prompt);
                response = result.response;
                toolsExecuted = result.toolsExecuted || [];

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
                await this.currentAgent.dispose();
                this.currentAgent = null;
            }

            if (this.currentTeam) {
                await this.currentTeam.dispose();
                this.currentTeam = null;
            }

            await this.historyPlugin.dispose();

            if (this.websocketClient) {
                this.websocketClient.disconnect();
                this.websocketClient = null;
            }

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
        this.userId = userId;
        this.sessionId = sessionId;
        this.authToken = authToken;

        if (this.websocketClient) {
            this.websocketClient.updateAuth(userId, sessionId, authToken);
        }
    }

    /**
 * Create Robota SDK compatible remote provider
 * 
 * This implementation follows the exact same interface as @robota-sdk/remote
 * and can be easily replaced with actual RemoteExecutor when available.
 */
    private async createRemoteProvider(): Promise<AIProvider> {
        const serverUrl = this.serverUrl;
        const authToken = this.authToken;

        return {
            name: 'remote',
            version: '1.0.0',

            /**
             * Chat method compatible with @robota-sdk/agents AIProvider interface
             */
            async chat(messages: UniversalMessage[], options?: ChatOptions): Promise<UniversalMessage> {
                try {
                    // Convert WebSocket URL to HTTP URL for API calls
                    const apiUrl = serverUrl.replace(/^ws/, 'http').replace(/\/ws\/playground$/, '');

                    // Helper function to get provider from model
                    const getProviderFromModel = (model: string): string => {
                        if (model.startsWith('gpt-') || model.includes('openai')) {
                            return 'openai';
                        } else if (model.startsWith('claude-') || model.includes('anthropic')) {
                            return 'anthropic';
                        } else if (model.startsWith('gemini-') || model.includes('google')) {
                            return 'google';
                        } else if (model.includes('/')) {
                            return model.split('/')[0]; // Format like "openai/gpt-4"
                        } else {
                            return 'openai'; // Default fallback
                        }
                    };

                    const modelName = options?.model || 'gpt-4';
                    const providerName = getProviderFromModel(modelName);

                    const requestBody = {
                        messages: messages.map(msg => ({
                            role: msg.role,
                            content: msg.content,
                            ...(msg.toolCalls && { toolCalls: msg.toolCalls })
                        })),
                        provider: providerName,
                        model: modelName,
                        temperature: options?.temperature,
                        maxTokens: options?.maxTokens,
                        tools: options?.tools
                    };

                    const response = await fetch(`${apiUrl}/api/v1/remote/chat`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${authToken}`,
                            'User-Agent': 'robota-playground/1.0.0'
                        },
                        body: JSON.stringify(requestBody)
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`Remote execution failed (${response.status}): ${errorText}`);
                    }

                    const data = await response.json();

                    // Handle the actual response structure: { success, data: { content, ... }, ... }
                    const responseData = data.data || data;

                    return {
                        role: 'assistant',
                        content: responseData.content || responseData.message || data.content || data.message || '',
                        timestamp: new Date(),
                        ...(responseData.toolCalls && { toolCalls: responseData.toolCalls }),
                        metadata: {
                            provider: data.provider || responseData.provider,
                            model: data.model || responseData.model,
                            tokensUsed: data.tokensUsed || responseData.tokensUsed,
                            duration: data.duration || responseData.duration
                        }
                    };
                } catch (error) {
                    throw new Error(`Remote chat execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            },

            /**
             * Stream chat method compatible with @robota-sdk/agents AIProvider interface
             */
            async *chatStream(messages: UniversalMessage[], options?: ChatOptions): AsyncIterable<UniversalMessage> {
                try {
                    // Convert WebSocket URL to HTTP URL for API calls
                    const apiUrl = serverUrl.replace(/^ws/, 'http').replace(/\/ws\/playground$/, '');

                    // Helper function to get provider from model
                    const getProviderFromModel = (model: string): string => {
                        if (model.startsWith('gpt-') || model.includes('openai')) {
                            return 'openai';
                        } else if (model.startsWith('claude-') || model.includes('anthropic')) {
                            return 'anthropic';
                        } else if (model.startsWith('gemini-') || model.includes('google')) {
                            return 'google';
                        } else if (model.includes('/')) {
                            return model.split('/')[0]; // Format like "openai/gpt-4"
                        } else {
                            return 'openai'; // Default fallback
                        }
                    };

                    const modelName = options?.model || 'gpt-4';
                    const providerName = getProviderFromModel(modelName);

                    const requestBody = {
                        messages: messages.map(msg => ({
                            role: msg.role,
                            content: msg.content,
                            ...(msg.toolCalls && { toolCalls: msg.toolCalls })
                        })),
                        provider: providerName,
                        model: modelName,
                        temperature: options?.temperature,
                        maxTokens: options?.maxTokens,
                        tools: options?.tools,
                        stream: true
                    };

                    const response = await fetch(`${apiUrl}/api/v1/remote/stream`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${authToken}`,
                            'Accept': 'text/event-stream',
                            'User-Agent': 'robota-playground/1.0.0'
                        },
                        body: JSON.stringify(requestBody)
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        console.error('Streaming request failed:', {
                            status: response.status,
                            statusText: response.statusText,
                            errorText,
                            url: `${apiUrl}/api/v1/remote/stream`
                        });
                        throw new Error(`Remote streaming failed (${response.status}): ${errorText}`);
                    }

                    const reader = response.body?.getReader();
                    const decoder = new TextDecoder();

                    if (!reader) {
                        throw new Error('Response body is not readable');
                    }

                    try {
                        let buffer = '';

                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;

                            buffer += decoder.decode(value, { stream: true });
                            const lines = buffer.split('\n');

                            // Keep the last incomplete line in buffer
                            buffer = lines.pop() || '';

                            for (const line of lines) {
                                if (line.trim() === '') continue;

                                if (line.startsWith('data: ')) {
                                    const data = line.slice(6).trim();

                                    if (data === '[DONE]') {
                                        return;
                                    }

                                    try {
                                        const parsed = JSON.parse(data);

                                        // Handle the actual response structure: { success, data: { content, ... }, ... }
                                        const responseData = parsed.data || parsed;
                                        const content = responseData.content;

                                        if (content !== undefined && content !== null) {
                                            const message: UniversalMessage = {
                                                role: 'assistant' as const,
                                                content: content,
                                                timestamp: new Date(),
                                                metadata: {
                                                    provider: parsed.provider || responseData.provider,
                                                    model: parsed.model || responseData.model,
                                                    chunk: true,
                                                    isComplete: responseData.metadata?.isComplete || false
                                                }
                                            };
                                            yield message;
                                        }
                                    } catch (e) {
                                        console.warn('Failed to parse SSE data:', data, e);
                                        // Skip invalid JSON chunks
                                        continue;
                                    }
                                }
                            }
                        }
                    } finally {
                        reader.releaseLock();
                    }
                } catch (error) {
                    throw new Error(`Remote stream execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            },

            supportsTools(): boolean {
                return true;
            },

            validateConfig(): boolean {
                return Boolean(serverUrl && authToken);
            },

            async dispose(): Promise<void> {
                // No cleanup needed for HTTP-based remote provider
                // WebSocket connections are handled separately by PlaygroundWebSocketClient
            }
        };
    }
}

/**
 * PlaygroundRobotaInstance - Robota SDK compatible agent implementation for browser
 * 
 * This class follows the same interface patterns as the actual Robota class
 * and integrates with remote AI providers for real execution.
 */
class PlaygroundRobotaInstance {
    private conversationHistory: UniversalMessage[] = [];
    private isInitialized = false;
    private remoteProvider: AIProvider; // Store the remote provider for direct access

    constructor(private config: PlaygroundAgentConfig) {
        // Create a dummy provider for now, will be replaced by actual RemoteExecutor
        this.remoteProvider = {
            name: 'dummy',
            version: '1.0.0',
            chat: async (messages: UniversalMessage[], options?: ChatOptions) => {
                console.log('Dummy chat called for:', this.config.name);
                return {
                    role: 'assistant',
                    content: 'Dummy response for ' + this.config.name,
                    timestamp: new Date()
                };
            },
            chatStream: async (messages: UniversalMessage[], options?: ChatOptions) => {
                console.log('Dummy stream called for:', this.config.name);
                return {
                    role: 'assistant',
                    content: 'Dummy stream response for ' + this.config.name,
                    timestamp: new Date()
                };
            },
            supportsTools: () => true,
            validateConfig: () => true,
            dispose: async () => { }
        };
    }

    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            // Initialize plugins following Robota SDK pattern
            if (this.config.plugins) {
                for (const plugin of this.config.plugins) {
                    await plugin.initialize();
                }
            }

            // Add system message if configured
            if (this.config.defaultModel.systemMessage) {
                this.conversationHistory.push({
                    role: 'system',
                    content: this.config.defaultModel.systemMessage,
                    timestamp: new Date()
                });
            }

            this.isInitialized = true;
        } catch (error) {
            throw new Error(`Agent initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async run(prompt: string): Promise<{ response: string; toolsExecuted?: string[] }> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            // Record user message through plugins
            this.recordEvent({
                type: 'user_message',
                content: prompt
            });

            // Add user message to conversation history
            const userMessage: UniversalMessage = {
                role: 'user',
                content: prompt,
                timestamp: new Date()
            };
            this.conversationHistory.push(userMessage);

            // Use actual AI provider for execution
            const provider = this.config.aiProviders[0];
            if (!provider) {
                throw new Error('No AI provider configured');
            }

            const aiResponse = await provider.chat(this.conversationHistory, {
                model: this.config.defaultModel.model,
                temperature: this.config.defaultModel.temperature,
                maxTokens: this.config.defaultModel.maxTokens
            });

            this.conversationHistory.push(aiResponse);

            // Record assistant response through plugins
            this.recordEvent({
                type: 'assistant_response',
                content: aiResponse.content || 'No response generated'
            });

            return {
                response: aiResponse.content || 'No response generated',
                toolsExecuted: this.config.tools?.map(t => t.name) || []
            };

        } catch (error) {
            // Record error through plugins
            this.recordEvent({
                type: 'error',
                content: `Agent execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            });

            throw new Error(`Agent execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async *runStream(prompt: string): AsyncIterable<string> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            // Record user message through plugins
            this.recordEvent({
                type: 'user_message',
                content: prompt
            });

            const userMessage: UniversalMessage = {
                role: 'user',
                content: prompt,
                timestamp: new Date()
            };
            this.conversationHistory.push(userMessage);

            const provider = this.config.aiProviders[0];
            if (!provider) {
                throw new Error('No AI provider configured');
            }

            let fullResponse = '';

            if (provider.chatStream) {
                // Use real streaming from AI provider
                console.log('Starting streaming with provider:', provider.name);
                for await (const chunk of provider.chatStream(this.conversationHistory, {
                    model: this.config.defaultModel.model,
                    temperature: this.config.defaultModel.temperature,
                    maxTokens: this.config.defaultModel.maxTokens
                })) {
                    console.log('Received chunk from provider:', chunk);
                    const content = chunk.content || '';
                    console.log('Extracted content:', content);
                    fullResponse += content;
                    yield content;
                }
                console.log('Streaming completed, full response:', fullResponse);

                // Record complete assistant response through plugins
                this.recordEvent({
                    type: 'assistant_response',
                    content: fullResponse
                });
            } else {
                // Fallback for providers without streaming
                const response = await provider.chat(this.conversationHistory);
                const content = response.content || '';
                fullResponse = content;

                // Record assistant response through plugins
                this.recordEvent({
                    type: 'assistant_response',
                    content: content
                });

                yield content;
            }

            this.conversationHistory.push({
                role: 'assistant',
                content: fullResponse,
                timestamp: new Date()
            });

        } catch (error) {
            // Record error through plugins
            this.recordEvent({
                type: 'error',
                content: `Agent execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            });

            throw new Error(`Agent execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async dispose(): Promise<void> {
        try {
            if (this.config.plugins) {
                for (const plugin of this.config.plugins) {
                    await plugin.dispose();
                }
            }

            for (const provider of this.config.aiProviders) {
                if (provider.dispose) {
                    await provider.dispose();
                }
            }

            this.isInitialized = false;
        } catch (error) {
            throw new Error(`Agent disposal failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    // Helper method to record events through plugins
    private recordEvent(event: { type: 'user_message' | 'assistant_response' | 'error'; content: string }) {
        if (this.config.plugins) {
            for (const plugin of this.config.plugins) {
                if (plugin instanceof PlaygroundHistoryPlugin) {
                    plugin.recordEvent(event);
                    break; // Only record once
                }
            }
        }
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
            const teamOptions: TeamOptions = {
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
                timestamp: new Date(),
                data: { prompt, teamName: this.config.name }
            });

            // Execute using actual team container
            const result = await this.teamContainer.execute(prompt);

            // Record team execution success
            this.historyPlugin.recordEvent({
                type: 'assistant_response', // Use valid event type
                timestamp: new Date(),
                data: {
                    prompt,
                    response: result.response || result,
                    teamName: this.config.name
                }
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
                timestamp: new Date(),
                data: {
                    prompt,
                    error: error instanceof Error ? error.message : String(error),
                    teamName: this.config.name
                }
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
                type: 'team_streaming_start',
                timestamp: new Date(),
                data: { prompt, teamName: this.config.name }
            });

            // Execute using actual team container
            for await (const chunk of this.teamContainer.stream(prompt)) {
                yield chunk;
            }

            // Record team streaming success
            this.historyPlugin.recordEvent({
                type: 'team_streaming_success',
                timestamp: new Date(),
                data: {
                    prompt,
                    teamName: this.config.name
                }
            });

        } catch (error) {
            console.error('Team streaming failed:', error);

            // Record team streaming error
            this.historyPlugin.recordEvent({
                type: 'team_streaming_error',
                timestamp: new Date(),
                data: {
                    prompt,
                    error: error instanceof Error ? error.message : String(error),
                    teamName: this.config.name
                }
            });

            throw new Error(`Team streaming failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async dispose(): Promise<void> {
        try {
            if (this.teamContainer) {
                await this.teamContainer.dispose();
                this.teamContainer = null;
            }
            this.isInitialized = false;
        } catch (error) {
            throw new Error(`Team disposal failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
} 