'use client';

/**
 * Workflow Visualization Component
 * 
 * Integrates React-Flow to visualize workflow structures in the playground
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ReactFlow,
    Node,
    Edge,
    type NodeChange,
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
    getBezierPath,
    getStraightPath,
    useReactFlow,
    NodeProps,
    useStore
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Bot, MessageSquare, MessageCircle, Settings, Wrench, LayoutGrid, RefreshCw, Clipboard } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type {
    UniversalWorkflowStructure
} from '@robota-sdk/agents';
import { SimpleReactFlowConverter } from '@/lib/workflow-visualization';
import {
    useReactFlowProgressiveReveal,
    type ReactFlowProgressiveRevealConfig
} from '@/lib/workflow-visualization/react-flow/progressive-reveal-wrapper';
import {
    applyDagreLayout,
    layoutExistingFlow,
    LAYOUT_PRESETS,
    suggestOptimalLayout,
    calculateOptimalSpacing,
    type LayoutConfig
} from '@/lib/workflow-visualization/auto-layout';

interface WorkflowVisualizationProps {
    workflow?: UniversalWorkflowStructure;
    className?: string;
    onAgentNodeClick?: (nodeId: string, data: any) => void;
    onToolDrop?: (agentId: string, tool: { id: string; name: string; description?: string }) => void;
}

// Unified Chat System
type ChatNodeType = 'agent' | 'response';

/**
 * Extract Agent ID from node data based on node type
 */
const extractAgentId = (nodeData: any, nodeType: ChatNodeType): string | null => {
    if (nodeType === 'agent') {
        return nodeData.sourceId || nodeData.conversationId || null;
    } else if (nodeType === 'response') {
        return nodeData.extensions?.robota?.originalEvent?.rootExecutionId || null;
    }
    return null;
};

/**
 * Unified Chat Button Component
 * Used by both Agent and Response nodes
 */
const ChatButton = ({
    nodeData,
    nodeType,
    onChatOpen
}: {
    nodeData: any;
    nodeType: ChatNodeType;
    onChatOpen?: (agentId: string, nodeData: any) => void;
}) => {
    const handleChatClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        const agentId = extractAgentId(nodeData, nodeType);
        if (agentId && onChatOpen) {
            onChatOpen(agentId, nodeData);
        }
    };

    const title = nodeType === 'agent'
        ? "Chat with agent"
        : "Continue chat from this response";

    return (
        <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 p-0"
            onClick={handleChatClick}
            title={title}
        >
            <MessageCircle className="h-3 w-3" />
        </Button>
    );
};

// Base Node Template Types
type NodeType = 'agent' | 'team' | 'toolCall' | 'agentResponse' | 'tool' | 'user_message' | 'agent_thinking' | 'response' | 'tool_call' | 'tool_call_response' | 'tool_response' | 'tool_result';

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
            className="w-48 p-2.5 bg-gray-50 rounded-lg text-sm font-medium"
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
 * 정상 연결 Edge (부드러운 초록색 곡선 + 은은한 외곽선)
 */
const ConnectedEdge = ({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }: any) => {
    const [edgePath] = getBezierPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
        sourcePosition: sourcePosition ?? Position.Bottom,
        targetPosition: targetPosition ?? Position.Top,
    });

    return (
        // Outline layer (under) - light and subtle
        <>
            <BaseEdge
                path={edgePath}
                style={{
                    stroke: '#a7f3d0', // emerald-200 (subtle outline)
                    strokeWidth: 4,
                    strokeLinecap: 'round',
                }}
            />
            {/* Main layer (over) */}
            <BaseEdge
                path={edgePath}
                style={{
                    stroke: '#34d399', // emerald-400 (softer green)
                    strokeWidth: 2,
                    strokeLinecap: 'round',
                }}
            />
        </>
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
            console.log('🎯 Applying unified Dagre layout with actual node dimensions');

            try {
                // 실제 측정된 크기를 노드 데이터에 업데이트
                const nodesWithRealDimensions = nodes.map((node) => {
                    const nodeInternal = nodeInternals.get(node.id);
                    return {
                        ...node,
                        data: {
                            ...node.data,
                            actualWidth: nodeInternal?.width || 192,
                            actualHeight: nodeInternal?.height || 80
                        }
                    };
                });

                // 동적 간격 계산을 현재 레이아웃 설정에 병합
                const dynamicOverrides = calculateOptimalSpacing(nodesWithRealDimensions);
                const mergedConfig = { ...layoutConfig, ...dynamicOverrides };

                // 통합된 레이아웃 함수 사용 (실제 크기 반영 + 동적 간격)
                const { nodes: layoutedNodes } = applyDagreLayout(
                    nodesWithRealDimensions,
                    edges,
                    mergedConfig,
                    true // useActualDimensions flag
                );

                setNodes(layoutedNodes);
                setHasAppliedLayout(true);
                onLayoutComplete?.();
            } catch (error) {
                console.error('❌ Unified Dagre layout failed:', error);
                console.log('🔄 Falling back to estimated dimensions');
                setHasAppliedLayout(true); // Prevent retry loop
            }
        }
    }, [nodeInternals, getNodes, getEdges, setNodes, layoutConfig, hasAppliedLayout, onLayoutComplete]);

    // 레이아웃 재설정 함수
    const resetLayout = useCallback(() => {
        setHasAppliedLayout(false);
    }, []);

    // 레이아웃 설정이 변경되면 재적용
    useEffect(() => {
        setHasAppliedLayout(false);
    }, [layoutConfig]);

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
    // Use our styled edge as the default renderer so all unspecified edges get the style
    default: ConnectedEdge,
    connected: ConnectedEdge,        // ✅ 정상 연결 (초록색)
    missing: MissingEdge,            // ❌ 누락 연결 (빨간색 점선)
    toolCall: ToolCallEdge,          // 🔧 Tool Call (오렌지색)
    recursiveAgent: RecursiveAgentEdge, // 🔄 재귀 Agent (보라색)

    // 실제 SDK에서 생성되는 타입들 매핑
    processes: ConnectedEdge,        // user_message → agent_thinking
    continues: ConnectedEdge,        // response → user_message
    return: ConnectedEdge,           // agent_thinking → response
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

    // DnD interaction state
    const [isDropping, setIsDropping] = React.useState(false);
    const hoverCounterRef = React.useRef(0);
    const isToolMime = (e: React.DragEvent) => Array.from(e.dataTransfer.types || []).includes('application/robota-tool');

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
            <div
                className={`relative space-y-1.5 min-h-16 p-2 rounded-md ${isDropping ? 'ring-2 ring-blue-500 bg-blue-50/40' : ''}`}
                onDragEnter={(e) => {
                    if (!isToolMime(e)) return;
                    hoverCounterRef.current += 1;
                    setIsDropping(true);
                }}
                onDragOver={(e) => {
                    if (!isToolMime(e)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'copy';
                }}
                onDragLeave={(e) => {
                    if (!isToolMime(e)) return;
                    hoverCounterRef.current = Math.max(0, hoverCounterRef.current - 1);
                    if (hoverCounterRef.current === 0) setIsDropping(false);
                }}
                onDrop={(e) => {
                    if (!isToolMime(e)) return;
                    e.preventDefault();
                    hoverCounterRef.current = 0;
                    setIsDropping(false);
                    const raw = e.dataTransfer.getData('application/robota-tool');
                    if (!raw) return;
                    try {
                        const tool = JSON.parse(raw);
                        const agentId = (data && (data.sourceId || data.conversationId)) as string | undefined;
                        const onToolDrop = (data as any).__onToolDrop as undefined | ((agentId: string, tool: any) => void);
                        if (agentId && typeof onToolDrop === 'function') {
                            onToolDrop(agentId, tool);
                        }
                    } catch { /* ignore */ }
                }}
            >
                {/* Overlay during drop */}
                {isDropping && (
                    <div className="pointer-events-none absolute inset-0 border-2 border-dashed border-blue-400 flex items-center justify-center rounded-md">
                        <span className="text-xs font-medium text-blue-700 bg-white/70 px-2 py-0.5 rounded">Drop tool to add</span>
                    </div>
                )}
                {/* Simple header */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <Bot className="h-3 w-3 text-blue-600" />
                        <span className="text-sm font-medium text-gray-800">
                            {data.label || `Agent ${data.agentNumber || 0}`}
                        </span>
                        {data.copyNumber && data.copyNumber > 1 && (
                            <Badge variant="outline" className="text-xs">
                                Copy {data.copyNumber}
                            </Badge>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        <ChatButton
                            nodeData={data}
                            nodeType="agent"
                            onChatOpen={(data as any).__onChat}
                        />
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 p-0"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (typeof (data as any).__onEdit === 'function') {
                                    (data as any).__onEdit();
                                }
                            }}
                            title="Edit agent"
                        >
                            <Settings className="h-3 w-3" />
                        </Button>
                    </div>
                </div>

                {/* Essential info only */}
                <div className="flex items-center gap-1">
                    {data.aiProvider && (
                        <Badge className={`${styles.badge} text-xs`} data-nodrop="true">
                            {data.aiProvider}
                        </Badge>
                    )}
                    {(() => {
                        const toolsArr = Array.isArray(data.tools) ? (data.tools as string[]) : [];
                        const computedCount = toolsArr.length > 0
                            ? toolsArr.length
                            : (data.toolCount || (data.availableTools && data.availableTools.length) || (data.toolSlots && data.toolSlots.length) || 0);
                        return computedCount > 0 ? (
                            <Badge variant="outline" className="text-xs" data-nodrop="true">
                                <Wrench className="h-2.5 w-2.5 mr-0.5" />
                                {computedCount}
                            </Badge>
                        ) : null;
                    })()}
                </div>

                {/* Tool preview (from data.tools) */}
                {Array.isArray(data.tools) && (data.tools as string[]).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1" data-nodrop="true">
                        {(data.tools as string[]).slice(0, 3).map((t: string) => (
                            <Badge key={t} variant="outline" className="text-[10px]" data-nodrop="true">
                                {t}
                            </Badge>
                        ))}
                        {(data.tools as string[]).length > 3 && (
                            <span className="text-[10px] text-gray-500" data-nodrop="true">+{(data.tools as string[]).length - 3} more</span>
                        )}
                    </div>
                )}

                {/* System Message Preview */}
                {(() => {
                    const systemMessage = data?.systemMessage ||
                        data?.defaultModel?.systemMessage ||
                        data?.extensions?.robota?.originalEvent?.parameters?.systemMessage ||
                        data?.extensions?.robota?.originalEvent?.parameters?.defaultModel?.systemMessage;

                    if (systemMessage && typeof systemMessage === 'string') {
                        const truncated = systemMessage.length > 80
                            ? systemMessage.substring(0, 80) + '...'
                            : systemMessage;

                        return (
                            <div className="mt-1 p-1.5 bg-gray-50 rounded text-[10px] text-gray-600 border-l-2 border-blue-300">
                                <div className="flex items-center gap-1 mb-0.5">
                                    <MessageSquare className="h-2.5 w-2.5" />
                                    <span className="font-medium">System:</span>
                                </div>
                                <div className="leading-tight">{truncated}</div>
                            </div>
                        );
                    }
                    return null;
                })()}

                {/* Status if present */}
                {data.status && (
                    <Badge className={`${styles.badge} text-xs`}>
                        {typeof data.status === 'string' ? data.status : JSON.stringify(data.status)}
                    </Badge>
                )}
                {/* rest of content remains droppable */}
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
            <div>
                <div className="font-semibold text-gray-800 mb-1">
                    {data.label || 'Team'}
                </div>
                {data.memberCount && (
                    <div className="text-xs text-gray-600 truncate">
                        {typeof data.memberCount === 'number' || typeof data.memberCount === 'string' ? data.memberCount : JSON.stringify(data.memberCount)} members
                    </div>
                )}
                {data.status && (
                    <div className="text-xs text-gray-500 mt-1">
                        {typeof data.status === 'string' ? data.status : JSON.stringify(data.status)}
                    </div>
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
            <div>
                <div className="font-semibold text-gray-800 mb-1">
                    {data.label || 'Tool'}
                </div>
            </div>
        </BaseNodeTemplate>
    );
};

/**
 * Custom Node Component for User Message
 * Minimal display: just the user prompt content
 */
const UserMessageNode = ({ data }: { data: any }) => {
    // Extract user prompt from multiple possible paths
    const userPrompt = data.parameters?.userPrompt ||
        data.parameters?.userMessageContent ||
        data.userPrompt ||
        data.userMessageContent ||
        data.message ||
        'No content';

    // Truncate content to 80 characters for minimal display
    const maxContentLength = 80;
    const contentPreview = userPrompt.length > maxContentLength
        ? userPrompt.substring(0, maxContentLength) + '...'
        : userPrompt;

    return (
        <BaseNodeTemplate
            nodeType="user_message"
            data={data}
            handles={{
                target: true,
                source: true,
                targetId: "user-message-input",
                sourceId: "user-message-output"
            }}
        >
            <div className="space-y-1">
                {/* Minimal header */}
                <div className="flex items-center gap-1">
                    <MessageSquare className="h-3 w-3 text-blue-500" />
                    <span className="text-xs font-medium text-gray-700">User</span>
                </div>

                {/* User prompt content - essential information */}
                <div className="text-xs text-gray-800 leading-tight">
                    {contentPreview}
                </div>
            </div>
        </BaseNodeTemplate>
    );
};

/**
 * Custom Node Component for Agent Thinking
 */
const AgentThinkingNode = ({ data }: { data: any }) => {
    return (
        <BaseNodeTemplate
            nodeType="agent_thinking"
            data={data}
            handles={{
                target: true,
                source: true,
                targetId: "thinking-input",
                sourceId: "thinking-output"
            }}
        >
            <div>
                <div className="font-semibold text-gray-800 mb-1 text-center">
                    Agent is thinking...
                </div>
                {data.content && (
                    <div className="text-xs text-gray-600 truncate">
                        {typeof data.content === 'string' ? data.content : JSON.stringify(data.content)}
                    </div>
                )}
            </div>
        </BaseNodeTemplate>
    );
};

/**
 * Custom Node Component for Response
 * Minimal display: just the assistant message content
 */
const ResponseNode = ({ data }: { data: any }) => {
    // Extract assistant message from multiple possible paths
    const assistantMessage = data.parameters?.assistantMessage ||
        data.extensions?.robota?.originalEvent?.parameters?.assistantMessage ||
        data.assistantMessage ||
        data.content ||
        'No response';

    const agentNumber = data.agentNumber || 0;

    // Truncate content to 100 characters for minimal display
    const maxContentLength = 100;
    const contentPreview = assistantMessage.length > maxContentLength
        ? assistantMessage.substring(0, maxContentLength) + '...'
        : assistantMessage;

    return (
        <BaseNodeTemplate
            nodeType="response"
            data={data}
            handles={{
                target: true,
                source: true,
                targetId: "response-input",
                sourceId: "response-output"
            }}
        >
            <div className="space-y-1">
                {/* Header with chat button */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                        <MessageCircle className="h-3 w-3 text-green-500" />
                        <span className="text-xs font-medium text-gray-700">
                            Response {agentNumber > 0 ? agentNumber : ''}
                        </span>
                    </div>
                    <div className="flex gap-1">
                        <ChatButton
                            nodeData={data}
                            nodeType="response"
                            onChatOpen={(data as any).__onChat}
                        />
                    </div>
                </div>

                {/* Assistant message content - essential information */}
                <div className="text-xs text-gray-800 leading-tight">
                    {contentPreview}
                </div>
            </div>
        </BaseNodeTemplate>
    );
};

/**
 * Custom Node Component for Tool Call
 */
const ToolCallNode = ({ data }: { data: any }) => {
    return (
        <BaseNodeTemplate
            nodeType="tool_call"
            data={data}
            handles={{
                target: true,
                source: true,
                targetId: "tool-call-input",
                sourceId: "tool-call-output"
            }}
        >
            <div>
                <div className="font-semibold text-gray-800 mb-1 text-center">
                    Tool Call
                </div>
                {data.toolName && (
                    <div className="text-xs text-gray-600 truncate text-center">
                        {typeof data.toolName === 'string' ? data.toolName : JSON.stringify(data.toolName)}
                    </div>
                )}
            </div>
        </BaseNodeTemplate>
    );
};

/**
 * Custom Node Component for Tool Call Response
 * Minimal display: tool name and result preview
 */
const ToolCallResponseNode = ({ data }: { data: any }) => {
    // Extract tool response data from multiple possible paths
    const toolName = data.toolName || data.parameters?.toolName || 'Tool';
    const toolResult = data.result?.data ||
        data.parameters?.result?.data ||
        data.toolResult ||
        'No result';

    const success = data.result?.success ||
        data.parameters?.result?.success ||
        data.success !== false;

    // Truncate result to 80 characters for minimal display
    const maxResultLength = 80;
    const resultPreview = toolResult.length > maxResultLength
        ? toolResult.substring(0, maxResultLength) + '...'
        : toolResult;

    return (
        <BaseNodeTemplate
            nodeType="tool_call_response"
            data={data}
            handles={{
                target: true,
                source: true,
                targetId: "tool-call-response-input",
                sourceId: "tool-call-response-output"
            }}
        >
            <div className="space-y-1">
                {/* Minimal header */}
                <div className="flex items-center gap-1">
                    <Wrench className="h-3 w-3 text-purple-500" />
                    <span className="text-xs font-medium text-gray-700">{toolName}</span>
                    <div className={`w-2 h-2 rounded-full ${success ? 'bg-green-400' : 'bg-red-400'}`} />
                </div>

                {/* Tool result preview - essential information */}
                <div className="text-xs text-gray-800 leading-tight">
                    {resultPreview}
                </div>
            </div>
        </BaseNodeTemplate>
    );
};

/**
 * Custom Node Component for Tool Response
 * Minimal display: just the tool response content (following response node pattern)
 */
const ToolResponseNode = ({ data }: { data: any }) => {
    // Extract tool response from multiple possible paths
    const toolResponse = data.parameters?.result?.data ||
        data.result?.data ||
        data.response?.data ||
        data.content ||
        'No response';

    const toolName = data.toolName || data.parameters?.toolName || '';

    // Truncate content to 100 characters for minimal display (same as ResponseNode)
    const maxContentLength = 100;
    const contentPreview = toolResponse.length > maxContentLength
        ? toolResponse.substring(0, maxContentLength) + '...'
        : toolResponse;

    return (
        <BaseNodeTemplate
            nodeType="tool_response"
            data={data}
            handles={{
                target: true,
                source: true,
                targetId: "tool-response-input",
                sourceId: "tool-response-output"
            }}
        >
            <div className="space-y-1">
                {/* Minimal header */}
                <div className="flex items-center gap-1">
                    <MessageCircle className="h-3 w-3 text-green-500" />
                    <span className="text-xs font-medium text-gray-700">
                        Tool Response {toolName && `(${toolName})`}
                    </span>
                </div>

                {/* Tool response content - essential information */}
                <div className="text-xs text-gray-800 leading-tight">
                    {contentPreview}
                </div>
            </div>
        </BaseNodeTemplate>
    );
};

/**
 * Custom Node Component for Tool Result
 */
const ToolResultNode = ({ data }: { data: any }) => {
    return (
        <BaseNodeTemplate
            nodeType="tool_result"
            data={data}
            handles={{
                target: true,
                source: true, // Enable outgoing handle for tool result nodes
                targetId: "tool-result-input",
                sourceId: "tool-result-output"
            }}
        >
            <div>
                <div className="font-semibold text-gray-800 mb-1 text-center">
                    Tool Result
                </div>
                {data.value && (
                    <div className="text-xs text-gray-600 truncate">
                        {typeof data.value === 'string' ? data.value : JSON.stringify(data.value)}
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
            <div>
                <div className="font-semibold text-gray-800 mb-1 text-center">
                    Agent Response
                </div>
                {data.response && (
                    <div className="text-xs text-gray-600 truncate">
                        {typeof data.response === 'string' ? data.response : JSON.stringify(data.response)}
                    </div>
                )}
            </div>
        </BaseNodeTemplate>
    );
};

/**
 * Custom Node Component for Tool Calls (Legacy)
 */
const LegacyToolCallNode = ({ data, sourcePosition, targetPosition }: NodeProps<any>) => {
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
            <div>
                <div className="font-semibold text-gray-800 mb-1 text-center">
                    Tool Call
                </div>
                {data.toolName && (
                    <div className="text-xs text-gray-600 truncate">
                        {typeof data.toolName === 'string' ? data.toolName : JSON.stringify(data.toolName)}
                    </div>
                )}
                {data.status && (
                    <div className="text-xs text-gray-500 mt-1">
                        {typeof data.status === 'string' ? data.status : JSON.stringify(data.status)}
                    </div>
                )}
            </div>
        </BaseNodeTemplate>
    );
};

/**
 * Placeholder Node Component for simple visualization
 * - No handles (connections disabled)
 * - Dotted border styling
 * - Minimal content display
 */
const PlaceholderNode = ({ data }: { data: any }) => {
    const label = data.label || data.name || 'Placeholder';
    const description = data.description || data.content || '';

    return (
        <div
            className="w-48 p-2.5 bg-gray-50 rounded-lg text-sm font-medium border-2 border-dashed border-gray-300"
            data-node-type="placeholder"
        >
            <div className="flex items-center gap-2 mb-1">
                <span className="text-gray-700 font-medium">{label}</span>
            </div>

            {description && (
                <div className="text-xs text-gray-500 mt-1">
                    {description.length > 80 ? description.substring(0, 80) + '...' : description}
                </div>
            )}

            {/* No handles - placeholder nodes don't connect */}
        </div>
    );
};

// SubAgentNode 제거 - Agent 노드 타입으로 통일

// Node types for React-Flow
const nodeTypes = {
    agent: AgentNode as any,
    team: TeamNode as any,
    tool: ToolNode as any,
    user_message: UserMessageNode as any,
    agent_thinking: AgentThinkingNode as any,
    response: ResponseNode as any,
    tool_call: ToolCallNode as any,
    tool_call_response: ToolCallResponseNode as any,
    tool_response: ToolResponseNode as any,
    tool_result: ToolResultNode as any,
    agentResponse: AgentResponseNode as any,
    toolCall: LegacyToolCallNode as any,
    placeholder: PlaceholderNode as any
    // userInput 제거 - 레거시 타입
};

// Local child component to show Agent details with mock endpoint generation
const AgentDetailsContent = ({ data, node }: { data: any; node: any }) => {
    const [endpoint, setEndpoint] = React.useState<string | null>(null);
    const handleGenerateEndpoint = () => {
        const base = typeof window !== 'undefined' ? window.location.origin : 'https://example.com';
        const id = String(node?.id || data?.sourceId || 'agent');
        const token = Math.random().toString(36).slice(2, 10);
        const url = `${base}/api/agents/${encodeURIComponent(id)}/${token}`;
        setEndpoint(url);
        console.info(`[PLAYGROUND] Mock API endpoint created: ${url}`);
    };

    const tools: string[] = Array.isArray(data?.tools)
        ? data.tools
        : (data?.extensions?.robota?.originalEvent?.parameters?.tools as string[] | undefined) || [];

    // Extract system message from various possible locations
    const systemMessage = data?.systemMessage ||
        data?.defaultModel?.systemMessage ||
        data?.extensions?.robota?.originalEvent?.parameters?.systemMessage ||
        data?.extensions?.robota?.originalEvent?.parameters?.defaultModel?.systemMessage;

    // Extract model information
    const modelInfo = data?.defaultModel || data?.extensions?.robota?.originalEvent?.parameters?.defaultModel;

    return (
        <div className="space-y-3">
            <div className="border-l-4 border-blue-500 pl-3">
                <h3 className="text-sm font-medium text-gray-900 mb-2">Agent Configuration</h3>

                {/* Model Information */}
                {modelInfo && (
                    <div className="mb-3">
                        <h4 className="text-xs font-medium text-gray-700 mb-1">Model</h4>
                        <div className="flex gap-2 text-xs">
                            <Badge variant="outline">{modelInfo.provider || 'Unknown'}</Badge>
                            <Badge variant="outline">{modelInfo.model || 'Unknown'}</Badge>
                            {modelInfo.temperature && (
                                <Badge variant="outline">temp: {modelInfo.temperature}</Badge>
                            )}
                        </div>
                    </div>
                )}

                {/* System Message */}
                {systemMessage && (
                    <div className="mb-3">
                        <h4 className="text-xs font-medium text-gray-700 mb-1">System Message</h4>
                        <div className="text-xs text-gray-600 bg-gray-50 p-2 rounded overflow-y-auto">
                            {systemMessage}
                        </div>
                    </div>
                )}

                {/* Tools */}
                <div className="mb-3">
                    <h4 className="text-xs font-medium text-gray-700 mb-1">Tools</h4>
                    {tools.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                            {tools.map((tool: string) => (
                                <Badge key={tool} variant="outline" className="text-xs">
                                    <Wrench className="h-3 w-3 mr-1" />{tool}
                                </Badge>
                            ))}
                        </div>
                    ) : (
                        <div className="text-xs text-gray-500">No tools</div>
                    )}
                </div>

                <div className="mt-3 space-y-2">
                    <Button
                        size="sm"
                        onClick={() => {
                            if (endpoint) {
                                setEndpoint(null);
                                console.info('[PLAYGROUND] Mock API endpoint revoked');
                            } else {
                                handleGenerateEndpoint();
                            }
                        }}
                    >
                        {endpoint ? 'Revoke endpoint' : 'Generate API endpoint'}
                    </Button>
                    {endpoint && (
                        <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded px-2 py-1 break-all">
                            Created: {endpoint}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// Specialized content rendering for different node types
const renderNodeContent = (node: Node): React.ReactElement | null => {
    const data = (node as any).data;
    const nodeType = String(node.type);

    switch (nodeType) {
        case 'agent': {
            return (
                <AgentDetailsContent data={data} node={node as any} />
            );
        }
        case 'user_message':
            return (
                <div className="space-y-3">
                    <div className="border-l-4 border-blue-500 pl-3">
                        <h3 className="text-sm font-medium text-gray-900 mb-2">User Prompt</h3>
                        <div className="text-sm text-gray-800 bg-blue-50 p-3 rounded">
                            {data.parameters?.userPrompt ||
                                data.parameters?.userMessageContent ||
                                data.userPrompt ||
                                data.userMessageContent ||
                                data.message ||
                                'No content available'}
                        </div>
                        {data.parameters?.messageLength && (
                            <div className="text-xs text-gray-500 mt-2">
                                Length: {data.parameters.messageLength} characters
                            </div>
                        )}
                    </div>
                </div>
            );

        case 'response':
            const assistantMessage = data.parameters?.assistantMessage ||
                data.extensions?.robota?.originalEvent?.parameters?.assistantMessage ||
                data.assistantMessage ||
                data.content ||
                'No response available';
            return (
                <div className="space-y-3">
                    <div className="border-l-4 border-green-500 pl-3">
                        <h3 className="text-sm font-medium text-gray-900 mb-2">Assistant Response</h3>
                        <div className="text-sm text-gray-800 bg-green-50 p-3 rounded max-h-96 overflow-y-auto">
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                                    code: ({ children, className }) => (
                                        <code className={`${className} bg-gray-100 px-1 py-0.5 rounded text-xs`}>
                                            {children}
                                        </code>
                                    ),
                                    pre: ({ children }) => (
                                        <pre className="bg-gray-100 p-2 rounded text-xs overflow-x-auto">
                                            {children}
                                        </pre>
                                    )
                                }}
                            >
                                {assistantMessage}
                            </ReactMarkdown>
                        </div>
                        <div className="flex gap-4 text-xs text-gray-500 mt-2">
                            {data.parameters?.responseLength && (
                                <span>Length: {data.parameters.responseLength} characters</span>
                            )}
                            {data.parameters?.wordCount && (
                                <span>Words: {data.parameters.wordCount}</span>
                            )}
                            {data.agentNumber > 0 && (
                                <span>Agent: {data.agentNumber}</span>
                            )}
                        </div>
                    </div>
                </div>
            );

        case 'tool_call_response':
            const toolName = data.toolName || data.parameters?.toolName || 'Tool';
            const toolResult = data.result?.data ||
                data.parameters?.result?.data ||
                data.toolResult ||
                'No result available';
            const toolSuccess = data.result?.success ||
                data.parameters?.result?.success ||
                data.success !== false;

            return (
                <div className="space-y-3">
                    <div className="border-l-4 border-purple-500 pl-3">
                        <h3 className="text-sm font-medium text-gray-900 mb-2">Tool Response</h3>

                        {/* Tool info */}
                        <div className="flex items-center gap-2 mb-3">
                            <Badge variant="outline" className="text-xs">
                                {toolName}
                            </Badge>
                            <div className={`flex items-center gap-1 text-xs ${toolSuccess ? 'text-green-600' : 'text-red-600'}`}>
                                <div className={`w-2 h-2 rounded-full ${toolSuccess ? 'bg-green-400' : 'bg-red-400'}`} />
                                {toolSuccess ? 'Success' : 'Failed'}
                            </div>
                        </div>

                        {/* Tool result */}
                        <div className="text-sm text-gray-800 bg-purple-50 p-3 rounded max-h-64 overflow-y-auto">
                            {toolResult}
                        </div>

                        {/* Additional metrics if available */}
                        <div className="flex gap-4 text-xs text-gray-500 mt-2">
                            {data.parameters?.metadata?.executionId && (
                                <span>ID: {data.parameters.metadata.executionId.substring(0, 8)}...</span>
                            )}
                            {data.parameters?.executionLevel && (
                                <span>Level: {data.parameters.executionLevel}</span>
                            )}
                        </div>
                    </div>
                </div>
            );

        case 'tool_response':
            const toolResponseData = data.parameters?.result?.data ||
                data.result?.data ||
                data.response?.data ||
                data.content ||
                'No response available';
            return (
                <div className="space-y-3">
                    <div className="border-l-4 border-green-500 pl-3">
                        <h3 className="text-sm font-medium text-gray-900 mb-2">Tool Response</h3>
                        <div className="text-sm text-gray-800 bg-green-50 p-3 rounded max-h-96 overflow-y-auto">
                            <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={{
                                    p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                                    code: ({ children, className }) => (
                                        <code className={`${className} bg-gray-100 px-1 py-0.5 rounded text-xs`}>
                                            {children}
                                        </code>
                                    ),
                                    pre: ({ children }) => (
                                        <pre className="bg-gray-100 p-2 rounded text-xs overflow-x-auto">
                                            {children}
                                        </pre>
                                    )
                                }}
                            >
                                {toolResponseData}
                            </ReactMarkdown>
                        </div>
                        <div className="flex gap-4 text-xs text-gray-500 mt-2">
                            {data.parameters?.responseLength && (
                                <span>Length: {data.parameters.responseLength} characters</span>
                            )}
                            {data.toolName && (
                                <span>Tool: {data.toolName}</span>
                            )}
                            {data.parameters?.toolName && (
                                <span>Tool: {data.parameters.toolName}</span>
                            )}
                        </div>
                    </div>
                </div>
            );

        default:
            // For other node types, show basic info if available
            const basicInfo = data.description || data.label;
            if (basicInfo) {
                return (
                    <div className="space-y-2">
                        <div className="text-sm text-gray-700 p-3 bg-gray-50 rounded">
                            {basicInfo}
                        </div>
                    </div>
                );
            }
            return null;
    }
};

function WorkflowVisualizationContent({ workflow, className, onAgentNodeClick, onToolDrop }: WorkflowVisualizationProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [converter] = useState(() => new SimpleReactFlowConverter());
    const [selectedLayout, setSelectedLayout] = useState<keyof typeof LAYOUT_PRESETS>('compact');
    const [isAutoLayoutEnabled, setIsAutoLayoutEnabled] = useState(true);
    const [currentLayoutConfig, setCurrentLayoutConfig] = useState<LayoutConfig>(LAYOUT_PRESETS.compact);
    const { fitView, setCenter, getZoom, getNode, updateNodeInternals } = useReactFlow() as any;
    const [isInfoOpen, setIsInfoOpen] = useState(false);
    const [selectedNode, setSelectedNode] = useState<Node | null>(null);

    // Centering control state
    const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
    const [layoutReady, setLayoutReady] = useState(false);
    const rafForCenterRef = useRef<number | null>(null);
    const nodeInternals = useStore((state: any) => state.nodeInternals);

    // Progressive Reveal Configuration
    const [isProgressiveRevealEnabled, setIsProgressiveRevealEnabled] = useState(true);
    const [fullTargetNodes, setFullTargetNodes] = useState<Node[]>([]);
    const [fullTargetEdges, setFullTargetEdges] = useState<Edge[]>([]);
    const lastAddedNodeIdRef = useRef<string | null>(null);
    const hasAppliedMeasuredLayoutRef = useRef(false);

    // Intentionally not reacting to node data changes

    // Progressive Reveal Configuration
    const progressiveRevealConfig: ReactFlowProgressiveRevealConfig = {
        enabled: isProgressiveRevealEnabled,
        intervalMs: 500,
        bundleSize: 1
    };

    // Progressive Reveal Hook
    const progressiveReveal = useReactFlowProgressiveReveal({
        nodes: fullTargetNodes,
        edges: fullTargetEdges,
        config: progressiveRevealConfig
    });

    // 레이아웃 적용 함수 - DynamicDagreLayout 컴포넌트를 통해서만 처리
    const applyAutoLayout = useCallback((layoutPreset?: keyof typeof LAYOUT_PRESETS) => {
        if (nodes.length === 0) return;

        const layoutToUse = layoutPreset || selectedLayout;
        setSelectedLayout(layoutToUse);
        setCurrentLayoutConfig(LAYOUT_PRESETS[layoutToUse]);

        // DynamicDagreLayout 컴포넌트를 통해 레이아웃 적용
        // setTimeout(() => {
        //     (window as any).__resetDagreLayout?.();
        // }, 50);
    }, [nodes.length, selectedLayout]);

    // Apply layout using unified system
    const handleApplyLayout = useCallback((presetName: keyof typeof LAYOUT_PRESETS) => {
        applyAutoLayout(presetName);
    }, [applyAutoLayout]);

    // Auto-suggest optimal layout
    const suggestAndApplyOptimalLayout = useCallback(() => {
        if (nodes.length === 0) return;

        const suggestedLayout = suggestOptimalLayout(nodes, edges);
        setSelectedLayout(suggestedLayout);
        applyAutoLayout(suggestedLayout);
    }, [nodes, edges, applyAutoLayout]);

    // Center the most recently added node when React Flow reports node updates (dimensions/position)
    const handleNodesChange = useCallback((changes: NodeChange[]) => {
        onNodesChange(changes);

        const lastId = lastAddedNodeIdRef.current;
        if (!lastId || !changes || changes.length === 0) return;

        const hasRelevantUpdate = changes.some(
            (c: any) => c && c.id === lastId && (c.type === 'dimensions' || c.type === 'position')
        );
        if (!hasRelevantUpdate) return;

        // Use latest RF node (ensures measured width/height and final position)
        const rfNode = typeof (getNode as any) === 'function' ? (getNode as any)(lastId) : null;
        if (!rfNode || typeof rfNode?.position?.x !== 'number' || typeof rfNode?.position?.y !== 'number') return;

        const width = rfNode.width ?? rfNode?.data?.actualWidth ?? rfNode?.data?.computedWidth ?? 192;
        const height = rfNode.height ?? rfNode?.data?.actualHeight ?? rfNode?.data?.computedHeight ?? 80;

        if (typeof width !== 'number' || typeof height !== 'number') return;

        const centerX = rfNode.position.x + width / 2;
        const centerY = rfNode.position.y + height / 2;
        const zoom = typeof getZoom === 'function' ? getZoom() : 1;
        setCenter(centerX, centerY, { duration: 600, zoom });

        // React only to actual size changes for relayout
        const hasDimensionChange = changes.some((c: any) => c && c.type === 'dimensions');
        if (hasDimensionChange) {
            hasAppliedMeasuredLayoutRef.current = false;
        }
    }, [onNodesChange, getNode, getZoom, setCenter]);

    // Centering effect: run when focus target is set. Uses a short RAF loop
    // to wait for actual measurement if it's not yet available.
    useEffect(() => {
        if (!focusNodeId) return;

        let attempts = 0;
        const maxAttempts = 16; // ~16 frames ≈ 250ms at 60fps

        const tryCenter = () => {
            attempts += 1;
            // Prefer React Flow store node (ensures latest position + measured size)
            const rfNode = typeof getNode === 'function' ? getNode(focusNodeId) : null;
            const positionedNode = rfNode;
            const pos = (positionedNode as any)?.position;

            // Fallback to computed dimensions if actual not measured yet
            const width = (rfNode?.width ?? (positionedNode as any)?.data?.actualWidth ?? (positionedNode as any)?.data?.computedWidth ?? 192);
            const height = (rfNode?.height ?? (positionedNode as any)?.data?.actualHeight ?? (positionedNode as any)?.data?.computedHeight ?? 80);

            // if (
            //     pos && typeof pos.x === 'number' && typeof pos.y === 'number' &&
            //     typeof width === 'number' && typeof height === 'number'
            // ) {
            //     const centerX = pos.x + width / 2;
            //     const centerY = pos.y + height / 2;
            //     const zoom = typeof getZoom === 'function' ? getZoom() : 1;

            //     setCenter(centerX, centerY, { duration: 600, zoom });
            //     return; // success; stop loop
            // }

            if (attempts < maxAttempts) {
                rafForCenterRef.current = requestAnimationFrame(tryCenter);
            }
        };

        if (rafForCenterRef.current) cancelAnimationFrame(rafForCenterRef.current);
        rafForCenterRef.current = requestAnimationFrame(tryCenter);

        return () => {
            if (rafForCenterRef.current) cancelAnimationFrame(rafForCenterRef.current);
        };
    }, [focusNodeId, nodeInternals, getZoom, setCenter]);

    // Cleanup pending RAF on unmount
    useEffect(() => {
        return () => {
            if (rafForCenterRef.current) cancelAnimationFrame(rafForCenterRef.current);
        };
    }, []);

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
                hasWorkflow: !!dumpData.workflow
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
                // Reset states for empty workflow
                setFullTargetNodes([]);
                setFullTargetEdges([]);
                setNodes([]);
                setEdges([]);
                hasAppliedMeasuredLayoutRef.current = false;
                return;
            }

            try {
                // Reset measured layout flag for new workflow
                hasAppliedMeasuredLayoutRef.current = false;

                const reactFlowData = await converter.convert(workflow);
                console.log('🧪 [REACT-FLOW-DATA] Conversion completed');

                // Determine target graph (pre-layout when enabled)
                let targetNodes: Node[] = reactFlowData.nodes;
                let targetEdges: Edge[] = reactFlowData.edges;

                if (isAutoLayoutEnabled && reactFlowData.nodes.length > 0) {
                    const { nodes: layoutedNodes, edges: layoutedEdges } = layoutExistingFlow(
                        reactFlowData.nodes,
                        reactFlowData.edges,
                        selectedLayout
                    );
                    targetNodes = layoutedNodes;
                    targetEdges = layoutedEdges;
                }

                // Unified chat handler for all node types
                const handleUnifiedChat = (agentId: string, nodeData: any) => {
                    onAgentNodeClick?.(agentId, nodeData);
                };

                // Attach callbacks to agent and response nodes (chat/edit)
                const augmentCallbacks = (list: Node[]): Node[] =>
                    list.map((n) => {
                        if (n.type === 'agent') {
                            return {
                                ...n,
                                data: {
                                    ...n.data,
                                    __onChat: handleUnifiedChat,
                                    __onEdit: () => {
                                        setSelectedNode(n);
                                        setIsInfoOpen(true);
                                    },
                                    __onToolDrop: (agentId: string, tool: any) => {
                                        if (typeof onToolDrop === 'function') {
                                            onToolDrop(agentId, tool);
                                        }
                                    }
                                },
                            };
                        } else if (n.type === 'response') {
                            return {
                                ...n,
                                data: {
                                    ...n.data,
                                    __onChat: handleUnifiedChat,
                                },
                            };
                        }
                        return n;
                    });

                targetNodes = augmentCallbacks(targetNodes);

                // Store full target data for Progressive Reveal
                setFullTargetNodes(targetNodes);
                setFullTargetEdges(targetEdges);

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
    }, [workflow, converter, isAutoLayoutEnabled, selectedLayout, onAgentNodeClick, onToolDrop]);

    // Apply measured layout once nodes are rendered and Progressive Reveal is complete
    useEffect(() => {
        if (!isAutoLayoutEnabled || fullTargetNodes.length === 0 || hasAppliedMeasuredLayoutRef.current) {
            return;
        }

        // Wait for Progressive Reveal to complete
        if (isProgressiveRevealEnabled && !progressiveReveal.isComplete) {
            return;
        }

        // Wait for nodes to be rendered and measured
        const applyMeasuredLayout = () => {
            requestAnimationFrame(() => {
                // Check if nodeInternals is available
                if (!nodeInternals || typeof nodeInternals.get !== 'function') {
                    return;
                }

                const measuredNodes = fullTargetNodes.map(node => {
                    const internalNode = nodeInternals.get(node.id);
                    if (internalNode && internalNode.width && internalNode.height) {
                        return {
                            ...node,
                            data: {
                                ...node.data,
                                actualWidth: internalNode.width,
                                actualHeight: internalNode.height
                            }
                        };
                    }
                    return node;
                });

                // Check if ALL nodes have actual measurements
                const allMeasured = measuredNodes.every(n => n.data.actualWidth && n.data.actualHeight);

                if (allMeasured) {


                    // Re-apply layout with actual dimensions
                    const layoutedData = applyDagreLayout(
                        measuredNodes,
                        fullTargetEdges,
                        LAYOUT_PRESETS[selectedLayout],
                        true // useActualDimensions = true
                    );

                    // Update full target nodes with measured layout
                    setFullTargetNodes(layoutedData.nodes);
                    // Also update rendered nodes so measured positions are applied
                    setNodes(layoutedData.nodes);
                    hasAppliedMeasuredLayoutRef.current = true;
                }
            });
        };

        // Delay to ensure nodes are rendered and retry if needed
        let attempts = 0;
        const maxAttempts = 10;

        const tryApplyLayout = () => {
            if (attempts >= maxAttempts) {
                return;
            }

            attempts++;
            applyMeasuredLayout();

            // If not applied yet, retry
            if (!hasAppliedMeasuredLayoutRef.current && attempts < maxAttempts) {
                setTimeout(tryApplyLayout, 200);
            }
        };

        const timeoutId = setTimeout(tryApplyLayout, 300);

        return () => clearTimeout(timeoutId);
    }, [nodeInternals, fullTargetNodes.length, fullTargetEdges, isAutoLayoutEnabled, selectedLayout, isProgressiveRevealEnabled, progressiveReveal.isComplete]);

    // Apply Progressive Reveal incremental actions to React Flow
    useEffect(() => {
        if (!isProgressiveRevealEnabled) {
            // Immediate display when Progressive Reveal is disabled
            setNodes(fullTargetNodes);
            setEdges(fullTargetEdges);
            return;
        }

        // Handle Progressive Reveal actions
        switch (progressiveReveal.action) {
            case 'init':
                // Do nothing; wait for add_node actions
                break;

            case 'add_node':
                if (progressiveReveal.nodeToAdd) {
                    // Add new node incrementally
                    setNodes(prev => {
                        // Check if node already exists to avoid duplicates
                        if (prev.some(n => n.id === progressiveReveal.nodeToAdd!.id)) {
                            return prev;
                        }
                        console.log('➕ [PROGRESSIVE] Adding node:', progressiveReveal.nodeToAdd!.id);
                        return [...prev, progressiveReveal.nodeToAdd!];
                    });

                    // Add new edges if any
                    if (progressiveReveal.edgesToAdd && progressiveReveal.edgesToAdd.length > 0) {
                        setEdges(prev => {
                            const existingEdgeIds = new Set(prev.map(e => e.id));
                            const newEdges = progressiveReveal.edgesToAdd!.filter(e => !existingEdgeIds.has(e.id));
                            if (newEdges.length > 0) {
                                console.log('🔗 [PROGRESSIVE] Adding edges:', newEdges.map(e => e.id));
                                return [...prev, ...newEdges];
                            }
                            return prev;
                        });
                    }

                    // Set focus for centering
                    lastAddedNodeIdRef.current = progressiveReveal.nodeToAdd.id;
                    setFocusNodeId(progressiveReveal.nodeToAdd.id);
                }
                break;

            case 'complete':
                console.log('✅ [PROGRESSIVE] All nodes revealed');
                break;
        }
    }, [
        isProgressiveRevealEnabled,
        progressiveReveal.action,
        progressiveReveal.nodeToAdd?.id,
        progressiveReveal.edgesToAdd?.length,
        progressiveReveal.isComplete,
        fullTargetNodes,
        fullTargetEdges
    ]);

    // Reconcile updates for already-rendered nodes (e.g., tools list changes)
    useEffect(() => {
        if (!isProgressiveRevealEnabled) return;
        if (fullTargetNodes.length === 0) return;

        setNodes((prev) => {
            if (prev.length === 0) return prev;

            const map = new Map(fullTargetNodes.map((n) => [n.id, n]));
            let changed = false;
            const next = prev.map((n) => {
                const updated = map.get(n.id);
                if (!updated) return n;
                // If data reference changed, merge to reflect updated config (e.g., tools)
                if (
                    updated.data !== n.data ||
                    updated.type !== n.type ||
                    (updated.position?.x !== n.position?.x) ||
                    (updated.position?.y !== n.position?.y)
                ) {
                    changed = true;
                    return {
                        ...n,
                        type: updated.type ?? n.type,
                        data: { ...n.data, ...updated.data },
                        position: updated.position ?? n.position
                    } as Node;
                }
                return n;
            });
            return changed ? next : prev;
        });
    }, [fullTargetNodes, isProgressiveRevealEnabled, setNodes]);

    const onConnect = useCallback(
        (params: Connection) => setEdges((eds) => addEdge(params, eds)),
        [setEdges]
    );

    const handleNodeClick = useCallback((_: any, node: Node) => {
        setSelectedNode(node);
        setIsInfoOpen(true);
    }, []);

    return (
        <>
            <Card className={`${className} h-full flex flex-col`}>
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
                                onClick={() => setIsProgressiveRevealEnabled(!isProgressiveRevealEnabled)}
                                variant={isProgressiveRevealEnabled ? "default" : "outline"}
                                size="sm"
                                title={isProgressiveRevealEnabled ? "Disable Progressive Reveal (Show all at once)" : "Enable Progressive Reveal (Show nodes sequentially)"}
                            >
                                {isProgressiveRevealEnabled ? "Sequential" : "Immediate"}
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
                <CardContent className="flex-1 min-h-0 p-0">
                    <div className="w-full h-full min-h-0"
                        onDragOver={(e) => {
                            if (e.dataTransfer.types.includes('application/robota-tool')) {
                                e.preventDefault();
                            }
                        }}
                        onDrop={(e) => {
                            const data = e.dataTransfer.getData('application/robota-tool');
                            if (data) {
                                try {
                                    const tool = JSON.parse(data);
                                    console.info('[PLAYGROUND] Tool dropped:', tool);
                                    // Future: create a tool_call node at drop position
                                } catch { }
                            }
                        }}
                    >
                        <ReactFlow
                            nodes={nodes}
                            edges={edges}
                            onNodesChange={handleNodesChange}
                            onEdgesChange={onEdgesChange}
                            onConnect={onConnect}
                            onNodeClick={handleNodeClick}
                            nodeTypes={nodeTypes}
                            edgeTypes={edgeTypes}
                            attributionPosition="bottom-left"
                        >
                            {/* 동적 Dagre 레이아웃 컴포넌트 */}
                            <DynamicDagreLayout
                                layoutConfig={currentLayoutConfig}
                                onLayoutComplete={() => {
                                    setLayoutReady(true);
                                }}
                            />

                            <Controls />
                            <MiniMap />
                            <Background variant={BackgroundVariant.Dots} />
                        </ReactFlow>
                    </div>
                </CardContent>
            </Card>

            {/* Node Info Modal */}
            <Modal
                isOpen={isInfoOpen}
                onClose={() => setIsInfoOpen(false)}
                title="Node Details"
                size="lg"
            >
                <div className="p-6 space-y-4">
                    {selectedNode && (
                        <div className="space-y-4">
                            {/* Header - Simplified */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Badge variant="outline" className="text-xs">{String(selectedNode.type)}</Badge>
                                    <span className="font-medium">{(selectedNode as any).data?.label || (selectedNode as any).data?.name || 'Node'}</span>
                                </div>
                                <div className="text-xs text-gray-500 font-mono">
                                    {selectedNode.id.substring(0, 8)}...
                                </div>
                            </div>

                            {/* Specialized Content Rendering */}
                            {renderNodeContent(selectedNode)}

                            {/* Raw Data (Compact) */}
                            <details className="border rounded">
                                <summary className="px-3 py-2 bg-gray-50 text-sm font-medium cursor-pointer hover:bg-gray-100 flex items-center justify-between">
                                    <span>Raw Data</span>
                                    <span className="text-xs text-gray-500">Click to expand</span>
                                </summary>
                                <div className="p-3 text-xs bg-gray-50 max-h-64 overflow-auto">
                                    <pre className="whitespace-pre-wrap text-gray-700 leading-relaxed">{JSON.stringify((selectedNode as any).data, null, 2)}</pre>
                                </div>
                            </details>
                        </div>
                    )}
                    {!selectedNode && (
                        <div className="text-sm text-gray-500">No node selected</div>
                    )}
                    <div className="flex justify-end">
                        <Button size="sm" variant="outline" onClick={() => setIsInfoOpen(false)}>Close</Button>
                    </div>
                </div>
            </Modal>
        </>
    );
}

export function WorkflowVisualization(props: WorkflowVisualizationProps) {
    return (
        <ReactFlowProvider>
            <WorkflowVisualizationContent {...props} />
            {/* Node Info Modal */}
            {/* Placed outside to avoid re-mounting ReactFlow; uses portal modal */}
        </ReactFlowProvider>
    );
}