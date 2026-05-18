'use client';

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Bot } from 'lucide-react';

const PROVIDER_COLORS: Record<string, string> = {
  openai: 'bg-green-500/15 text-green-400',
  anthropic: 'bg-violet-500/15 text-violet-400',
  gemini: 'bg-yellow-500/15 text-yellow-400',
  google: 'bg-yellow-500/15 text-yellow-400',
  deepseek: 'bg-blue-500/15 text-blue-400',
};

export interface IAgentNodeData extends Record<string, unknown> {
  name: string;
  provider: string;
  model: string;
  systemMessage?: string;
  toolCount: number;
}

export function AgentNode({ data }: { data: IAgentNodeData }) {
  const colorClass = PROVIDER_COLORS[data.provider] ?? 'bg-primary/15 text-primary';

  return (
    <div className="bg-card border border-border rounded-xl shadow-md w-52">
      <Handle
        type="target"
        position={Position.Right}
        id="tool-input"
        className="!w-3 !h-3 !bg-primary !border-2 !border-background"
      />
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-primary/10">
            <Bot className="h-4 w-4 text-primary" />
          </div>
          <span className="font-semibold text-sm text-foreground truncate">{data.name}</span>
        </div>
        <div className="flex items-center gap-1.5 mb-1">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${colorClass}`}>
            {data.provider}
          </span>
          <span className="text-xs text-muted-foreground truncate">{data.model}</span>
        </div>
        {data.systemMessage && (
          <p className="text-xs text-muted-foreground mt-2 line-clamp-2 leading-relaxed">
            {data.systemMessage}
          </p>
        )}
        {data.toolCount > 0 && (
          <div className="mt-2 pt-2 border-t border-border">
            <span className="text-xs font-medium text-primary">
              {data.toolCount} {data.toolCount === 1 ? 'tool' : 'tools'} connected
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
