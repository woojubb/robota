import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskRunner,
  ICommandHostAdapters,
  ICommandModule,
  TSubagentRunnerFactory,
} from '@robota-sdk/agent-sdk';
import { createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { useInteractiveSession } from './hooks/useInteractiveSession.js';
import { usePluginCallbacks } from './hooks/usePluginCallbacks.js';
import { useSideEffects } from './hooks/useSideEffects.js';
import { useStatusLineSettings } from './hooks/useStatusLineSettings.js';
import MessageList from './MessageList.js';
import SessionStatusBar from './SessionStatusBar.js';
import InputArea from './InputArea.js';
import ConfirmPrompt from './ConfirmPrompt.js';
import InteractivePrompt from './InteractivePrompt.js';
import PermissionPrompt from './PermissionPrompt.js';
import StreamingIndicator from './StreamingIndicator.js';
import PluginTUI from './PluginTUI.js';
import SessionPicker from './SessionPicker.js';
import BackgroundTaskPanel from './BackgroundTaskPanel.js';
import UpdateNotice from './UpdateNotice.js';
import { formatCliUpdateNotice, type ICliUpdateNotice } from '../utils/update-check.js';
import { formatModelChangeConfirmationMessage } from './hooks/model-change-side-effect.js';
import type { SessionStore } from '@robota-sdk/agent-sessions';

interface IProps {
  cwd: string;
  provider: IAIProvider;
  providerOverride?: string | undefined;
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
  commandHostAdapters?: ICommandHostAdapters;
  startupUpdateNoticePromise?: Promise<ICliUpdateNotice | undefined>;
}

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
    commandHostAdapters: props.commandHostAdapters,
  });

  const pluginCallbacks = usePluginCallbacks(cwd);
  const { exit } = useApp();
  const [sessionName, setSessionName] = useState<string | undefined>(props.sessionName);
  const [updateNotice, setUpdateNotice] = useState<ICliUpdateNotice | undefined>();
  const [statusLineSettings, setStatusLineSettings] = useStatusLineSettings();
  const activeBackgroundTaskCount = backgroundTasks.filter(
    (task) => task.status === 'queued' || task.status === 'running',
  ).length;

  const {
    handleSubmit,
    pendingModelId,
    pendingInteractionPrompt,
    showPluginTUI,
    showSessionPicker,
    setShowPluginTUI,
    setShowSessionPicker,
    handleModelConfirm,
    handleInteractionSubmit,
    handleInteractionCancel,
  } = useSideEffects({
    cwd,
    providerOverride: props.providerOverride,
    interactiveSession,
    addEntry,
    baseHandleSubmit,
    setSessionName,
    setStatusLineSettings,
  });

  // Sync session name from InteractiveSession when resuming
  useEffect(() => {
    const name = interactiveSession?.getName?.();
    if (name && !sessionName) setSessionName(name);
  }, [interactiveSession, sessionName]);

  useEffect(() => {
    let isMounted = true;
    props.startupUpdateNoticePromise
      ?.then((notice) => {
        if (isMounted && notice !== undefined) {
          setUpdateNotice(notice);
        }
      })
      .catch(() => {
        // Startup update checks are best-effort and must not disrupt the TUI.
      });
    return () => {
      isMounted = false;
    };
  }, [props.startupUpdateNoticePromise]);

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
      {updateNotice && <UpdateNotice message={formatCliUpdateNotice(updateNotice)} />}
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        <MessageList history={history} />
        {isShuttingDown && (
          <Box marginBottom={1}>
            <Text color="yellow">Shutting down...</Text>
          </Box>
        )}
        {(isThinking || activeTools.length > 0) && (
          <Box flexDirection="column" marginBottom={1}>
            <StreamingIndicator
              text={streamingText}
              activeTools={activeTools}
              isThinking={isThinking}
            />
          </Box>
        )}
        <BackgroundTaskPanel tasks={backgroundTasks} />
      </Box>
      {permissionRequest && <PermissionPrompt request={permissionRequest} />}
      {pendingModelId && (
        <ConfirmPrompt
          message={formatModelChangeConfirmationMessage(pendingModelId)}
          onSelect={handleModelConfirm}
        />
      )}
      {pendingInteractionPrompt && (
        <InteractivePrompt
          prompt={pendingInteractionPrompt}
          onSubmit={handleInteractionSubmit}
          onCancel={handleInteractionCancel}
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
      <SessionStatusBar
        cwd={cwd}
        permissionMode={permissionMode}
        modelId={props.modelId}
        sessionId={sessionId}
        messageCount={history.length}
        isThinking={isThinking}
        activeToolCount={activeTools.length}
        activeBackgroundTaskCount={activeBackgroundTaskCount}
        hasPendingPrompt={pendingPrompt !== null}
        contextState={contextState}
        sessionName={sessionName}
        settings={statusLineSettings}
      />
      <InputArea
        onSubmit={handleSubmit}
        onCancelQueue={handleCancelQueue}
        isDisabled={
          !!permissionRequest ||
          showPluginTUI ||
          showSessionPicker ||
          isShuttingDown ||
          pendingInteractionPrompt !== null ||
          (isThinking && !!pendingPrompt)
        }
        isAborting={isAborting}
        pendingPrompt={pendingPrompt}
        registry={registry}
        sessionName={sessionName}
        history={history}
      />
      {/* Permanent blank line below input — required for Korean IME stability. */}
      <Text> </Text>
    </Box>
  );
}
