'use client';

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { MessageSquare, Bot, Wrench, CheckCircle, XCircle, Cpu, AlertTriangle } from 'lucide-react';
import type { IFlowNodeData } from './events-to-flow';

const CONTENT_PREVIEW_LENGTH = 80;

const TOOL_DISPLAY_NAMES: Record<string, string> = {
  robota_command_agent: 'Agent Command',
};

function toolDisplayName(name: string): string {
  return TOOL_DISPLAY_NAMES[name] ?? name;
}

function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/#{1,6}\s/g, '');
}

function preview(content: string): string {
  const stripped = stripMarkdown(content);
  if (stripped.length <= CONTENT_PREVIEW_LENGTH) return stripped;
  return stripped.slice(0, CONTENT_PREVIEW_LENGTH) + '…';
}

function parseJsonSafe(text: string): unknown | null {
  const trimmed = text.trim();
  if (trimmed[0] !== '{' && trimmed[0] !== '[') return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    // allow-fallback: JSON.parse throws SyntaxError on non-JSON; null signals "not JSON" to caller
    return null;
  }
}

function ContentDisplay({ content }: { content: string }) {
  const parsed = parseJsonSafe(content);
  if (parsed !== null) {
    return (
      <pre className="text-xs font-mono max-h-28 overflow-y-auto bg-black/20 rounded p-1.5 whitespace-pre-wrap break-all mt-1 leading-relaxed">
        {JSON.stringify(parsed, null, 2)}
      </pre>
    );
  }
  return <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{preview(content)}</p>;
}

function NodeShell({
  accentColor,
  children,
  hasTarget = true,
  hasSource = true,
}: {
  accentColor: string;
  children: React.ReactNode;
  hasTarget?: boolean;
  hasSource?: boolean;
}) {
  return (
    <div
      className={`w-52 rounded-lg border border-border/50 ${accentColor} bg-card text-card-foreground shadow-md p-2.5 text-sm`}
    >
      {hasTarget && <Handle type="target" position={Position.Top} />}
      {children}
      {hasSource && <Handle type="source" position={Position.Bottom} />}
    </div>
  );
}

export function UserMessageNode({ data }: NodeProps) {
  const d = data as IFlowNodeData;
  return (
    <NodeShell accentColor="border-l-4 border-l-blue-500">
      <div className="flex items-center gap-1.5 mb-1">
        <MessageSquare className="h-3 w-3 text-blue-400 shrink-0" />
        <span className="font-semibold text-xs text-foreground">User</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{preview(d.content)}</p>
    </NodeShell>
  );
}

export function AssistantResponseNode({ data }: NodeProps) {
  const d = data as IFlowNodeData;
  return (
    <NodeShell accentColor="border-l-4 border-l-emerald-500">
      <div className="flex items-center gap-1.5 mb-1">
        <Bot className="h-3 w-3 text-emerald-400 shrink-0" />
        <span className="font-semibold text-xs text-foreground">Assistant</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{preview(d.content)}</p>
    </NodeShell>
  );
}

export function ToolCallNode({ data }: NodeProps) {
  const d = data as IFlowNodeData;
  return (
    <NodeShell accentColor="border-l-4 border-l-purple-500">
      <div className="flex items-center gap-1.5">
        <Wrench className="h-3 w-3 text-purple-400 shrink-0" />
        <span className="font-semibold text-xs text-foreground">
          {toolDisplayName(d.toolName) || 'Tool call'}
        </span>
      </div>
    </NodeShell>
  );
}

export function ToolResultNode({ data }: NodeProps) {
  const d = data as IFlowNodeData;
  return (
    <NodeShell accentColor="border-l-4 border-l-amber-500">
      <div className="flex items-center gap-1.5">
        <CheckCircle className="h-3 w-3 text-amber-400 shrink-0" />
        <span className="font-semibold text-xs text-foreground">
          {toolDisplayName(d.toolName) || 'Tool result'}
        </span>
      </div>
      {d.content && <ContentDisplay content={d.content} />}
    </NodeShell>
  );
}

export function ToolErrorNode({ data }: NodeProps) {
  const d = data as IFlowNodeData;
  return (
    <NodeShell accentColor="border-l-4 border-l-red-500">
      <div className="flex items-center gap-1.5">
        <XCircle className="h-3 w-3 text-red-400 shrink-0" />
        <span className="font-semibold text-xs text-foreground">
          {toolDisplayName(d.toolName) || 'Tool error'}
        </span>
      </div>
      {d.content && (
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{preview(d.content)}</p>
      )}
    </NodeShell>
  );
}

export function AgentJobCreatedNode({ data }: NodeProps) {
  const d = data as IFlowNodeData;
  const agentType = (d.metadata?.agentType as string) || '';
  return (
    <NodeShell accentColor="border-l-4 border-l-violet-500">
      <div className="flex items-center gap-1.5 mb-1">
        <Cpu className="h-3 w-3 text-violet-400 shrink-0 animate-pulse" />
        <span className="font-semibold text-xs text-foreground">Agent spawned</span>
      </div>
      {d.content && (
        <p className="text-xs text-violet-300 font-medium leading-relaxed">{preview(d.content)}</p>
      )}
      {agentType && <p className="text-xs text-muted-foreground leading-relaxed">{agentType}</p>}
    </NodeShell>
  );
}

export function AgentJobCompletedNode({ data }: NodeProps) {
  const d = data as IFlowNodeData;
  const label = (d.metadata?.label as string) || 'Agent result';
  return (
    <NodeShell accentColor="border-l-4 border-l-teal-500">
      <div className="flex items-center gap-1.5 mb-1">
        <CheckCircle className="h-3 w-3 text-teal-400 shrink-0" />
        <span className="font-semibold text-xs text-foreground">Agent done</span>
      </div>
      <p className="text-xs text-teal-300 font-medium leading-none truncate mb-1">{label}</p>
      {d.content && <ContentDisplay content={d.content} />}
    </NodeShell>
  );
}

export function AgentJobFailedNode({ data }: NodeProps) {
  const d = data as IFlowNodeData;
  const label = (d.metadata?.label as string) || d.content || 'Agent job';
  return (
    <NodeShell accentColor="border-l-4 border-l-rose-500">
      <div className="flex items-center gap-1.5 mb-1">
        <AlertTriangle className="h-3 w-3 text-rose-400 shrink-0" />
        <span className="font-semibold text-xs text-foreground">Agent failed</span>
      </div>
      <p className="text-xs text-rose-300 font-medium leading-relaxed truncate">{label}</p>
    </NodeShell>
  );
}
