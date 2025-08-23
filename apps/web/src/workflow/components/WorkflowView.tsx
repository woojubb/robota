'use client';

import React from 'react';
import { WorkflowVisualization } from '@/components/playground/workflow-visualization';
import type { UniversalWorkflowStructure } from '@robota-sdk/agents';

interface WorkflowViewProps {
  workflow?: UniversalWorkflowStructure;
  onAgentNodeClick?: (nodeId: string, data?: any) => void;
  onToolDrop?: (agentId: string, tool: any) => Promise<void>;
}

export function WorkflowView({ 
  workflow, 
  onAgentNodeClick, 
  onToolDrop 
}: WorkflowViewProps): JSX.Element {
  return (
    <div className="h-full w-full">
      <WorkflowVisualization
        workflow={workflow}
        onAgentNodeClick={onAgentNodeClick}
        onToolDrop={onToolDrop}
      />
    </div>
  );
}


