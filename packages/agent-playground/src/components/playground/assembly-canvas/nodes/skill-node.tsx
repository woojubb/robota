'use client';

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Sparkles } from 'lucide-react';

export interface ISkillNodeData extends Record<string, unknown> {
  name: string;
  description?: string;
}

export function SkillNode({ data }: { data: ISkillNodeData }) {
  return (
    <div className="bg-card border border-violet-500/40 rounded-lg shadow-sm shadow-violet-500/10 w-44">
      <Handle
        type="source"
        position={Position.Left}
        id="skill-output"
        className="!w-3 !h-3 !bg-violet-500 !border-2 !border-background"
      />
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-violet-400 shrink-0" />
          <span className="text-xs font-semibold text-violet-300 truncate">{data.name}</span>
        </div>
        {data.description && (
          <p className="text-xs text-muted-foreground mt-1 line-clamp-2 leading-relaxed">
            {data.description}
          </p>
        )}
      </div>
    </div>
  );
}
