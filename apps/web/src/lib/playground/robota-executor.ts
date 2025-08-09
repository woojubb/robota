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

import { Robota, type ToolHooks, ActionTrackingEventService, WorkflowEventSubscriber, RealTimeWorkflowBuilder } from '@robota-sdk/agents';
import { DefaultExternalWorkflowStore, type ExternalWorkflowStore } from './external-workflow-store';
import { OpenAIProvider } from '@robota-sdk/openai';
import { AnthropicProvider } from '@robota-sdk/anthropic';
import { createTeam, type TeamOptions, type TeamContainer } from '@robota-sdk/team';
import {
    PlaygroundHistoryPlugin,
    ConversationEvent,
    VisualizationData
} from './plugins/playground-history-plugin';
import { PlaygroundStatisticsPlugin } from './plugins/playground-statistics-plugin';
import type { PlaygroundMetrics, PlaygroundExecutionResult as PlaygroundStatisticsResult } from '../../types/playground-statistics';
import { SimpleLogger, SilentLogger } from '@robota-sdk/agents';
// ExecutionHierarchyTracker will be added later when exports are fixed

// Re-export types for external use
export type { VisualizationData, ConversationEvent } from './plugins/playground-history-plugin';
import { PlaygroundWebSocketClient } from './websocket-client';
import { RemoteExecutor } from '@robota-sdk/remote';
import { PlaygroundEventService, createPlaygroundEventService } from './playground-event-service';
import { createBlockTrackingHooks } from './block-tracking/block-hooks';



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
    visualizationData?: VisualizationData; // ✅ 올바른 타입 이름
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
    private currentTeam: TeamContainer | null = null;

    // Playground-specific plugins
    private historyPlugin: PlaygroundHistoryPlugin;
    private statisticsPlugin: PlaygroundStatisticsPlugin;
    private eventService: ActionTrackingEventService;
    private websocketClient: PlaygroundWebSocketClient | null = null;

    // SDK Workflow system
    private workflowSubscriber: WorkflowEventSubscriber;
    private workflowBuilder: RealTimeWorkflowBuilder;

    // STEP 8.3.1: External Workflow Store
    private externalWorkflowStore: ExternalWorkflowStore;

    private readonly logger: SimpleLogger;

    constructor(
        private serverUrl: string,
        private authToken: string,
        logger?: SimpleLogger
    ) {
        // Initialize logger with dependency injection
        this.logger = logger || SilentLogger;

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

        // Create PlaygroundEventService that connects to historyPlugin
        const basePlaygroundEventService = createPlaygroundEventService(this.historyPlugin);

        // STEP 7.1.1: Create WorkflowEventSubscriber
        this.workflowSubscriber = new WorkflowEventSubscriber(this.logger);
        console.log('🏗️ [STEP 7.1.1] WorkflowEventSubscriber created:', !!this.workflowSubscriber);

        // 🎯 26번 예제 구조: ActionTrackingEventService with WorkflowEventSubscriber
        this.eventService = new ActionTrackingEventService(this.workflowSubscriber);
        console.log('🎯 [26-STRUCTURE] ActionTrackingEventService created with WorkflowEventSubscriber');

        // STEP 8.3.2: Create ExternalWorkflowStore
        this.externalWorkflowStore = new DefaultExternalWorkflowStore(this.logger);
        console.log('🏪 [STEP 8.3.2] ExternalWorkflowStore created:', !!this.externalWorkflowStore);

        // STEP 7.1.2: Create RealTimeWorkflowBuilder with ExternalWorkflowStore
        this.workflowBuilder = new RealTimeWorkflowBuilder(
            this.workflowSubscriber,
            this.logger,
            this.externalWorkflowStore  // STEP 8.3.2: 외부 Store 주입
        );
        console.log('🔧 [STEP 7.1.2] RealTimeWorkflowBuilder created with External Store:', !!this.workflowBuilder);

        // External Store → SDK Store 연결 설정
        this.externalWorkflowStore.setUpdateCallback(async () => {
            await this.workflowBuilder.triggerManualUpdate();
        });
        console.log('🔗 [CONNECTION] External Store → SDK Store trigger connected');
        console.log('🔧 [STEP 7.1.2] Workflow system ready');

        // 🎯 26번 예제 구조: 워크플로우 실시간 업데이트 구독
        this.setupWorkflowSubscription();

        // PlaygroundExecutor is ready immediately
        // WebSocket will be connected lazily when needed
    }

    /**
     * 🎯 26번 예제 구조: 워크플로우 실시간 업데이트 구독 설정
     */
    private setupWorkflowSubscription(): void {
        let updateCount = 0;
        let scheduled = false;
        let lastWorkflow: any = null;

        this.workflowBuilder.subscribeToUniversalUpdates((workflow) => {
            updateCount++;

            console.log(`📊 [26-STRUCTURE] Workflow Update #${updateCount}:`, {
                nodeCount: workflow.nodes.length,
                edgeCount: workflow.edges.length,
                workflowType: workflow.__workflowType
            });

            // Snapshot coalescing: batch multiple rapid updates into one microtask
            lastWorkflow = workflow;
            if (!this.uiUpdateCallback) return;
            if (scheduled) return;
            scheduled = true;
            queueMicrotask(() => {
                try {
                    const snapshot = (globalThis as any).structuredClone
                        ? (globalThis as any).structuredClone(lastWorkflow)
                        : JSON.parse(JSON.stringify(lastWorkflow));
                    this.uiUpdateCallback!(snapshot);
                } catch {
                    // Fallback to JSON clone if structuredClone unavailable
                    const snapshot = JSON.parse(JSON.stringify(lastWorkflow));
                    this.uiUpdateCallback!(snapshot);
                } finally {
                    scheduled = false;
                }
            });
        });

        console.log('🎯 [26-STRUCTURE] Workflow subscription setup completed');
    }

    // 🎯 UI 업데이트 콜백 저장소
    private uiUpdateCallback: ((workflow: any) => void) | null = null;

    /**
     * 🎯 플레이그라운드 UI가 워크플로우 업데이트를 구독할 수 있는 메서드
     */
    subscribeToWorkflowUpdates(callback: (workflow: any) => void): void {
        console.log('🎯 [UI-SUBSCRIPTION] Playground UI subscribed to workflow updates');
        this.uiUpdateCallback = callback;
    }

    /**
     * 🎯 26번 예제 구조: 현재 워크플로우 데이터 반환
     */
    getCurrentWorkflow(): any {
        return this.workflowBuilder.getCurrentWorkflow();
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

            // 🎯 26번 예제 구조: Context-bound EventService 사용
            console.log('🚀 [26-STRUCTURE] Creating agent with context-bound EventService');

            // Generate execution context for agent
            const agentContext = {
                executionId: `agent_${Date.now()}`,
                rootExecutionId: `agent_${Date.now()}`,
                executionLevel: 0, // Agent level
                executionPath: [],
                sourceType: 'agent' as const,
                sourceId: config.name,
                toolName: 'agent',
                parameters: {}
            };

            // Create context-bound EventService
            const contextBoundEventService = this.eventService.createContextBoundInstance &&
                typeof this.eventService.createContextBoundInstance === 'function'
                ? this.eventService.createContextBoundInstance(agentContext)
                : this.eventService;

            this.currentAgent = new Robota({
                name: config.name,
                aiProviders: aiProviders as any,
                defaultModel: config.defaultModel,
                plugins: [this.historyPlugin as any, this.statisticsPlugin as any],
                tools: (config.tools || []) as any,
                eventService: contextBoundEventService // Context-bound EventService 사용
            });

            console.log('🚀 [26-STRUCTURE] Agent created with context-bound EventService');

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

            // 🎯 26번 예제 구조: Context-bound EventService 사용
            console.log('🚀 [26-STRUCTURE] Creating team with context-bound EventService');

            const testConversationId = `test_conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const baseExecutionId = `conv_${Date.now()}`;
            // Generate execution context for team
            const teamContext = {
                executionId: testConversationId,
                rootExecutionId: testConversationId,
                executionLevel: 0, // Team level
                executionPath: [],
                sourceType: 'team' as const,
                sourceId: baseExecutionId,
                toolName: 'team',
                parameters: {}
            };

            // Create context-bound EventService
            const contextBoundEventService = this.eventService.createContextBoundInstance &&
                typeof this.eventService.createContextBoundInstance === 'function'
                ? this.eventService.createContextBoundInstance(teamContext)
                : this.eventService;

            this.currentTeam = createTeam({
                aiProviders: aiProviders,
                eventService: contextBoundEventService, // 26번과 동일한 순서
                logger: this.logger
                // 🎯 26번과 동일: maxMembers, maxTokenLimit, debug 제거
            });

            console.log('🚀 [26-STRUCTURE] Team created with context-bound EventService');

            // 🔍 Team 초기화 디버깅
            console.log('🔍 [TEAM-DEBUG] Team Details:', {
                teamExists: !!this.currentTeam,
                teamName: this.currentTeam?.name,
                teamType: typeof this.currentTeam,
                hasExecuteMethod: typeof this.currentTeam?.execute === 'function',
                teamMethods: this.currentTeam ? Object.getOwnPropertyNames(Object.getPrototypeOf(this.currentTeam)) : []
            });

            // 🔍 Team tools 디버깅 - TeamContainer의 내부 teamAgent 접근
            try {
                // TeamContainer는 내부적으로 teamAgent를 가지고 있음
                const teamAgent = (this.currentTeam as any)?.teamAgent;
                if (teamAgent && typeof teamAgent.getAvailableTools === 'function') {
                    const tools = teamAgent.getAvailableTools();
                    console.log('🔍 [TEAM-TOOLS] Team agent available tools:', tools.map((t: any) => t.name || t.toolName || 'unnamed'));
                    const hasAssignTask = tools.some((t: any) => (t.name || t.toolName) === 'assignTask');
                    console.log('🔍 [TEAM-TOOLS] Has assignTask tool:', hasAssignTask);

                    // assignTask tool 상세 정보
                    const assignTaskTool = tools.find((t: any) => (t.name || t.toolName) === 'assignTask');
                    if (assignTaskTool) {
                        console.log('🔍 [TEAM-TOOLS] assignTask tool details:', {
                            name: assignTaskTool.name || assignTaskTool.toolName,
                            description: assignTaskTool.description,
                            hasHandler: typeof assignTaskTool.handler === 'function',
                            schema: assignTaskTool.schema
                        });
                    }
                } else {
                    console.log('🔍 [TEAM-TOOLS] Cannot access team agent tools');
                }
            } catch (error) {
                console.log('🔍 [TEAM-TOOLS] Error checking tools:', error);
            }

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
     * 🚫 DEPRECATED: Use execute() method instead for 26번 compatibility
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
     * 🎯 26번 예제와 동일한 단순 실행 구조
     */
    async execute(prompt: string, onChunk?: (chunk: string) => void): Promise<PlaygroundExecutionResult> {
        console.log('🚀 [26-DIRECT-EXECUTION] Direct team execution - same as example 26');

        // 🔍 [DEBUG] 현재 상태 확인
        console.log('🔍 [MODE-DEBUG] Current state:', {
            mode: this.mode,
            hasCurrentTeam: !!this.currentTeam,
            hasCurrentAgent: !!this.currentAgent,
            teamType: this.currentTeam?.constructor.name,
            agentType: this.currentAgent?.constructor.name
        });

        // 🔍 [TOOL-DEBUG] Team Agent tools 확인
        try {
            const teamAgent = (this.currentTeam as any)?.teamAgent;
            if (teamAgent) {
                console.log('🔍 [TOOL-DEBUG] TeamAgent found:', {
                    name: teamAgent.name,
                    isInitialized: teamAgent.isFullyInitialized,
                    hasToolsManager: !!teamAgent.tools,
                    availableMethods: Object.getOwnPropertyNames(Object.getPrototypeOf(teamAgent))
                });

                // Robota Agent의 올바른 방법 사용
                if (teamAgent.tools && typeof teamAgent.tools.getTools === 'function') {
                    const tools = teamAgent.tools.getTools();
                    console.log('🔍 [TOOL-DEBUG] Team agent tools:', tools.map((t: any) => ({
                        name: t.name || t.toolName,
                        description: t.description,
                        hasSchema: !!t.schema
                    })));

                    // assignTask tool 특별 확인
                    const assignTaskTool = tools.find((t: any) => (t.name || t.toolName) === 'assignTask');
                    if (assignTaskTool) {
                        console.log('🔍 [TOOL-DEBUG] assignTask tool found:', {
                            name: assignTaskTool.name || assignTaskTool.toolName,
                            description: assignTaskTool.description,
                            schemaKeys: assignTaskTool.schema ? Object.keys(assignTaskTool.schema) : 'no schema'
                        });
                    } else {
                        console.log('❌ [TOOL-DEBUG] assignTask tool NOT FOUND!');
                    }
                } else {
                    console.log('❌ [TOOL-DEBUG] TeamAgent tools manager not available');
                }
            } else {
                console.log('❌ [TOOL-DEBUG] TeamAgent not found in currentTeam');
            }
        } catch (error) {
            console.log('🔍 [TOOL-DEBUG] Error checking tools:', error);
        }

        const startTime = Date.now();

        try {
            let result: string;

            if (this.mode === 'team' && this.currentTeam) {
                // 🎯 26번과 동일: 직접 team.execute() 호출
                console.log('🎯 [26-STRUCTURE] Direct team.execute() call');
                result = await this.currentTeam.execute(prompt);

                // 🔍 [TOOL-DEBUG] 실행 후 Team Agent tools 확인 (초기화 완료 후)
                try {
                    const teamAgent = (this.currentTeam as any)?.teamAgent;
                    if (teamAgent && teamAgent.isFullyInitialized) {
                        const tools = teamAgent.tools.getTools();
                        console.log('🔍 [TOOL-FLOW] Team agent tools after execution:', tools.map((t: any) => ({
                            name: t.name || t.toolName,
                            description: t.description,
                            hasSchema: !!t.schema
                        })));

                        const assignTaskTool = tools.find((t: any) => (t.name || t.toolName) === 'assignTask');
                        console.log('🔍 [TOOL-FLOW] assignTask tool detailed analysis:', {
                            found: !!assignTaskTool,
                            details: assignTaskTool ? {
                                name: assignTaskTool.name,
                                description: assignTaskTool.description,
                                schemaType: typeof assignTaskTool.schema,
                                schemaContent: assignTaskTool.schema,
                                schemaKeys: assignTaskTool.schema ? Object.keys(assignTaskTool.schema) : 'no schema',
                                toolType: assignTaskTool.constructor?.name,
                                hasParameters: !!(assignTaskTool.schema?.parameters)
                            } : 'NOT FOUND'
                        });
                    }
                } catch (error) {
                    console.log('🔍 [POST-EXECUTION-TOOLS] Error:', error);
                }
            } else if (this.mode === 'agent' && this.currentAgent) {
                // 🎯 Agent도 동일하게 직접 호출
                console.log('🎯 [26-STRUCTURE] Direct agent.run() call');
                result = await this.currentAgent.run(prompt);
            } else {
                console.error('❌ [MODE-ERROR] No active executor found:', {
                    mode: this.mode,
                    hasTeam: !!this.currentTeam,
                    hasAgent: !!this.currentAgent
                });
                throw new Error('No active team or agent to execute prompt');
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
                visualizationData: this.getVisualizationData()
            };

        } catch (error) {
            const duration = Date.now() - startTime;
            console.error('❌ [26-DIRECT-EXECUTION] Execution failed:', error);

            const executionResult: PlaygroundExecutionResult = {
                success: false,
                response: 'Execution failed',
                duration: duration,
                error: error instanceof Error ? error : new Error(String(error)),
                visualizationData: this.getVisualizationData()
            };
            throw executionResult.error;
        }
    }

    /**
     * Execute with streaming response (Facade method)
     * 🚫 DEPRECATED: Use execute() method instead for 26번 compatibility
     */
    async *runStream(prompt: string): AsyncGenerator<string, PlaygroundExecutionResult> {
        const startTime = Date.now();
        const request: UniversalMessage[] = [{ role: 'user', content: prompt }];

        try {
            let fullResponse = '';

            // ✅ executeChatStream의 모든 UniversalMessage를 수집
            for await (const chunk of this.executeChatStream(request)) {
                const content = chunk.content || '';
                fullResponse += content;
                // ❌ 각 UniversalMessage마다 yield하지 않음
            }

            // ✅ 최종 완성된 응답만 한 번 yield
            yield fullResponse;

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
    getVisualizationData(): VisualizationData {
        return this.historyPlugin.getVisualizationData();
    }

    /**
     * Get all playground events from PlaygroundHistoryPlugin
     * These events include all EventService events (execution.*, tool_call_*, task.*)
     */
    getPlaygroundEvents(): ConversationEvent[] {
        return this.historyPlugin.getAllEvents();
    }



    /**
     * Create ToolHooks using EventService for assignTask instrumentation
     */
    private createEventServiceToolHooks(): any {
        return EventServiceHookFactory.createToolHooks(this.eventService, 'team-assignTask');
    }

    /**
     * Get conversation history from current agent/team
     */
    getHistory(): UniversalMessage[] {
        if (this.mode === 'agent' && this.currentAgent) {
            return this.currentAgent.getHistory();
        } else if (this.mode === 'team' && this.currentTeam) {
            // ✅ Use TeamContainer's teamAgent getHistory() - follows SDK architecture
            return (this.currentTeam as any).getHistory();
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

            if (this.currentTeam) {
                // TeamContainer doesn't have dispose method
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

        // Debug: Log current execution state
        console.log('🔍 PlaygroundExecutor.executeChat debug:', {
            mode: this.mode,
            hasAgent: !!this.currentAgent,
            hasTeam: !!this.currentTeam,
            message: messages[0]?.content?.substring(0, 50) + '...'
        });

        try {
            // Record execution start
            await this.recordExecutionStart(executionId, messages);

            let response: UniversalMessage;

            if (this.mode === 'agent' && this.currentAgent) {
                console.log('✅ Executing in AGENT mode');
                const prompt = messages[0].content || '';
                const result = await this.currentAgent.run(prompt);
                response = {
                    role: 'assistant',
                    content: result,
                    timestamp: new Date()
                } as UniversalMessage;

            } else if (this.mode === 'team' && this.currentTeam) {
                console.log('✅ [TEAM] Executing in TEAM mode');
                console.log('✅ [TEAM] Current team object:', !!this.currentTeam);
                console.log('✅ [TEAM] User prompt:', messages[0].content);

                // 🎯 Team Level 사용자 메시지 기록
                this.historyPlugin.recordEvent({
                    type: 'user_message',
                    content: messages[0].content || '',
                    metadata: { level: 'team', action: 'execute_start' }
                });

                console.log('🔥 [TEAM] About to call team.execute() method with prompt:', messages[0].content);
                console.log('🔥 [TEAM] Team object type:', this.currentTeam.constructor.name);

                const result = await this.currentTeam.execute(messages[0].content || '');

                console.log('🔥 [TEAM] Team execution completed with result length:', typeof result === 'string' ? result.length : 'non-string');
                console.log('🔥 [TEAM] Team execution result preview:', typeof result === 'string' ? result.substring(0, 100) + '...' : result);

                // 🎯 Team Level 응답 메시지 기록  
                this.historyPlugin.recordEvent({
                    type: 'assistant_response',
                    content: typeof result === 'string' ? result : JSON.stringify(result),
                    metadata: { level: 'team', action: 'execute_complete' }
                });

                response = {
                    role: 'assistant',
                    content: typeof result === 'string' ? result : JSON.stringify(result),
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
            console.log('🚀 [CRITICAL] Current execution state:', {
                mode: this.mode,
                hasAgent: !!this.currentAgent,
                hasTeam: !!this.currentTeam,
                agentType: this.currentAgent?.constructor?.name,
                teamType: this.currentTeam?.constructor?.name
            });

            // Record execution start
            await this.recordExecutionStart(executionId, messages);

            if (this.mode === 'agent' && this.currentAgent) {
                console.log('📡 Starting agent stream...');
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
                } as UniversalMessage;

            } else if (this.mode === 'team' && this.currentTeam) {
                console.log('📡 Starting team stream...');
                const prompt = messages[0].content || '';
                console.log('🔥 [TEAM-STREAM] About to call currentTeam.executeStream()');
                console.log('🔥 [TEAM-STREAM] currentTeam type:', this.currentTeam.constructor.name);
                console.log('🔥 [TEAM-STREAM] currentTeam prototype:', Object.getPrototypeOf(this.currentTeam).constructor.name);
                console.log('🔥 [TEAM-STREAM] executeStream method exists:', typeof this.currentTeam.executeStream);
                console.log('🔥 [TEAM-STREAM] currentTeam methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(this.currentTeam)));

                // ❌ Team Level 사용자 메시지 기록 제거 (PlaygroundTeamInstance에서 이미 기록함)
                // this.historyPlugin.recordEvent({
                //     type: 'user_message',
                //     content: prompt,
                //     metadata: { level: 'team', action: 'stream_start' }
                // });

                console.log('🔥 [TEAM-STREAM] Calling executeStream now...');
                const stream = this.currentTeam.executeStream(prompt);
                console.log('🔥 [TEAM-STREAM] executeStream called, got stream:', !!stream);

                // 🕵️ Deep object analysis
                console.log('🕵️ [DEEP-ANALYSIS] currentTeam object details:');
                console.log('🕵️ Constructor:', this.currentTeam.constructor);
                console.log('🕵️ Constructor name:', this.currentTeam.constructor.name);
                console.log('🕵️ Prototype chain:', Object.getPrototypeOf(this.currentTeam));
                console.log('🕵️ executeStream function:', this.currentTeam.executeStream);
                console.log('🕵️ executeStream toString:', this.currentTeam.executeStream.toString().substring(0, 200));
                console.log('🕵️ Is proxy?', typeof Proxy !== 'undefined' && this.currentTeam.constructor === Object);
                console.log('🔥 [TEAM-STREAM] Starting to iterate over stream...');
                let fullResponse = '';

                // ✅ ExecutionService와 동일: 청크를 수집만 하고 최종에 한 번만 yield
                for await (const chunk of stream) {
                    console.log('🔥 [TEAM-STREAM] Received chunk:', chunk.length, 'chars');
                    fullResponse += chunk;
                    // ❌ 각 청크마다 yield하지 않음 (LocalExecutor와 동일하게)
                }
                console.log('🔥 [TEAM-STREAM] Stream iteration completed, total response:', fullResponse.length, 'chars');

                // ✅ 최종 완성된 메시지만 한 번 yield
                yield {
                    role: 'assistant',
                    content: fullResponse,
                    timestamp: new Date()
                } as UniversalMessage;

                // ❌ Team Level 응답 메시지 기록 제거 (PlaygroundTeamInstance에서 이미 기록함)
                // this.historyPlugin.recordEvent({
                //     type: 'assistant_response',
                //     content: fullResponse,
                //     metadata: { level: 'team', action: 'stream_complete' }
                // });

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
     * Get last execution ID for External Store connection
     */
    getLastExecutionId(): string | null {
        // For now, we'll generate a consistent ID based on current state
        // This should be improved to track actual execution IDs
        if (this.mode === 'team') {
            return 'team-execution-' + Date.now();
        } else if (this.mode === 'agent') {
            return 'agent-execution-' + Date.now();
        }
        return null;
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

        // 🎯 26번 예제와 동일: model 명시적 지정
        const openaiProvider = new OpenAIProvider({
            executor: remoteExecutor,
            model: 'gpt-4o-mini'  // 26번과 동일한 모델
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
        console.log(`🔧 [MODE] Setting mode to:`, mode);
        console.log(`🔧 [MODE] Previous mode:`, this.mode);

        // 🔍 [DEBUG] Mode 변경 추적
        const stack = new Error().stack?.split('\n').slice(1, 4).join('\n');
        console.log('🔍 [MODE-TRACE] Call stack:', stack);
        console.log('🔍 [MODE-STATE] Current state:', {
            hasCurrentTeam: !!this.currentTeam,
            hasCurrentAgent: !!this.currentAgent,
            newMode: mode
        });

        this.mode = mode;
        console.log(`🔧 [MODE] Mode set successfully to:`, this.mode);
        this.logDebug('Mode changed', { mode });
    }

    /**
     * STEP 7.1.3: Get current workflow from SDK
     */
    async getCurrentWorkflow(): Promise<any | null> {
        console.log('📊 [STEP 7.1.3] getCurrentWorkflow called');
        const result = await this.workflowBuilder.generateUniversalWorkflow();
        console.log('📊 [STEP 7.1.3] Workflow result:', result ? 'Success' : 'Null');
        return result;
    }

    /**
     * STEP 7.1.4: Subscribe to workflow updates from SDK
     */
    subscribeToWorkflowUpdates(callback: (workflow: any) => void): void {
        console.log('📡 [STEP 7.1.4] Setting up workflow subscription');
        this.workflowBuilder.subscribeToUniversalUpdates((workflow) => {
            console.log('📡 [STEP 7.1.4] Workflow update received:', !!workflow);
            callback(workflow);
        });
    }

    /**
     * STEP 8.3.3: Get External Workflow Store for manual node management
     */
    getExternalWorkflowStore(): ExternalWorkflowStore {
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
        private statisticsPlugin: PlaygroundStatisticsPlugin,
        private eventService: any // PlaygroundEventService
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
                },
                eventService: this.eventService // Pass EventService from PlaygroundExecutor
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
                type: 'execution.error', // Use valid event type
                content: error instanceof Error ? error.message : String(error),
                metadata: { teamName: this.config.name, action: 'execution_error' }
            });

            throw new Error(`Team execution failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    async *executeStream(prompt: string): AsyncGenerator<string, void, undefined> {
        if (!this.isInitialized) {
            await this.initialize();
        }

        if (!this.teamContainer) {
            throw new Error('Team not properly initialized for streaming');
        }

        try {
            console.log('Team streaming prompt:', prompt);

            // 🎯 Phase 2.2: Team Level 이벤트 기록 (Level 0)
            const teamUserEventId = this.historyPlugin.recordEvent({
                type: 'user_message',
                content: prompt,
                metadata: {
                    teamName: this.config.name,
                    action: 'streaming_start',
                    level: 'team'
                }
                // parentEventId 없음 (Level 0: Team level)
            });

            let fullResponse = '';

            // Execute using actual team container streaming
            // 🔧 여기서 teamContainer.executeStream이 내부적으로 assignTask를 호출하고
            // 각 Sub-Agent가 실행되면서 Hook을 통해 계층화된 이벤트들이 자동 기록됨
            for await (const chunk of this.teamContainer.executeStream(prompt)) {
                fullResponse += chunk;
                // ❌ 각 청크마다 yield하지 않음 (PlaygroundExecutor와 일관성 유지)
            }

            // ✅ 최종 완성된 응답만 한 번 yield
            yield fullResponse;

            // 🎯 Team Level 응답 이벤트 기록 (Level 0)
            this.historyPlugin.recordEvent({
                type: 'assistant_response',
                content: fullResponse,
                parentEventId: teamUserEventId, // Team의 user_message와 연결
                metadata: {
                    teamName: this.config.name,
                    action: 'streaming_success',
                    level: 'team'
                }
            });

        } catch (error) {
            console.error('Team streaming failed:', error);

            // Team Level 에러 이벤트 기록 (Level 0)
            this.historyPlugin.recordEvent({
                type: 'execution.error',
                content: error instanceof Error ? error.message : String(error),
                metadata: {
                    teamName: this.config.name,
                    action: 'streaming_error',
                    level: 'team'
                }
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

    /**
     * Get Event Service for external event listening
     * Used by PlaygroundContext to listen for tool_call_start and agent_created events
     */
    getEventService(): ActionTrackingEventService {
        return this.eventService;
    }
} 