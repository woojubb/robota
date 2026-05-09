'use client';

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import type { NodeProps } from '@xyflow/react';
import { MessageSquare, Bot, Wrench, CheckCircle, XCircle } from 'lucide-react';
import type { IFlowNodeData } from './events-to-flow';

const CONTENT_PREVIEW_LENGTH = 80;

function preview(content: string): string {
  if (content.length <= CONTENT_PREVIEW_LENGTH) return content;
  return content.slice(0, CONTENT_PREVIEW_LENGTH) + '…';
}

function NodeShell({
  borderColor,
  children,
  hasTarget = true,
  hasSource = true,
}: {
  borderColor: string;
  children: React.ReactNode;
  hasTarget?: boolean;
  hasSource?: boolean;
}) {
  return (
    <div
      className={`w-52 rounded-lg border-2 ${borderColor} bg-card text-card-foreground shadow-sm p-2.5 text-sm`}
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
    <NodeShell borderColor="border-blue-500" hasTarget={false}>
      <div className="flex items-center gap-1.5 mb-1">
        <MessageSquare className="h-3 w-3 text-blue-500 shrink-0" />
        <span className="font-medium text-xs">User</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{preview(d.content)}</p>
    </NodeShell>
  );
}

export function AssistantResponseNode({ data }: NodeProps) {
  const d = data as IFlowNodeData;
  return (
    <NodeShell borderColor="border-green-500">
      <div className="flex items-center gap-1.5 mb-1">
        <Bot className="h-3 w-3 text-green-500 shrink-0" />
        <span className="font-medium text-xs">Assistant</span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{preview(d.content)}</p>
    </NodeShell>
  );
}

export function ToolCallNode({ data }: NodeProps) {
  const d = data as IFlowNodeData;
  return (
    <NodeShell borderColor="border-purple-500">
      <div className="flex items-center gap-1.5">
        <Wrench className="h-3 w-3 text-purple-500 shrink-0" />
        <span className="font-medium text-xs">{d.toolName || 'Tool call'}</span>
      </div>
    </NodeShell>
  );
}

export function ToolResultNode({ data }: NodeProps) {
  const d = data as IFlowNodeData;
  return (
    <NodeShell borderColor="border-orange-500">
      <div className="flex items-center gap-1.5">
        <CheckCircle className="h-3 w-3 text-orange-500 shrink-0" />
        <span className="font-medium text-xs">{d.toolName || 'Tool result'}</span>
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
    <NodeShell borderColor="border-red-500">
      <div className="flex items-center gap-1.5">
        <XCircle className="h-3 w-3 text-red-500 shrink-0" />
        <span className="font-medium text-xs">{d.toolName || 'Tool error'}</span>
      </div>
      {d.content && (
        <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{preview(d.content)}</p>
      )}
    </NodeShell>
  );
}
