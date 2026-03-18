'use client';

import React from 'react';
import { Button } from '../ui/button';
import { Progress } from '../ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { CheckCircle, AlertCircle, Activity, Code, ChevronRight, Zap } from 'lucide-react';
import type { IRealTimeBlockMetadata } from '../../lib/playground/block-tracking/types';
import type { TToolParameters } from '@robota-sdk/agent-core';
import { formatDuration, formatTime } from './real-time-tool-block-utils';

/** In-progress indicator with optional tool-provided step info. */
export const ProgressSection: React.FC<{
  actualProgress: number;
  metadata: IRealTimeBlockMetadata;
}> = ({ actualProgress, metadata }) => (
  <div className="space-y-2">
    <div className="flex items-center justify-between text-xs">
      <span className="text-gray-600">Progress</span>
      <span className="font-medium">{actualProgress.toFixed(0)}%</span>
    </div>
    <Progress value={actualProgress} className="h-2" />
    {metadata.toolProvidedData?.currentStep && (
      <div className="flex items-center space-x-2 text-xs text-gray-600">
        <Activity className="w-3 h-3" />
        <span>{metadata.toolProvidedData.currentStep}</span>
      </div>
    )}
  </div>
);

/** Collapsible tool parameters display. */
export const ToolParametersSection: React.FC<{
  parameters: TToolParameters;
}> = ({ parameters }) => (
  <Collapsible>
    <CollapsibleTrigger asChild>
      <Button variant="ghost" size="sm" className="h-auto p-0 text-xs text-gray-600">
        <Code className="w-3 h-3 mr-1" />
        Parameters
        <ChevronRight className="w-3 h-3 ml-1" />
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <pre className="text-xs bg-gray-100 p-2 rounded mt-1 overflow-x-auto">
        {JSON.stringify(parameters, null, 2)}
      </pre>
    </CollapsibleContent>
  </Collapsible>
);

/** Collapsible tool result display (shown only when completed). */
export const ToolResultSection: React.FC<{
  toolResult: unknown;
}> = ({ toolResult }) => (
  <Collapsible>
    <CollapsibleTrigger asChild>
      <Button variant="ghost" size="sm" className="h-auto p-0 text-xs text-green-600">
        <CheckCircle className="w-3 h-3 mr-1" />
        Result
        <ChevronRight className="w-3 h-3 ml-1" />
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <pre className="text-xs bg-green-50 p-2 rounded mt-1 overflow-x-auto border border-green-200">
        {typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult, null, 2)}
      </pre>
    </CollapsibleContent>
  </Collapsible>
);

/** Error information panel (shown only when in error state). */
export const ErrorInfoSection: React.FC<{
  error: { message?: string };
}> = ({ error }) => (
  <div className="bg-red-50 border border-red-200 p-2 rounded">
    <div className="flex items-center space-x-2 text-red-700 text-xs font-medium">
      <AlertCircle className="w-3 h-3" />
      <span>Execution Error</span>
    </div>
    <pre className="text-xs text-red-600 mt-1 overflow-x-auto">
      {error.message || String(error)}
    </pre>
  </div>
);

/** Collapsible debug information panel. */
export const DebugInfoSection: React.FC<{
  metadata: IRealTimeBlockMetadata;
}> = ({ metadata }) => (
  <Collapsible>
    <CollapsibleTrigger asChild>
      <Button variant="ghost" size="sm" className="h-auto p-0 text-xs text-gray-500">
        <Zap className="w-3 h-3 mr-1" />
        Debug Info
        <ChevronRight className="w-3 h-3 ml-1" />
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent>
      <div className="text-xs bg-gray-50 p-2 rounded mt-1 space-y-1">
        <div>
          <strong>Block ID:</strong> {metadata.id}
        </div>
        <div>
          <strong>Execution ID:</strong> {metadata.executionContext?.executionId}
        </div>
        <div>
          <strong>Parent ID:</strong> {metadata.parentId || 'None'}
        </div>
        <div>
          <strong>Start Time:</strong> {formatTime(metadata.startTime)}
        </div>
        <div>
          <strong>End Time:</strong> {formatTime(metadata.endTime)}
        </div>
        <div>
          <strong>Duration:</strong> {formatDuration(metadata.actualDuration)}
        </div>
        {metadata.toolProvidedData && (
          <div>
            <strong>Tool Data:</strong> {JSON.stringify(metadata.toolProvidedData)}
          </div>
        )}
      </div>
    </CollapsibleContent>
  </Collapsible>
);
