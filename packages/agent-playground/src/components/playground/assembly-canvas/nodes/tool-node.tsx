'use client';

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Wrench } from 'lucide-react';

export interface IToolNodeData extends Record<string, unknown> {
  name: string;
  description?: string;
}

export function ToolNode({ data }: { data: IToolNodeData }) {
  return (
    <div className="bg-card border border-border rounded-lg shadow-sm w-44">
      <Handle
        type="source"
        position={Position.Left}
        id="tool-output"
        className="!w-3 !h-3 !bg-muted-foreground !border-2 !border-background"
      />
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <Wrench className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-semibold text-foreground truncate">{data.name}</span>
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
