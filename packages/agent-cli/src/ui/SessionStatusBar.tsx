import React, { useMemo } from 'react';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import { getModelName } from '@robota-sdk/agent-core';
import type { IStatusLineSettings } from '../utils/statusline-settings.js';
import { resolveGitBranch } from '../utils/git-branch.js';
import StatusBar from './StatusBar.js';

interface IProps {
  cwd: string;
  permissionMode: TPermissionMode;
  modelId?: string;
  sessionId: string;
  messageCount: number;
  isThinking: boolean;
  contextState: { percentage: number; usedTokens: number; maxTokens: number };
  sessionName?: string;
  settings: IStatusLineSettings;
}

export default function SessionStatusBar({
  cwd,
  permissionMode,
  modelId,
  sessionId,
  messageCount,
  isThinking,
  contextState,
  sessionName,
  settings,
}: IProps): React.ReactElement | null {
  const gitBranch = useMemo(() => resolveGitBranch(cwd), [cwd]);
  if (!settings.enabled) return null;

  return (
    <StatusBar
      permissionMode={permissionMode}
      modelName={modelId ? getModelName(modelId) : ''}
      sessionId={sessionId}
      messageCount={messageCount}
      isThinking={isThinking}
      contextPercentage={contextState.percentage}
      contextUsedTokens={contextState.usedTokens}
      contextMaxTokens={contextState.maxTokens}
      sessionName={sessionName}
      gitBranch={gitBranch}
      showGitBranch={settings.gitBranch}
    />
  );
}
