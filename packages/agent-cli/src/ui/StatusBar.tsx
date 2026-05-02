import React from 'react';
import { Box, Text } from 'ink';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import { formatTokenCount } from '@robota-sdk/agent-core';
import { formatStatusActivity } from './status-activity.js';

/** Threshold boundaries for context percentage color coding */
const CONTEXT_YELLOW_THRESHOLD = 70;
const CONTEXT_RED_THRESHOLD = 90;

interface IProps {
  permissionMode: TPermissionMode;
  modelName: string;
  sessionId: string;
  messageCount: number;
  isThinking: boolean;
  activeToolCount?: number;
  activeBackgroundTaskCount?: number;
  hasPendingPrompt?: boolean;
  contextPercentage: number;
  contextUsedTokens: number;
  contextMaxTokens: number;
  sessionName?: string;
  gitBranch?: string;
  showGitBranch?: boolean;
}

interface IStatusLeftProps {
  permissionMode: TPermissionMode;
  modelName: string;
  isThinking: boolean;
  activeToolCount: number;
  activeBackgroundTaskCount: number;
  hasPendingPrompt: boolean;
  contextPercentage: number;
  contextUsedTokens: number;
  contextMaxTokens: number;
  sessionName?: string;
  gitBranch?: string;
  showGitBranch: boolean;
}

/** Return the color for the context percentage indicator */
function getContextColor(percentage: number): string {
  if (percentage >= CONTEXT_RED_THRESHOLD) return 'red';
  if (percentage >= CONTEXT_YELLOW_THRESHOLD) return 'yellow';
  return 'green';
}

function StatusActivityText({
  isThinking,
  activeToolCount,
  activeBackgroundTaskCount,
  hasPendingPrompt,
}: Pick<
  IStatusLeftProps,
  'isThinking' | 'activeToolCount' | 'activeBackgroundTaskCount' | 'hasPendingPrompt'
>): React.ReactElement {
  const activity = formatStatusActivity({
    isThinking,
    activeToolCount,
    activeBackgroundTaskCount,
    hasPendingPrompt,
  });

  return (
    <>
      <Text color="cyan" bold>
        Activity:
      </Text>{' '}
      <Text color={activity.color} bold={activity.kind !== 'idle'}>
        {activity.text}
      </Text>
    </>
  );
}

function ContextText({
  percentage,
  usedTokens,
  maxTokens,
}: {
  percentage: number;
  usedTokens: number;
  maxTokens: number;
}): React.ReactElement {
  return (
    <Text color={getContextColor(percentage)}>
      Context: {Math.round(percentage)}% ({formatTokenCount(usedTokens)}/
      {formatTokenCount(maxTokens)})
    </Text>
  );
}

function ModeText({ permissionMode }: { permissionMode: TPermissionMode }): React.ReactElement {
  return (
    <>
      <Text color="cyan" bold>
        Mode:
      </Text>{' '}
      <Text>{permissionMode}</Text>
    </>
  );
}

function StatusLeft({
  permissionMode,
  modelName,
  isThinking,
  activeToolCount,
  activeBackgroundTaskCount,
  hasPendingPrompt,
  contextPercentage,
  contextUsedTokens,
  contextMaxTokens,
  sessionName,
  gitBranch,
  showGitBranch,
}: IStatusLeftProps): React.ReactElement {
  const shouldShowGitBranch = showGitBranch && gitBranch !== undefined && gitBranch.length > 0;
  return (
    <Text>
      <StatusActivityText
        isThinking={isThinking}
        activeToolCount={activeToolCount}
        activeBackgroundTaskCount={activeBackgroundTaskCount}
        hasPendingPrompt={hasPendingPrompt}
      />
      {'  |  '}
      <ModeText permissionMode={permissionMode} />
      {sessionName && (
        <>
          {'  |  '}
          <Text color="magenta">{sessionName}</Text>
        </>
      )}
      {shouldShowGitBranch && (
        <>
          {'  |  '}
          <Text dimColor>git: {gitBranch}</Text>
        </>
      )}
      {'  |  '}
      <Text dimColor>{modelName}</Text>
      {'  |  '}
      <ContextText
        percentage={contextPercentage}
        usedTokens={contextUsedTokens}
        maxTokens={contextMaxTokens}
      />
    </Text>
  );
}

export default function StatusBar({
  permissionMode,
  modelName,
  sessionId: _sessionId,
  messageCount,
  isThinking,
  activeToolCount = 0,
  activeBackgroundTaskCount = 0,
  hasPendingPrompt = false,
  contextPercentage,
  contextUsedTokens,
  contextMaxTokens,
  sessionName,
  gitBranch,
  showGitBranch = true,
}: IProps): React.ReactElement {
  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      paddingLeft={1}
      paddingRight={1}
      justifyContent="space-between"
    >
      <StatusLeft
        permissionMode={permissionMode}
        modelName={modelName}
        isThinking={isThinking}
        activeToolCount={activeToolCount}
        activeBackgroundTaskCount={activeBackgroundTaskCount}
        hasPendingPrompt={hasPendingPrompt}
        contextPercentage={contextPercentage}
        contextUsedTokens={contextUsedTokens}
        contextMaxTokens={contextMaxTokens}
        sessionName={sessionName}
        gitBranch={gitBranch}
        showGitBranch={showGitBranch}
      />
      <Text>
        <Text dimColor>msgs: {messageCount}</Text>
      </Text>
    </Box>
  );
}
