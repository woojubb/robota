import { formatTokenCount } from '@robota-sdk/agent-core';
import { Box } from 'ink';
import React from 'react';

import { Text } from './SafeText.js';
import { useScreenReader } from './screen-reader-context.js';
import { formatStatusActivity } from './status-activity.js';
import { PALETTE } from './tui-palette.js';

import type { TModelEffort, TPermissionMode } from '@robota-sdk/agent-core';

/** Threshold boundaries for context percentage color coding */
const CONTEXT_YELLOW_THRESHOLD = 70;
const CONTEXT_RED_THRESHOLD = 90;

/** Segment separator between status-bar fields (SCREEN-006: single SSOT, was repeated inline 6x). */
const SEP = '  |  ';

interface IProps {
  permissionMode: TPermissionMode;
  modelName: string;
  providerDisplayName?: string | undefined;
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
  activeAgentLabel?: string;
  activePresetId?: string;
  effort?: TModelEffort;
}

interface IStatusLeftProps {
  permissionMode: TPermissionMode;
  modelName: string;
  providerDisplayName?: string | undefined;
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
  activePresetId?: string;
  effort?: TModelEffort;
}

/** Return the color for the context percentage indicator */
function getContextColor(percentage: number): string {
  if (percentage >= CONTEXT_RED_THRESHOLD) return PALETTE.text.error;
  if (percentage >= CONTEXT_YELLOW_THRESHOLD) return PALETTE.text.warning;
  return PALETTE.text.success;
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
      {formatTokenCount(maxTokens)} tokens)
    </Text>
  );
}

function ModeText({ permissionMode }: { permissionMode: TPermissionMode }): React.ReactElement {
  return (
    <>
      <Text color={PALETTE.text.accent} bold>
        Mode:
      </Text>{' '}
      <Text>{permissionMode}</Text>
    </>
  );
}

/**
 * CLI-2004 verdict (l): outside the mode the `default` mode is hidden as noise. In the mode it is
 * ALWAYS rendered — with no key-based cycling to announce, the status line is the only place a
 * reader can find which permission mode it is in, and a hidden `default` leaves nothing to find.
 */
function shouldShowPermissionMode(permissionMode: TPermissionMode, screenReader: boolean): boolean {
  return screenReader || permissionMode !== 'default';
}

function PresetText({ activePresetId }: { activePresetId: string }): React.ReactElement {
  return (
    <>
      <Text color={PALETTE.text.accent} bold>
        Preset:
      </Text>{' '}
      <Text>{activePresetId}</Text>
    </>
  );
}

function shouldShowActivePreset(activePresetId: string | undefined): activePresetId is string {
  return activePresetId !== undefined && activePresetId !== 'default';
}

function ProviderText({
  modelName,
  providerDisplayName,
  effort,
}: {
  modelName: string;
  providerDisplayName?: string | undefined;
  effort?: TModelEffort;
}): React.ReactElement {
  const provider =
    providerDisplayName !== undefined ? `${providerDisplayName} ${modelName}` : modelName;
  if (providerDisplayName !== undefined) {
    return (
      <Text dimColor>
        {provider}
        {effort !== undefined ? ` Effort: ${effort}` : ''}
      </Text>
    );
  }
  return (
    <Text dimColor>
      {provider}
      {effort !== undefined ? ` Effort: ${effort}` : ''}
    </Text>
  );
}

function StatusLeft(props: IStatusLeftProps): React.ReactElement {
  const shouldShowGitBranch =
    props.showGitBranch && props.gitBranch !== undefined && props.gitBranch.length > 0;
  // CLI-2004 § Solution 13: one rule applied to fields of different VOLATILITY. The activity text
  // and the context percentage re-render on their own cadence and on every token, so a reader
  // reviewing the status line would re-announce them continuously while the operator types — they
  // are suppressed. The permission mode, the preset and the model change only when the operator
  // changes them: those are anchors, and they stay.
  const screenReader = useScreenReader();
  const showPermissionMode = shouldShowPermissionMode(props.permissionMode, screenReader);
  const activePresetId = props.activePresetId;
  const showActivePreset = shouldShowActivePreset(activePresetId);
  return (
    <Text>
      {!screenReader && (
        <StatusActivityText
          isThinking={props.isThinking}
          activeToolCount={props.activeToolCount}
          activeBackgroundTaskCount={props.activeBackgroundTaskCount}
          hasPendingPrompt={props.hasPendingPrompt}
        />
      )}
      {showPermissionMode && (
        <>
          {SEP}
          <ModeText permissionMode={props.permissionMode} />
        </>
      )}
      {showActivePreset && (
        <>
          {SEP}
          <PresetText activePresetId={activePresetId} />
        </>
      )}
      {props.sessionName && (
        <>
          {SEP}
          <Text color={PALETTE.text.session}>{props.sessionName}</Text>
        </>
      )}
      {shouldShowGitBranch && (
        <>
          {SEP}
          <Text dimColor>git: {props.gitBranch}</Text>
        </>
      )}
      {SEP}
      <ProviderText
        modelName={props.modelName}
        providerDisplayName={props.providerDisplayName}
        effort={props.effort}
      />
      {!screenReader && (
        <>
          {SEP}
          <ContextText
            percentage={props.contextPercentage}
            usedTokens={props.contextUsedTokens}
            maxTokens={props.contextMaxTokens}
          />
        </>
      )}
    </Text>
  );
}

export default function StatusBar({
  permissionMode,
  modelName,
  providerDisplayName,
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
  activeAgentLabel,
  activePresetId,
  effort,
}: IProps): React.ReactElement {
  return (
    <Box paddingLeft={1} paddingRight={1} justifyContent="space-between">
      <StatusLeft
        permissionMode={permissionMode}
        modelName={modelName}
        providerDisplayName={providerDisplayName}
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
        activePresetId={activePresetId}
        effort={effort}
      />
      {activeAgentLabel !== undefined && (
        <Text color={PALETTE.text.warning} bold>
          [{activeAgentLabel}]
        </Text>
      )}
    </Box>
  );
}
