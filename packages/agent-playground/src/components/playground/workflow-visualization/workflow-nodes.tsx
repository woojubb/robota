'use client';

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { MessageSquare, Bot, Wrench, CheckCircle, XCircle } from 'lucide-react';
import type { IFlowNodeData } from './events-to-flow';

const CONTENT_PREVIEW_LENGTH = 80;

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
    <NodeShell accentColor="border-l-4 border-l-blue-500" hasTarget={false}>
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
        <span className="font-semibold text-xs text-foreground">{d.toolName || 'Tool call'}</span>
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
        <span className="font-semibold text-xs text-foreground">{d.toolName || 'Tool result'}</span>
      </div>
      {d.content && (
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{preview(d.content)}</p>
      )}
    </NodeShell>
  );
}

export function ToolErrorNode({ data }: NodeProps) {
  const d = data as IFlowNodeData;
  return (
    <NodeShell accentColor="border-l-4 border-l-red-500">
      <div className="flex items-center gap-1.5">
        <XCircle className="h-3 w-3 text-red-400 shrink-0" />
        <span className="font-semibold text-xs text-foreground">{d.toolName || 'Tool error'}</span>
      </div>
      {d.content && (
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{preview(d.content)}</p>
      )}
    </NodeShell>
  );
}
