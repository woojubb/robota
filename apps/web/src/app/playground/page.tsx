'use client';

/**
 * Playground Page - Complete Robota SDK Testing Environment
 * 
 * This is the main Playground interface that integrates all the components:
 * - PlaygroundContext for state management
 * - Visual configuration blocks for Agents and Teams
 * - Real-time chat interface with execution display
 * - WebSocket integration for live updates
 * - Tool and Plugin management
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
    Play,
    Pause,
    Square,
    Settings,
    Plus,
    Bot,
    Users,
    Zap,
    Puzzle,
    MessageCircle,
    MessageSquare,
    Activity,
    Wifi,
    WifiOff,
    AlertCircle,
    CheckCircle,
    Loader2,
    GitBranch
} from 'lucide-react';

// Context and Hooks
import { PlaygroundProvider, usePlayground } from '@/contexts/playground-context';
import { usePlaygroundData } from '@/hooks/use-playground-data';
import { useRobotaExecution } from '@/hooks/use-robota-execution';
import { useWebSocketConnection } from '@/hooks/use-websocket-connection';
import { useChatInput } from '@/hooks/use-chat-input';
import { useBlockTracking } from '@/hooks/use-block-tracking';
import { usePlaygroundStatistics } from '@/hooks/use-playground-statistics';

// Import our new execution tree components
import { ExecutionTreeDebug } from '@/components/playground/execution-tree-debug';
import { PlaygroundBlockCollector } from '@/lib/playground/block-tracking/block-collector';
import type { RealTimeBlockMessage } from '@/lib/playground/block-tracking/types';

// Visual Components
import { AgentConfigurationBlock } from '@/components/playground/agent-configuration-block';
import { TeamConfigurationBlock } from '@/components/playground/team-configuration-block';
import { ToolContainerBlock } from '@/components/playground/tool-container-block';
import { PluginContainerBlock } from '@/components/playground/plugin-container-block';
import { AuthDebug } from '@/components/debug/auth-debug';

// Types
import type {
    PlaygroundAgentConfig,
    PlaygroundTeamConfig,
    PlaygroundExecutionResult
} from '@/lib/playground/robota-executor';

// Configuration Panel Component
function ConfigurationPanel() {
    const { state } = usePlayground();
    const {
        createAgent,
        createTeam,
        currentMode,
        currentAgentConfig,
        currentTeamConfig,
        getDefaultAgentConfig,
        getDefaultTeamConfig,
        validateConfiguration,
        cancelExecution
    } = useRobotaExecution();

    const [activeConfigTab, setActiveConfigTab] = useState<'agent' | 'team'>('agent');
    // Local state for execution status
    const [isAgentRunning, setIsAgentRunning] = useState(false);
    const [isTeamRunning, setIsTeamRunning] = useState(false);

    // Create default configurations
    const handleCreateAgent = useCallback(async () => {
        const defaultConfig = getDefaultAgentConfig();
        await createAgent(defaultConfig);
    }, [createAgent, getDefaultAgentConfig]);

    const handleCreateTeam = useCallback(async () => {
        const defaultConfig = getDefaultTeamConfig();
        await createTeam(defaultConfig);
    }, [createTeam, getDefaultTeamConfig]);

    // Execution handlers
    const handleExecuteAgent = useCallback(async (config: PlaygroundAgentConfig) => {
        try {
            console.log('Activating agent for execution...');
            // First ensure the agent is created/updated
            await createAgent(config);

            // Set agent to running state
            setIsAgentRunning(true);
            console.log('Agent is now ready for execution');
        } catch (error) {
            console.error('Failed to activate agent:', error);
        }
    }, [createAgent]);

    const handleExecuteTeam = useCallback(async (config: PlaygroundTeamConfig) => {
        try {
            console.log('Activating team for execution...');
            // First ensure the team is created/updated
            await createTeam(config);

            // Set team to running state
            setIsTeamRunning(true);
            console.log('Team is now ready for execution');
        } catch (error) {
            console.error('Failed to activate team:', error);
        }
    }, [createTeam]);

    const handleStopExecution = useCallback(() => {
        console.log('Stopping execution...');
        setIsAgentRunning(false);
        setIsTeamRunning(false);
    }, []);

    // Sync global execution state with local agent running state
    const effectiveIsExecuting = currentMode === 'agent' ? isAgentRunning : isTeamRunning;

    // Reset local running state when global execution starts
    useEffect(() => {
        if (state.isExecuting && isAgentRunning) {
            console.log('Global execution started, transitioning from local to global state');
            setIsAgentRunning(false);
        }
    }, [state.isExecuting, isAgentRunning]);

    return (
        <Card className="h-full">
            <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Settings className="h-4 w-4" />
                    Configuration
                </CardTitle>

                <Tabs value={activeConfigTab} onValueChange={(value) => setActiveConfigTab(value as 'agent' | 'team')}>
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="agent" className="flex items-center gap-1 text-xs">
                            <Bot className="h-3 w-3" />
                            Agent
                        </TabsTrigger>
                        <TabsTrigger value="team" className="flex items-center gap-1 text-xs">
                            <Users className="h-3 w-3" />
                            Team
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </CardHeader>

            <CardContent className="pt-0">
                <Tabs value={activeConfigTab}>
                    {/* Agent Configuration */}
                    <TabsContent value="agent" className="space-y-3 mt-0">
                        {currentAgentConfig ? (
                            <AgentConfigurationBlock
                                config={currentAgentConfig}
                                isActive={currentMode === 'agent'}
                                isExecuting={effectiveIsExecuting}
                                onConfigChange={createAgent}
                                onExecute={handleExecuteAgent}
                                onStop={handleStopExecution}
                                className="w-full"
                            />
                        ) : (
                            <div className="text-center py-6">
                                <Bot className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                <p className="text-sm text-gray-500 mb-3">No agent configured</p>
                                <Button
                                    size="sm"
                                    onClick={handleCreateAgent}
                                    className="flex items-center gap-2"
                                >
                                    <Plus className="h-3 w-3" />
                                    Create Agent
                                </Button>
                            </div>
                        )}
                    </TabsContent>

                    {/* Team Configuration */}
                    <TabsContent value="team" className="space-y-3 mt-0">
                        {currentTeamConfig ? (
                            <TeamConfigurationBlock
                                config={currentTeamConfig}
                                isActive={currentMode === 'team'}
                                isExecuting={effectiveIsExecuting}
                                onConfigChange={createTeam}
                                onExecute={handleExecuteTeam}
                                onStop={handleStopExecution}
                                className="w-full"
                            />
                        ) : (
                            <div className="text-center py-6">
                                <Users className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                <p className="text-sm text-gray-500 mb-3">No team configured</p>
                                <Button
                                    size="sm"
                                    onClick={handleCreateTeam}
                                    className="flex items-center gap-2"
                                >
                                    <Plus className="h-3 w-3" />
                                    Create Team
                                </Button>
                            </div>
                        )}
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
}

// Chat Input Component - Input Only (No Chat History)
function ChatInputPanel() {
    const { state } = usePlayground();
    const { executePrompt, executeStreamPrompt, isExecuting } = useRobotaExecution();
    const {
        inputState,
        setValue,
        sendMessage,
        sendStreamingMessage,
        inputRef,
        canSend
    } = useChatInput();

    const [useStreaming, setUseStreaming] = useState(true);

    // Handle message sending
    const handleSendMessage = useCallback(async () => {
        if (!canSend || !inputState.value.trim()) return;

        try {
            if (useStreaming) {
                await sendStreamingMessage(inputState.value);
            } else {
                await sendMessage(inputState.value);
            }
        } catch (error) {
            console.error('Failed to send message:', error);
        }
    }, [canSend, inputState.value, useStreaming, sendStreamingMessage, sendMessage]);

    const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    }, [handleSendMessage]);

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="pb-3 flex-shrink-0">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <MessageCircle className="h-4 w-4" />
                    Chat Input
                </CardTitle>
                <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                        {state.mode === 'agent' ? 'Agent Mode' : 'Team Mode'}
                    </Badge>
                    {isExecuting && (
                        <Badge variant="secondary" className="text-xs animate-pulse">
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Executing
                        </Badge>
                    )}
                </div>
            </CardHeader>

            <CardContent className="flex-1 flex flex-col gap-3 min-h-0 pt-0">
                {/* Input Section */}
                <div className="flex-shrink-0 space-y-3">
                    {/* Controls */}
                    <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={useStreaming}
                                    onChange={(e) => setUseStreaming(e.target.checked)}
                                    className="w-3 h-3"
                                />
                                <span>Streaming</span>
                            </label>
                        </div>

                        <div className="flex items-center gap-2 text-gray-500">
                            <span>{inputState.characterCount}/4000</span>
                            <span>•</span>
                            <span>{inputState.wordCount} words</span>
                            <span>•</span>
                            <span>{inputState.estimatedTokens} tokens</span>
                        </div>
                    </div>

                    {/* Input Field */}
                    <div className="flex gap-2">
                        <Textarea
                            ref={inputRef}
                            value={inputState.value}
                            onChange={(e) => setValue(e.target.value)}
                            onKeyPress={handleKeyPress}
                            placeholder="Type your message here... (Press Enter to send, Shift+Enter for new line)"
                            className="flex-1 min-h-[120px] resize-none"
                            disabled={isExecuting}
                        />

                        <div className="flex flex-col gap-2">
                            <Button
                                onClick={handleSendMessage}
                                disabled={!canSend || isExecuting}
                                size="sm"
                                className="px-3"
                            >
                                {isExecuting ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Play className="h-4 w-4" />
                                )}
                            </Button>

                            {isExecuting && (
                                <Button
                                    onClick={() => { }} // TODO: Implement stop execution
                                    variant="outline"
                                    size="sm"
                                    className="px-3"
                                >
                                    <Square className="h-4 w-4" />
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* Validation Errors */}
                    {inputState.errors.length > 0 && (
                        <div className="text-xs text-red-600">
                            {inputState.errors.map((error, index) => (
                                <div key={index} className="flex items-center gap-1">
                                    <AlertCircle className="h-3 w-3" />
                                    {error}
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Empty space for future features */}
                <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                    <div className="text-center">
                        <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-30" />
                        <p>Chat history removed</p>
                        <p className="text-xs">Focus on Block Tree</p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}

// Connection Status Component
function SystemStatusPanel() {
    const { state } = usePlayground();
    const {
        chatExecutions,
        errorCount,
        averageResponseTime,
        successRate,
        agentExecutions,
        teamExecutions,
        isActive,
        formattedResponseTime,
        isLoading
    } = usePlaygroundStatistics();

    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    System Status
                </CardTitle>
            </CardHeader>

            <CardContent className="pt-0 space-y-2">
                {/* Compact Status Grid */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                    {/* Connection Status */}
                    <div className="flex items-center gap-1">
                        {state.isInitialized ? (
                            <>
                                <CheckCircle className="h-3 w-3 text-green-500" />
                                <span className="text-green-600">Ready</span>
                            </>
                        ) : (
                            <>
                                <AlertCircle className="h-3 w-3 text-orange-500" />
                                <span className="text-orange-600">Init...</span>
                            </>
                        )}
                    </div>

                    {/* Execution Status */}
                    <div className="flex items-center gap-1">
                        {state.isExecuting || isActive ? (
                            <>
                                <Loader2 className="h-3 w-3 text-blue-500 animate-spin" />
                                <span className="text-blue-600">Running</span>
                            </>
                        ) : chatExecutions > 0 ? (
                            <>
                                <CheckCircle className="h-3 w-3 text-green-500" />
                                <span className="text-green-600">Idle</span>
                            </>
                        ) : (
                            <>
                                <AlertCircle className="h-3 w-3 text-gray-500" />
                                <span className="text-gray-600">Ready</span>
                            </>
                        )}
                    </div>
                </div>

                {/* Enhanced Statistics */}
                <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                    <div>Total: {chatExecutions}</div>
                    <div>Success: {Math.round(successRate)}%</div>
                    <div>Agent: {agentExecutions}</div>
                    <div>Team: {teamExecutions}</div>
                </div>

                {/* Response Time */}
                {averageResponseTime > 0 && (
                    <div className="text-xs text-gray-500 text-center">
                        Avg Response: {formattedResponseTime}
                    </div>
                )}

                {/* Error Count - Only when present */}
                {errorCount > 0 && (
                    <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                        <div className="flex items-center gap-1 font-medium">
                            <AlertCircle className="h-3 w-3" />
                            Errors: {errorCount}
                        </div>
                    </div>
                )}

                {/* Current Error Display */}
                {state.error && (
                    <div className="p-2 bg-orange-50 border border-orange-200 rounded text-xs text-orange-700">
                        <div className="flex items-center gap-1 font-medium">
                            <AlertCircle className="h-3 w-3" />
                            Current Error
                        </div>
                        <div className="mt-1 truncate" title={state.error}>
                            {state.error}
                        </div>
                    </div>
                )}

                {/* Loading State */}
                {isLoading && (
                    <div className="text-xs text-gray-400 text-center">
                        Loading statistics...
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// Main Content Component (requires PlaygroundProvider)
function PlaygroundContent() {
    const { state } = usePlayground();

    return (
        <div className="container mx-auto p-6 min-h-screen flex flex-col space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between flex-shrink-0">
                <div>
                    <h1 className="text-3xl font-bold">Robota Playground</h1>
                    <p className="text-gray-600">Build, test, and deploy intelligent agents</p>
                </div>
                <Badge variant={state.isInitialized ? "default" : "secondary"}>
                    {state.isInitialized ? "Ready" : "Initializing"}
                </Badge>
            </div>

            {/* Top Row - Configuration Banner */}
            <div className="flex-shrink-0">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <ConfigurationPanel />
                    <SystemStatusPanel />
                    <AuthDebug />
                </div>
            </div>

            {/* Main Content - Chat Input + Execution Tree */}
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 flex-grow min-h-0">
                {/* Left Column - Chat Input Only (1/4 width) */}
                <div className="lg:col-span-1 min-h-0">
                    <ChatInputPanel />
                </div>

                {/* Right Column - Execution Tree (3/4 width) */}
                <div className="lg:col-span-3 min-h-0">
                    <ExecutionTreePanel />
                </div>
            </div>

            {/* Bottom Row - Block Visualization (Full Width) */}
            <div className="w-full flex-shrink-0">
                <BlockVisualizationPanel />
            </div>
        </div>
    );
}

// Temporary implementation of missing components
function ToolsAndPluginsPanel() {
    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Puzzle className="h-4 w-4" />
                    Tools & Plugins
                </CardTitle>
            </CardHeader>
            <CardContent>
                <p className="text-sm text-gray-500">Coming soon...</p>
            </CardContent>
        </Card>
    );
}

// 🧪 New Execution Tree Panel with Demo Capabilities
function ExecutionTreePanel() {
    const [blockCollector] = useState(() => new PlaygroundBlockCollector());
    const { conversationEvents } = usePlaygroundData();

    // Convert conversation events to our block format
    useEffect(() => {
        if (conversationEvents.length > 0) {
            // Clear existing blocks first
            blockCollector.clearBlocks();

            // Convert each conversation event to our block format
            conversationEvents.forEach((event, index) => {
                const blockMessage: RealTimeBlockMessage = {
                    role: event.type === 'user_message' ? 'user' :
                        event.type === 'assistant_response' ? 'assistant' :
                            (event.type === 'tool_call_start' || event.type === 'tool_call_complete' || event.type === 'tool_call_error') ? 'tool' :
                                (event.type === 'subtool.call_start' || event.type === 'subtool.call_complete' || event.type === 'subtool.call_error') ? 'tool' :
                                    (event.type === 'execution.start' || event.type === 'execution.complete' || event.type === 'execution.error') ? 'assistant' :
                                        (event.type === 'agent.creation_start' || event.type === 'agent.creation_complete') ? 'system' :
                                            (event.type === 'agent.execution_start' || event.type === 'agent.execution_complete') ? 'assistant' :
                                                (event.type === 'team.analysis_start' || event.type === 'team.analysis_complete') ? 'system' :
                                                    (event.type === 'task.aggregation_start' || event.type === 'task.aggregation_complete') ? 'system' :
                                                        (event.type === 'task.assigned' || event.type === 'task.completed') ? 'system' : 'system',
                    content: event.content || '',
                    timestamp: event.timestamp,
                    blockMetadata: {
                        id: event.id,
                        type: event.type === 'user_message' ? 'user' :
                            event.type === 'assistant_response' ? 'assistant' :
                                event.type === 'tool_call_start' ? 'tool_call' :
                                    event.type === 'tool_call_complete' ? 'tool_result' :
                                        event.type === 'subtool.call_start' ? 'tool_call' :
                                            event.type === 'subtool.call_complete' ? 'tool_result' :
                                                (event.type === 'tool_call_error' || event.type === 'subtool.call_error' || event.type === 'execution.error') ? 'error' :
                                                    (event.type === 'execution.start' || event.type === 'execution.complete') ? 'assistant' :
                                                        (event.type === 'agent.execution_start' || event.type === 'agent.execution_complete') ? 'assistant' :
                                                            (event.type === 'team.analysis_start' || event.type === 'team.analysis_complete' ||
                                                                event.type === 'agent.creation_start' || event.type === 'agent.creation_complete' ||
                                                                event.type === 'task.aggregation_start' || event.type === 'task.aggregation_complete' ||
                                                                event.type === 'task.assigned' || event.type === 'task.completed') ? 'group' : 'group',
                        level: event.executionLevel || 0,
                        parentId: event.parentEventId,
                        children: event.childEventIds || [],
                        isExpanded: true,
                        visualState: 'completed',
                        startTime: event.timestamp,
                        endTime: event.timestamp,
                        actualDuration: 0,
                        executionHierarchy: {
                            level: event.executionLevel || 0,
                            path: event.executionPath ? event.executionPath.split('/') : [],
                            parentExecutionId: event.parentEventId,
                            rootExecutionId: event.delegationId || event.id
                        },
                        executionContext: {
                            timestamp: event.timestamp,
                            toolName: event.toolName,
                            executionId: event.id
                        }
                    }
                };

                blockCollector.collectBlock(blockMessage);
            });
        }
    }, [conversationEvents, blockCollector]);

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="pb-3 flex-shrink-0">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <GitBranch className="h-4 w-4 text-blue-500" />
                    Execution Tree Debug
                    <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 ml-auto">
                        New!
                    </Badge>
                </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 pt-0 pb-3 min-h-0">
                <div className="h-full overflow-hidden">
                    <ExecutionTreeDebug
                        blockCollector={blockCollector}
                        refreshInterval={1000}
                    />
                </div>
            </CardContent>
        </Card>
    );
}

// 🎯 계층 구조 기반 Block Visualization Panel
function BlockVisualizationPanel() {
    const { conversationEvents } = usePlaygroundData();

    // 이벤트 타입별 색상 및 아이콘 매핑
    const getEventStyle = (event: any) => {
        switch (event.type) {
            case 'user_message':
                return {
                    bg: 'bg-blue-50 border-blue-200',
                    text: 'text-blue-800',
                    icon: '👤',
                    label: 'User'
                };
            case 'assistant_response':
                return {
                    bg: 'bg-green-50 border-green-200',
                    text: 'text-green-800',
                    icon: '🤖',
                    label: 'Assistant'
                };
            case 'tool_call':
                return {
                    bg: 'bg-orange-50 border-orange-200',
                    text: 'text-orange-800',
                    icon: '🔧',
                    label: 'Tool Call'
                };
            case 'tool_result':
                return {
                    bg: 'bg-purple-50 border-purple-200',
                    text: 'text-purple-800',
                    icon: '✅',
                    label: 'Tool Result'
                };
            case 'error':
                return {
                    bg: 'bg-red-50 border-red-200',
                    text: 'text-red-800',
                    icon: '❌',
                    label: 'Error'
                };
            default:
                return {
                    bg: 'bg-gray-50 border-gray-200',
                    text: 'text-gray-800',
                    icon: '📄',
                    label: 'Unknown'
                };
        }
    };

    // 계층별 들여쓰기 렌더링
    const renderEventBlock = (event: any, index: number) => {
        const style = getEventStyle(event);
        const level = event.executionLevel || 0;
        const marginLeft = level * 20; // 레벨당 20px 들여쓰기

        return (
            <div
                key={event.id || index}
                style={{ marginLeft: `${marginLeft}px` }}
                className={`p-3 rounded-lg border ${style.bg} mb-2 transition-all duration-200 hover:shadow-sm`}
            >
                {/* 이벤트 헤더 */}
                <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                        <span className="text-lg">{style.icon}</span>
                        <span className={`text-xs font-medium ${style.text}`}>
                            {style.label}
                        </span>
                        {event.executionLevel !== undefined && (
                            <span className="text-xs bg-gray-200 px-2 py-1 rounded">
                                Level {event.executionLevel}
                            </span>
                        )}
                    </div>
                    <span className="text-xs text-gray-500">
                        {event.timestamp?.toLocaleTimeString() || 'Unknown time'}
                    </span>
                </div>

                {/* 실행 경로 표시 */}
                {event.executionPath && (
                    <div className="text-xs text-gray-600 mb-2 font-mono bg-gray-100 px-2 py-1 rounded">
                        Path: {event.executionPath}
                    </div>
                )}

                {/* 이벤트 내용 */}
                <div className="text-sm">{event.content || 'No content'}</div>

                {/* Tool 관련 정보 */}
                {event.toolName && (
                    <div className="mt-2 text-xs text-gray-600">
                        <strong>Tool:</strong> {event.toolName}
                    </div>
                )}

                {/* Delegation ID 표시 */}
                {event.delegationId && (
                    <div className="mt-1 text-xs text-gray-500">
                        <strong>Delegation:</strong> {event.delegationId}
                    </div>
                )}

                {/* 계층 정보 */}
                {event.parentEventId && (
                    <div className="mt-1 text-xs text-gray-500">
                        <strong>Parent:</strong> {event.parentEventId}
                    </div>
                )}
            </div>
        );
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                    <Puzzle className="h-4 w-4" />
                    Block Visualization
                    <span className="text-xs text-gray-500 ml-2">
                        ({conversationEvents.length} events)
                    </span>
                </CardTitle>
            </CardHeader>
            <CardContent>
                <ScrollArea className="h-64">
                    <div className="space-y-1">
                        {conversationEvents.map((event, index) => renderEventBlock(event, index))}
                        {conversationEvents.length === 0 && (
                            <div className="text-center text-gray-500 py-8">
                                No conversation blocks yet
                                <div className="text-xs mt-2">
                                    Start a conversation to see the hierarchical block structure
                                </div>
                            </div>
                        )}
                    </div>
                </ScrollArea>
            </CardContent>
        </Card>
    );
}

// Main Playground Page with Provider
export default function PlaygroundPage() {
    return (
        <PlaygroundProvider defaultServerUrl="ws://localhost:3001/ws">
            <PlaygroundContent />
        </PlaygroundProvider>
    );
} 