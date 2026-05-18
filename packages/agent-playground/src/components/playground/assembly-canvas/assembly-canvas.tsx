'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  useNodesState,
  useEdgesState,
  ReactFlowProvider,
  type Node,
  type Edge,
} from '@xyflow/react';
import { Bot } from 'lucide-react';
import type { IPlaygroundAgentConfig } from '../../../lib/playground/robota-executor';
import type { IPlaygroundToolMeta } from '../../../tools/catalog';
import { AgentNode } from './nodes/agent-node';
import { ToolNode } from './nodes/tool-node';

const nodeTypes = {
  agent: AgentNode,
  tool: ToolNode,
};

const AGENT_POSITION = { x: 120, y: 120 };
const TOOL_START_X = 450;
const TOOL_START_Y = 60;
const TOOL_GAP_Y = 130;

export interface IAssemblyCanvasProps {
  agentConfig: IPlaygroundAgentConfig | null;
  activeTools: IPlaygroundToolMeta[];
  onDropTool: (tool: IPlaygroundToolMeta) => void;
}

function buildAgentNodeId(config: IPlaygroundAgentConfig): string {
  return `agent-${config.id ?? config.name}`;
}

function AssemblyCanvasContent({ agentConfig, activeTools, onDropTool }: IAssemblyCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    if (!agentConfig) {
      setNodes([]);
      setEdges([]);
      return;
    }

    const agentNodeId = buildAgentNodeId(agentConfig);

    const agentNode: Node = {
      id: agentNodeId,
      type: 'agent',
      position: AGENT_POSITION,
      data: {
        name: agentConfig.name,
        provider: agentConfig.defaultModel.provider,
        model: agentConfig.defaultModel.model,
        systemMessage: agentConfig.defaultModel.systemMessage,
        toolCount: activeTools.length,
      },
    };

    const toolNodes: Node[] = activeTools.map((tool, idx) => ({
      id: `tool-${tool.id}`,
      type: 'tool',
      position: { x: TOOL_START_X, y: TOOL_START_Y + idx * TOOL_GAP_Y },
      data: { name: tool.name, description: tool.description },
    }));

    const toolEdges: Edge[] = activeTools.map((tool) => ({
      id: `edge-${tool.id}`,
      source: `tool-${tool.id}`,
      sourceHandle: 'tool-output',
      target: agentNodeId,
      targetHandle: 'tool-input',
      animated: true,
      style: { stroke: '#7c3aed', strokeWidth: 2, opacity: 0.8 },
    }));

    setNodes([agentNode, ...toolNodes]);
    setEdges(toolEdges);
  }, [agentConfig, activeTools, setNodes, setEdges]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/robota-tool')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as HTMLElement | null)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const raw = e.dataTransfer.getData('application/robota-tool');
      if (!raw) return;
      const tool = JSON.parse(raw) as IPlaygroundToolMeta;
      onDropTool(tool);
    },
    [onDropTool],
  );

  if (!agentConfig) {
    return (
      <div
        className="w-full h-full flex flex-col items-center justify-center gap-3 text-muted-foreground"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <Bot className="h-10 w-10 opacity-30" />
        <p className="text-sm">Create an agent to start assembling</p>
        <p className="text-xs opacity-60">Click "Create Agent" to add an agent node</p>
      </div>
    );
  }

  return (
    <div
      className={`w-full h-full relative transition-colors ${isDragOver ? 'bg-primary/5 ring-2 ring-inset ring-primary/30' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
          <div className="bg-primary/10 border-2 border-dashed border-primary/50 rounded-xl px-8 py-4 text-primary text-sm font-medium">
            Drop to add tool to agent
          </div>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.3}
        maxZoom={2}
        colorMode="dark"
        nodesDraggable
        nodesConnectable={false}
        elementsSelectable={false}
        attributionPosition="bottom-left"
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
  );
}

export function AssemblyCanvas(props: IAssemblyCanvasProps) {
  return (
    <ReactFlowProvider>
      <AssemblyCanvasContent {...props} />
    </ReactFlowProvider>
  );
}
