import React, { useMemo } from 'react';

import StatusBar, { ReadOnlyText } from './StatusBar.js';
import { useTuiCliAdapter } from './tui-cli-adapter-context.js';

import type { TModelEffortSelection, TPermissionMode } from '@robota-sdk/agent-core';
import type { IStatusLineCommandSettings } from '@robota-sdk/agent-interface-command';

interface IProps {
  cwd: string;
  permissionMode: TPermissionMode;
  modelId?: string;
  providerType?: string | undefined;
  sessionId: string;
  isThinking: boolean;
  activeToolCount: number;
  activeBackgroundTaskCount: number;
  hasPendingPrompt: boolean;
  contextState: { percentage: number; usedTokens: number; maxTokens: number };
  sessionName?: string;
  settings: IStatusLineCommandSettings;
  activeAgentLabel?: string;
  activePresetId?: string;
  effort?: TModelEffortSelection;
  gitRefreshToken?: number;
  readOnly?: boolean;
}

export default function SessionStatusBar({
  cwd,
  permissionMode,
  modelId,
  providerType,
  sessionId,
  isThinking,
  activeToolCount,
  activeBackgroundTaskCount,
  hasPendingPrompt,
  contextState,
  sessionName,
  settings,
  activeAgentLabel,
  activePresetId,
  effort,
  gitRefreshToken,
  readOnly = false,
}: IProps): React.ReactElement | null {
  const cliAdapter = useTuiCliAdapter();
  const gitBranch = useMemo(() => cliAdapter.getGitBranch(cwd), [cliAdapter, cwd, gitRefreshToken]);
  const providerDisplayName = useMemo(
    () =>
      providerType !== undefined ? cliAdapter.getProviderDisplayName(providerType) : undefined,
    [cliAdapter, providerType],
  );
  // With the status line off, an observer is still told it cannot change the session.
  if (!settings.enabled) return readOnly ? <ReadOnlyText /> : null;

  return (
    <StatusBar
      permissionMode={permissionMode}
      modelName={modelId ?? ''}
      providerDisplayName={providerDisplayName}
      sessionId={sessionId}
      isThinking={isThinking}
      activeToolCount={activeToolCount}
      activeBackgroundTaskCount={activeBackgroundTaskCount}
      hasPendingPrompt={hasPendingPrompt}
      contextPercentage={contextState.percentage}
      contextUsedTokens={contextState.usedTokens}
      contextMaxTokens={contextState.maxTokens}
      sessionName={sessionName}
      gitBranch={gitBranch}
      showGitBranch={settings.gitBranch}
      activeAgentLabel={activeAgentLabel}
      activePresetId={activePresetId}
      effort={effort}
      readOnly={readOnly}
    />
  );
}
