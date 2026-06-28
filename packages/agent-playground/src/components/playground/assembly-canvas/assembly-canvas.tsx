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
import type {
  IPlaygroundAgentConfig,
  IConversationEvent,
} from '../../../lib/playground/robota-executor';
import type { IPlaygroundToolMeta } from '../../../tools/catalog';
import type { IPlaygroundSkillMeta } from '../../../skills/catalog';
import { AgentNode } from './nodes/agent-node';
import { ToolNode } from './nodes/tool-node';
import { SkillNode } from './nodes/skill-node';
import {
  UserMessageNode,
  AssistantResponseNode,
  ToolCallNode,
  ToolResultNode,
  ToolErrorNode,
  AgentJobCreatedNode,
  AgentJobCompletedNode,
  AgentJobFailedNode,
} from '../workflow-visualization/workflow-nodes';
import { eventsToFlow } from '../workflow-visualization/events-to-flow';

const nodeTypes = {
  agent: AgentNode,
  tool: ToolNode,
  skill: SkillNode,
  user_message: UserMessageNode,
  assistant_response: AssistantResponseNode,
  tool_call_start: ToolCallNode,
  tool_call_complete: ToolResultNode,
  tool_call_error: ToolErrorNode,
  agent_job_created: AgentJobCreatedNode,
  agent_job_completed: AgentJobCompletedNode,
  agent_job_failed: AgentJobFailedNode,
};

const AGENT_POSITION = { x: 220, y: 120 };
const TOOL_START_X = 550;
const TOOL_START_Y = 60;
const TOOL_GAP_Y = 130;
const SKILL_START_X = -220;
const SKILL_START_Y = 60;
const SKILL_GAP_Y = 130;
const EVENT_CHAIN_OFFSET_X = 40;
const EVENT_CHAIN_OFFSET_Y = 340;

export interface IAssemblyCanvasProps {
  agentConfig: IPlaygroundAgentConfig | null;
  activeTools: IPlaygroundToolMeta[];
  activeSkills?: IPlaygroundSkillMeta[];
  onDropTool: (tool: IPlaygroundToolMeta) => void;
  onDropSkill?: (skill: IPlaygroundSkillMeta) => void;
  events?: IConversationEvent[];
}

function buildAgentNodeId(config: IPlaygroundAgentConfig): string {
  return `agent-${config.id ?? config.name}`;
}

function AssemblyCanvasContent({
  agentConfig,
  activeTools,
  activeSkills = [],
  onDropTool,
  onDropSkill,
  events = [],
}: IAssemblyCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    (window as unknown as Record<string, unknown>).__robota_dag = {
      ...(((window as unknown as Record<string, unknown>).__robota_dag as Record<
        string,
        unknown
      >) ?? {}),
      test: (mockEvents: IConversationEvent[]) => eventsToFlow(mockEvents),
      renderMock: (mockEvents: IConversationEvent[]) => {
        const { nodes: raw, edges: mockEdges } = eventsToFlow(mockEvents);
        setNodes(
          raw.map((n) => ({
            ...n,
            position: {
              x: n.position.x + EVENT_CHAIN_OFFSET_X,
              y: n.position.y + EVENT_CHAIN_OFFSET_Y,
            },
          })),
        );
        setEdges(mockEdges);
      },
    };
  }, [setNodes, setEdges]);

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
        systemMessage: agentConfig.systemMessage,
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

    const skillNodes: Node[] = activeSkills.map((skill, idx) => ({
      id: `skill-${skill.id}`,
      type: 'skill',
      position: { x: SKILL_START_X, y: SKILL_START_Y + idx * SKILL_GAP_Y },
      data: { name: skill.name, description: skill.description },
    }));

    const skillEdges: Edge[] = activeSkills.map((skill) => ({
      id: `edge-skill-${skill.id}`,
      source: `skill-${skill.id}`,
      sourceHandle: 'skill-output',
      target: agentNodeId,
      targetHandle: 'tool-input',
      animated: true,
      style: { stroke: '#8b5cf6', strokeWidth: 1.5, opacity: 0.7, strokeDasharray: '4 2' },
    }));

    const { nodes: rawEventNodes, edges: eventEdges } = eventsToFlow(events);

    const eventNodes: Node[] = rawEventNodes.map((n) => ({
      ...n,
      position: {
        x: n.position.x + EVENT_CHAIN_OFFSET_X,
        y: n.position.y + EVENT_CHAIN_OFFSET_Y,
      },
    }));

    const agentToChainEdge: Edge[] =
      events.length > 0
        ? [
            {
              id: `edge-agent-to-chain`,
              source: agentNodeId,
              sourceHandle: 'chain-output',
              target: events[0].id,
              animated: true,
              style: { stroke: '#6366f1', strokeWidth: 1.5, opacity: 0.6 },
            },
          ]
        : [];

    setNodes([agentNode, ...skillNodes, ...toolNodes, ...eventNodes]);
    setEdges([...skillEdges, ...toolEdges, ...agentToChainEdge, ...eventEdges]);

    (window as unknown as Record<string, unknown>).__robota_dag = {
      ...(((window as unknown as Record<string, unknown>).__robota_dag as Record<
        string,
        unknown
      >) ?? {}),
      events,
      eventNodes: rawEventNodes,
      eventEdges,
      test: (mockEvents: IConversationEvent[]) => eventsToFlow(mockEvents),
    };
  }, [agentConfig, activeTools, activeSkills, events, setNodes, setEdges]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (
      e.dataTransfer.types.includes('application/robota-tool') ||
      e.dataTransfer.types.includes('application/robota-skill')
    ) {
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
      const rawTool = e.dataTransfer.getData('application/robota-tool');
      if (rawTool) {
        const tool = JSON.parse(rawTool) as IPlaygroundToolMeta;
        onDropTool(tool);
        return;
      }
      const rawSkill = e.dataTransfer.getData('application/robota-skill');
      if (rawSkill && onDropSkill) {
        const skill = JSON.parse(rawSkill) as IPlaygroundSkillMeta;
        onDropSkill(skill);
      }
    },
    [onDropTool, onDropSkill],
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
          } as unknown as React.CSSProperties
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
