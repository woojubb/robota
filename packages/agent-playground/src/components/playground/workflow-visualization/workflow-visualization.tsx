'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  type Node,
  type Edge,
} from '@xyflow/react';
import { GitBranch, Wrench } from 'lucide-react';
import type { IConversationEvent } from '../../../lib/playground/robota-executor';
import type { IPlaygroundToolMeta } from '../../../tools/catalog';
import { eventsToFlow } from './events-to-flow';
import {
  UserMessageNode,
  AssistantResponseNode,
  ToolCallNode,
  ToolResultNode,
  ToolErrorNode,
  AgentJobCreatedNode,
  AgentJobCompletedNode,
  AgentJobFailedNode,
} from './workflow-nodes';

const nodeTypes = {
  user_message: UserMessageNode,
  assistant_response: AssistantResponseNode,
  tool_call_start: ToolCallNode,
  tool_call_complete: ToolResultNode,
  tool_call_error: ToolErrorNode,
  agent_job_created: AgentJobCreatedNode,
  agent_job_completed: AgentJobCompletedNode,
  agent_job_failed: AgentJobFailedNode,
};

interface IWorkflowVisualizationProps {
  events: IConversationEvent[];
  className?: string;
  activeTools?: IPlaygroundToolMeta[];
  onDropTool?: (tool: IPlaygroundToolMeta) => void;
}

function WorkflowVisualizationContent({
  events,
  activeTools,
  onDropTool,
}: IWorkflowVisualizationProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  const flowData = useMemo(() => eventsToFlow(events), [events]);

  useEffect(() => {
    setNodes(flowData.nodes);
    setEdges(flowData.edges);
  }, [flowData, setNodes, setEdges]);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__robota_dag = {
      nodes,
      edges,
      events,
      recompute: () => eventsToFlow(events),
      test: (mockEvents: IConversationEvent[]) => eventsToFlow(mockEvents),
    };
  }, [nodes, edges, events]);

  const handleDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/robota-tool')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as HTMLElement | null)) {
      setIsDragOver(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const raw = e.dataTransfer.getData('application/robota-tool');
    if (!raw || !onDropTool) return;
    const tool = JSON.parse(raw) as IPlaygroundToolMeta;
    onDropTool(tool);
  };

  return (
    <div
      className={`w-full h-full flex flex-col relative transition-colors ${isDragOver ? 'bg-primary/5 ring-2 ring-inset ring-primary/40' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {activeTools && activeTools.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-card/60 flex-wrap shrink-0">
          <Wrench className="h-3 w-3 text-muted-foreground shrink-0" />
          {activeTools.map((t) => (
            <span
              key={t.id}
              className="inline-flex items-center gap-1 text-xs bg-primary/15 text-primary px-2 py-0.5 rounded-full"
            >
              {t.name}
            </span>
          ))}
        </div>
      )}

      {isDragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="bg-primary/10 border-2 border-dashed border-primary/60 rounded-xl px-8 py-4 text-primary text-sm font-medium">
            Drop to add tool to agent
          </div>
        </div>
      )}

      {events.length === 0 && !isDragOver ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-muted-foreground">
          <GitBranch className="h-10 w-10 opacity-30" />
          <p className="text-sm">대화를 시작하면 실행 흐름이 여기에 표시됩니다</p>
          {onDropTool && (
            <p className="text-xs opacity-60">툴을 여기에 드래그하여 에이전트에 추가하세요</p>
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0">
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
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            style={
              {
                '--xy-node-border-default': 'none',
                '--xy-node-selected-border': 'none',
              } as React.CSSProperties
            }
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
            <Controls />
          </ReactFlow>
        </div>
      )}
    </div>
  );
}

export function WorkflowVisualization({
  events,
  className,
  activeTools,
  onDropTool,
}: IWorkflowVisualizationProps) {
  return (
    <div className={`w-full h-full ${className ?? ''}`}>
      <ReactFlowProvider>
        <WorkflowVisualizationContent
          events={events}
          activeTools={activeTools}
          onDropTool={onDropTool}
        />
      </ReactFlowProvider>
    </div>
  );
}
