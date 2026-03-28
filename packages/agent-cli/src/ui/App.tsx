import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import { getModelName, createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import { useInteractiveSession } from './hooks/useInteractiveSession.js';
import { usePluginCallbacks } from './hooks/usePluginCallbacks.js';
import { useSideEffects } from './hooks/useSideEffects.js';
import MessageList from './MessageList.js';
import StatusBar from './StatusBar.js';
import InputArea from './InputArea.js';
import ConfirmPrompt from './ConfirmPrompt.js';
import PermissionPrompt from './PermissionPrompt.js';
import StreamingIndicator from './StreamingIndicator.js';
import PluginTUI from './PluginTUI.js';
import SessionPicker from './SessionPicker.js';

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

  const {
    interactiveSession,
    registry,
    history,
    addEntry,
    streamingText,
    activeTools,
    isThinking,
    isAborting,
    pendingPrompt,
    permissionRequest,
    contextState,
    handleSubmit: baseHandleSubmit,
    handleAbort,
    handleCancelQueue,
  } = useInteractiveSession({
    cwd,
    provider: props.provider,
    permissionMode: props.permissionMode,
    maxTurns: props.maxTurns,
    sessionStore: props.sessionStore,
    resumeSessionId: props.resumeSessionId,
    forkSession: props.forkSession,
    sessionName: props.sessionName,
  });

  const pluginCallbacks = usePluginCallbacks(cwd);
  const [sessionName, setSessionName] = useState<string | undefined>(props.sessionName);

  const {
    handleSubmit,
    pendingModelId,
    showPluginTUI,
    showSessionPicker,
    setShowPluginTUI,
    setShowSessionPicker,
    handleModelConfirm,
  } = useSideEffects({
    interactiveSession,
    addEntry,
    baseHandleSubmit,
    setSessionName,
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
  useInput(
    (_input: string, key: { escape: boolean }) => {
      if (key.escape && isThinking) handleAbort();
    },
    { isActive: !permissionRequest && !showPluginTUI && !showSessionPicker },
  );

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
        {(isThinking || activeTools.length > 0) && (
          <Box flexDirection="column" marginBottom={1}>
            <StreamingIndicator text={streamingText} activeTools={activeTools} />
          </Box>
        )}
      </Box>
      {permissionRequest && <PermissionPrompt request={permissionRequest} />}
      {pendingModelId && (
        <ConfirmPrompt
          message={`Change model to ${getModelName(pendingModelId)}? This will restart the session.`}
          onSelect={handleModelConfirm}
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
