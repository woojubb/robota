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
  providerProfileName?: string | undefined;
  providerType?: string | undefined;
  sessionId: string;
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
  providerProfileName?: string | undefined;
  providerType?: string | undefined;
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
    <Text color={activity.color} bold={activity.kind !== 'idle'}>
      {activity.text}
    </Text>
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

function shouldShowPermissionMode(permissionMode: TPermissionMode): boolean {
  return permissionMode !== 'default';
}

function ProviderText({
  modelName,
  providerProfileName,
  providerType,
}: {
  modelName: string;
  providerProfileName?: string | undefined;
  providerType?: string | undefined;
}): React.ReactElement {
  if (providerProfileName !== undefined && providerType !== undefined) {
    return (
      <Text dimColor>
        {providerProfileName} ({providerType}) {modelName}
      </Text>
    );
  }
  return <Text dimColor>{modelName}</Text>;
}

function StatusLeft(props: IStatusLeftProps): React.ReactElement {
  const shouldShowGitBranch =
    props.showGitBranch && props.gitBranch !== undefined && props.gitBranch.length > 0;
  const showPermissionMode = shouldShowPermissionMode(props.permissionMode);
  return (
    <Text>
      <StatusActivityText
        isThinking={props.isThinking}
        activeToolCount={props.activeToolCount}
        activeBackgroundTaskCount={props.activeBackgroundTaskCount}
        hasPendingPrompt={props.hasPendingPrompt}
      />
      {showPermissionMode && (
        <>
          {'  |  '}
          <ModeText permissionMode={props.permissionMode} />
        </>
      )}
      {props.sessionName && (
        <>
          {'  |  '}
          <Text color="magenta">{props.sessionName}</Text>
        </>
      )}
      {shouldShowGitBranch && (
        <>
          {'  |  '}
          <Text dimColor>git: {props.gitBranch}</Text>
        </>
      )}
      {'  |  '}
      <ProviderText
        modelName={props.modelName}
        providerProfileName={props.providerProfileName}
        providerType={props.providerType}
      />
      {'  |  '}
      <ContextText
        percentage={props.contextPercentage}
        usedTokens={props.contextUsedTokens}
        maxTokens={props.contextMaxTokens}
      />
    </Text>
  );
}

export default function StatusBar({
  permissionMode,
  modelName,
  providerProfileName,
  providerType,
  sessionId: _sessionId,
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
        providerProfileName={providerProfileName}
        providerType={providerType}
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
    </Box>
  );
}
