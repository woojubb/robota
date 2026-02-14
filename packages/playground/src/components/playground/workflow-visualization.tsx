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
    EdgeProps,
    type NodeChange,
    NodeTypes,
    NodeMouseHandler,
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
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Modal } from '../ui/modal';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Bot, MessageSquare, MessageCircle, Settings, Wrench, LayoutGrid, RefreshCw, Clipboard } from 'lucide-react';
import { WebLogger } from '../../lib/web-logger';
import { useToast } from '../../hooks/use-toast';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { IPlaygroundToolMeta } from '../../tools/catalog';
import type { IToolResult, TContextData, TLoggerData, TUniversalValue } from '@robota-sdk/agents';
import type {
    IWorkflowExportStructure,
    IWorkflowNodeExtensions
} from '@robota-sdk/workflow';
import { UniversalToReactFlowConverter } from '../../lib/workflow-visualization';
import {
    useReactFlowProgressiveReveal,
    type IReactFlowProgressiveRevealConfig
} from '../../lib/workflow-visualization/react-flow/progressive-reveal-wrapper';
import {
    applyDagreLayout,
    layoutExistingFlow,
    LAYOUT_PRESETS,
    suggestOptimalLayout,
    calculateOptimalSpacing,
    type ILayoutConfig
} from '../../lib/workflow-visualization/auto-layout';

interface IWorkflowVisualizationProps {
    workflow?: IWorkflowExportStructure;
    className?: string;
    onAgentNodeClick?: (nodeId: string, data: IWorkflowVisualizationNodeData) => void;
    onToolDrop?: (agentId: string, tool: IPlaygroundToolMeta) => void;
    toolItems?: IPlaygroundToolMeta[];
    addedToolsByAgent?: Record<string, string[]>;
}

type TWorkflowVisualizationNodeValue = TUniversalValue | Date | Error | TLoggerData;

interface IWorkflowVisualizationModelInfo {
    provider?: string;
    model?: string;
    temperature?: number;
    systemMessage?: string;
    [key: string]: string | number | boolean | undefined;
}

interface IWorkflowVisualizationResultData {
    data?: TUniversalValue;
    success?: boolean;
    [key: string]: TUniversalValue | boolean | undefined;
}

interface IWorkflowVisualizationMetadata {
    executionId?: string;
    [key: string]: TUniversalValue | undefined;
}

interface IWorkflowVisualizationParameters {
    userPrompt?: string;
    userMessageContent?: string;
    assistantMessage?: string;
    toolName?: string;
    result?: IWorkflowVisualizationResultData;
    messageLength?: number;
    responseLength?: number;
    wordCount?: number;
    executionLevel?: number;
    metadata?: IWorkflowVisualizationMetadata;
    tools?: string[];
    systemMessage?: string;
    defaultModel?: IWorkflowVisualizationModelInfo;
    [key: string]:
    | TUniversalValue
    | IWorkflowVisualizationResultData
    | IWorkflowVisualizationMetadata
    | IWorkflowVisualizationModelInfo
    | string[]
    | undefined;
}

interface IWorkflowVisualizationNodeData {
    label?: string;
    name?: string;
    description?: string;
    status?: string;
    sourceId?: string;
    conversationId?: string;
    message?: string;
    content?: string;
    userPrompt?: string;
    userMessageContent?: string;
    assistantMessage?: string;

    agentNumber?: number;
    copyNumber?: number;

    aiProvider?: string;
    tools?: string[];
    toolCount?: number;
    availableTools?: string[];
    toolSlots?: string[];

    memberCount?: number;

    toolName?: string;
    toolResult?: TUniversalValue;
    response?: string;
    success?: boolean;
    result?: IWorkflowVisualizationResultData;
    parameters?: IWorkflowVisualizationParameters;
    sourcePosition?: Position;
    targetPosition?: Position;

    systemMessage?: string;
    defaultModel?: IWorkflowVisualizationModelInfo;
    extensions?: {
        robota?: {
            originalEvent?: {
                rootExecutionId?: string;
                parameters?: IWorkflowVisualizationParameters;
            };
        };
        [platformName: string]: Record<string, TUniversalValue | undefined> | undefined;
    };

    __addedTools?: IPlaygroundToolMeta[];
    __onChat?: (agentId: string, nodeData: IWorkflowVisualizationNodeData) => void;
    __onEdit?: () => void;
    __onToolDrop?: (agentId: string, tool: IPlaygroundToolMeta) => void;

    [key: string]:
    | TWorkflowVisualizationNodeValue
    | IToolResult
    | TContextData
    | IWorkflowNodeExtensions
    | IWorkflowVisualizationParameters
    | IWorkflowVisualizationResultData
    | IWorkflowVisualizationModelInfo
    | IPlaygroundToolMeta[]
    | ((agentId: string, nodeData: IWorkflowVisualizationNodeData) => void)
    | (() => void)
    | ((agentId: string, tool: IPlaygroundToolMeta) => void)
    | undefined;
}

type TWorkflowVisualizationNode = Node<IWorkflowVisualizationNodeData>;

function toText(value: TUniversalValue | undefined, fallback: string): string {
    if (typeof value === 'string' && value.length > 0) {
        return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === 'object' && value !== null) {
        return JSON.stringify(value, null, 2);
    }
    return fallback;
}

// Unified Chat System
type TChatNodeKind = 'agent' | 'response';

function isPlaygroundToolMeta(value: unknown): value is IPlaygroundToolMeta {
    if (!value || typeof value !== 'object') return false;
    const obj = value as { id?: unknown; name?: unknown; description?: unknown; tags?: unknown };
    if (typeof obj.id !== 'string' || obj.id.length === 0) return false;
    if (typeof obj.name !== 'string' || obj.name.length === 0) return false;
    if (typeof obj.description !== 'undefined' && typeof obj.description !== 'string') return false;
    if (typeof obj.tags !== 'undefined' && !Array.isArray(obj.tags)) return false;
    return true;
}

function getToolsList(nodeData: IWorkflowVisualizationNodeData): string[] {
    if (!Array.isArray(nodeData.tools)) {
        return [];
    }
    return nodeData.tools.filter((tool): tool is string => typeof tool === 'string');
}

/**
 * Extract Agent ID from node data based on node type
 */
const extractAgentId = (nodeData: IWorkflowVisualizationNodeData, nodeType: TChatNodeKind): string | null => {
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
    nodeData: IWorkflowVisualizationNodeData;
    nodeType: TChatNodeKind;
    onChatOpen?: (agentId: string, nodeData: IWorkflowVisualizationNodeData) => void;
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
type TNodeKind = 'agent' | 'team' | 'toolCall' | 'agentResponse' | 'tool' | 'user_message' | 'agent_thinking' | 'response' | 'tool_call' | 'tool_call_response' | 'tool_response' | 'tool_result';

interface INodeTemplateProps {
    nodeType: TNodeKind;
    data: IWorkflowVisualizationNodeData;
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
 * Abstracts shared node structure and React Flow Handle logic for custom nodes.
 * - Sets `data-node-type` and `data-status` on the outer container.
 * - Manages Handle positions and IDs.
 * - Enables node-type styling via CSS selectors.
 */
const BaseNodeTemplate = ({
    nodeType,
    data,
    sourcePosition,
    targetPosition,
    children,
    handles = { target: true, source: true }
}: INodeTemplateProps) => {
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

// Visual distinction system - Custom Edge Components

/**
 * Connected Edge (smooth green curve with a subtle outline)
 */
const ConnectedEdge = ({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition }: EdgeProps) => {
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
                className="stroke-emerald-200 stroke-[4]"
            />
            {/* Main layer (over) */}
            <BaseEdge
                path={edgePath}
                className="stroke-emerald-400 stroke-[2]"
            />
        </>
    );
};

/**
 * Missing Edge (red dashed line)
 */
const MissingEdge = ({ sourceX, sourceY, targetX, targetY }: EdgeProps) => {
    const [edgePath] = getStraightPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
    });

    return (
        <BaseEdge
            path={edgePath}
            className="stroke-red-500 stroke-[2] [stroke-dasharray:5,5]"
        />
    );
};

/**
 * Domain-neutral Tool Call Edge (orange)
 */
const ToolCallEdge = ({ sourceX, sourceY, targetX, targetY }: EdgeProps) => {
    const [edgePath] = getStraightPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
    });

    return (
        <BaseEdge
            path={edgePath}
            className="stroke-orange-500 stroke-[3]"
        />
    );
};

/**
 * Recursive agent creation Edge (purple)
 */
const RecursiveAgentEdge = ({ sourceX, sourceY, targetX, targetY }: EdgeProps) => {
    const [edgePath] = getStraightPath({
        sourceX,
        sourceY,
        targetX,
        targetY,
    });

    return (
        <BaseEdge
            path={edgePath}
            className="stroke-violet-500 stroke-[2] [stroke-dasharray:10,5]"
        />
    );
};

/**
 * Dynamic Dagre Layout Component 
 * Runs inside the React Flow Provider and recomputes layout using measured node dimensions.
 */
const DynamicDagreLayout = ({
    layoutConfig,
    onLayoutComplete
}: {
    layoutConfig: ILayoutConfig;
    onLayoutComplete?: () => void;
}) => {
    const { getNodes, getEdges, setNodes } = useReactFlow();
    const nodeInternals = useStore(
        (state) => (state as unknown as { nodeInternals: Map<string, { width?: number; height?: number }> }).nodeInternals
    );
    const [hasAppliedLayout, setHasAppliedLayout] = useState(false);

    useEffect(() => {
        // Ensure React Flow is fully initialized.
        if (!getNodes || !getEdges || !setNodes) {
            WebLogger.debug('React Flow not ready yet, skipping layout');
            return;
        }

        // Read measured node dimensions from React Flow internals.
        const nodes = getNodes();
        const edges = getEdges();

        // No nodes means there is nothing to layout.
        if (nodes.length === 0) {
            return;
        }

        // Ensure nodeInternals is ready.
        if (!nodeInternals || typeof nodeInternals.values !== 'function') {
            WebLogger.debug('NodeInternals not ready yet, skipping layout');
            return;
        }

        // Ensure all nodes have measured dimensions before applying layout.
        const nodesWithDimensions = Array.from(nodeInternals.values());
        const allNodesHaveDimensions = nodesWithDimensions.length > 0 &&
            nodesWithDimensions.every((node) => Boolean(node.width) && Boolean(node.height));

        if (allNodesHaveDimensions && !hasAppliedLayout && nodes.length > 0) {
            WebLogger.debug('Applying unified Dagre layout with actual node dimensions');

            try {
                // Update node data with the measured dimensions.
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

                // Merge dynamic spacing into the current layout configuration.
                const dynamicOverrides = calculateOptimalSpacing(nodesWithRealDimensions);
                const mergedConfig = { ...layoutConfig, ...dynamicOverrides };

                // Use the unified layout function (measured sizes + dynamic spacing).
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
                WebLogger.error('Unified Dagre layout failed', { error: error instanceof Error ? error.message : String(error) });
                WebLogger.warn('Falling back to estimated dimensions');
                setHasAppliedLayout(true); // Prevent retry loop
            }
        }
    }, [nodeInternals, getNodes, getEdges, setNodes, layoutConfig, hasAppliedLayout, onLayoutComplete]);

    // Layout reset function
    const resetLayout = useCallback(() => {
        setHasAppliedLayout(false);
    }, []);

    // Re-apply when layout configuration changes
    useEffect(() => {
        setHasAppliedLayout(false);
    }, [layoutConfig]);

    // Expose a re-layout trigger for external callers
    useEffect(() => {
        (window as Window & { __resetDagreLayout?: () => void }).__resetDagreLayout = resetLayout;
        return () => {
            delete (window as Window & { __resetDagreLayout?: () => void }).__resetDagreLayout;
        };
    }, [resetLayout]);

    return null;
};



/**
 * Edge Types - visual distinction by connection status
 */
const edgeTypes: EdgeTypes = {
    // Use our styled edge as the default renderer so all unspecified edges get the style
    default: ConnectedEdge,
    connected: ConnectedEdge,        // Connected (green)
    missing: MissingEdge,            // Missing (red dashed)
    toolCall: ToolCallEdge,          // Tool call (orange)
    recursiveAgent: RecursiveAgentEdge, // Recursive agent (purple)

    // Mapping for types produced by the SDK
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
const AgentNode = ({ data, sourcePosition, targetPosition }: NodeProps<TWorkflowVisualizationNode>) => {
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
                        const parsed: unknown = JSON.parse(raw);
                        if (!isPlaygroundToolMeta(parsed)) {
                            return;
                        }
                        const tool = parsed;
                        const agentId = data.sourceId ?? data.conversationId;
                        if (agentId && typeof data.__onToolDrop === 'function') {
                            data.__onToolDrop(agentId, tool);
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
                                Replica {data.copyNumber}
                            </Badge>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        <ChatButton
                            nodeData={data}
                            nodeType="agent"
                            onChatOpen={data.__onChat}
                        />
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 p-0"
                            onClick={(e) => {
                                e.stopPropagation();
                                if (typeof data.__onEdit === 'function') {
                                    data.__onEdit();
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
                        const toolsArr = getToolsList(data);
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
                    {Array.isArray(data.__addedTools) && data.__addedTools.length > 0 && (
                        <Badge variant="secondary" className="text-xs" data-nodrop="true">
                            +{data.__addedTools.length}
                        </Badge>
                    )}
                </div>

                {/* Tool preview (from data.tools) */}
                {getToolsList(data).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1" data-nodrop="true">
                        {getToolsList(data).slice(0, 3).map((t) => (
                            <Badge key={t} variant="outline" className="text-[10px]" data-nodrop="true">
                                {t}
                            </Badge>
                        ))}
                        {getToolsList(data).length > 3 && (
                            <span className="text-[10px] text-gray-500" data-nodrop="true">+{getToolsList(data).length - 3} more</span>
                        )}
                    </div>
                )}

                {/* Added tools overlay (from UI state) */}
                {Array.isArray(data.__addedTools) && data.__addedTools.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1" data-nodrop="true">
                        {data.__addedTools.slice(0, 4).map((tool) => (
                            <Badge key={tool.id} variant="outline" className="text-[10px]" data-nodrop="true">
                                {tool.name}
                            </Badge>
                        ))}
                        {data.__addedTools.length > 4 && (
                            <span className="text-[10px] text-gray-500" data-nodrop="true">
                                +{data.__addedTools.length - 4} more
                            </span>
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
const TeamNode = ({ data, sourcePosition, targetPosition }: NodeProps<TWorkflowVisualizationNode>) => {
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
const ToolNode = ({ data }: { data: IWorkflowVisualizationNodeData }) => {
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
const UserMessageNode = ({ data }: { data: IWorkflowVisualizationNodeData }) => {
    // Extract user prompt from multiple possible paths
    const userPromptCandidate = data.parameters?.userPrompt ||
        data.parameters?.userMessageContent ||
        data.userPrompt ||
        data.userMessageContent ||
        data.message ||
        'No content';
    const userPrompt = toText(userPromptCandidate, 'No content');

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
const AgentThinkingNode = ({ data }: { data: IWorkflowVisualizationNodeData }) => {
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
const ResponseNode = ({ data }: { data: IWorkflowVisualizationNodeData }) => {
    // Extract assistant message from multiple possible paths
    const assistantMessageCandidate = data.parameters?.assistantMessage ||
        data.extensions?.robota?.originalEvent?.parameters?.assistantMessage ||
        data.assistantMessage ||
        data.content ||
        'No response';
    const assistantMessage = toText(assistantMessageCandidate, 'No response');

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
                            onChatOpen={data.__onChat}
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
const ToolCallNode = ({ data }: { data: IWorkflowVisualizationNodeData }) => {
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
const ToolCallResponseNode = ({ data }: { data: IWorkflowVisualizationNodeData }) => {
    // Extract tool response data from multiple possible paths
    const toolName = data.toolName || data.parameters?.toolName || 'Tool';
    const rawToolResult = data.result?.data ||
        data.parameters?.result?.data ||
        data.toolResult ||
        'No result';
    const toolResult = toText(rawToolResult, 'No result');

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
const ToolResponseNode = ({ data }: { data: IWorkflowVisualizationNodeData }) => {
    // Extract tool response from multiple possible paths
    const rawToolResponse = data.parameters?.result?.data ||
        data.result?.data ||
        data.response ||
        data.content ||
        'No response';
    const toolResponse = toText(rawToolResponse, 'No response');

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
const ToolResultNode = ({ data }: { data: IWorkflowVisualizationNodeData }) => {
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
const AgentResponseNode = ({ data, sourcePosition, targetPosition }: NodeProps<TWorkflowVisualizationNode>) => {
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
 * Custom Node Component for Tool Calls (Compatibility)
 */
const ToolCallCompatibilityNode = ({ data, sourcePosition, targetPosition }: NodeProps<TWorkflowVisualizationNode>) => {
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
const PlaceholderNode = ({ data }: { data: IWorkflowVisualizationNodeData }) => {
    const label = toText(data.label || data.name, 'Placeholder');
    const description = toText(data.description || data.content, '');

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

// Removed previous hierarchical node naming - use Agent node type only.

// Node types for React-Flow
const nodeTypes: NodeTypes = {
    agent: AgentNode,
    team: TeamNode,
    tool: ToolNode,
    user_message: UserMessageNode,
    agent_thinking: AgentThinkingNode,
    response: ResponseNode,
    tool_call: ToolCallNode,
    tool_call_response: ToolCallResponseNode,
    tool_response: ToolResponseNode,
    tool_result: ToolResultNode,
    agentResponse: AgentResponseNode,
    toolCall: ToolCallCompatibilityNode,
    placeholder: PlaceholderNode
    // Removed previous user input type
};

// Local child component to show Agent details with mock endpoint generation
const AgentDetailsContent = ({ data, node }: { data: IWorkflowVisualizationNodeData; node: Node<IWorkflowVisualizationNodeData> }) => {
    const [endpoint, setEndpoint] = React.useState<string | null>(null);
    const handleGenerateEndpoint = () => {
        const base = typeof window !== 'undefined' ? window.location.origin : 'https://example.com';
        const id = String(node?.id || data?.sourceId || 'agent');
        const token = Math.random().toString(36).slice(2, 10);
        const url = `${base}/api/agents/${encodeURIComponent(id)}/${token}`;
        setEndpoint(url);
        WebLogger.info('Mock API endpoint created', { url });
    };

    const tools: string[] = (() => {
        const directTools = getToolsList(data);
        if (directTools.length > 0) {
            return directTools;
        }
        const parameterTools = data?.extensions?.robota?.originalEvent?.parameters?.tools;
        if (!Array.isArray(parameterTools)) {
            return [];
        }
        return parameterTools.filter((tool): tool is string => typeof tool === 'string');
    })();

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
                            <Badge variant="outline">{toText(modelInfo.provider, 'Unknown')}</Badge>
                            <Badge variant="outline">{toText(modelInfo.model, 'Unknown')}</Badge>
                            {typeof modelInfo.temperature === 'number' && (
                                <Badge variant="outline">temp: {modelInfo.temperature}</Badge>
                            )}
                        </div>
                    </div>
                )}

                {/* System Message */}
                {typeof systemMessage === 'string' && systemMessage.length > 0 && (
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
                                WebLogger.info('Mock API endpoint revoked');
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
const renderNodeContent = (node: Node<IWorkflowVisualizationNodeData>): React.ReactElement | null => {
    const data = node.data;
    const nodeType = String(node.type);

    switch (nodeType) {
        case 'agent': {
            return (
                <AgentDetailsContent data={data} node={node} />
            );
        }
        case 'user_message':
            return (
                <div className="space-y-3">
                    <div className="border-l-4 border-blue-500 pl-3">
                        <h3 className="text-sm font-medium text-gray-900 mb-2">User Prompt</h3>
                        <div className="text-sm text-gray-800 bg-blue-50 p-3 rounded">
                            {toText(
                                data.parameters?.userPrompt ||
                                data.parameters?.userMessageContent ||
                                data.userPrompt ||
                                data.userMessageContent ||
                                data.message,
                                'No content available'
                            )}
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
            {
                const assistantMessage = toText(
                    data.parameters?.assistantMessage ||
                    data.extensions?.robota?.originalEvent?.parameters?.assistantMessage ||
                    data.assistantMessage ||
                    data.content,
                    'No response available'
                );
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
                                {typeof data.agentNumber === 'number' && data.agentNumber > 0 && (
                                    <span>Agent: {data.agentNumber}</span>
                                )}
                            </div>
                        </div>
                    </div>
                );
            }

        case 'tool_call_response':
            {
                const toolName = toText(data.toolName || data.parameters?.toolName, 'Tool');
                const rawToolResult = data.result?.data ||
                    data.parameters?.result?.data ||
                    data.toolResult ||
                    'No result available';
                const toolResult = toText(rawToolResult, 'No result available');

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
                            <pre className="whitespace-pre-wrap font-mono text-xs">
                                {toolResult}
                            </pre>
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
            }

        case 'tool_response':
            {
                const rawToolResponseData = data.parameters?.result?.data ||
                    data.result?.data ||
                    data.response ||
                    data.content ||
                    'No response available';
                const toolResponseData = toText(rawToolResponseData, 'No response available');

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
            }

        default:
            // For other node types, show basic info if available
            {
                const basicInfo = toText(data.description || data.label, '');
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
    }
};

function WorkflowVisualizationContent({
    workflow,
    className,
    onAgentNodeClick,
    onToolDrop,
    toolItems,
    addedToolsByAgent
}: IWorkflowVisualizationProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState<TWorkflowVisualizationNode>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const [converter] = useState(() => new UniversalToReactFlowConverter());
    const [selectedLayout, setSelectedLayout] = useState<keyof typeof LAYOUT_PRESETS>('compact');
    const [isAutoLayoutEnabled, setIsAutoLayoutEnabled] = useState(true);
    const [currentLayoutConfig, setCurrentLayoutConfig] = useState<ILayoutConfig>(LAYOUT_PRESETS.compact);
    const { setCenter, getZoom, getNode } = useReactFlow<TWorkflowVisualizationNode, Edge>();
    const [isInfoOpen, setIsInfoOpen] = useState(false);
    const [selectedNode, setSelectedNode] = useState<TWorkflowVisualizationNode | null>(null);
    const { toast } = useToast();

    // Centering control state
    const [focusNodeId, setFocusNodeId] = useState<string | null>(null);
    const [layoutReady, setLayoutReady] = useState(false);
    const rafForCenterRef = useRef<number | null>(null);
    const nodeInternals = useStore(
        (state) => (state as unknown as { nodeInternals: Map<string, { width?: number; height?: number }> }).nodeInternals
    );

    // Progressive Reveal Configuration
    const [isProgressiveRevealEnabled, setIsProgressiveRevealEnabled] = useState(true);
    const [fullTargetNodes, setFullTargetNodes] = useState<TWorkflowVisualizationNode[]>([]);
    const [fullTargetEdges, setFullTargetEdges] = useState<Edge[]>([]);
    const lastAddedNodeIdRef = useRef<string | null>(null);
    const hasAppliedMeasuredLayoutRef = useRef(false);

    // Intentionally not reacting to node data changes

    // Progressive Reveal Configuration
    const progressiveRevealConfig: IReactFlowProgressiveRevealConfig = {
        enabled: isProgressiveRevealEnabled,
        intervalMs: 500,
        bundleSize: 1
    };

    // Progressive Reveal Hook
    const progressiveReveal = useReactFlowProgressiveReveal<TWorkflowVisualizationNode, Edge>({
        nodes: fullTargetNodes,
        edges: fullTargetEdges,
        config: progressiveRevealConfig
    });

    // Apply layout - handled exclusively via the DynamicDagreLayout component.
    const applyAutoLayout = useCallback((layoutPreset?: keyof typeof LAYOUT_PRESETS) => {
        if (nodes.length === 0) return;

        const layoutToUse = layoutPreset || selectedLayout;
        setSelectedLayout(layoutToUse);
        setCurrentLayoutConfig(LAYOUT_PRESETS[layoutToUse]);

        // Layout is applied through the DynamicDagreLayout component.
        // setTimeout(() => {
        //     (window as Window & { __resetDagreLayout?: () => void }).__resetDagreLayout?.();
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
    const handleNodesChange = useCallback((changes: NodeChange<TWorkflowVisualizationNode>[]) => {
        onNodesChange(changes);

        const lastId = lastAddedNodeIdRef.current;
        if (!lastId || !changes || changes.length === 0) return;

        const hasRelevantUpdate = changes.some((c) => {
            if (!('id' in c)) {
                return false;
            }
            return c.id === lastId && (c.type === 'dimensions' || c.type === 'position');
        });
        if (!hasRelevantUpdate) return;

        // Use latest RF node (ensures measured width/height and final position)
        const rfNode = getNode(lastId);
        if (!rfNode || typeof rfNode.position?.x !== 'number' || typeof rfNode.position?.y !== 'number') return;

        const width = rfNode.width ?? rfNode?.data?.actualWidth ?? rfNode?.data?.computedWidth ?? 192;
        const height = rfNode.height ?? rfNode?.data?.actualHeight ?? rfNode?.data?.computedHeight ?? 80;

        if (typeof width !== 'number' || typeof height !== 'number') return;

        const centerX = rfNode.position.x + width / 2;
        const centerY = rfNode.position.y + height / 2;
        const zoom = typeof getZoom === 'function' ? getZoom() : 1;
        setCenter(centerX, centerY, { duration: 600, zoom });

        // React only to actual size changes for relayout
        const hasDimensionChange = changes.some((c) => c.type === 'dimensions');
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
            const pos = positionedNode?.position;

            // Fallback to computed dimensions if actual not measured yet
            const width = rfNode?.width ?? positionedNode?.data?.actualWidth ?? positionedNode?.data?.computedWidth ?? 192;
            const height = rfNode?.height ?? positionedNode?.data?.actualHeight ?? positionedNode?.data?.computedHeight ?? 80;

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

    // Data dump - copy the current workflow data to the clipboard
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

            WebLogger.info('Workflow data copied to clipboard');
            WebLogger.debug('Workflow data summary', {
                nodes: dumpData.totalNodes,
                edges: dumpData.totalEdges,
                hasWorkflow: !!dumpData.workflow
            });

            toast({
                title: 'Workflow copied',
                description: `Nodes: ${dumpData.totalNodes}, Edges: ${dumpData.totalEdges}`,
                variant: 'default'
            });
        } catch (error) {
            WebLogger.error('Failed to copy workflow data', { error: error instanceof Error ? error.message : String(error) });
            toast({
                title: 'Failed to copy workflow',
                description: error instanceof Error ? error.message : String(error),
                variant: 'destructive'
            });
        }
    }, [workflow, toast]);

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
                WebLogger.debug('React Flow data conversion completed');

                // Determine target graph (pre-layout when enabled)
                let targetNodes: TWorkflowVisualizationNode[] = reactFlowData.nodes;
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
                const handleUnifiedChat = (agentId: string, nodeData: IWorkflowVisualizationNodeData) => {
                    onAgentNodeClick?.(agentId, nodeData);
                };

                // Attach callbacks to agent and response nodes (chat/edit)
                const toolCatalogById = new Map<string, IPlaygroundToolMeta>(
                    Array.isArray(toolItems) ? toolItems.map(item => [item.id, item]) : []
                );

                const isNonEmptyString = (value: TUniversalValue | undefined): value is string =>
                    typeof value === 'string' && value.length > 0;

                const mapToolIdsToMeta = (toolIds: string[]): IPlaygroundToolMeta[] => {
                    const out: IPlaygroundToolMeta[] = [];
                    for (const toolId of toolIds) {
                        const meta = toolCatalogById.get(toolId);
                        if (meta) out.push(meta);
                    }
                    return out;
                };

                const augmentCallbacks = (list: TWorkflowVisualizationNode[]): TWorkflowVisualizationNode[] =>
                    list.map((n) => {
                        if (n.type === 'agent') {
                            const agentIdCandidate = n.data as IWorkflowVisualizationNodeData;
                            const agentId =
                                (isNonEmptyString(agentIdCandidate?.sourceId) && agentIdCandidate?.sourceId) ||
                                (isNonEmptyString(agentIdCandidate?.conversationId) && agentIdCandidate?.conversationId) ||
                                n.id;
                            const addedToolIdsRaw = addedToolsByAgent?.[agentId];
                            const addedToolIds = Array.isArray(addedToolIdsRaw) ? addedToolIdsRaw.filter(isNonEmptyString) : [];
                            const addedTools = mapToolIdsToMeta(addedToolIds);
                            return {
                                ...n,
                                data: {
                                    ...n.data,
                                    __onChat: handleUnifiedChat,
                                    __onEdit: () => {
                                        setSelectedNode(n);
                                        setIsInfoOpen(true);
                                    },
                                    __onToolDrop: (agentId: string, tool: IPlaygroundToolMeta) => {
                                        if (typeof onToolDrop === 'function') {
                                            onToolDrop(agentId, tool);
                                        }
                                    },
                                    __addedTools: addedTools
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
                WebLogger.error('Failed to convert workflow', { error: error instanceof Error ? error.message : String(error) });
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
    }, [workflow, converter, isAutoLayoutEnabled, selectedLayout, onAgentNodeClick, onToolDrop, toolItems, addedToolsByAgent]);

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
                        WebLogger.debug('Progressive reveal: adding node', { nodeId: progressiveReveal.nodeToAdd!.id });
                        return [...prev, progressiveReveal.nodeToAdd!];
                    });

                    // Add new edges if present
                    if (progressiveReveal.edgesToAdd && progressiveReveal.edgesToAdd.length > 0) {
                        setEdges(prev => {
                            const existingEdgeIds = new Set(prev.map(e => e.id));
                            const newEdges = progressiveReveal.edgesToAdd!.filter(e => !existingEdgeIds.has(e.id));
                            if (newEdges.length > 0) {
                                WebLogger.debug('Progressive reveal: adding edges', { edgeIds: newEdges.map(e => e.id) });
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
                WebLogger.info('Progressive reveal: all nodes revealed');
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
                    };
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

    const handleNodeClick = useCallback<NodeMouseHandler<TWorkflowVisualizationNode>>((_, node) => {
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
                                    WebLogger.info('Tool dropped', { toolId: tool?.id, toolName: tool?.name });
                                    // Future: create a tool_call node at drop position
                                } catch (error) {
                                    WebLogger.warn('Tool drop parse failed', {
                                        error: error instanceof Error ? error.message : String(error)
                                    });
                                }
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
                            {/* Dynamic Dagre layout component */}
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
                                    <span className="font-medium">{selectedNode.data?.label || selectedNode.data?.name || 'Node'}</span>
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
                                    <pre className="whitespace-pre-wrap text-gray-700 leading-relaxed">{JSON.stringify(selectedNode.data, null, 2)}</pre>
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

export function WorkflowVisualization(props: IWorkflowVisualizationProps) {
    return (
        <ReactFlowProvider>
            <WorkflowVisualizationContent {...props} />
            {/* Node Info Modal */}
            {/* Placed outside to avoid re-mounting ReactFlow; uses portal modal */}
        </ReactFlowProvider>
    );
}