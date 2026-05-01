import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { IAIProvider, IProviderDefinition } from '@robota-sdk/agent-core';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskRunner,
  ICommandModule,
  TSubagentRunnerFactory,
} from '@robota-sdk/agent-sdk';
import { getModelName, createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { useInteractiveSession } from './hooks/useInteractiveSession.js';
import { usePluginCallbacks } from './hooks/usePluginCallbacks.js';
import { useSideEffects } from './hooks/useSideEffects.js';
import MessageList from './MessageList.js';
import StatusBar from './StatusBar.js';
import InputArea from './InputArea.js';
import ConfirmPrompt from './ConfirmPrompt.js';
import ProviderSetupPrompt from './ProviderSetupPrompt.js';
import PermissionPrompt from './PermissionPrompt.js';
import StreamingIndicator from './StreamingIndicator.js';
import PluginTUI from './PluginTUI.js';
import SessionPicker from './SessionPicker.js';
import BackgroundTaskPanel from './BackgroundTaskPanel.js';
import { DEFAULT_PROVIDER_DEFINITIONS } from '../utils/provider-default-definitions.js';

import type { SessionStore } from '@robota-sdk/agent-sessions';

interface IProps {
  cwd: string;
  provider: IAIProvider;
  modelId?: string;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  version?: string;
  sessionStore?: SessionStore;
  resumeSessionId?: string;
  forkSession?: boolean;
  sessionName?: string;
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  subagentRunnerFactory?: TSubagentRunnerFactory;
  commandModules?: readonly ICommandModule[];
  providerDefinitions?: readonly IProviderDefinition[];
}

/**
 * Outer wrapper that manages session switching via React key remounting.
 */
export default function App(props: IProps): React.ReactElement {
  const [activeSessionId, setActiveSessionId] = useState<string | undefined>(props.resumeSessionId);

  return (
    <AppInner
      key={activeSessionId ?? '__new__'}
      {...props}
      resumeSessionId={activeSessionId}
      onSessionSwitch={(sessionId) => setActiveSessionId(sessionId)}
    />
  );
}

function AppInner(
  props: IProps & { onSessionSwitch: (sessionId: string) => void },
): React.ReactElement {
  const cwd = props.cwd;
  const providerDefinitions = props.providerDefinitions ?? DEFAULT_PROVIDER_DEFINITIONS;

  const {
    interactiveSession,
    registry,
    history,
    addEntry,
    streamingText,
    activeTools,
    isThinking,
    isAborting,
    isShuttingDown,
    pendingPrompt,
    backgroundTasks,
    permissionRequest,
    contextState,
    handleSubmit: baseHandleSubmit,
    handleAbort,
    handleCancelQueue,
    handleShutdown,
  } = useInteractiveSession({
    cwd,
    provider: props.provider,
    permissionMode: props.permissionMode,
    maxTurns: props.maxTurns,
    sessionStore: props.sessionStore,
    resumeSessionId: props.resumeSessionId,
    forkSession: props.forkSession,
    sessionName: props.sessionName,
    backgroundTaskRunners: props.backgroundTaskRunners,
    subagentRunnerFactory: props.subagentRunnerFactory,
    commandModules: props.commandModules,
    providerDefinitions,
  });

  const pluginCallbacks = usePluginCallbacks(cwd);
  const { exit } = useApp();
  const [sessionName, setSessionName] = useState<string | undefined>(props.sessionName);

  const {
    handleSubmit,
    pendingModelId,
    pendingProviderProfile,
    pendingProviderSetupType,
    showPluginTUI,
    showSessionPicker,
    setShowPluginTUI,
    setShowSessionPicker,
    handleModelConfirm,
    handleProviderConfirm,
    handleProviderSetupSubmit,
    handleProviderSetupCancel,
  } = useSideEffects({
    cwd,
    interactiveSession,
    addEntry,
    baseHandleSubmit,
    setSessionName,
    providerDefinitions,
  });

  // Sync session name from InteractiveSession when resuming
  useEffect(() => {
    const name = interactiveSession?.getName?.();
    if (name && !sessionName) setSessionName(name);
  }, [interactiveSession, sessionName]);

  // Update terminal title
  useEffect(() => {
    const title = sessionName ? `Robota — ${sessionName}` : 'Robota';
    process.stdout.write(`\x1b]0;${title}\x07`);
  }, [sessionName]);

  // ESC abort
  useInput((_input: string, key: { escape: boolean }) => {
    if (!key.escape || !isThinking) return;
    if (permissionRequest || showPluginTUI || showSessionPicker) return;
    handleAbort();
  });

  // Ctrl+C graceful shutdown
  useInput((input: string, key: { ctrl?: boolean }) => {
    if (!key.ctrl || input !== 'c' || isShuttingDown) return;
    void handleShutdown('prompt_input_exit').finally(() => exit());
  });

  useEffect(() => {
    const onSigterm = (): void => {
      if (isShuttingDown) return;
      void handleShutdown('other').finally(() => exit());
    };
    process.once('SIGINT', onSigterm);
    process.once('SIGTERM', onSigterm);
    return () => {
      process.off('SIGINT', onSigterm);
      process.off('SIGTERM', onSigterm);
    };
  }, [handleShutdown, exit, isShuttingDown]);

  // Session may not be initialized yet
  let permissionMode: TPermissionMode = props.permissionMode ?? 'default';
  let sessionId = '';
  try {
    const session = interactiveSession.getSession();
    permissionMode = session.getPermissionMode();
    sessionId = session.getSessionId();
  } catch {
    // Not yet initialized
  }

  return (
    <Box flexDirection="column">
      <Box flexDirection="column" paddingX={1} marginBottom={1}>
        <Text color="cyan" bold>{`
  ____   ___  ____   ___ _____  _
 |  _ \\ / _ \\| __ ) / _ \\_   _|/ \\
 | |_) | | | |  _ \\| | | || | / _ \\
 |  _ <| |_| | |_) | |_| || |/ ___ \\
 |_| \\_\\\\___/|____/ \\___/ |_/_/   \\_\\
`}</Text>
        <Text dimColor> v{props.version ?? '0.0.0'}</Text>
      </Box>
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        <MessageList history={history} />
        {isShuttingDown && (
          <Box marginBottom={1}>
            <Text color="yellow">Shutting down...</Text>
          </Box>
        )}
        {(isThinking || activeTools.length > 0) && (
          <Box flexDirection="column" marginBottom={1}>
            <StreamingIndicator text={streamingText} activeTools={activeTools} />
          </Box>
        )}
        <BackgroundTaskPanel tasks={backgroundTasks} />
      </Box>
      {permissionRequest && <PermissionPrompt request={permissionRequest} />}
      {pendingModelId && (
        <ConfirmPrompt
          message={`Change model to ${getModelName(pendingModelId)}? This will restart the session.`}
          onSelect={handleModelConfirm}
        />
      )}
      {pendingProviderProfile && (
        <ConfirmPrompt
          message={`Change provider to ${pendingProviderProfile}? This will restart the session.`}
          onSelect={handleProviderConfirm}
        />
      )}
      {pendingProviderSetupType && (
        <ProviderSetupPrompt
          type={pendingProviderSetupType}
          providerDefinitions={providerDefinitions}
          onSubmit={handleProviderSetupSubmit}
          onCancel={handleProviderSetupCancel}
        />
      )}
      {showPluginTUI && (
        <PluginTUI
          callbacks={pluginCallbacks}
          onClose={() => setShowPluginTUI(false)}
          addMessage={(msg) => addEntry(messageToHistoryEntry(createSystemMessage(msg.content)))}
        />
      )}
      {showSessionPicker && (
        <SessionPicker
          sessionStore={props.sessionStore}
          cwd={props.cwd}
          onSelect={(id) => {
            setShowSessionPicker(false);
            props.onSessionSwitch(id);
          }}
          onCancel={() => {
            setShowSessionPicker(false);
            addEntry(messageToHistoryEntry(createSystemMessage('Session resume cancelled.')));
          }}
        />
      )}
      <StatusBar
        permissionMode={permissionMode}
        modelName={props.modelId ? getModelName(props.modelId) : ''}
        sessionId={sessionId}
        messageCount={history.length}
        isThinking={isThinking}
        contextPercentage={contextState.percentage}
        contextUsedTokens={contextState.usedTokens}
        contextMaxTokens={contextState.maxTokens}
        sessionName={sessionName}
      />
      <InputArea
        onSubmit={handleSubmit}
        onCancelQueue={handleCancelQueue}
        isDisabled={
          !!permissionRequest ||
          showPluginTUI ||
          showSessionPicker ||
          isShuttingDown ||
          !!pendingProviderSetupType ||
          (isThinking && !!pendingPrompt)
        }
        isAborting={isAborting}
        pendingPrompt={pendingPrompt}
        registry={registry}
        sessionName={sessionName}
      />
      {/* Permanent blank line below input — required for Korean IME stability. */}
      <Text> </Text>
    </Box>
  );
}
