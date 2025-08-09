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
    NodeProps,
    useStore
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bot, Users, Zap, MessageSquare, MessageCircle, Settings, Wrench, LayoutGrid, RefreshCw, Clipboard } from 'lucide-react';
import type {
    UniversalWorkflowStructure
} from '@robota-sdk/agents';
import { SimpleReactFlowConverter } from '@/lib/workflow-visualization';
import {
    layoutExistingFlow,
    LAYOUT_PRESETS,
    suggestOptimalLayout,
    type LayoutConfig
} from '@/lib/workflow-visualization/auto-layout';
import dagre from 'dagre';

interface WorkflowVisualizationProps {
    workflow?: UniversalWorkflowStructure;
    className?: string;
}

// Base Node Template Types
type NodeType = 'agent' | 'team' | 'toolCall' | 'agentResponse' | 'tool' | 'userInput';

interface BaseNodeTemplateProps {
    nodeType: NodeType;
    data: any;
    sourcePosition?: Position;
    targetPosition?: Position;
    children: React.ReactNode;
    handles?: {
        target?: boolean;
        source?: boolean;
        targetId?: string;
        sourceId?: string;
    };
}

/**
 * Base Node Template Component
 * 
 * 모든 커스텀 노드의 공통 구조와 Handle 로직을 추상화
 * - 외부 div에 data-node-type, data-status 속성 설정
 * - Handle 위치와 ID 자동 관리
 * - CSS에서 노드 타입별 스타일링 적용
 */
const BaseNodeTemplate = ({
    nodeType,
    data,
    sourcePosition,
    targetPosition,
    children,
    handles = { target: true, source: true }
}: BaseNodeTemplateProps) => {
    return (
        <div
            className="bg-white"
            data-status={data.status}
            data-node-type={nodeType}
        >
            {children}

            {handles.target && (
                <Handle
                    type="target"
                    position={targetPosition || data.targetPosition || Position.Top}
                    id={handles.targetId || `${nodeType}-input`}
                />
            )}

            {handles.source && (
                <Handle
                    type="source"
                    position={sourcePosition || data.sourcePosition || Position.Bottom}
                    id={handles.sourceId || `${nodeType}-output`}
                />
            )}
        </div>
    );
};

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
 * Dynamic Dagre Layout Component 
 * React Flow Provider 내부에서 실행되어 실제 노드 크기로 레이아웃 재계산
 */
const DynamicDagreLayout = ({
    layoutConfig,
    onLayoutComplete
}: {
    layoutConfig: LayoutConfig;
    onLayoutComplete?: () => void;
}) => {
    const { getNodes, getEdges, setNodes } = useReactFlow();
    const nodeInternals = useStore((state: any) => state.nodeInternals);
    const [hasAppliedLayout, setHasAppliedLayout] = useState(false);

    useEffect(() => {
        // React Flow가 완전히 초기화되었는지 확인
        if (!getNodes || !getEdges || !setNodes) {
            console.log('🔄 React Flow not ready yet, skipping layout');
            return;
        }

        // React Flow 내부 상태에서 실제 렌더링된 노드 크기 가져오기
        const nodes = getNodes();
        const edges = getEdges();

        // 노드가 없으면 레이아웃 불필요
        if (nodes.length === 0) {
            return;
        }

        // nodeInternals가 존재하고 값이 있는지 확인
        if (!nodeInternals || typeof nodeInternals.values !== 'function') {
            console.log('🔄 NodeInternals not ready yet, skipping layout');
            return;
        }

        // 모든 노드가 실제 크기를 가지고 있는지 확인
        const nodesWithDimensions = Array.from(nodeInternals.values());
        const allNodesHaveDimensions = nodesWithDimensions.length > 0 &&
            nodesWithDimensions.every((node: any) => node.width && node.height);

        if (allNodesHaveDimensions && !hasAppliedLayout && nodes.length > 0) {
            console.log('🎯 Applying dynamic Dagre layout with actual node dimensions');

            try {
                // Dagre 그래프 생성
                const dagreGraph = new dagre.graphlib.Graph();
                dagreGraph.setDefaultEdgeLabel(() => ({}));
                dagreGraph.setGraph({
                    rankdir: layoutConfig.rankdir,
                    align: layoutConfig.align,
                    nodesep: layoutConfig.nodesep,
                    edgesep: layoutConfig.edgesep,
                    ranksep: layoutConfig.ranksep,
                    marginx: layoutConfig.marginx,
                    marginy: layoutConfig.marginy
                });

                // 실제 측정된 크기로 노드 설정
                nodesWithDimensions.forEach((nodeInternal: any) => {
                    if (nodeInternal && nodeInternal.id) {
                        dagreGraph.setNode(nodeInternal.id, {
                            width: nodeInternal.width || 200,
                            height: nodeInternal.height || 80
                        });
                    }
                });

                // 엣지 설정
                edges.forEach((edge) => {
                    dagreGraph.setEdge(edge.source, edge.target);
                });

                // Dagre 레이아웃 실행
                dagre.layout(dagreGraph);

                // 레이아웃 결과를 React Flow 노드에 적용
                const isHorizontal = layoutConfig.rankdir === 'LR' || layoutConfig.rankdir === 'RL';
                const sourcePos = isHorizontal ? Position.Right : Position.Bottom;
                const targetPos = isHorizontal ? Position.Left : Position.Top;

                const layoutedNodes = nodes.map((node) => {
                    const nodeWithPosition = dagreGraph.node(node.id);
                    const nodeInternal = nodeInternals.get(node.id);

                    return {
                        ...node,
                        position: {
                            x: nodeWithPosition.x - (nodeInternal?.width || 200) / 2,
                            y: nodeWithPosition.y - (nodeInternal?.height || 80) / 2
                        },
                        sourcePosition: sourcePos,
                        targetPosition: targetPos,
                        data: {
                            ...node.data,
                            computedWidth: nodeInternal?.width || 200,
                            computedHeight: nodeInternal?.height || 80,
                            sourcePosition: sourcePos,
                            targetPosition: targetPos
                        }
                    };
                });

                setNodes(layoutedNodes);
                setHasAppliedLayout(true);
                onLayoutComplete?.();
            } catch (error) {
                console.error('❌ Dynamic Dagre layout failed:', error);
                // Fallback to simple layout without nodeInternals
                console.log('🔄 Falling back to basic layout without node dimensions');
                setHasAppliedLayout(true); // Prevent retry loop
            }
        }
    }, [nodeInternals, getNodes, getEdges, setNodes, layoutConfig, hasAppliedLayout, onLayoutComplete]);

    // 레이아웃 재설정 함수
    const resetLayout = useCallback(() => {
        setHasAppliedLayout(false);
    }, []);

    // 외부에서 재레이아웃 트리거할 수 있도록 노출
    useEffect(() => {
        (window as any).__resetDagreLayout = resetLayout;
        return () => {
            delete (window as any).__resetDagreLayout;
        };
    }, [resetLayout]);

    return null;
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
const AgentNode = ({ data, sourcePosition, targetPosition }: NodeProps<any>) => {
    // Status-based icon and badge styling (border now handled by CSS)
    const getStatusStyles = (status?: string) => {
        switch (status) {
            case 'ready':
                return {
                    icon: 'h-4 w-4 text-yellow-600',
                    badge: 'bg-yellow-100 text-yellow-800'
                };
            case 'running':
                return {
                    icon: 'h-4 w-4 text-orange-600',
                    badge: 'bg-orange-100 text-orange-800'
                };
            case 'completed':
                return {
                    icon: 'h-4 w-4 text-green-600',
                    badge: 'bg-green-100 text-green-800'
                };
            case 'error':
                return {
                    icon: 'h-4 w-4 text-red-600',
                    badge: 'bg-red-100 text-red-800'
                };
            default: // pending or undefined
                return {
                    icon: 'h-4 w-4 text-blue-600',
                    badge: 'bg-blue-100 text-blue-800'
                };
        }
    };

    const styles = getStatusStyles(data.status);

    return (
        <BaseNodeTemplate
            nodeType="agent"
            data={data}
            sourcePosition={sourcePosition}
            targetPosition={targetPosition}
            handles={{
                target: true,
                source: true,
                targetId: "agent-input",
                sourceId: "agent-output"
            }}
        >
            <div className="px-3 py-1.5">
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
            </div>
        </BaseNodeTemplate>
    );
};

/**
 * Custom Node Component for Teams
 */
const TeamNode = ({ data, sourcePosition, targetPosition }: NodeProps<any>) => {
    // Status-based styling for teams (border now handled by CSS)
    const getStatusStyles = (status?: string) => {
        switch (status) {
            case 'ready':
                return {
                    icon: 'h-4 w-4 text-yellow-600',
                    badge: 'bg-yellow-100 text-yellow-800'
                };
            case 'running':
                return {
                    icon: 'h-4 w-4 text-orange-600',
                    badge: 'bg-orange-100 text-orange-800'
                };
            case 'completed':
                return {
                    icon: 'h-4 w-4 text-green-700',
                    badge: 'bg-green-100 text-green-800'
                };
            case 'error':
                return {
                    icon: 'h-4 w-4 text-red-600',
                    badge: 'bg-red-100 text-red-800'
                };
            default: // pending or undefined
                return {
                    icon: 'h-4 w-4 text-green-600',
                    badge: 'bg-green-100 text-green-800'
                };
        }
    };

    const styles = getStatusStyles(data.status);

    return (
        <BaseNodeTemplate
            nodeType="team"
            data={data}
            sourcePosition={sourcePosition}
            targetPosition={targetPosition}
            handles={{
                target: true,
                source: true,
                targetId: "team-input",
                sourceId: "team-output"
            }}
        >
            <div className="px-3 py-1.5">
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
            </div>
        </BaseNodeTemplate>
    );
};

/**
 * Custom Node Component for Tools
 */
const ToolNode = ({ data }: { data: any }) => {
    return (
        <BaseNodeTemplate
            nodeType="tool"
            data={data}
            handles={{
                target: false,
                source: false
            }}
        >
            <div className="px-3 py-1.5">
                <div className="flex items-center gap-2">
                    <Zap className="h-3 w-3 text-purple-600" />
                    <div className="text-xs font-medium">{data.label}</div>
                </div>
            </div>
        </BaseNodeTemplate>
    );
};

/**
 * Custom Node Component for User Input
 */
const UserInputNode = ({ data }: { data: any }) => {
    return (
        <BaseNodeTemplate
            nodeType="userInput"
            data={data}
            handles={{
                target: false,
                source: true,
                sourceId: "user-output"
            }}
        >
            <div className="px-3 py-1.5">
                <div className="flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-purple-600" />
                    <div className="text-sm font-semibold">User Input</div>
                </div>
                {data.message && (
                    <div className="mt-1 text-xs text-gray-600 max-w-[200px] truncate">
                        {data.message}
                    </div>
                )}
            </div>
        </BaseNodeTemplate>
    );
};

/**
 * Custom Node Component for Agent Response
 */
const AgentResponseNode = ({ data, sourcePosition, targetPosition }: NodeProps<any>) => {
    return (
        <BaseNodeTemplate
            nodeType="agentResponse"
            data={data}
            sourcePosition={sourcePosition}
            targetPosition={targetPosition}
            handles={{
                target: true,
                source: false,
                targetId: "response-input"
            }}
        >
            <div className="px-3 py-1.5">
                <div className="flex items-center gap-2">
                    <MessageCircle className="h-4 w-4 text-teal-600" />
                    <div className="text-sm font-semibold">Agent Response</div>
                </div>
                {data.response && (
                    <div className="mt-1 text-xs text-gray-600 max-w-[200px] truncate">
                        {data.response}
                    </div>
                )}
            </div>
        </BaseNodeTemplate>
    );
};

/**
 * Custom Node Component for Tool Calls
 */
const ToolCallNode = ({ data, sourcePosition, targetPosition }: NodeProps<any>) => {
    return (
        <BaseNodeTemplate
            nodeType="toolCall"
            data={data}
            sourcePosition={sourcePosition}
            targetPosition={targetPosition}
            handles={{
                target: true,
                source: true,
                targetId: "tool-input",
                sourceId: "tool-output"
            }}
        >
            <div className="px-3 py-1.5">
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
            </div>
        </BaseNodeTemplate>
    );
};

// SubAgentNode 제거 - Agent 노드 타입으로 통일

// Node types for React-Flow
const nodeTypes = {
    agent: AgentNode as any,
    team: TeamNode as any,
    tool: ToolNode as any,
    userInput: UserInputNode as any,
    agentResponse: AgentResponseNode as any,
    toolCall: ToolCallNode as any
    // subAgent 제거 - 모든 Agent는 동일한 'agent' 타입 사용
};

function WorkflowVisualizationContent({ workflow, className }: WorkflowVisualizationProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [converter] = useState(() => new SimpleReactFlowConverter());
    const [selectedLayout, setSelectedLayout] = useState<keyof typeof LAYOUT_PRESETS>('compact');
    const [isAutoLayoutEnabled, setIsAutoLayoutEnabled] = useState(true);
    const [currentLayoutConfig, setCurrentLayoutConfig] = useState<LayoutConfig>(LAYOUT_PRESETS.compact);
    const { fitView } = useReactFlow();

    // Apply layout using DynamicDagreLayout
    const handleApplyLayout = useCallback((presetName: keyof typeof LAYOUT_PRESETS) => {
        setSelectedLayout(presetName);
        setCurrentLayoutConfig(LAYOUT_PRESETS[presetName]);
        // 레이아웃 재설정 트리거
        if ((window as any).__resetDagreLayout) {
            (window as any).__resetDagreLayout();
        }
    }, []);

    // Legacy auto layout function (fallback)
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

    // 🔍 Data Dump 기능 - 현재 workflow 데이터를 클립보드에 복사
    const handleDataDump = useCallback(async () => {
        try {
            // Single source of truth: dump only workflow (UI derives reactFlow data)
            const dumpData = {
                timestamp: new Date().toISOString(),
                workflow,
                totalNodes: workflow?.nodes?.length ?? 0,
                totalEdges: workflow?.edges?.length ?? 0
            };

            const jsonString = JSON.stringify(dumpData, null, 2);
            await navigator.clipboard.writeText(jsonString);

            console.log('📋 [DATA-DUMP] Workflow data copied to clipboard');
            console.log('📊 Summary:', {
                nodes: dumpData.totalNodes,
                edges: dumpData.totalEdges,
                types: dumpData.nodeTypes
            });

            // Toast 알림 (선택사항)
            alert(`✅ Workflow data copied to clipboard!\nNodes: ${dumpData.totalNodes}, Edges: ${dumpData.totalEdges}`);
        } catch (error) {
            console.error('❌ Failed to copy workflow data:', error);
            alert('❌ Failed to copy workflow data to clipboard');
        }
    }, [workflow]);

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
                // console.log('🧪 [REACT-FLOW-DATA] === 완전한 데이터 덤프 ===');
                // console.log('📊 [WORKFLOW-INPUT]:', JSON.stringify(workflow, null, 2));
                // console.log('🔵 [NODES]:', JSON.stringify(reactFlowData.nodes, null, 2));
                // console.log('🔗 [EDGES]:', JSON.stringify(reactFlowData.edges, null, 2));
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

                    {/* Auto Layout Controls + Data Dump */}
                    <div className="flex items-center gap-2">
                        {/* Data Dump Button */}
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={handleDataDump}
                            className="flex items-center gap-2"
                            title="Copy current workflow data to clipboard"
                        >
                            <Clipboard className="h-4 w-4" />
                            Dump Data
                        </Button>

                        <Select
                            value={selectedLayout}
                            onValueChange={(value: keyof typeof LAYOUT_PRESETS) => handleApplyLayout(value)}
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
                            onClick={() => handleApplyLayout(selectedLayout)}
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
                        {/* 동적 Dagre 레이아웃 컴포넌트 */}
                        <DynamicDagreLayout
                            layoutConfig={currentLayoutConfig}
                            onLayoutComplete={() => {
                                console.log('✅ Dynamic layout applied successfully');
                                // Fit view after layout completion
                                setTimeout(() => fitView({ duration: 500, padding: 0.1 }), 100);
                            }}
                        />

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