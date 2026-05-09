'use client';

import React, { useEffect, useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  MiniMap,
  type Node,
  type Edge,
} from '@xyflow/react';
import { GitBranch } from 'lucide-react';
import type { IConversationEvent } from '../../../lib/playground/robota-executor';
import { eventsToFlow } from './events-to-flow';
import {
  UserMessageNode,
  AssistantResponseNode,
  ToolCallNode,
  ToolResultNode,
  ToolErrorNode,
} from './workflow-nodes';

const nodeTypes = {
  user_message: UserMessageNode,
  assistant_response: AssistantResponseNode,
  tool_call_start: ToolCallNode,
  tool_call_complete: ToolResultNode,
  tool_call_error: ToolErrorNode,
};

interface IWorkflowVisualizationProps {
  events: IConversationEvent[];
  className?: string;
}

function WorkflowVisualizationContent({ events }: IWorkflowVisualizationProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const flowData = useMemo(() => eventsToFlow(events), [events]);

  useEffect(() => {
    setNodes(flowData.nodes);
    setEdges(flowData.edges);
  }, [flowData, setNodes, setEdges]);

  if (events.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <GitBranch className="h-10 w-10 opacity-30" />
        <p className="text-sm">대화를 시작하면 실행 흐름이 여기에 표시됩니다</p>
      </div>
    );
  }

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.3}
      maxZoom={2}
      attributionPosition="bottom-left"
      colorMode="dark"
    >
      <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
      <Controls />
      <MiniMap nodeStrokeWidth={3} zoomable pannable />
    </ReactFlow>
  );
}

export function WorkflowVisualization({ events, className }: IWorkflowVisualizationProps) {
  return (
    <div className={`w-full h-full ${className ?? ''}`}>
      <ReactFlowProvider>
        <WorkflowVisualizationContent events={events} />
      </ReactFlowProvider>
    </div>
  );
}
