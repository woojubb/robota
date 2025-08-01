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
    Connection,
    ReactFlowProvider
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Bot, Users, Zap } from 'lucide-react';
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
    return (
        <div className="px-4 py-2 shadow-md rounded-md bg-white border-2 border-blue-400">
            <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-blue-600" />
                <div className="text-sm font-semibold">{data.label}</div>
            </div>
            {data.status && (
                <Badge variant="secondary" className="mt-1 text-xs">
                    {data.status}
                </Badge>
            )}
        </div>
    );
};

/**
 * Custom Node Component for Teams
 */
const TeamNode = ({ data }: { data: any }) => {
    return (
        <div className="px-4 py-2 shadow-md rounded-md bg-white border-2 border-green-400">
            <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-green-600" />
                <div className="text-sm font-semibold">{data.label}</div>
            </div>
            {data.memberCount && (
                <Badge variant="secondary" className="mt-1 text-xs">
                    {data.memberCount} members
                </Badge>
            )}
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

// Node types for React-Flow
const nodeTypes = {
    agent: AgentNode,
    team: TeamNode,
    tool: ToolNode,
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