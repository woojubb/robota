'use client';

/**
 * Workflow Visualization Component
 * 
 * Integrates React-Flow to visualize workflow structures in the playground
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
    ReactFlow,
    Node,
    Edge,
    Controls,
    MiniMap,
    Background,
    BackgroundVariant,
    useNodesState,
    useEdgesState,
    addEdge,
    Handle,
    Position,
    Connection,
    ReactFlowProvider,
    EdgeTypes,
    BaseEdge,
    getStraightPath,
    useReactFlow,
    NodeProps
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bot, Users, Zap, MessageSquare, MessageCircle, Settings, Wrench, LayoutGrid, RefreshCw } from 'lucide-react';
import type {
    UniversalWorkflowStructure,
    UniversalWorkflowNode,
    UniversalWorkflowEdge
} from '@robota-sdk/agents';
import { SimpleReactFlowConverter } from '@/lib/workflow-visualization';
import {
    layoutExistingFlow,
    LAYOUT_PRESETS,
    suggestOptimalLayout,
    type LayoutConfig
} from '@/lib/workflow-visualization/auto-layout';

interface WorkflowVisualizationProps {
    workflow?: UniversalWorkflowStructure;
    className?: string;
}

// STEP 12.0.3: 시각적 구분 시스템 - Custom Edge Components

/**
 * 정상 연결 Edge (초록색)
 */
const ConnectedEdge = ({ id, sourceX, sourceY, targetX, targetY }: any) => {
    const [edgePath] = getStraightPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
    });

    return (
        <BaseEdge
            path={edgePath}
            style={{
                stroke: '#10b981', // green-500
                strokeWidth: 2,
            }}
        />
    );
};

/**
 * 누락된 연결 Edge (빨간색 점선)
 */
const MissingEdge = ({ id, sourceX, sourceY, targetX, targetY }: any) => {
    const [edgePath] = getStraightPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
    });

    return (
        <BaseEdge
            path={edgePath}
            style={{
                stroke: '#ef4444', // red-500
                strokeWidth: 2,
                strokeDasharray: '5,5',
            }}
        />
    );
};

/**
 * 도메인 중립적 Tool Call Edge (오렌지색)
 */
const ToolCallEdge = ({ id, sourceX, sourceY, targetX, targetY }: any) => {
    const [edgePath] = getStraightPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
    });

    return (
        <BaseEdge
            path={edgePath}
            style={{
                stroke: '#f97316', // orange-500
                strokeWidth: 3,
            }}
        />
    );
};

/**
 * 재귀적 Agent 생성 Edge (보라색)
 */
const RecursiveAgentEdge = ({ id, sourceX, sourceY, targetX, targetY }: any) => {
    const [edgePath] = getStraightPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
    });

    return (
        <BaseEdge
            path={edgePath}
            style={{
                stroke: '#8b5cf6', // violet-500
                strokeWidth: 2,
                strokeDasharray: '10,5',
            }}
        />
    );
};

/**
 * Edge Types 정의 - 연결 상태 시각적 구분
 */
const edgeTypes: EdgeTypes = {
    connected: ConnectedEdge,        // ✅ 정상 연결 (초록색)
    missing: MissingEdge,            // ❌ 누락 연결 (빨간색 점선)
    toolCall: ToolCallEdge,          // 🔧 Tool Call (오렌지색)
    recursiveAgent: RecursiveAgentEdge, // 🔄 재귀 Agent (보라색)

    // 실제 SDK에서 생성되는 타입들 매핑
    processes: ConnectedEdge,        // 🎯 Agent → Agent Thinking (실제 SDK)
    contains: ConnectedEdge,         // Team → Agent
    receives: ConnectedEdge,         // User Input → Agent
    thinks: ConnectedEdge,           // Agent → Agent Thinking
    calls: ToolCallEdge,             // Agent Thinking → Tool Call
    creates: RecursiveAgentEdge,     // Tool Call → New Agent
};

/**
 * Custom Node Component for Agents
 */
const AgentNode = ({ data, sourcePosition, targetPosition }: NodeProps) => {
    // Status-based styling
    const getStatusStyles = (status?: string) => {
        switch (status) {
            case 'ready':
                return {
                    container: 'px-4 py-2 shadow-md rounded-md bg-white border-2 border-yellow-400',
                    icon: 'h-4 w-4 text-yellow-600',
                    badge: 'bg-yellow-100 text-yellow-800'
                };
            case 'running':
                return {
                    container: 'px-4 py-2 shadow-md rounded-md bg-white border-2 border-orange-400 animate-pulse',
                    icon: 'h-4 w-4 text-orange-600',
                    badge: 'bg-orange-100 text-orange-800'
                };
            case 'completed':
                return {
                    container: 'px-4 py-2 shadow-md rounded-md bg-white border-2 border-green-400',
                    icon: 'h-4 w-4 text-green-600',
                    badge: 'bg-green-100 text-green-800'
                };
            case 'error':
                return {
                    container: 'px-4 py-2 shadow-md rounded-md bg-white border-2 border-red-400',
                    icon: 'h-4 w-4 text-red-600',
                    badge: 'bg-red-100 text-red-800'
                };
            default: // pending or undefined
                return {
                    container: 'px-4 py-2 shadow-md rounded-md bg-white border-2 border-blue-400',
                    icon: 'h-4 w-4 text-blue-600',
                    badge: 'bg-blue-100 text-blue-800'
                };
        }
    };

    const styles = getStatusStyles(data.status);

    return (
        <div className={styles.container}>
            <div className="flex items-center gap-2">
                <Bot className={styles.icon} />
                <div className="text-sm font-semibold">{data.label}</div>
            </div>
            {data.taskName && (
                <div className="mt-1 text-xs text-gray-600 max-w-[150px] truncate">
                    {data.taskName}
                </div>
            )}
            {data.level && data.level > 0 && (
                <Badge className="mt-1 text-xs bg-gray-100 text-gray-700">
                    Level {data.level}
                </Badge>
            )}
            {data.status && (
                <Badge className={`mt-1 text-xs ${styles.badge}`}>
                    {data.status}
                </Badge>
            )}

            {/* Tool Slots - 사용 가능한 도구들 표시 */}
            {data.toolSlots && data.toolSlots.length > 0 && (
                <div className="mt-2 border-t pt-2">
                    <div className="text-xs text-gray-500 mb-1">Tools:</div>
                    <div className="flex flex-wrap gap-1">
                        {data.toolSlots.map((tool: string, index: number) => (
                            <div
                                key={index}
                                className="flex items-center gap-1 px-2 py-1 bg-gray-50 border border-gray-200 rounded text-xs"
                            >
                                <Wrench className="h-3 w-3 text-gray-600" />
                                <span className="text-gray-700">{tool}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Target handle - Agents receive connections from Team */}
            <Handle
                type="target"
                position={targetPosition || data.targetPosition || Position.Top}
                id="agent-input"
                style={{
                    background: '#2563eb',
                    width: 8,
                    height: 8,
                    top: (targetPosition || data.targetPosition) === Position.Top ? -4 : undefined,
                    bottom: (targetPosition || data.targetPosition) === Position.Bottom ? -4 : undefined,
                    left: (targetPosition || data.targetPosition) === Position.Left ? -4 : undefined,
                    right: (targetPosition || data.targetPosition) === Position.Right ? -4 : undefined,
                    border: '2px solid white'
                }}
            />

            {/* Source handle - Agents can connect to other nodes */}
            <Handle
                type="source"
                position={sourcePosition || data.sourcePosition || Position.Bottom}
                id="agent-output"
                style={{
                    background: '#2563eb',
                    width: 8,
                    height: 8,
                    top: (sourcePosition || data.sourcePosition) === Position.Top ? -4 : undefined,
                    bottom: (sourcePosition || data.sourcePosition) === Position.Bottom ? -4 : undefined,
                    left: (sourcePosition || data.sourcePosition) === Position.Left ? -4 : undefined,
                    right: (sourcePosition || data.sourcePosition) === Position.Right ? -4 : undefined,
                    border: '2px solid white'
                }}
            />
        </div>
    );
};

/**
 * Custom Node Component for Teams
 */
const TeamNode = ({ data, sourcePosition, targetPosition }: NodeProps) => {
    // Status-based styling for teams
    const getStatusStyles = (status?: string) => {
        switch (status) {
            case 'ready':
                return {
                    container: 'px-4 py-2 shadow-md rounded-md bg-white border-2 border-yellow-400',
                    icon: 'h-4 w-4 text-yellow-600',
                    badge: 'bg-yellow-100 text-yellow-800'
                };
            case 'running':
                return {
                    container: 'px-4 py-2 shadow-md rounded-md bg-white border-2 border-orange-400 animate-pulse',
                    icon: 'h-4 w-4 text-orange-600',
                    badge: 'bg-orange-100 text-orange-800'
                };
            case 'completed':
                return {
                    container: 'px-4 py-2 shadow-md rounded-md bg-white border-2 border-green-500',
                    icon: 'h-4 w-4 text-green-700',
                    badge: 'bg-green-100 text-green-800'
                };
            case 'error':
                return {
                    container: 'px-4 py-2 shadow-md rounded-md bg-white border-2 border-red-400',
                    icon: 'h-4 w-4 text-red-600',
                    badge: 'bg-red-100 text-red-800'
                };
            default: // pending or undefined
                return {
                    container: 'px-4 py-2 shadow-md rounded-md bg-white border-2 border-green-400',
                    icon: 'h-4 w-4 text-green-600',
                    badge: 'bg-green-100 text-green-800'
                };
        }
    };

    const styles = getStatusStyles(data.status);

    return (
        <div className={styles.container}>
            <div className="flex items-center gap-2">
                <Users className={styles.icon} />
                <div className="text-sm font-semibold">{data.label}</div>
            </div>
            {data.memberCount && (
                <Badge className={`mt-1 text-xs ${styles.badge}`}>
                    {data.memberCount} members
                </Badge>
            )}
            {data.status && (
                <Badge className={`mt-1 text-xs ${styles.badge}`}>
                    {data.status}
                </Badge>
            )}

            {/* Target handle - User Input connects to Team */}
            <Handle
                type="target"
                position={targetPosition || data.targetPosition || Position.Top}
                id="team-input"
                style={{
                    background: '#16a34a',
                    width: 8,
                    height: 8,
                    top: (targetPosition || data.targetPosition) === Position.Top ? -4 : undefined,
                    bottom: (targetPosition || data.targetPosition) === Position.Bottom ? -4 : undefined,
                    left: (targetPosition || data.targetPosition) === Position.Left ? -4 : undefined,
                    right: (targetPosition || data.targetPosition) === Position.Right ? -4 : undefined,
                    border: '2px solid white'
                }}
            />

            {/* Source handle - Team connects to Agents */}
            <Handle
                type="source"
                position={sourcePosition || data.sourcePosition || Position.Bottom}
                id="team-output"
                style={{
                    background: '#16a34a',
                    width: 8,
                    height: 8,
                    top: (sourcePosition || data.sourcePosition) === Position.Top ? -4 : undefined,
                    bottom: (sourcePosition || data.sourcePosition) === Position.Bottom ? -4 : undefined,
                    left: (sourcePosition || data.sourcePosition) === Position.Left ? -4 : undefined,
                    right: (sourcePosition || data.sourcePosition) === Position.Right ? -4 : undefined,
                    border: '2px solid white'
                }}
            />
        </div>
    );
};

/**
 * Custom Node Component for Tools
 */
const ToolNode = ({ data }: { data: any }) => {
    return (
        <div className="px-3 py-2 shadow-md rounded-md bg-white border-2 border-purple-400">
            <div className="flex items-center gap-2">
                <Zap className="h-3 w-3 text-purple-600" />
                <div className="text-xs font-medium">{data.label}</div>
            </div>
        </div>
    );
};

/**
 * Custom Node Component for User Input
 */
const UserInputNode = ({ data }: { data: any }) => {
    return (
        <div className="px-4 py-2 shadow-md rounded-md bg-white border-2 border-purple-400">
            <div className="flex items-center gap-2">
                <MessageSquare className="h-4 w-4 text-purple-600" />
                <div className="text-sm font-semibold">User Input</div>
            </div>
            {data.message && (
                <div className="mt-1 text-xs text-gray-600 max-w-[200px] truncate">
                    {data.message}
                </div>
            )}

            {/* Source handle - User Input connects to Agent */}
            <Handle
                type="source"
                position={Position.Bottom}
                id="user-output"
                style={{ background: '#9333ea' }}
            />
        </div>
    );
};

/**
 * Custom Node Component for Agent Response
 */
const AgentResponseNode = ({ data, sourcePosition, targetPosition }: NodeProps) => {
    return (
        <div className="px-4 py-2 shadow-md rounded-md bg-white border-2 border-teal-400">
            <div className="flex items-center gap-2">
                <MessageCircle className="h-4 w-4 text-teal-600" />
                <div className="text-sm font-semibold">Agent Response</div>
            </div>
            {data.response && (
                <div className="mt-1 text-xs text-gray-600 max-w-[200px] truncate">
                    {data.response}
                </div>
            )}

            {/* Target handle - Agent Response receives from Agent */}
            <Handle
                type="target"
                position={targetPosition || data.targetPosition || Position.Top}
                id="response-input"
                style={{
                    background: '#14b8a6',
                    width: 8,
                    height: 8,
                    top: (targetPosition || data.targetPosition) === Position.Top ? -4 : undefined,
                    bottom: (targetPosition || data.targetPosition) === Position.Bottom ? -4 : undefined,
                    left: (targetPosition || data.targetPosition) === Position.Left ? -4 : undefined,
                    right: (targetPosition || data.targetPosition) === Position.Right ? -4 : undefined,
                    border: '2px solid white'
                }}
            />
        </div>
    );
};

/**
 * Custom Node Component for Tool Calls
 */
const ToolCallNode = ({ data, sourcePosition, targetPosition }: NodeProps) => {
    return (
        <div className="px-3 py-2 shadow-md rounded-md bg-white border-2 border-orange-400">
            <div className="flex items-center gap-2">
                <Settings className="h-3 w-3 text-orange-600" />
                <div className="text-xs font-semibold">Tool Call</div>
            </div>
            {data.toolName && (
                <div className="mt-1 text-xs text-gray-600 max-w-[150px] truncate">
                    {data.toolName}
                </div>
            )}
            {data.status && (
                <Badge className="mt-1 text-xs bg-orange-100 text-orange-800">
                    {data.status}
                </Badge>
            )}

            {/* Target handle - Tool Call receives from Agent */}
            <Handle
                type="target"
                position={targetPosition || data.targetPosition || Position.Top}
                id="tool-input"
                style={{
                    background: '#ea580c',
                    width: 8,
                    height: 8,
                    top: (targetPosition || data.targetPosition) === Position.Top ? -4 : undefined,
                    bottom: (targetPosition || data.targetPosition) === Position.Bottom ? -4 : undefined,
                    left: (targetPosition || data.targetPosition) === Position.Left ? -4 : undefined,
                    right: (targetPosition || data.targetPosition) === Position.Right ? -4 : undefined,
                    border: '2px solid white'
                }}
            />

            {/* Source handle - Tool Call connects to Sub-Agent or Response */}
            <Handle
                type="source"
                position={sourcePosition || data.sourcePosition || Position.Bottom}
                id="tool-output"
                style={{
                    background: '#ea580c',
                    width: 8,
                    height: 8,
                    top: (sourcePosition || data.sourcePosition) === Position.Top ? -4 : undefined,
                    bottom: (sourcePosition || data.sourcePosition) === Position.Bottom ? -4 : undefined,
                    left: (sourcePosition || data.sourcePosition) === Position.Left ? -4 : undefined,
                    right: (sourcePosition || data.sourcePosition) === Position.Right ? -4 : undefined,
                    border: '2px solid white'
                }}
            />
        </div>
    );
};

// SubAgentNode 제거 - Agent 노드 타입으로 통일

// Node types for React-Flow
const nodeTypes = {
    agent: AgentNode,
    team: TeamNode,
    tool: ToolNode,
    userInput: UserInputNode,
    agentResponse: AgentResponseNode,
    toolCall: ToolCallNode
    // subAgent 제거 - 모든 Agent는 동일한 'agent' 타입 사용
};

function WorkflowVisualizationContent({ workflow, className }: WorkflowVisualizationProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [converter] = useState(() => new SimpleReactFlowConverter());
    const [selectedLayout, setSelectedLayout] = useState<keyof typeof LAYOUT_PRESETS>('vertical');
    const [isAutoLayoutEnabled, setIsAutoLayoutEnabled] = useState(true);
    const { fitView } = useReactFlow();

    // Auto layout function
    const applyAutoLayout = useCallback((layoutPreset?: keyof typeof LAYOUT_PRESETS) => {
        if (nodes.length === 0) return;

        const layoutToUse = layoutPreset || selectedLayout;
        const { nodes: layoutedNodes, edges: layoutedEdges } = layoutExistingFlow(
            nodes,
            edges,
            layoutToUse
        );

        setNodes(layoutedNodes);
        setEdges(layoutedEdges);

        // Fit view after layout with a slight delay
        setTimeout(() => fitView({ duration: 500, padding: 0.1 }), 100);
    }, [nodes, edges, selectedLayout, setNodes, setEdges, fitView]);

    // Auto-suggest optimal layout
    const suggestAndApplyOptimalLayout = useCallback(() => {
        if (nodes.length === 0) return;

        const suggestedLayout = suggestOptimalLayout(nodes, edges);
        setSelectedLayout(suggestedLayout);
        applyAutoLayout(suggestedLayout);
    }, [nodes, edges, applyAutoLayout]);

    // Convert workflow to React-Flow format
    useEffect(() => {
        const convertWorkflow = async () => {
            if (!workflow) {
                // Show empty state with sample nodes
                setNodes([
                    {
                        id: 'welcome',
                        type: 'default',
                        position: { x: 250, y: 100 },
                        data: { label: 'Create Agent or Team to start' },
                    }
                ]);
                setEdges([]);
                return;
            }

            try {
                const reactFlowData = await converter.convert(workflow);

                // 🧪 [DEBUG] React-Flow 데이터 출력
                console.log('🧪 [REACT-FLOW-DATA] === 완전한 데이터 덤프 ===');
                console.log('📊 [WORKFLOW-INPUT]:', JSON.stringify(workflow, null, 2));
                console.log('🔵 [NODES]:', JSON.stringify(reactFlowData.nodes, null, 2));
                console.log('🔗 [EDGES]:', JSON.stringify(reactFlowData.edges, null, 2));
                console.log('🧪 [REACT-FLOW-DATA] === 덤프 완료 ===');

                // Apply auto layout if enabled
                if (isAutoLayoutEnabled && reactFlowData.nodes.length > 0) {
                    const { nodes: layoutedNodes, edges: layoutedEdges } = layoutExistingFlow(
                        reactFlowData.nodes,
                        reactFlowData.edges,
                        selectedLayout
                    );
                    setNodes(layoutedNodes);
                    setEdges(layoutedEdges);

                    // Fit view after layout
                    setTimeout(() => fitView({ duration: 800, padding: 0.1 }), 200);
                } else {
                    setNodes(reactFlowData.nodes);
                    setEdges(reactFlowData.edges);
                }
            } catch (error) {
                console.error('Failed to convert workflow:', error);
                setNodes([
                    {
                        id: 'error',
                        type: 'default',
                        position: { x: 250, y: 100 },
                        data: { label: 'Error loading workflow' },
                    }
                ]);
                setEdges([]);
            }
        };

        convertWorkflow();
    }, [workflow, converter, isAutoLayoutEnabled, selectedLayout, fitView, setNodes, setEdges]);

    const onConnect = useCallback(
        (params: Connection) => setEdges((eds) => addEdge(params, eds)),
        [setEdges]
    );

    return (
        <Card className={className}>
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                        <Bot className="h-5 w-5" />
                        Workflow Visualization
                    </CardTitle>

                    {/* Auto Layout Controls */}
                    <div className="flex items-center gap-2">
                        <Select
                            value={selectedLayout}
                            onValueChange={(value: keyof typeof LAYOUT_PRESETS) => setSelectedLayout(value)}
                        >
                            <SelectTrigger className="w-32">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="vertical">Vertical</SelectItem>
                                <SelectItem value="horizontal">Horizontal</SelectItem>
                                <SelectItem value="compact">Compact</SelectItem>
                                <SelectItem value="spacious">Spacious</SelectItem>
                            </SelectContent>
                        </Select>

                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => applyAutoLayout()}
                            disabled={nodes.length === 0}
                            className="flex items-center gap-1"
                        >
                            <LayoutGrid className="h-4 w-4" />
                            Layout
                        </Button>

                        <Button
                            size="sm"
                            variant="outline"
                            onClick={suggestAndApplyOptimalLayout}
                            disabled={nodes.length === 0}
                            className="flex items-center gap-1"
                        >
                            <RefreshCw className="h-4 w-4" />
                            Auto
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                <div style={{ width: '100%', height: '400px' }}>
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        onConnect={onConnect}
                        nodeTypes={nodeTypes}
                        edgeTypes={edgeTypes}
                        fitView
                        attributionPosition="bottom-left"
                    >
                        <Controls />
                        <MiniMap />
                        <Background variant={BackgroundVariant.Dots} />
                    </ReactFlow>
                </div>
            </CardContent>
        </Card>
    );
}

export function WorkflowVisualization(props: WorkflowVisualizationProps) {
    return (
        <ReactFlowProvider>
            <WorkflowVisualizationContent {...props} />
        </ReactFlowProvider>
    );
}