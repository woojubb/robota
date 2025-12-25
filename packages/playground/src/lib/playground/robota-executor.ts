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

import { Robota } from '@robota-sdk/agents';
import type { IAIProvider, IChatOptions, IEventService, IToolSchema, TUniversalMessage, TUniversalValue } from '@robota-sdk/agents';
import type { WorkflowEventSubscriber } from '@robota-sdk/workflow';
import { DefaultExternalWorkflowStore, type IExternalWorkflowStore } from './external-workflow-store';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { FunctionTool } from '@robota-sdk/agents';
import {
    PlaygroundHistoryPlugin,
    type IConversationEvent,
    type IVisualizationData
} from './plugins/playground-history-plugin';
import { PlaygroundStatisticsPlugin } from './plugins/playground-statistics-plugin';
import type { IPlaygroundAction, IPlaygroundMetrics, IPlaygroundExecutionResult as IPlaygroundStatisticsExecutionResult } from '../../types/playground-statistics';
import { SimpleLogger, SilentLogger } from '@robota-sdk/agents';
// ExecutionHierarchyTracker will be added later when exports are fixed

// Re-export types for external use
export type { IVisualizationData, IConversationEvent } from './plugins/playground-history-plugin';
import { PlaygroundWebSocketClient } from './websocket-client';
import { RemoteExecutor } from '@robota-sdk/remote';
import { createBlockTrackingHooks } from './block-tracking/block-hooks';
import { ToolRegistry } from '../../tools/catalog';



// NOTE:
// This module must consume canonical contracts from @robota-sdk/agents (SSOT).
// Do not re-declare message/provider/tool contracts locally.

export interface IPlaygroundTool {
    readonly name: string;
    readonly description: string;
    execute(params: TUniversalValue): Promise<TUniversalValue>;
}

export interface IPlaygroundPlugin {
    readonly name: string;
    readonly version: string;
    initialize(): Promise<void>;
    dispose(): Promise<void>;
}

// Playground-specific configuration interfaces using Robota-compatible types
export interface IPlaygroundAgentConfig {
    id?: string;
    name: string;
    aiProviders: IAIProvider[];
    defaultModel: {
        provider: string;
        model: string;
        temperature?: number;
        maxTokens?: number;
        systemMessage?: string;
    };
    tools?: IPlaygroundTool[];
    plugins?: IPlaygroundPlugin[];
    systemMessage?: string;
    metadata?: Record<string, unknown>;
}

export interface IPlaygroundExecutorResult {
    success: boolean;
    response: string;
    duration: number;
    tokensUsed?: number;
    toolsExecuted?: string[];
    error?: Error;
    uiError?: IPlaygroundUiError;
    visualizationData?: IVisualizationData;
}

export type TPlaygroundMode = 'agent';

export type TPlaygroundUiErrorKind = 'user_message' | 'recoverable' | 'fatal';

export interface IPlaygroundUiError {
    kind: TPlaygroundUiErrorKind;
    message: string;
}

function toPlaygroundUiError(input: unknown): IPlaygroundUiError {
    const message = input instanceof Error ? input.message : String(input);

    // Heuristic classification:
    // - user_message: validation / user input issues
    // - fatal: strict-policy / invariant violations
    // - recoverable: default (transient/system)
    const lowered = message.toLowerCase();
    if (lowered.includes('missing required') || lowered.includes('invalid') || lowered.includes('unknown tool')) {
        return { kind: 'user_message', message };
    }
    if (lowered.includes('[strict-policy]') || lowered.includes('[path-only]') || lowered.includes('no fallback')) {
        return { kind: 'fatal', message };
    }
    return { kind: 'recoverable', message };
}

/**
 * Playground executor for managing Robota agents in browser (team removed)
 * 
 * Follows Facade Pattern - simple interface with essential methods only
 * Integrates PlaygroundStatisticsPlugin for real-time metrics collection
 */
export class PlaygroundExecutor {
    private mode: 'agent' = 'agent';
    private currentAgent: Robota | null = null;
    // Team feature removed
    // Registry: rootId(conversationId) → agent instance
    private agentRegistry: Map<string, Robota> = new Map();

    // Playground-specific plugins
    private historyPlugin: PlaygroundHistoryPlugin;
    private statisticsPlugin: PlaygroundStatisticsPlugin;
    private eventService: IEventService;
    private websocketClient: PlaygroundWebSocketClient | null = null;

    // SDK Workflow system
    private workflowSubscriber: WorkflowEventSubscriber;

    // STEP 8.3.1: External Workflow Store
    private externalWorkflowStore: IExternalWorkflowStore;

    private readonly logger: SimpleLogger;

    constructor(
        private serverUrl: string,
        private authToken: string,
        options: {
            eventService: IEventService;
            workflowSubscriber: WorkflowEventSubscriber;
            logger?: SimpleLogger;
        }
    ) {
        // Initialize logger with dependency injection
        this.logger = options.logger || SilentLogger;

        // HierarchyTracker will be added later

        // Create playground-specific plugins (ready immediately)
        this.historyPlugin = new PlaygroundHistoryPlugin({
            maxEvents: 1000,
            enableVisualization: true,
            logger: this.logger
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

        // Injected workflow subscriber + event service (single DI path)
        this.workflowSubscriber = options.workflowSubscriber;
        this.eventService = options.eventService;
        this.logger.debug('PlaygroundExecutor initialized with injected IEventService and WorkflowEventSubscriber');

        // STEP 8.3.2: Create ExternalWorkflowStore
        this.externalWorkflowStore = new DefaultExternalWorkflowStore(this.logger);
        this.logger.debug('ExternalWorkflowStore created');

        // Subscribe to workflow snapshots (SDK source of truth)
        this.setupWorkflowSubscription();

        // PlaygroundExecutor is ready immediately
        // WebSocket will be connected lazily when needed
    }

    /**
     * 🎯 26번 예제 구조: 워크플로우 실시간 업데이트 구독 설정
     */
    private setupWorkflowSubscription(): void {
        let snapCount = 0;
        // Subscribe to snapshots emitted AFTER each applied update
        this.workflowSubscriber.subscribeToWorkflowSnapshots((snapshot: any) => {
            if (!snapshot) return;
            snapCount++;
            this.logger.debug(`Workflow snapshot received (${snapCount})`, {
                nodeCount: snapshot.nodes?.length || 0,
                edgeCount: snapshot.edges?.length || 0
            });
            if (this.uiUpdateCallback) {
                this.uiUpdateCallback(snapshot);
            }
        });

        this.logger.debug('Workflow snapshot subscription setup completed');
    }

    // 🎯 UI 업데이트 콜백 저장소
    private uiUpdateCallback: ((workflow: any) => void) | null = null;

    /**
     * 🎯 플레이그라운드 UI가 워크플로우 업데이트를 구독할 수 있는 메서드
     */
    subscribeToWorkflowUpdates(callback: (workflow: any) => void): void {
        this.logger.debug('Playground UI subscribed to workflow updates');
        this.uiUpdateCallback = callback;
    }

    /**
     * 🎯 26번 예제 구조: 현재 워크플로우 데이터 반환
     */
    getCurrentWorkflow(): any {
        return this.workflowSubscriber.exportWorkflow();
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
    async createAgent(config: IPlaygroundAgentConfig): Promise<void> {
        try {
            // Create AI providers with remote executor
            const aiProviders = this.createProvidersWithExecutor();

            this.currentAgent = new Robota({
                name: config.name,
                aiProviders: aiProviders as any,
                defaultModel: config.defaultModel,
                plugins: [this.historyPlugin as any, this.statisticsPlugin as any],
                tools: (config.tools || []) as any,
                eventService: this.eventService
            });

            // Immediate registry registration with conversationId/root id
            try {
                const convId = (this.currentAgent as any).conversationId || config.name;
                if (typeof convId === 'string') {
                    this.agentRegistry.set(convId, this.currentAgent);
                }
            } catch { /* ignore */ }

            this.logger.debug('Agent created');

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
     * Update tools on a specific agent instance by rootId(conversationId).
     * Strict: if agent not found in registry, throws.
     */
    async updateAgentTools(agentId: string, tools: IPlaygroundTool[]): Promise<{ version: number }> {
        if (!agentId || typeof agentId !== 'string') {
            throw new Error('updateAgentTools: invalid agentId');
        }
        const agent = this.agentRegistry.get(agentId);
        if (!agent) {
            throw new Error(`updateAgentTools: agent not found for id ${agentId}`);
        }
        return agent.updateTools(tools as any);
    }

    /**
     * Read current configuration of an agent by rootId(conversationId).
     */
    async getAgentConfiguration(agentId: string): Promise<{ version: number; tools: Array<{ name: string; parameters?: string[] }>; updatedAt: number; metadata?: Record<string, unknown> }> {
        if (!agentId || typeof agentId !== 'string') {
            throw new Error('getAgentConfiguration: invalid agentId');
        }
        const agent = this.agentRegistry.get(agentId);
        if (!agent) {
            throw new Error(`getAgentConfiguration: agent not found for id ${agentId}`);
        }
        return agent.getConfiguration() as any;
    }

    /** Build a simple dummy FunctionTool using JSON schema that returns a fixed or echoed result */
    private buildDummyTool(name: string, description?: string): any {
        const schema: IToolSchema = {
            name,
            description: description || 'Dummy tool (returns echo) for Playground',
            parameters: {
                type: 'object',
                properties: {
                    value: { type: 'string', description: 'Value to echo' }
                }
            }
        } as any;
        const executor = async (params: any) => {
            const val = params && typeof params.value === 'string' ? params.value : `ok:${name}`;
            return { success: true, data: val } as any;
        };
        return new FunctionTool(schema as any, executor as any);
    }

    /** Convenience: from UI card ({ id, name, description }) append tool from registry and update agent */
    async updateAgentToolsFromCard(agentId: string, card: { id: string; name: string; description?: string }): Promise<{ version: number }> {
        const agent = this.agentRegistry.get(agentId);
        if (!agent) {
            throw new Error(`agent not found: ${agentId}`);
        }

        // Create tool from static ToolRegistry (eventService injected)
        const factory = (ToolRegistry as any)[card.id];
        if (typeof factory !== 'function') {
            throw new Error(`Unknown tool id: ${card.id}`);
        }

        const newTool = factory(this.eventService);

        const existing: any[] = ((agent as any).config?.tools as any[]) || [];
        const result = await agent.updateTools([...
            existing,
            newTool
        ] as any);
        return result;
    }

    /**
     * Execute a prompt (Facade method)
     * 🚫 DEPRECATED: Use execute() method instead for 26번 compatibility
     */
    async run(prompt: string): Promise<IPlaygroundExecutorResult> {
        const startTime = Date.now();
        const request: TUniversalMessage[] = [{ role: 'user', content: prompt, timestamp: new Date() }];

        try {
            const result = await this.executeChat(request);
            const duration = Date.now() - startTime;

            const executionResult: IPlaygroundExecutorResult = {
                success: true,
                response: result.content || 'No response',
                duration: duration,
                visualizationData: this.getVisualizationData(),
                uiError: undefined
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
            const executionResult: IPlaygroundExecutorResult = {
                success: false,
                response: 'Execution failed',
                duration: duration,
                error: error instanceof Error ? error : new Error(String(error)),
                visualizationData: this.getVisualizationData(),
                uiError: toPlaygroundUiError(error)
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
     * 🎯 26번 예제와 동일한 단순 실행 구조
     */
    async execute(prompt: string, onChunk?: (chunk: string) => void): Promise<IPlaygroundExecutorResult> {
        this.logger.debug('Playground execute called');

        const startTime = Date.now();

        try {
            let result: string;

            if (this.currentAgent) {
                this.logger.debug('Executing current agent run');
                result = await this.currentAgent.run(prompt);
            } else {
                this.logger.error('No active agent configured for execution', {
                    mode: this.mode,
                    hasAgent: !!this.currentAgent
                });
                throw new Error('No active agent to execute prompt');
            }

            const duration = Date.now() - startTime;

            // 스트리밍 콜백이 있으면 한 번에 전체 결과 전달
            if (onChunk) {
                onChunk(result);
            }

            return {
                success: true,
                response: result,
                duration: duration,
                visualizationData: this.getVisualizationData(),
                uiError: undefined
            };

        } catch (error) {
            const duration = Date.now() - startTime;
            this.logger.error('Playground execution failed', {
                error: error instanceof Error ? error.message : String(error)
            });

            const executionResult: IPlaygroundExecutorResult = {
                success: false,
                response: 'Execution failed',
                duration: duration,
                error: error instanceof Error ? error : new Error(String(error)),
                visualizationData: this.getVisualizationData(),
                uiError: toPlaygroundUiError(error)
            };
            return executionResult;
        }
    }

    /**
     * Execute with streaming response (Facade method)
     * 🚫 DEPRECATED: Use execute() method instead for 26번 compatibility
     */
    async *runStream(prompt: string): AsyncGenerator<string, IPlaygroundExecutorResult> {
        const startTime = Date.now();
        const request: TUniversalMessage[] = [{ role: 'user', content: prompt, timestamp: new Date() }];

        try {
            let fullResponse = '';

            // Collect all TUniversalMessage chunks from executeChatStream().
            for await (const chunk of this.executeChatStream(request)) {
                const content = chunk.content || '';
                fullResponse += content;
                // Do not yield per chunk; we yield the final concatenated response once.
            }

            // Yield the final complete response once.
            yield fullResponse;

            const duration = Date.now() - startTime;
            const executionResult: IPlaygroundExecutorResult = {
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
            const executionResult: IPlaygroundExecutorResult = {
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
    getPlaygroundStatistics(): IPlaygroundMetrics {
        return this.statisticsPlugin.getPlaygroundStats().metrics;
    }

    /**
     * Record a Playground-specific action
     */
    async recordPlaygroundAction(actionType: IPlaygroundAction['type'], metadata?: Record<string, TUniversalValue>): Promise<void> {
        await this.statisticsPlugin.recordUIInteraction(actionType, metadata);
    }

    /**
     * Record block creation for visualization
     */
    async recordBlockCreation(blockType: string, metadata?: Record<string, TUniversalValue>): Promise<void> {
        await this.statisticsPlugin.recordBlockCreation(blockType, metadata);
    }

    /**
     * Get visualization data from history plugin
     */
    getVisualizationData(): IVisualizationData {
        return this.historyPlugin.getVisualizationData();
    }

    /**
     * Get all playground events from PlaygroundHistoryPlugin
     * These events include all EventService events (execution.*, tool_call_*, task.*)
     */
    getPlaygroundEvents(): IConversationEvent[] {
        return this.historyPlugin.getAllEvents();
    }



    /**
     * Create IToolHooks using EventService for assignTask instrumentation
     */
    private createEventServiceToolHooks(): any {
        return { hooksEnabled: true } as any;
    }

    /**
     * Get conversation history from current agent/team
     */
    getHistory(): TUniversalMessage[] {
        if (this.mode === 'agent' && this.currentAgent) {
            return this.currentAgent.getHistory();
        }
        return [];
    }

    /**
     * Clear conversation history (Facade essential method)
     */
    clearHistory(): void {
        this.historyPlugin.clearEvents();
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
    private async executeChat(messages: TUniversalMessage[]): Promise<TUniversalMessage> {
        const startTime = Date.now();
        const executionId = this.generateExecutionId();

        this.logger.debug('PlaygroundExecutor.executeChat debug', {
            mode: this.mode,
            hasAgent: !!this.currentAgent
        });

        try {
            // Record execution start
            await this.recordExecutionStart(executionId, messages);

            let response: TUniversalMessage;

            if (this.mode === 'agent' && this.currentAgent) {
                this.logger.debug('Executing in agent mode');
                const prompt = messages[0].content || '';
                const result = await this.currentAgent.run(prompt);
                response = {
                    role: 'assistant',
                    content: result,
                    timestamp: new Date()
                } as TUniversalMessage;

            } else {
                throw new Error('No agent configured for execution');
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
    private async *executeChatStream(messages: TUniversalMessage[]): AsyncIterable<TUniversalMessage> {
        const startTime = Date.now();
        const executionId = this.generateExecutionId();

        try {
            this.logger.debug('executeChatStream starting', { executionId, mode: this.mode, messagesCount: messages.length });
            this.logger.debug('Current execution state', {
                mode: this.mode,
                hasAgent: !!this.currentAgent,
                agentType: this.currentAgent?.constructor?.name
            });

            // Record execution start
            await this.recordExecutionStart(executionId, messages);

            if (this.mode === 'agent' && this.currentAgent) {
                this.logger.debug('Starting agent stream');
                const prompt = messages[0].content || '';
                const stream = this.currentAgent.runStream(prompt);

                // ✅ Agent 모드도 team 모드와 동일: 청크를 수집만 하고 최종에 한 번만 yield
                let fullResponse = '';
                for await (const chunk of stream) {
                    fullResponse += chunk;
                    // ❌ 각 청크마다 yield하지 않음 (team 모드와 동일하게)
                }

                // ✅ 최종 완성된 메시지만 한 번 yield
                yield {
                    role: 'assistant',
                    content: fullResponse,
                    timestamp: new Date()
                } as TUniversalMessage;

            } else {
                const error = new Error('No agent configured for streaming execution');
                this.logger.error('No configured executor for streaming', { mode: this.mode, hasAgent: !!this.currentAgent });
                throw error;
            }

            this.logger.debug('executeChatStream completed successfully');

        } catch (error) {
            this.logger.error('executeChatStream error', {
                executionId,
                mode: this.mode,
                hasAgent: !!this.currentAgent,
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
     * Get last execution ID for External Store connection
     */
    getLastExecutionId(): string | null {
        // For now, we'll generate a consistent ID based on current state
        // This should be improved to track actual execution IDs
        return 'agent-execution-' + Date.now();
    }

    /**
     * Record execution start for statistics
     */
    private async recordExecutionStart(executionId: string, messages: TUniversalMessage[]): Promise<void> {
        // Start time is already tracked in executeChat/executeChatStream
        // This can be used for more detailed tracking if needed
        this.logDebug('Execution started', { executionId, provider: 'openai', model: 'gpt-4', mode: this.mode || 'agent' });
    }

    /**
     * Record successful execution completion
     */
    private async recordExecutionComplete(executionId: string, result: IPlaygroundStatisticsExecutionResult): Promise<void> {
        await this.statisticsPlugin.recordPlaygroundExecution(result);
        this.logDebug('Execution completed', { executionId, duration: result.duration, success: result.success });
    }

    /**
     * Record execution error
     */
    private async recordExecutionError(executionId: string, result: IPlaygroundStatisticsExecutionResult): Promise<void> {
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

        // Explicitly set a model to keep execution deterministic in examples/tests.
        const openaiProvider = new OpenAIProvider({
            executor: remoteExecutor,
            model: 'gpt-4o-mini'
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
    private setMode(mode: TPlaygroundMode): void {
        this.logger.debug('Setting playground mode', {
            previousMode: this.mode,
            nextMode: mode,
            hasCurrentAgent: !!this.currentAgent
        });

        this.mode = mode;
        this.logDebug('Mode changed', { mode });
    }



    /**
     * STEP 8.3.3: Get External Workflow Store for manual node management
     */
    getExternalWorkflowStore(): IExternalWorkflowStore {
        return this.externalWorkflowStore;
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

// Team feature removed: legacy team execution code deleted.