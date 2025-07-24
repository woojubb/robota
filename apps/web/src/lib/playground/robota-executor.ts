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

        const remoteProvider = await this.createRemoteProvider();

        const agents = await Promise.all(
            config.agents.map(async (agentConfig: PlaygroundAgentConfig) => {
                const agent = new PlaygroundRobotaInstance({
                    name: agentConfig.name,
                    aiProviders: [remoteProvider],
                    defaultModel: agentConfig.defaultModel,
                    tools: agentConfig.tools,
                    plugins: [this.historyPlugin]
                });
                await agent.initialize();
                return agent;
            })
        );

        this.currentTeam = new PlaygroundTeamInstance(config, agents, this.historyPlugin);
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
                    const response = await fetch(`${serverUrl}/api/remote/chat`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${authToken}`,
                            'User-Agent': 'robota-playground/1.0.0'
                        },
                        body: JSON.stringify({
                            messages: messages.map(msg => ({
                                role: msg.role,
                                content: msg.content,
                                ...(msg.toolCalls && { toolCalls: msg.toolCalls })
                            })),
                            provider: options?.model?.split('/')[0] || 'openai',
                            model: options?.model || 'gpt-4',
                            temperature: options?.temperature,
                            maxTokens: options?.maxTokens,
                            tools: options?.tools
                        })
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
                        throw new Error(`Remote execution failed (${response.status}): ${errorText}`);
                    }

                    const data = await response.json();

                    return {
                        role: 'assistant',
                        content: data.content || data.message || '',
                        timestamp: new Date(),
                        ...(data.toolCalls && { toolCalls: data.toolCalls }),
                        metadata: {
                            provider: data.provider,
                            model: data.model,
                            tokensUsed: data.tokensUsed,
                            duration: data.duration
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
                    const response = await fetch(`${serverUrl}/api/remote/stream`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${authToken}`,
                            'Accept': 'text/event-stream',
                            'User-Agent': 'robota-playground/1.0.0'
                        },
                        body: JSON.stringify({
                            messages: messages.map(msg => ({
                                role: msg.role,
                                content: msg.content,
                                ...(msg.toolCalls && { toolCalls: msg.toolCalls })
                            })),
                            provider: options?.model?.split('/')[0] || 'openai',
                            model: options?.model || 'gpt-4',
                            temperature: options?.temperature,
                            maxTokens: options?.maxTokens,
                            tools: options?.tools,
                            stream: true
                        })
                    });

                    if (!response.ok) {
                        const errorText = await response.text();
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
                                    if (data === '[DONE]') return;

                                    try {
                                        const parsed = JSON.parse(data);
                                        if (parsed.content) {
                                            yield {
                                                role: 'assistant',
                                                content: parsed.content,
                                                timestamp: new Date(),
                                                metadata: {
                                                    provider: parsed.provider,
                                                    model: parsed.model,
                                                    chunk: true
                                                }
                                            };
                                        }
                                    } catch (e) {
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

    constructor(private config: PlaygroundAgentConfig) { }

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

            return {
                response: aiResponse.content || 'No response generated',
                toolsExecuted: this.config.tools?.map(t => t.name) || []
            };

        } catch (error) {
            throw new Error(`Agent execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async *runStream(prompt: string): AsyncIterable<string> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
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
                for await (const chunk of provider.chatStream(this.conversationHistory, {
                    model: this.config.defaultModel.model,
                    temperature: this.config.defaultModel.temperature,
                    maxTokens: this.config.defaultModel.maxTokens
                })) {
                    const content = chunk.content || '';
                    fullResponse += content;
                    yield content;
                }
            } else {
                // Fallback for providers without streaming
                const response = await provider.chat(this.conversationHistory);
                fullResponse = response.content || '';
                const words = fullResponse.split(' ');

                for (const word of words) {
                    yield word + ' ';
                    await new Promise(resolve => setTimeout(resolve, 50));
                }
            }

            // Add complete response to history
            this.conversationHistory.push({
                role: 'assistant',
                content: fullResponse,
                timestamp: new Date()
            });

        } catch (error) {
            throw new Error(`Agent stream execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
}

/**
 * PlaygroundTeamInstance - Team collaboration implementation for browser
 */
class PlaygroundTeamInstance {
    private isInitialized = false;

    constructor(
        private config: PlaygroundTeamConfig,
        private agents: PlaygroundRobotaInstance[],
        private historyPlugin: PlaygroundHistoryPlugin
    ) { }

    async initialize(): Promise<void> {
        if (this.isInitialized) return;

        try {
            for (const agent of this.agents) {
                await agent.initialize();
            }
            this.isInitialized = true;
        } catch (error) {
            throw new Error(`Team initialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async execute(prompt: string): Promise<{ response: string; toolsExecuted?: string[] }> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            // Simple team logic: use primary agent (can be enhanced)
            const primaryAgent = this.agents[0];
            if (!primaryAgent) {
                throw new Error('No agents available in team');
            }

            const result = await primaryAgent.run(prompt);

            return {
                response: `Team response: ${result.response}`,
                toolsExecuted: result.toolsExecuted || []
            };

        } catch (error) {
            throw new Error(`Team execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async *executeStream(prompt: string): AsyncIterable<string> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        try {
            const primaryAgent = this.agents[0];
            if (!primaryAgent) {
                throw new Error('No agents available in team');
            }

            yield 'Team processing: ';

            for await (const chunk of primaryAgent.runStream(prompt)) {
                yield chunk;
            }

        } catch (error) {
            throw new Error(`Team stream execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async dispose(): Promise<void> {
        try {
            for (const agent of this.agents) {
                await agent.dispose();
            }
            this.isInitialized = false;
        } catch (error) {
            throw new Error(`Team disposal failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }
} 