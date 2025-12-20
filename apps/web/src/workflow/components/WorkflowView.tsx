'use client';

import React from 'react';
import { WorkflowVisualization } from '@/components/playground/workflow-visualization';
import type { UniversalWorkflowStructure } from '@robota-sdk/agents';
import type { PlaygroundToolMeta } from '@/tools/catalog';

interface WorkflowViewProps {
  workflow?: UniversalWorkflowStructure;
  onAgentNodeClick?: (nodeId: string, data?: any) => void;
  onToolDrop?: (agentId: string, tool: PlaygroundToolMeta) => Promise<void>;
  toolItems?: PlaygroundToolMeta[];
  addedToolsByAgent?: Record<string, string[]>;
}

export function WorkflowView({ 
  workflow, 
  onAgentNodeClick, 
  onToolDrop,
  toolItems,
  addedToolsByAgent
}: WorkflowViewProps): JSX.Element {
  return (
    <div className="h-full w-full">
      <WorkflowVisualization
        workflow={workflow}
        onAgentNodeClick={onAgentNodeClick}
        onToolDrop={onToolDrop}
        toolItems={toolItems}
        addedToolsByAgent={addedToolsByAgent}
      />
    </div>
  );
}


