'use client';

import React from 'react';
import { WorkflowVisualization } from '../../components/playground/workflow-visualization';
import type { IWorkflowExportStructure } from '@robota-sdk/workflow';
import type { IPlaygroundToolMeta } from '../../tools/catalog';

interface IWorkflowViewProps {
  workflow?: IWorkflowExportStructure;
  onAgentNodeClick?: (nodeId: string, data?: any) => void;
  onToolDrop?: (agentId: string, tool: IPlaygroundToolMeta) => Promise<void>;
  toolItems?: IPlaygroundToolMeta[];
  addedToolsByAgent?: Record<string, string[]>;
}

export function WorkflowView({ 
  workflow, 
  onAgentNodeClick, 
  onToolDrop,
  toolItems,
  addedToolsByAgent
}: IWorkflowViewProps): React.ReactElement {
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


