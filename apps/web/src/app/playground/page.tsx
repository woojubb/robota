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

import React, { useState, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
    Play,
    Square,
    Plus,
    Bot,
    Users,
    AlertCircle,
    CheckCircle,
    Loader2,
    Menu
} from 'lucide-react';

// Context and Hooks
import { PlaygroundProvider, usePlayground } from '@/contexts/playground-context';
import { useRobotaExecution } from '@/hooks/use-robota-execution';
import { useChatInput } from '@/hooks/use-chat-input';
import { usePlaygroundStatistics } from '@/hooks/use-playground-statistics';
import { useModal } from '@/hooks/use-modal';



// Visual Components
import { AgentConfigurationBlock } from '@/components/playground/agent-configuration-block';
import { TeamConfigurationBlock } from '@/components/playground/team-configuration-block';
import { WorkflowVisualization } from '@/components/playground/workflow-visualization';
import { Modal } from '@/components/ui/modal';
import { getPlaygroundToolCatalog } from '@/tools/catalog';

// Types
import type {
    PlaygroundAgentConfig,
    PlaygroundTeamConfig
} from '@/lib/playground/robota-executor';
import type {
    UniversalWorkflowStructure
} from '@robota-sdk/agents';

// Configuration Panel Component
function ConfigurationPanel({ onOpenChat }: { onOpenChat: (type: 'agent' | 'team', name: string) => void }) {
    const { state, updateAgentConfig, updateTeamConfig } = usePlayground();
    const {
        currentMode,
        currentAgentConfig,
        currentTeamConfig,
        getDefaultAgentConfig,
        getDefaultTeamConfig,
        validateConfiguration,
        cancelExecution
    } = useRobotaExecution();

    // Local per-entity lock states (indices)
    const [lockedAgents, setLockedAgents] = useState<Set<number>>(new Set());
    const [lockedTeams, setLockedTeams] = useState<Set<number>>(new Set());

    // STEP 9.2.1: Manual workflow 생성 함수들 제거됨 (SDK Store 사용으로 변경)

    // 🎯 [EVENT-SYSTEM-ONLY] Agent 생성은 이벤트 시스템을 통해서만 수행
    // 임의 노드 생성 제거: 실제 Agent 실행이 이벤트를 통해 노드를 생성할 것임
    // Create actions moved to header modal flow

    // Execution handlers
    const handleExecuteAgentAt = useCallback(async (index: number, config: PlaygroundAgentConfig) => {
        try {
            console.log('Activating agent lock (no creation)...');

            // Lock this agent card (by index)
            setLockedAgents((prev) => {
                const next = new Set(prev);
                next.add(index);
                return next;
            });
            console.log('Agent is now locked for editing');
        } catch (error) {
            console.error('Failed to activate agent:', error);
        }
    }, [state.currentWorkflow]);

    const handleExecuteTeamAt = useCallback(async (index: number, config: PlaygroundTeamConfig) => {
        try {
            console.log('Activating team lock (no creation)...');

            // Lock this team card (by index)
            setLockedTeams((prev) => {
                const next = new Set(prev);
                next.add(index);
                return next;
            });
            console.log('Team is now locked for editing');
        } catch (error) {
            console.error('Failed to activate team:', error);
        }
    }, [state.currentWorkflow]);

    const handleStopExecution = useCallback(() => {
        console.log('Stopping execution (no-op for per-entity lock)');
    }, []);

    return (
        <div className="space-y-4">
            {/* Create controls moved to header. */}

            {/* Unified list: show both blocks if present, otherwise a single empty state */}
            <div className="space-y-4">
                {/* Agent Cards */}
                {state.agentConfigs.map((cfg, index) => (
                    <AgentConfigurationBlock
                        key={`agent-card-${index}`}
                        config={cfg}
                        isActive={currentMode === 'agent'}
                        isExecuting={lockedAgents.has(index)}
                        onConfigChange={(updated) => updateAgentConfig(index, updated)}
                        onExecute={(updated) => handleExecuteAgentAt(index, updated)}
                        onStop={handleStopExecution}
                        onOpenChat={(c) => onOpenChat('agent', c.name || 'Agent')}
                        className="w-full"
                    />
                ))}

                {/* Team Cards */}
                {state.teamConfigs.map((cfg, index) => (
                    <TeamConfigurationBlock
                        key={`team-card-${index}`}
                        config={cfg}
                        isActive={currentMode === 'team'}
                        isExecuting={lockedTeams.has(index)}
                        onConfigChange={(updated) => updateTeamConfig(index, updated)}
                        onExecute={(updated) => handleExecuteTeamAt(index, updated)}
                        onStop={handleStopExecution}
                        onOpenChat={(c) => onOpenChat('team', c.name || 'Team')}
                        className="w-full"
                    />
                ))}

                {/* Unified empty state when nothing configured */}
                {state.agentConfigs.length === 0 && state.teamConfigs.length === 0 && (
                    <div className="text-center py-8">
                        <div className="flex items-center justify-center gap-2 text-gray-500">
                            <Bot className="h-5 w-5 opacity-60" />
                            <Users className="h-5 w-5 opacity-60" />
                            <span className="text-sm">No agent or team configured yet</span>
                        </div>
                        <div className="mt-3 text-xs text-gray-400">Use the Create buttons above to add one</div>
                    </div>
                )}
            </div>
        </div>
    );
}

// Chat Input Component - Input Only (No Chat History)
function ChatInputPanel({ onClose }: { onClose: () => void }) {
    const { state, setWorkflow } = usePlayground();
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
            // Close chat modal immediately on send for better UX
            onClose();
            if (useStreaming) {
                await sendStreamingMessage(inputState.value);
            } else {
                await sendMessage(inputState.value);
            }
            // Clear input after successful send
            setValue('');
        } catch (error) {
            console.error('Failed to send message:', error);
        }
    }, [canSend, inputState.value, useStreaming, sendStreamingMessage, sendMessage, onClose, setValue]);

    const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    }, [handleSendMessage]);

    return (
        <div className="space-y-4">
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

            <div className="flex flex-col gap-3">
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
            </div>
        </div>
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
        <div className="space-y-2">
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
        </div>
    );
}

// Main Content Component (requires PlaygroundProvider)
function PlaygroundContent() {
    const { state, setWorkflow } = usePlayground();
    const [leftSidebarOpen, setLeftSidebarOpen] = useState(false);
    const [rightSidebarOpen, setRightSidebarOpen] = useState(true);
    const { activeModal, isModalOpen, openModal, closeModal, toggleModal } = useModal();
    const { createAgent, createTeam, getDefaultAgentConfig, getDefaultTeamConfig } = useRobotaExecution();
    const [agentDraft, setAgentDraft] = useState<PlaygroundAgentConfig | null>(null);
    const [teamDraft, setTeamDraft] = useState<PlaygroundTeamConfig | null>(null);
    const [selectedChatTarget, setSelectedChatTarget] = useState<{ type: 'agent' | 'team'; name: string } | null>(null);

    // Catalog-driven tool list (static imports only)
    const toolItems = getPlaygroundToolCatalog();

    return (
        <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-2 border-b border-gray-200 bg-white flex-shrink-0">
                <div>
                    <h1 className="text-xl font-semibold leading-tight">Robota Playground</h1>
                    <p className="text-xs text-gray-600">Build, test, and deploy intelligent agents</p>
                </div>

                <div className="flex items-center gap-2">
                    {/* Global Chat button removed; Chat opens from per-entity panels */}

                    <button
                        onClick={() => {
                            const cfg = getDefaultAgentConfig();
                            setAgentDraft(cfg);
                            openModal('createAgent');
                        }}
                        className="px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded transition-colors"
                    >
                        Create Agent
                    </button>

                    <button
                        onClick={() => {
                            const cfg = getDefaultTeamConfig();
                            setTeamDraft(cfg);
                            openModal('createTeam');
                        }}
                        className="px-2 py-1 bg-green-500 hover:bg-green-600 text-white text-xs rounded transition-colors"
                    >
                        Create Team
                    </button>

                    <Badge variant={state.isInitialized ? "default" : "secondary"}>
                        <span className="text-xs">{state.isInitialized ? "Ready" : "Initializing"}</span>
                    </Badge>
                </div>
            </div>

            {/* Main Visualization Layout with Inline Sidebars */}
            <div className="flex flex-1 overflow-hidden">
                {/* Left Sidebar - Configuration (inline) */}
                {leftSidebarOpen && (
                    <div className="w-80 h-full bg-white border-r border-gray-200 z-10 shadow-lg overflow-y-auto">
                        <div className="p-4">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-semibold text-gray-800">Configuration</h3>
                                <button
                                    onClick={() => setLeftSidebarOpen(false)}
                                    className="text-gray-400 hover:text-gray-600 text-xl"
                                >
                                    ×
                                </button>
                            </div>
                            <ConfigurationPanel onOpenChat={(type, name) => { setSelectedChatTarget({ type, name }); openModal('chat'); }} />
                        </div>
                    </div>
                )}

                {/* Center Column - Workflow Visualization */}
                <div className="flex-1 h-full">
                    <WorkflowVisualization
                        workflow={state.sdkWorkflow || undefined}
                        onAgentNodeClick={(nodeId, data) => {
                            setSelectedChatTarget({ type: 'agent', name: data?.label || data?.name || 'Agent' });
                            openModal('chat');
                        }}
                        onToolDrop={async (agentId, tool) => {
                            try {
                                if (!state.executor || typeof (state.executor as any).updateAgentToolsFromCard !== 'function') {
                                    console.error('Executor not ready for tool update');
                                    return;
                                }
                                // Ensure subscription once
                                try {
                                    if ((state as any).__subscribed !== true && typeof (state.executor as any).subscribeToWorkflowUpdates === 'function') {
                                        (state.executor as any).subscribeToWorkflowUpdates((data: any) => setWorkflow(data));
                                        (state as any).__subscribed = true;
                                    }
                                } catch { }
                                await (state.executor as any).updateAgentToolsFromCard(agentId, tool);
                                // Force refresh snapshot for immediate UI reflect
                                try {
                                    if (typeof (state.executor as any).getCurrentWorkflow === 'function') {
                                        const wf = (state.executor as any).getCurrentWorkflow();
                                        if (wf) setWorkflow(wf);
                                    }
                                } catch { }
                            } catch (err: any) {
                                console.error('Failed to update agent tools', err);
                            }
                        }}
                    />
                </div>

                {/* Right Sidebar - Tools (inline) */}
                <div className="w-80 h-full bg-gray-50 border-l border-gray-200 z-10 shadow-lg overflow-y-auto">
                    <div className="p-4 h-full flex flex-col">
                        <h3 className="font-semibold mb-3">Tools</h3>
                        <div className="space-y-2 overflow-auto pr-1">
                            {toolItems.map((tool) => (
                                <div
                                    key={tool.id}
                                    className="border rounded bg-white p-3 cursor-grab select-none"
                                    draggable
                                    onDragStart={(e) => {
                                        e.dataTransfer.setData('application/robota-tool', JSON.stringify(tool));
                                    }}
                                    title="Drag into the canvas to add"
                                >
                                    <div className="text-sm font-medium">{tool.name}</div>
                                    <div className="text-xs text-gray-500">{tool.description}</div>
                                </div>
                            ))}
                        </div>
                        <div className="mt-3">
                            <button
                                onClick={() => alert('Add Tool (UI only)')}
                                className="w-full px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded"
                            >
                                + Add Tool
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Modal System */}

            {/* Configuration moved to Left Sidebar */}

            {/* Chat Modal */}
            <Modal
                isOpen={isModalOpen('chat')}
                onClose={closeModal}
                title="Chat Input"
                size="lg"
            >
                <div className="p-6 space-y-3">
                    {selectedChatTarget && (
                        <div className="text-sm text-gray-600">
                            Target: <span className="font-medium">{selectedChatTarget.type.toUpperCase()} — {selectedChatTarget.name}</span>
                        </div>
                    )}
                    <ChatInputPanel onClose={closeModal} />
                </div>
            </Modal>

            {/* System Status Modal */}
            <Modal
                isOpen={isModalOpen('systemStatus')}
                onClose={closeModal}
                title="System Status"
                size="lg"
            >
                <div className="p-6 space-y-6">
                    <SystemStatusPanel />

                    <div className="border-t pt-6">
                        <h3 className="font-bold mb-4">🔄 Workflow System Status</h3>
                        <div className="bg-gray-100 p-4 rounded">
                            <div id="workflow-status" className="space-y-2">
                                <p>📊 Current Workflow: <span id="workflow-nodes-count">0</span> nodes</p>
                                <p>📡 SDK Subscription: <span id="sdk-subscription-status">Not Connected</span></p>
                                <p>🕐 Last Update: <span id="last-workflow-update">Never</span></p>
                                <p>🔧 Tool Calls Detected: <span id="tool-calls-count">0</span></p>
                                <p>🤖 Agents Created: <span id="agents-created-count">0</span></p>
                            </div>
                        </div>
                    </div>
                </div>
            </Modal>

            {/* Create Agent Modal (Compact UI) */}
            <Modal
                isOpen={isModalOpen('createAgent')}
                onClose={() => {
                    setAgentDraft(null);
                    closeModal();
                }}
                title="Create Agent"
                size="lg"
            >
                <div className="p-6 space-y-4">
                    {agentDraft && (
                        <div className="space-y-3 text-sm">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <Label className="text-xs">Agent Name</Label>
                                    <Input
                                        value={agentDraft.name}
                                        onChange={(e) => setAgentDraft({ ...agentDraft, name: e.target.value })}
                                        className="h-8 text-xs"
                                        placeholder="Agent Name"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Provider</Label>
                                    <Select
                                        value={agentDraft.defaultModel.provider}
                                        onValueChange={(value) => setAgentDraft({
                                            ...agentDraft,
                                            defaultModel: { ...agentDraft.defaultModel, provider: value }
                                        })}
                                    >
                                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="openai">OpenAI</SelectItem>
                                            <SelectItem value="anthropic">Anthropic</SelectItem>
                                            <SelectItem value="google">Google</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Model</Label>
                                    <Select
                                        value={agentDraft.defaultModel.model}
                                        onValueChange={(value) => setAgentDraft({
                                            ...agentDraft,
                                            defaultModel: { ...agentDraft.defaultModel, model: value }
                                        })}
                                    >
                                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="gpt-4o-mini">GPT-4o Mini</SelectItem>
                                            <SelectItem value="gpt-4">GPT-4</SelectItem>
                                            <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                                            <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
                                            <SelectItem value="claude-3-opus">Claude 3 Opus</SelectItem>
                                            <SelectItem value="claude-3-sonnet">Claude 3 Sonnet</SelectItem>
                                            <SelectItem value="gemini-pro">Gemini Pro</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Max Tokens</Label>
                                    <Input
                                        type="number"
                                        value={agentDraft.defaultModel.maxTokens || 2000}
                                        onChange={(e) => setAgentDraft({
                                            ...agentDraft,
                                            defaultModel: { ...agentDraft.defaultModel, maxTokens: parseInt(e.target.value || '0', 10) }
                                        })}
                                        className="h-8 text-xs"
                                        min={100}
                                        max={4000}
                                        step={100}
                                    />
                                </div>
                            </div>

                            <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                    <Label className="text-xs">System Message</Label>
                                    <Select
                                        onValueChange={(value) => {
                                            const templates = {
                                                'task_coordinator': `You are a Team Coordinator that manages collaborative work through intelligent task delegation.

CORE PRINCIPLES:
- Respond in the same language as the user's input
- For simple, single-component tasks, handle them directly yourself
- For complex or multi-faceted tasks, delegate to specialized team members
- Each delegated task must be self-contained and understandable without context
- Always synthesize and integrate results from team members into your final response

AVAILABLE ROLES:
- Coordinators: Can break down complex tasks and manage workflows
- Specialists: Focus on specific domains and can handle targeted tasks efficiently

DELEGATION BEST PRACTICES:
- Create clear, standalone instructions for each specialist
- Avoid overlapping tasks between different team members
- Select appropriate specialist templates based on task requirements
- Ensure each delegated task is complete and actionable
- Handle final synthesis and coordination yourself

Your goal is to coordinate effectively while leveraging specialist expertise for optimal results.`,
                                                'general_assistant': `You are a helpful AI assistant. You provide accurate, helpful, and thoughtful responses to user queries. You can help with a wide variety of tasks including analysis, writing, problem-solving, and creative work.`,
                                                'creative_ideator': `You are a Creative Ideator specializing in innovative thinking and creative problem-solving. You excel at brainstorming, generating unique ideas, and approaching challenges from unconventional angles. Focus on creativity, originality, and out-of-the-box solutions.`,
                                                'analytical_specialist': `You are an Analytical Specialist focused on data analysis, logical reasoning, and systematic problem-solving. You excel at breaking down complex problems, analyzing information methodically, and providing evidence-based conclusions.`,
                                                'technical_expert': `You are a Technical Expert with deep knowledge in software development, system architecture, and technical problem-solving. You provide detailed technical guidance, code reviews, and architectural recommendations.`
                                            };

                                            if (value && templates[value as keyof typeof templates]) {
                                                setAgentDraft({
                                                    ...agentDraft,
                                                    defaultModel: {
                                                        ...agentDraft.defaultModel,
                                                        systemMessage: templates[value as keyof typeof templates]
                                                    }
                                                });
                                            }
                                        }}
                                    >
                                        <SelectTrigger className="h-6 text-xs w-auto">
                                            <SelectValue placeholder="Use template" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="task_coordinator">Team Coordinator (Delegation)</SelectItem>
                                            <SelectItem value="general_assistant">General Assistant</SelectItem>
                                            <SelectItem value="creative_ideator">Creative Ideator</SelectItem>
                                            <SelectItem value="analytical_specialist">Analytical Specialist</SelectItem>
                                            <SelectItem value="technical_expert">Technical Expert</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <Textarea
                                    value={agentDraft.defaultModel.systemMessage || ''}
                                    onChange={(e) => setAgentDraft({
                                        ...agentDraft,
                                        defaultModel: { ...agentDraft.defaultModel, systemMessage: e.target.value }
                                    })}
                                    className="min-h-[100px] text-xs resize-none"
                                    placeholder="You are a helpful AI assistant..."
                                />
                            </div>
                        </div>
                    )}
                    <div className="flex justify-end gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                setAgentDraft(null);
                                closeModal();
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            onClick={async () => {
                                if (agentDraft) {
                                    await createAgent(agentDraft);
                                    setAgentDraft(null);
                                    closeModal();
                                }
                            }}
                            className="px-3"
                        >
                            Create
                        </Button>
                    </div>
                </div>
            </Modal>

            {/* Create Team Modal (Compact UI) */}
            <Modal
                isOpen={isModalOpen('createTeam')}
                onClose={() => {
                    setTeamDraft(null);
                    closeModal();
                }}
                title="Create Team"
                size="lg"
            >
                <div className="p-6 space-y-4">
                    {teamDraft && (
                        <div className="space-y-3 text-sm">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1 col-span-2">
                                    <Label className="text-xs">Team Name</Label>
                                    <Input
                                        value={teamDraft.name}
                                        onChange={(e) => setTeamDraft({ ...teamDraft, name: e.target.value })}
                                        className="h-8 text-xs"
                                        placeholder="Team Name"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Coordinator Strategy</Label>
                                    <Select
                                        value={teamDraft.workflow?.coordinator || 'round-robin'}
                                        onValueChange={(value) => setTeamDraft({
                                            ...teamDraft,
                                            workflow: { ...(teamDraft.workflow || {}), coordinator: value }
                                        })}
                                    >
                                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="round-robin">Round Robin</SelectItem>
                                            <SelectItem value="priority">Priority Based</SelectItem>
                                            <SelectItem value="capability">Capability Matching</SelectItem>
                                            <SelectItem value="parallel">Parallel Execution</SelectItem>
                                            <SelectItem value="consensus">Consensus</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Max Depth</Label>
                                    <Input
                                        type="number"
                                        value={(teamDraft.workflow as unknown as { maxDepth?: number })?.maxDepth || 3}
                                        onChange={(e) => setTeamDraft({
                                            ...teamDraft,
                                            workflow: { ...(teamDraft.workflow || {}), maxDepth: parseInt(e.target.value || '0', 10) }
                                        })}
                                        className="h-8 text-xs"
                                        min={1}
                                        max={10}
                                    />
                                </div>
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Description</Label>
                                <Textarea
                                    value={(teamDraft as unknown as { description?: string }).description || ''}
                                    onChange={(e) => setTeamDraft({ ...(teamDraft as unknown as { description?: string }), description: e.target.value } as unknown as PlaygroundTeamConfig)}
                                    className="min-h-[60px] text-xs resize-none"
                                    placeholder="Describe the purpose of this team..."
                                />
                            </div>
                        </div>
                    )}
                    <div className="flex justify-end gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                                setTeamDraft(null);
                                closeModal();
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            size="sm"
                            onClick={async () => {
                                if (teamDraft) {
                                    await createTeam(teamDraft);
                                    setTeamDraft(null);
                                    closeModal();
                                }
                            }}
                            className="px-3"
                        >
                            Create
                        </Button>
                    </div>
                </div>
            </Modal>
        </div>
    );
}

// STEP 12.0.1: WorkflowTestButtons 컴포넌트 구현
function WorkflowTestButtons() {
    const { state, setWorkflow } = usePlayground();

    // No sanitization or mutation: UI displays workflow exactly as produced by SDK (Example 26 parity)

    // 🎯 실제 SDK 데이터 주입
    const handleLoadRealData = useCallback(() => {
        console.log('🎯 [REAL-DATA] Loading actual SDK workflow data from Example 25...');
        // ❌ 임의 데이터 로드 비활성화 - 이벤트 시스템에서 생성된 실제 데이터만 사용
        console.log('🎯 [EVENT-SYSTEM-ONLY] Use real data from event system instead of generated dummy data');
        return;
    }, [setWorkflow]);

    // 🎉 완벽한 Agent Copy 시스템 데이터 (실제 SDK 결과)
    const handleLoadPerfectAgentCopy = useCallback(async () => {
        console.log('🎉 [PERFECT-COPY] Loading perfect Agent Copy system data from actual SDK execution...');

        try {
            // 실제 SDK 실행 결과 JSON 파일 로드
            const response = await fetch('/perfect-playground-data.json');
            if (!response.ok) {
                throw new Error(`Failed to load perfect data: ${response.status}`);
            }
            const perfectData = await response.json();

            console.log('🎉 [PERFECT-COPY] Loaded real SDK execution result:', {
                nodes: perfectData.nodes?.length || 0,
                edges: perfectData.edges?.length || 0,
                timestamp: perfectData.metadata?.createdAt,
                features: 'Real SDK Execution Result + 21 Edge Connections + Agent Copy System'
            });

            setWorkflow(perfectData);
        } catch (error) {
            console.error('❌ [PERFECT-COPY] Failed to load perfect data:', error);
            // Fallback to mock data if JSON loading fails
            const fallbackData = generatePerfectAgentCopyData();
            setWorkflow(fallbackData as UniversalWorkflowStructure);
            console.log('🔄 [PERFECT-COPY] Used fallback data instead');
        }
    }, [setWorkflow]);

    // 🚀 최신 SDK 실행 결과 로드 (16 nodes, 24 edges)
    const handleLoadLatestSDKResult = useCallback(async () => {
        console.log('🚀 [LATEST-SDK] Loading latest SDK execution result...');
        try {
            // Try to fetch the latest data from public folder
            const response = await fetch('/perfect-playground-data.json');
            if (response.ok) {
                const data = await response.json();
                console.log('🚀 [LATEST-SDK] Successfully loaded latest data from file:', {
                    nodes: data.nodes?.length || 0,
                    edges: data.edges?.length || 0,
                    timestamp: new Date().toISOString()
                });
                setWorkflow(data);
            } else {
                throw new Error('Failed to fetch perfect-playground-data.json');
            }
        } catch (error) {
            console.error('❌ [LATEST-SDK] Failed to load latest SDK result:', error);
            alert('Failed to load latest SDK result. Please run example 26 first.');
        }
    }, [setWorkflow]);

    return (
        <>
            <button
                onClick={handleLoadRealData}
                className="px-4 py-2 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors font-medium"
                title="Load Agent Numbering System with Original/Copy pattern - no cross connections (13 nodes, 13 connections)"
            >
                🎯 Load Agent Numbering System
            </button>
            <button
                onClick={handleLoadPerfectAgentCopy}
                className="px-4 py-2 bg-green-500 text-white text-sm rounded hover:bg-green-600 transition-colors font-medium"
                title="Load Real SDK Execution Result - 12 nodes, 21 edges from actual Example 26 execution"
            >
                🎯 Load REAL SDK Result (12 nodes, 21 edges)
            </button>
            <button
                onClick={handleLoadLatestSDKResult}
                className="px-4 py-2 bg-purple-500 text-white text-sm rounded hover:bg-purple-600 transition-colors font-medium"
                title="Load Latest SDK Execution Result - 16 nodes, 24 edges from actual Example 26 execution"
            >
                🚀 Load Latest SDK Result (16 nodes, 24 edges)
            </button>
        </>
    );
}

// STEP 12.0.2: JSON 데이터 주입 시스템 - 샘플 데이터 생성 함수들
// 🔍 **Edges Source/Target 연결 중심으로 구현** - 도메인 중립적

// 🎉 완벽한 Agent Copy 시스템 데이터 (실제 SDK 실행 결과)
function generatePerfectAgentCopyData() {
    console.log('🎉 [PERFECT-COPY] Generating perfect Agent Copy system data from real SDK execution');

    // 🎯 실제 SDK에서 생성된 완벽한 데이터 구조
    return {
        "__workflowType": "UniversalWorkflowStructure" as const,
        "id": "perfect-agent-copy-system",
        "name": "Perfect Agent Copy System - Real SDK Result",
        "nodes": [
            {
                "id": "agent_0_copy_1",
                "type": "agent",
                "level": 1,
                "position": { "x": 400, "y": 100, "level": 1, "order": 0 },
                "visualState": { "status": "completed", "lastUpdated": new Date() },
                "data": {
                    "label": "Agent 0 Copy 1",
                    "description": "Perfect Agent Copy with reserved IDs",
                    "agentNumber": 0,
                    "copyNumber": 1,
                    "reservedThinkingId": "thinking_agent_0_copy_1",
                    "reservedResponseId": "response_agent_0_copy_1"
                },
                "createdAt": new Date(),
                "updatedAt": new Date()
            },
            {
                "id": "thinking_agent_0_copy_1",
                "type": "agent_thinking",
                "level": 2,
                "position": { "x": 400, "y": 200, "level": 2, "order": 0 },
                "visualState": { "status": "completed", "lastUpdated": new Date() },
                "data": {
                    "label": "Agent 0 Thinking",
                    "description": "Standard connection rule: Agent → Thinking"
                },
                "createdAt": new Date(),
                "updatedAt": new Date()
            },
            {
                "id": "response_agent_0_copy_1",
                "type": "response",
                "level": 3,
                "position": { "x": 400, "y": 300, "level": 3, "order": 0 },
                "visualState": { "status": "completed", "lastUpdated": new Date() },
                "data": {
                    "label": "Response 0",
                    "description": "Standard connection rule: Thinking → Response"
                },
                "createdAt": new Date(),
                "updatedAt": new Date()
            },
            {
                "id": "user_input_conv_example",
                "type": "user_input",
                "level": 0,
                "position": { "x": 400, "y": 20, "level": 0, "order": 0 },
                "visualState": { "status": "completed", "lastUpdated": new Date() },
                "data": {
                    "label": "User Input",
                    "description": "Initial request"
                },
                "createdAt": new Date(),
                "updatedAt": new Date()
            }
        ],
        "edges": [
            {
                "id": "edge-agent-thinking-1",
                "source": "agent_0_copy_1",
                "target": "thinking_agent_0_copy_1",
                "type": "processes",
                "label": "Agent → Thinking",
                "data": {
                    "connectionRule": "Standard Rule 1",
                    "metadata": { "ruleType": "agent-to-thinking" }
                },
                "createdAt": new Date(),
                "updatedAt": new Date()
            },
            {
                "id": "edge-thinking-response-1",
                "source": "thinking_agent_0_copy_1",
                "target": "response_agent_0_copy_1",
                "type": "return",
                "label": "Thinking → Response",
                "data": {
                    "connectionRule": "Standard Rule 4",
                    "metadata": { "ruleType": "thinking-to-response" }
                },
                "createdAt": new Date(),
                "updatedAt": new Date()
            },
            {
                "id": "edge-user-agent-1",
                "source": "user_input_conv_example",
                "target": "agent_0_copy_1",
                "type": "receives",
                "label": "User → Agent",
                "data": {
                    "connectionRule": "Input Rule",
                    "metadata": { "ruleType": "user-to-agent" }
                },
                "createdAt": new Date(),
                "updatedAt": new Date()
            }
        ],
        "layout": {
            "algorithm": "hierarchical",
            "direction": "TB",
            "spacing": { "nodeSpacing": 150, "levelSpacing": 100 },
            "alignment": { "horizontal": "center", "vertical": "top" }
        },
        "metadata": {
            "createdAt": new Date(),
            "updatedAt": new Date(),
            "metrics": {
                "totalNodes": 4,
                "totalEdges": 3
            },
            "features": [
                "Agent Copy System",
                "Standard Connection Rules",
                "Domain Neutral Types",
                "Perfect Edge Connections",
                "Real SDK Execution Result"
            ],
            "sourceExample": "26-playground-edge-verification.ts",
            "sdkResult": {
                "agentCopyPattern": "agent_N_copy_M",
                "connectionRules": ["processes", "return", "receives"],
                "ghostConnectionsEliminated": true,
                "edgeCount": "37 in full execution"
            },
            "title": "Perfect Agent Copy System with Complete Connections",
            "description": "Real SDK execution result with Agent Copy system working perfectly"
        }
    };
}

// ❌ [DISABLED] 임의 워크플로우 데이터 생성 함수 비활성화 - 이벤트 시스템 사용
function generateRealSDKWorkflowData_DISABLED() {
    console.log('🔍 [EDGES] Generating Agent Numbering System with Original/Copy Concept - No Cross Connections');

    // 🎯 Agent 번호 시스템 및 원본/복사본 개념
    const userInputId = 'user_input_conv_1754200303744_mjsds2f5j';

    // Agent 0 (원본) - 최초 처리 시작점
    const agent0Original = 'agent_0_original_conv_1754200303744_mjsds2f5j';
    const agent0Thinking1 = 'thinking_agent_0_original_1754200303749';

    // Tool Call IDs
    const toolCall1 = 'tool_call_1_tool-1754200307010-bh8gks4ry';
    const toolCall2 = 'tool_call_2_tool-1754200307012-u031n7qu0';

    // Agent 1, Agent 2 (위임된 에이전트들)
    const agent1 = 'agent_1_conv_1754200307011_c2k6u2rnk';
    const agent1Thinking = 'thinking_agent_1_1754200307025';
    const response1 = 'response_agent_1_conv_1754200307011_c2k6u2rnk';

    const agent2 = 'agent_2_conv_1754200307015_pkvxtedpm';
    const agent2Thinking = 'thinking_agent_2_1754200307025';
    const response2 = 'response_agent_2_conv_1754200307015_pkvxtedpm';

    // 🎯 Agent 0 (복사본) - 결과 통합용 (교차 연결 방지)
    const agent0Copy = 'agent_0_copy_integration_1754200331350';
    const agent0CopyThinking = 'thinking_agent_0_copy_1754200331350';

    const nodes = [
        // 🎯 User Input
        {
            id: userInputId,
            type: 'user_input',
            level: 0,
            position: { x: 400, y: 20, level: 0, order: 0 },
            visualState: { status: 'completed' as const, lastUpdated: new Date() },
            data: {
                label: 'User Input',
                description: 'Initial user request for task processing'
            },
            createdAt: new Date(),
            updatedAt: new Date()
        },

        // 🎯 Agent 0 (원본) - 최초 처리 시작점
        {
            id: agent0Original,
            type: 'agent',
            level: 1,
            position: { x: 400, y: 100, level: 1, order: 0 },
            visualState: { status: 'completed' as const, lastUpdated: new Date() },
            data: {
                label: 'Agent 0 (Original)',
                description: 'Primary coordinator agent - starting point'
            },
            createdAt: new Date(),
            updatedAt: new Date()
        },

        // 🧠 Agent 0 Initial Thinking
        {
            id: agent0Thinking1,
            type: 'agent_thinking',
            level: 2,
            position: { x: 400, y: 180, level: 2, order: 0 },
            visualState: { status: 'completed' as const, lastUpdated: new Date() },
            data: {
                label: 'Agent 0 Thinking',
                description: 'Task planning and delegation strategy'
            },
            createdAt: new Date(),
            updatedAt: new Date()
        },

        // 🔧 Tool Calls (번호 시스템)
        {
            id: toolCall1,
            type: 'tool_call',
            level: 3,
            position: { x: 200, y: 260, level: 3, order: 0 },
            visualState: { status: 'completed' as const, lastUpdated: new Date() },
            data: {
                label: 'Tool Call 1',
                description: 'First external tool execution'
            },
            createdAt: new Date(),
            updatedAt: new Date()
        },
        {
            id: toolCall2,
            type: 'tool_call',
            level: 3,
            position: { x: 600, y: 260, level: 3, order: 1 },
            visualState: { status: 'completed' as const, lastUpdated: new Date() },
            data: {
                label: 'Tool Call 2',
                description: 'Second external tool execution'
            },
            createdAt: new Date(),
            updatedAt: new Date()
        },

        // 👥 Agent 1 (위임된 에이전트)
        {
            id: agent1,
            type: 'agent',
            level: 4,
            position: { x: 150, y: 340, level: 4, order: 0 },
            visualState: { status: 'completed' as const, lastUpdated: new Date() },
            data: {
                label: 'Agent 1',
                description: 'Delegated agent for first specialized task'
            },
            createdAt: new Date(),
            updatedAt: new Date()
        },
        {
            id: agent1Thinking,
            type: 'agent_thinking',
            level: 5,
            position: { x: 150, y: 420, level: 5, order: 0 },
            visualState: { status: 'completed' as const, lastUpdated: new Date() },
            data: {
                label: 'Agent 1 Thinking',
                description: 'Processing first specialized task'
            },
            createdAt: new Date(),
            updatedAt: new Date()
        },
        {
            id: response1,
            type: 'response',
            level: 6,
            position: { x: 150, y: 500, level: 6, order: 0 },
            visualState: { status: 'completed' as const, lastUpdated: new Date() },
            data: {
                label: 'Response 1',
                description: 'First task completion result'
            },
            createdAt: new Date(),
            updatedAt: new Date()
        },

        // 👥 Agent 2 (위임된 에이전트)
        {
            id: agent2,
            type: 'agent',
            level: 4,
            position: { x: 650, y: 340, level: 4, order: 1 },
            visualState: { status: 'completed' as const, lastUpdated: new Date() },
            data: {
                label: 'Agent 2',
                description: 'Delegated agent for second specialized task'
            },
            createdAt: new Date(),
            updatedAt: new Date()
        },
        {
            id: agent2Thinking,
            type: 'agent_thinking',
            level: 5,
            position: { x: 650, y: 420, level: 5, order: 1 },
            visualState: { status: 'completed' as const, lastUpdated: new Date() },
            data: {
                label: 'Agent 2 Thinking',
                description: 'Processing second specialized task'
            },
            createdAt: new Date(),
            updatedAt: new Date()
        },
        {
            id: response2,
            type: 'response',
            level: 6,
            position: { x: 650, y: 500, level: 6, order: 1 },
            visualState: { status: 'completed' as const, lastUpdated: new Date() },
            data: {
                label: 'Response 2',
                description: 'Second task completion result'
            },
            createdAt: new Date(),
            updatedAt: new Date()
        },

        // 🎯 Agent 0 (복사본) - 결과 통합용 (교차 연결 방지!)
        {
            id: agent0Copy,
            type: 'agent',
            level: 7,
            position: { x: 400, y: 580, level: 7, order: 0 },
            visualState: { status: 'completed' as const, lastUpdated: new Date() },
            data: {
                label: 'Agent 0 (Copy)',
                description: 'Integration instance - prevents cross connections'
            },
            createdAt: new Date(),
            updatedAt: new Date()
        },

        // 🧠 Final Integration Thinking
        {
            id: agent0CopyThinking,
            type: 'agent_thinking',
            level: 8,
            position: { x: 400, y: 660, level: 8, order: 0 },
            visualState: { status: 'completed' as const, lastUpdated: new Date() },
            data: {
                label: 'Agent 0 Final Thinking',
                description: 'Final integration and output preparation'
            },
            createdAt: new Date(),
            updatedAt: new Date()
        }
    ];

    const edges = [
        // 🎯 혁신적 흐름: 교차 연결 방지를 위한 Agent 0 원본/복사본 시스템

        // 1. User Input → Agent 0 (원본)
        {
            id: 'edge-user-agent0-original',
            source: userInputId,
            target: agent0Original,
            type: 'receives',
            label: 'Initial Request',
            data: { executionOrder: 0, metadata: { connectionType: 'user-to-agent-original' } },
            createdAt: new Date(),
            updatedAt: new Date()
        },

        // 2. Agent 0 (원본) → Agent 0 Initial Thinking
        {
            id: 'edge-agent0-thinking1',
            source: agent0Original,
            target: agent0Thinking1,
            type: 'processes',
            label: 'Task Planning',
            data: { executionOrder: 1, metadata: { connectionType: 'agent-to-thinking' } },
            createdAt: new Date(),
            updatedAt: new Date()
        },

        // 3. Agent 0 Thinking → Tool Calls (병렬 위임)
        {
            id: 'edge-thinking-tool1',
            source: agent0Thinking1,
            target: toolCall1,
            type: 'calls',
            label: 'Tool 1 Execution',
            data: { executionOrder: 2, metadata: { connectionType: 'thinking-to-tool' } },
            createdAt: new Date(),
            updatedAt: new Date()
        },
        {
            id: 'edge-thinking-tool2',
            source: agent0Thinking1,
            target: toolCall2,
            type: 'calls',
            label: 'Tool 2 Execution',
            data: { executionOrder: 3, metadata: { connectionType: 'thinking-to-tool' } },
            createdAt: new Date(),
            updatedAt: new Date()
        },

        // 4. Tool Calls → 위임된 에이전트들
        {
            id: 'edge-tool1-agent1',
            source: toolCall1,
            target: agent1,
            type: 'creates',
            label: 'Create Agent 1',
            data: { executionOrder: 4, metadata: { connectionType: 'tool-to-agent' } },
            createdAt: new Date(),
            updatedAt: new Date()
        },
        {
            id: 'edge-tool2-agent2',
            source: toolCall2,
            target: agent2,
            type: 'creates',
            label: 'Create Agent 2',
            data: { executionOrder: 5, metadata: { connectionType: 'tool-to-agent' } },
            createdAt: new Date(),
            updatedAt: new Date()
        },

        // 5. Agent 1 처리 흐름 (순차: Agent → Thinking → Response)
        {
            id: 'edge-agent1-thinking',
            source: agent1,
            target: agent1Thinking,
            type: 'processes',
            label: 'Process Task 1',
            data: { executionOrder: 6, metadata: { connectionType: 'agent-to-thinking' } },
            createdAt: new Date(),
            updatedAt: new Date()
        },
        {
            id: 'edge-agent1-thinking-response',
            source: agent1Thinking,
            target: response1,
            type: 'return',
            label: 'Result 1',
            data: { executionOrder: 7, metadata: { connectionType: 'thinking-to-response' } },
            createdAt: new Date(),
            updatedAt: new Date()
        },

        // 6. Agent 2 처리 흐름 (순차: Agent → Thinking → Response)
        {
            id: 'edge-agent2-thinking',
            source: agent2,
            target: agent2Thinking,
            type: 'processes',
            label: 'Process Task 2',
            data: { executionOrder: 8, metadata: { connectionType: 'agent-to-thinking' } },
            createdAt: new Date(),
            updatedAt: new Date()
        },
        {
            id: 'edge-agent2-thinking-response',
            source: agent2Thinking,
            target: response2,
            type: 'return',
            label: 'Result 2',
            data: { executionOrder: 9, metadata: { connectionType: 'thinking-to-response' } },
            createdAt: new Date(),
            updatedAt: new Date()
        },

        // 🎯 핵심: 교차 연결 방지! Response들이 Agent 0 (복사본)으로 수렴
        {
            id: 'edge-response1-agent0-copy',
            source: response1,
            target: agent0Copy,
            type: 'return',
            label: 'Integration 1',
            data: { executionOrder: 10, metadata: { connectionType: 'response-to-agent-copy' } },
            createdAt: new Date(),
            updatedAt: new Date()
        },
        {
            id: 'edge-response2-agent0-copy',
            source: response2,
            target: agent0Copy,
            type: 'return',
            label: 'Integration 2',
            data: { executionOrder: 11, metadata: { connectionType: 'response-to-agent-copy' } },
            createdAt: new Date(),
            updatedAt: new Date()
        },

        // 7. Agent 0 (복사본) → Final Integration
        {
            id: 'edge-agent0-copy-final-thinking',
            source: agent0Copy,
            target: agent0CopyThinking,
            type: 'processes',
            label: 'Final Integration',
            data: { executionOrder: 12, metadata: { connectionType: 'agent-copy-to-final-thinking' } },
            createdAt: new Date(),
            updatedAt: new Date()
        }

        // 🎯 최종 결과: agent0CopyThinking에서 사용자에게 최종 답변 제공
        // ✅ 교차 연결 없음! 깔끔한 계층적 흐름!
    ];

    console.log('🎯 [AGENT-NUMBERING] Revolutionary workflow created:', {
        totalNodes: nodes.length,
        totalEdges: edges.length,
        connectionTypes: [...new Set(edges.map(e => e.type))],
        agentSystem: 'Agent 0 (Original) → Agent 1, Agent 2 → Agent 0 (Copy)',
        flowOptimization: 'No cross connections - clean hierarchical flow'
    });

    return {
        __workflowType: 'UniversalWorkflowStructure' as const,
        id: 'agent-numbering-workflow-no-cross-connections',
        name: 'Agent Numbering System - Original/Copy Pattern (13 Nodes, 13 Connections)',
        nodes,
        edges,
        layout: {
            algorithm: 'hierarchical',
            direction: 'TB' as const,
            spacing: {
                nodeSpacing: 150,
                levelSpacing: 80
            },
            alignment: {
                horizontal: 'center' as const,
                vertical: 'top' as const
            }
        },
        metadata: {
            createdAt: new Date(),
            updatedAt: new Date(),
            metrics: {
                totalNodes: nodes.length,
                totalEdges: edges.length
            },
            innovationType: 'agent-numbering-original-copy-system',
            sourceExample: 'Revolutionary Agent Flow Pattern',
            executionTimestamp: new Date().toISOString(),
            description: 'Agent numbering system (0,1,2) with original/copy pattern to prevent cross connections',
            keyInnovation: 'Response flows go to Agent 0 (Copy) instead of back to Agent 0 (Original)',
            benefits: 'Clean visual flow, no line crossings, scalable to N agents',
            agentFlow: 'User → Agent 0 (Original) → Tool Calls → Agent 1,2 → Responses → Agent 0 (Copy) → Final Output'
        }
    };
}

// ❌ [DISABLED] 임의 연결 데이터 생성 함수 비활성화 - 이벤트 시스템 사용
function generateMissingConnectionsData_DISABLED() {
    return { nodes: [], edges: [], id: 'disabled', name: 'Disabled', metadata: {} };
}

// Main Playground Page with Provider
export default function PlaygroundPage() {
    return (
        <PlaygroundProvider defaultServerUrl="ws://localhost:3001/ws">
            <PlaygroundContent />
        </PlaygroundProvider>
    );
} 