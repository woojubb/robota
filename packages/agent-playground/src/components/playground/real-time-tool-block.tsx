'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { ChevronDown, ChevronRight, ArrowRight, Timer } from 'lucide-react';
import type {
  IRealTimeBlockMessage,
  IRealTimeBlockMetadata,
} from '../../lib/playground/block-tracking/types';
import {
  getBlockTypeIcon,
  getStatusIcon,
  getStatusColors,
  formatDuration,
  formatTime,
  getIndentationClasses,
  PROGRESS_IN_PROGRESS,
  PROGRESS_PARTIAL,
  PROGRESS_INITIAL,
  PROGRESS_COMPLETE,
} from './real-time-tool-block-utils';
import {
  ProgressSection,
  ToolParametersSection,
  ToolResultSection,
  ErrorInfoSection,
  DebugInfoSection,
} from './real-time-tool-block-sections';

/**
 * Props for RealTimeToolBlock component
 */
export interface IRealTimeToolBlockProps {
  /** The real-time block message to render */
  block: IRealTimeBlockMessage;

  /** Child blocks for hierarchical rendering */
  children?: React.ReactNode;

  /** Callback when block expand/collapse state changes */
  onToggleExpand?: (blockId: string, isExpanded: boolean) => void;

  /** Callback when block is clicked */
  onClick?: (block: IRealTimeBlockMessage) => void;

  /** Whether this block is currently selected */
  isSelected?: boolean;

  /** Current hierarchical level for indentation */
  level?: number;

  /** Whether to show detailed debug information */
  showDebug?: boolean;

  /** Whether to show real-time progress information */
  showProgress?: boolean;
}

/**
 * Enhanced Tool Execution Visualization
 *
 * Displays real-time tool execution with hierarchical context and actual data.
 * Features:
 * - Real-time execution status and progress
 * - Hierarchical execution tree visualization
 * - Actual execution timing and duration
 * - Tool parameters and results display
 * - Interactive expand/collapse for details
 */
export const RealTimeToolBlock: React.FC<IRealTimeToolBlockProps> = ({
  block,
  children,
  onToggleExpand,
  onClick,
  isSelected = false,
  level = 0,
  showDebug = false,
  showProgress = true,
}) => {
  const [isExpanded, setIsExpanded] = useState(block.blockMetadata.isExpanded);

  const metadata = block.blockMetadata;
  const hasChildren = !!children || metadata.children.length > 0;

  const actualProgress = useMemo(() => {
    if (metadata.toolProvidedData?.progress !== undefined) {
      return metadata.toolProvidedData.progress;
    }
    switch (metadata.visualState) {
      case 'pending':
        return 0;
      case 'in_progress':
        return metadata.actualDuration
          ? Math.min(PROGRESS_IN_PROGRESS, PROGRESS_PARTIAL)
          : PROGRESS_INITIAL;
      case 'completed':
        return PROGRESS_COMPLETE;
      case 'error':
        return 0;
      default:
        return 0;
    }
  }, [metadata.visualState, metadata.toolProvidedData?.progress, metadata.actualDuration]);

  const handleToggleExpand = useCallback(() => {
    const newExpanded = !isExpanded;
    setIsExpanded(newExpanded);
    onToggleExpand?.(metadata.id, newExpanded);
  }, [isExpanded, metadata.id, onToggleExpand]);

  const handleClick = useCallback(() => {
    onClick?.(block);
  }, [block, onClick]);

  const indentationClasses = getIndentationClasses(level);

  return (
    <div className={`relative ${indentationClasses}`}>
      {level > 0 && (
        <div className="absolute left-0 top-6 w-3 h-0 border-t-2 border-gray-300"></div>
      )}

      <Card
        className={`
                    ${getStatusColors(metadata.visualState)}
                    ${isSelected ? 'ring-2 ring-blue-400' : ''}
                    transition-all duration-200 hover:shadow-md cursor-pointer
                    mb-2
                `}
        onClick={handleClick}
      >
        <CardHeader className="pb-3">
          <BlockHeader
            metadata={metadata}
            blockRole={block.role}
            hasChildren={hasChildren}
            isExpanded={isExpanded}
            onToggleExpand={handleToggleExpand}
          />
        </CardHeader>

        <CardContent className="pt-0">
          <div className="space-y-3">
            {block.content && (
              <div className="text-sm text-gray-700 font-mono bg-gray-50 p-2 rounded border">
                {block.content}
              </div>
            )}

            {showProgress && metadata.visualState === 'in_progress' && (
              <ProgressSection actualProgress={actualProgress} metadata={metadata} />
            )}

            {metadata.toolParameters && (
              <ToolParametersSection parameters={metadata.toolParameters} />
            )}

            {metadata.toolResult && metadata.visualState === 'completed' && (
              <ToolResultSection toolResult={metadata.toolResult} />
            )}

            {metadata.renderData?.error && metadata.visualState === 'error' && (
              <ErrorInfoSection error={metadata.renderData.error} />
            )}

            {showDebug && <DebugInfoSection metadata={metadata} />}
          </div>
        </CardContent>
      </Card>

      {isExpanded && children && (
        <div className="ml-4 border-l-2 border-gray-200 pl-4">{children}</div>
      )}
    </div>
  );
};

/** Header section with expand toggle, type icon, title, status, and timing. */
const BlockHeader: React.FC<{
  metadata: IRealTimeBlockMetadata;
  blockRole: string;
  hasChildren: boolean;
  isExpanded: boolean;
  onToggleExpand: () => void;
}> = ({ metadata, blockRole, hasChildren, isExpanded, onToggleExpand }) => (
  <div className="flex items-center justify-between">
    <div className="flex items-center space-x-3">
      {hasChildren && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
        >
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </Button>
      )}

      {getBlockTypeIcon(metadata)}

      <div className="flex flex-col">
        <CardTitle className="text-sm font-medium">
          {metadata.executionContext?.toolName || blockRole}
          {metadata.executionHierarchy && (
            <Badge variant="outline" className="ml-2 text-xs">
              Level {metadata.executionHierarchy.level}
            </Badge>
          )}
        </CardTitle>

        {metadata.executionHierarchy?.path && (
          <div className="flex items-center space-x-1 text-xs text-gray-500 mt-1">
            {metadata.executionHierarchy.path.map((step, index) => (
              <React.Fragment key={index}>
                {index > 0 && <ArrowRight className="w-3 h-3" />}
                <span>{step}</span>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </div>

    <div className="flex items-center space-x-2">
      <div className="flex items-center space-x-1">
        {getStatusIcon(metadata.visualState)}
        <span className="text-xs capitalize text-gray-600">
          {metadata.visualState.replace('_', ' ')}
        </span>
      </div>

      {metadata.startTime && (
        <Badge variant="secondary" className="text-xs">
          <Timer className="w-3 h-3 mr-1" />
          {metadata.actualDuration
            ? formatDuration(metadata.actualDuration)
            : formatTime(metadata.startTime)}
        </Badge>
      )}
    </div>
  </div>
);

export default RealTimeToolBlock;
