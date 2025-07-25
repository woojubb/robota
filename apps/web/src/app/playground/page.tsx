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
    Activity,
    Wifi,
    WifiOff,
    AlertCircle,
    CheckCircle,
    Loader2
} from 'lucide-react';

// Context and Hooks
import { PlaygroundProvider, usePlayground } from '@/contexts/playground-context';
import { usePlaygroundData } from '@/hooks/use-playground-data';
import { useRobotaExecution } from '@/hooks/use-robota-execution';
import { useWebSocketConnection } from '@/hooks/use-websocket-connection';
import { useChatInput } from '@/hooks/use-chat-input';
import { useBlockTracking } from '@/hooks/use-block-tracking';

// Visual Components
import { AgentConfigurationBlock } from '@/components/playground/agent-configuration-block';
import { TeamConfigurationBlock } from '@/components/playground/team-configuration-block';
import { BlockVisualizationPanel } from '@/components/playground/block-visualization';
import { ToolContainerBlock } from '@/components/playground/tool-container-block';
import { PluginContainerBlock } from '@/components/playground/plugin-container-block';

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
    const [isAgentRunning, setIsAgentRunning] = useState(false);

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

    const handleStopExecution = useCallback(() => {
        console.log('Stopping agent execution...');
        cancelExecution();
        setIsAgentRunning(false);
    }, [cancelExecution]);

    // Sync global execution state with local agent running state
    const effectiveIsExecuting = state.isExecuting || isAgentRunning;

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

// Chat Interface Component
function ChatInterfacePanel({ blockTracking }: { blockTracking: any }) {
    const { state } = usePlayground();
    const { executePrompt, executeStreamPrompt, isExecuting, lastResult } = useRobotaExecution();
    const { conversationEvents } = usePlaygroundData();
    const {
        inputState,
        setValue,
        sendMessage,
        sendStreamingMessage,
        streamingResponse,
        isReceivingStream,
        inputRef,
        canSend
    } = useChatInput();

    const [useStreaming, setUseStreaming] = useState(true);
    const lastResultRef = useRef(lastResult);

    // Monitor lastResult changes and create assistant blocks
    useEffect(() => {
        if (lastResult && lastResult !== lastResultRef.current && lastResult.response) {
            if (blockTracking?.blockCollector) {
                const assistantBlock = blockTracking.blockCollector.createGroupBlock(
                    'assistant',
                    lastResult.response,
                    undefined,
                    0
                );

                blockTracking.blockCollector.updateBlock(assistantBlock.blockMetadata.id, {
                    visualState: 'completed'
                });

                console.log('Assistant response block created:', assistantBlock.blockMetadata.id);
            }
        }
        lastResultRef.current = lastResult;
    }, [lastResult, blockTracking]);

    const handleSendMessage = useCallback(async () => {
        if (!canSend) return;

        const messageText = inputState.value.trim();
        if (!messageText) return;

        // Create user message block
        let userBlockId: string | undefined;
        if (blockTracking?.blockCollector) {
            const userBlock = blockTracking.blockCollector.createGroupBlock(
                'user',
                messageText,
                undefined,
                0
            );
            userBlockId = userBlock.blockMetadata.id;
            console.log('User message block created:', userBlockId);
        }

        try {
            let result: any;
            if (useStreaming) {
                result = await sendStreamingMessage();
            } else {
                result = await sendMessage();
            }

            // Assistant response block will be created by useEffect when lastResult updates

        } catch (error) {
            console.error('Failed to send message:', error);

            // Create error block if message sending fails
            if (blockTracking?.blockCollector) {
                const errorBlock = blockTracking.blockCollector.createGroupBlock(
                    'group',
                    `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    undefined,
                    0
                );

                blockTracking.blockCollector.updateBlock(errorBlock.blockMetadata.id, {
                    visualState: 'error',
                    type: 'error'
                });
            }
        }
    }, [canSend, inputState.value, useStreaming, sendStreamingMessage, sendMessage, blockTracking, lastResult]);

    const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    }, [handleSendMessage]);

    return (
        <Card className="h-full flex flex-col">
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-sm font-semibold flex items-center gap-2">
                        <MessageCircle className="h-4 w-4" />
                        Chat Interface
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
                </div>
            </CardHeader>

            <CardContent className="pt-0 flex-1 flex flex-col">
                {/* Chat History */}
                <div className="flex-1 mb-4">
                    <ScrollArea className="h-80 border rounded p-3">
                        {conversationEvents.length === 0 ? (
                            <div className="text-center py-6 text-sm text-gray-500">
                                <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                                <p>No conversation yet</p>
                                <p className="text-xs">Send a message to start</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {conversationEvents.map((event) => (
                                    <div key={event.id} className="space-y-2">
                                        <div className="flex items-center gap-2 text-xs text-gray-500">
                                            <Badge variant="outline" className="text-xs">
                                                {event.type.replace('_', ' ')}
                                            </Badge>
                                            <span>{event.timestamp.toLocaleTimeString()}</span>
                                        </div>
                                        <div className={`
                      p-3 rounded-lg text-sm
                      ${event.type === 'user_message' ? 'bg-blue-50 border-l-4 border-blue-500' : ''}
                      ${event.type === 'assistant_response' ? 'bg-green-50 border-l-4 border-green-500' : ''}
                      ${event.type === 'error' ? 'bg-red-50 border-l-4 border-red-500' : ''}
                      ${event.type === 'tool_call' ? 'bg-orange-50 border-l-4 border-orange-500' : ''}
                    `}>
                                            {event.content}
                                        </div>
                                    </div>
                                ))}

                                {/* Streaming Response */}
                                {isReceivingStream && streamingResponse && (
                                    <div className="space-y-2">
                                        <div className="flex items-center gap-2 text-xs text-gray-500">
                                            <Badge variant="secondary" className="text-xs animate-pulse">
                                                Streaming
                                            </Badge>
                                            <span>{new Date().toLocaleTimeString()}</span>
                                        </div>
                                        <div className="p-3 rounded-lg text-sm bg-green-50 border-l-4 border-green-500">
                                            {streamingResponse}
                                            <span className="inline-block w-2 h-4 bg-green-500 ml-1 animate-pulse" />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </ScrollArea>
                </div>

                {/* Input Area */}
                <div className="space-y-3">
                    {/* Input Controls */}
                    <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1">
                                <input
                                    type="checkbox"
                                    checked={useStreaming}
                                    onChange={(e) => setUseStreaming(e.target.checked)}
                                    className="rounded"
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
                            className="flex-1 min-h-[80px] resize-none"
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
            </CardContent>
        </Card>
    );
}

// Connection Status Component
function ConnectionStatusPanel() {
    const { state } = usePlayground();
    const { connectionState, connectionInfo, statistics } = useWebSocketConnection();

    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Activity className="h-4 w-4" />
                    System Status
                </CardTitle>
            </CardHeader>

            <CardContent className="pt-0 space-y-3">
                {/* Connection Status */}
                <div className="flex items-center justify-between">
                    <Label className="text-xs">Connection</Label>
                    <div className="flex items-center gap-1">
                        {state.isWebSocketConnected ? (
                            <>
                                <Wifi className="h-3 w-3 text-green-500" />
                                <span className="text-xs text-green-600">Connected</span>
                            </>
                        ) : (
                            <>
                                <WifiOff className="h-3 w-3 text-red-500" />
                                <span className="text-xs text-red-600">Disconnected</span>
                            </>
                        )}
                    </div>
                </div>

                {/* Executor Status */}
                <div className="flex items-center justify-between">
                    <Label className="text-xs">Executor</Label>
                    <div className="flex items-center gap-1">
                        {state.isInitialized ? (
                            <>
                                <CheckCircle className="h-3 w-3 text-green-500" />
                                <span className="text-xs text-green-600">Ready</span>
                            </>
                        ) : (
                            <>
                                <AlertCircle className="h-3 w-3 text-orange-500" />
                                <span className="text-xs text-orange-600">Initializing</span>
                            </>
                        )}
                    </div>
                </div>

                {/* Server URL */}
                {state.serverUrl && (
                    <div className="space-y-1">
                        <Label className="text-xs">Server</Label>
                        <div className="text-xs text-gray-600 font-mono bg-gray-50 p-1 rounded">
                            {state.serverUrl}
                        </div>
                    </div>
                )}

                {/* Statistics */}
                <Separator />
                <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                        <Label className="text-xs text-gray-500">Messages Sent</Label>
                        <div className="font-semibold">{statistics.messagesSent}</div>
                    </div>
                    <div>
                        <Label className="text-xs text-gray-500">Messages Received</Label>
                        <div className="font-semibold">{statistics.messagesReceived}</div>
                    </div>
                </div>

                {/* Error Display */}
                {state.error && (
                    <div className="p-2 bg-red-50 border border-red-200 rounded text-xs text-red-700">
                        <div className="flex items-center gap-1 font-medium">
                            <AlertCircle className="h-3 w-3" />
                            Error
                        </div>
                        <div className="mt-1">{state.error}</div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// Main Playground Component (without Provider)
function PlaygroundContent() {
    const { initializeExecutor } = usePlayground();
    const blockTracking = useBlockTracking();

    // Memoize sessionId to prevent re-initialization
    const sessionId = useMemo(() => `session-${Date.now()}`, []);

    // Test function to manually add blocks
    const handleTestBlocks = useCallback(() => {
        const { blockCollector } = blockTracking;

        // Create a user message block
        const userBlock = blockCollector.createGroupBlock(
            'user',
            '테스트 사용자 메시지',
            undefined,
            0
        );

        // Create an assistant response block
        const assistantBlock = blockCollector.createGroupBlock(
            'assistant',
            '테스트 어시스턴트 응답',
            userBlock.blockMetadata.id,
            1
        );

        // Create a tool call block
        const toolCallBlock = blockCollector.createGroupBlock(
            'tool_call',
            'weather_tool 호출',
            assistantBlock.blockMetadata.id,
            2
        );

        // Update tool call with parameters
        blockCollector.updateBlock(toolCallBlock.blockMetadata.id, {
            visualState: 'completed',
            renderData: {
                parameters: { city: '서울', unit: 'celsius' }
            }
        });

        // Create tool result block
        const resultBlock = blockCollector.createGroupBlock(
            'group',
            '서울 온도: 25°C, 맑음',
            toolCallBlock.blockMetadata.id,
            3
        );

        blockCollector.updateBlock(resultBlock.blockMetadata.id, {
            visualState: 'completed',
            type: 'tool_result'
        });

        console.log('테스트 블록 추가됨:', {
            userBlock: userBlock.blockMetadata.id,
            assistantBlock: assistantBlock.blockMetadata.id,
            toolCallBlock: toolCallBlock.blockMetadata.id,
            resultBlock: resultBlock.blockMetadata.id
        });
    }, [blockTracking]);

    // Initialize on mount
    useEffect(() => {
        initializeExecutor({
            serverUrl: 'ws://localhost:3001', // Default server URL
            userId: 'playground-user',
            sessionId,
            authToken: 'playground-token'
        });
    }, [initializeExecutor, sessionId]);

    return (
        <div className="min-h-screen bg-gray-50 p-4">
            <div className="max-w-7xl mx-auto space-y-4">
                {/* Header */}
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Robota Playground</h1>
                        <p className="text-sm text-gray-600">Visual Agent and Team Configuration Interface</p>
                    </div>

                    <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-xs">
                            <Zap className="h-3 w-3 mr-1" />
                            Real-time
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                            <Puzzle className="h-3 w-3 mr-1" />
                            Block Coding
                        </Badge>
                        <Button
                            onClick={handleTestBlocks}
                            size="sm"
                            className="flex items-center gap-1"
                        >
                            <Play className="h-3 w-3" />
                            Test Blocks
                        </Button>
                    </div>
                </div>

                {/* Main Layout */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-200px)]">
                    {/* Left Panel - Configuration */}
                    <div className="lg:col-span-1">
                        <ConfigurationPanel />
                    </div>

                    {/* Middle Panel - Chat Interface */}
                    <div className="lg:col-span-1">
                        <ChatInterfacePanel blockTracking={blockTracking} />
                    </div>

                    {/* Right Panel - Status and Monitoring */}
                    <div className="lg:col-span-1 space-y-4">
                        <ConnectionStatusPanel />

                        {/* Block Visualization Panel */}
                        <BlockVisualizationPanel
                            blockCollector={blockTracking.blockCollector}
                            height="400px"
                            showDebug={false}
                            autoScroll={true}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

// Main Playground Page with Provider
export default function PlaygroundPage() {
    return (
        <PlaygroundProvider defaultServerUrl="ws://localhost:3001">
            <PlaygroundContent />
        </PlaygroundProvider>
    );
} 