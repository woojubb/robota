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
    ReactFlowProvider
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bot, Users, Zap, MessageSquare, MessageCircle } from 'lucide-react';
import type {
    UniversalWorkflowStructure,
    UniversalWorkflowNode,
    UniversalWorkflowEdge
} from '@robota-sdk/agents';
import { SimpleReactFlowConverter } from '@/lib/workflow-visualization';

interface WorkflowVisualizationProps {
    workflow?: UniversalWorkflowStructure;
    className?: string;
}

/**
 * Custom Node Component for Agents
 */
const AgentNode = ({ data }: { data: any }) => {
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
            {data.status && (
                <Badge className={`mt-1 text-xs ${styles.badge}`}>
                    {data.status}
                </Badge>
            )}

            {/* Target handle - Agents receive connections from Team */}
            <Handle
                type="target"
                position={Position.Top}
                id="agent-input"
                style={{ background: '#2563eb' }}
            />

            {/* Source handle - Agents can connect to other nodes */}
            <Handle
                type="source"
                position={Position.Bottom}
                id="agent-output"
                style={{ background: '#2563eb' }}
            />
        </div>
    );
};

/**
 * Custom Node Component for Teams
 */
const TeamNode = ({ data }: { data: any }) => {
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
                position={Position.Top}
                id="team-input"
                style={{ background: '#16a34a' }}
            />

            {/* Source handle - Team connects to Agents */}
            <Handle
                type="source"
                position={Position.Bottom}
                id="team-output"
                style={{ background: '#16a34a' }}
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
const AgentResponseNode = ({ data }: { data: any }) => {
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
                position={Position.Top}
                id="response-input"
                style={{ background: '#14b8a6' }}
            />
        </div>
    );
};

// Node types for React-Flow
const nodeTypes = {
    agent: AgentNode,
    team: TeamNode,
    tool: ToolNode,
    userInput: UserInputNode,
    agentResponse: AgentResponseNode
};

function WorkflowVisualizationContent({ workflow, className }: WorkflowVisualizationProps) {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [converter] = useState(() => new SimpleReactFlowConverter());

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
                setNodes(reactFlowData.nodes);
                setEdges(reactFlowData.edges);
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
    }, [workflow, converter]);

    const onConnect = useCallback(
        (params: Connection) => setEdges((eds) => addEdge(params, eds)),
        [setEdges]
    );

    return (
        <Card className={className}>
            <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center gap-2">
                    <Bot className="h-5 w-5" />
                    Workflow Visualization
                </CardTitle>
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