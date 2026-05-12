import React, { useMemo } from 'react';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import type { IStatusLineCommandSettings } from '@robota-sdk/agent-sdk';
import { useTuiCliAdapter } from './tui-cli-adapter-context.js';
import StatusBar from './StatusBar.js';

interface IProps {
  cwd: string;
  permissionMode: TPermissionMode;
  modelId?: string;
  providerProfileName?: string | undefined;
  providerType?: string | undefined;
  sessionId: string;
  isThinking: boolean;
  activeToolCount: number;
  activeBackgroundTaskCount: number;
  hasPendingPrompt: boolean;
  contextState: { percentage: number; usedTokens: number; maxTokens: number };
  sessionName?: string;
  settings: IStatusLineCommandSettings;
}

export default function SessionStatusBar({
  cwd,
  permissionMode,
  modelId,
  providerProfileName,
  providerType,
  sessionId,
  isThinking,
  activeToolCount,
  activeBackgroundTaskCount,
  hasPendingPrompt,
  contextState,
  sessionName,
  settings,
}: IProps): React.ReactElement | null {
  const cliAdapter = useTuiCliAdapter();
  const gitBranch = useMemo(() => cliAdapter.getGitBranch(cwd), [cliAdapter, cwd]);
  if (!settings.enabled) return null;

  return (
    <StatusBar
      permissionMode={permissionMode}
      modelName={modelId ?? ''}
      providerProfileName={providerProfileName}
      providerType={providerType}
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
    />
  );
}
