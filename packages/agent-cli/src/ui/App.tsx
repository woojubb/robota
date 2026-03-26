import React, { useState, useRef, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import { getModelName, createSystemMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';
import {
  getUserSettingsPath,
  updateModelInSettings,
  deleteSettings,
  readSettings,
  writeSettings,
} from '../utils/settings-io.js';
import { useInteractiveSession } from './hooks/useInteractiveSession.js';
import type { ISideEffects } from './hooks/useInteractiveSession.js';
import { usePluginCallbacks } from './hooks/usePluginCallbacks.js';
import MessageList from './MessageList.js';
import StatusBar from './StatusBar.js';
import InputArea from './InputArea.js';
import ConfirmPrompt from './ConfirmPrompt.js';
import PermissionPrompt from './PermissionPrompt.js';
import StreamingIndicator from './StreamingIndicator.js';
import PluginTUI from './PluginTUI.js';
import ListPicker from './ListPicker.js';

import type { SessionStore, ISessionRecord } from '@robota-sdk/agent-sessions';

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

const EXIT_DELAY_MS = 500;
const SESSION_ID_DISPLAY_LENGTH = 8;

/**
 * Outer wrapper that manages session switching via React key remounting.
 * When a session is selected from the picker, activeSessionId changes,
 * causing AppInner to unmount and remount with the new resumeSessionId.
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
  const { exit } = useApp();
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

  // TUI-specific state
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const pendingModelChangeRef = useRef<string | null>(null);
  const [showPluginTUI, setShowPluginTUI] = useState(false);
  const [showSessionPicker, setShowSessionPicker] = useState(
    props.resumeSessionId === '__picker__',
  );
  const [sessionName, setSessionName] = useState<string | undefined>(props.sessionName);

  // Sync session name from InteractiveSession when resuming a named session
  useEffect(() => {
    const name = interactiveSession?.getName?.();
    if (name && !sessionName) setSessionName(name);
  }, [interactiveSession, sessionName]);

  // Update terminal title when session name changes
  useEffect(() => {
    const title = sessionName ? `Robota — ${sessionName}` : 'Robota';
    process.stdout.write(`\x1b]0;${title}\x07`);
  }, [sessionName]);

  // Wrap submit to handle TUI-specific side effects from system commands
  const handleSubmit = async (input: string): Promise<void> => {
    await baseHandleSubmit(input);

    // Check for TUI-specific side effects set by useInteractiveSession
    const sideEffects = interactiveSession as InteractiveSession & ISideEffects;

    if (sideEffects._pendingModelId) {
      const modelId = sideEffects._pendingModelId as string;
      delete sideEffects._pendingModelId;
      pendingModelChangeRef.current = modelId;
      setPendingModelId(modelId);
      return;
    }

    if (sideEffects._pendingLanguage) {
      const lang = sideEffects._pendingLanguage as string;
      delete sideEffects._pendingLanguage;
      const settingsPath = getUserSettingsPath();
      const settings = readSettings(settingsPath);
      settings.language = lang;
      writeSettings(settingsPath, settings);
      addEntry(
        messageToHistoryEntry(createSystemMessage(`Language set to "${lang}". Restarting...`)),
      );
      setTimeout(() => exit(), EXIT_DELAY_MS);
      return;
    }

    if (sideEffects._resetRequested) {
      delete sideEffects._resetRequested;
      const settingsPath = getUserSettingsPath();
      if (deleteSettings(settingsPath)) {
        addEntry(messageToHistoryEntry(createSystemMessage(`Deleted ${settingsPath}. Exiting...`)));
      } else {
        addEntry(messageToHistoryEntry(createSystemMessage('No user settings found.')));
      }
      setTimeout(() => exit(), EXIT_DELAY_MS);
      return;
    }

    if (sideEffects._exitRequested) {
      delete sideEffects._exitRequested;
      setTimeout(() => exit(), EXIT_DELAY_MS);
      return;
    }

    if (sideEffects._triggerPluginTUI) {
      delete sideEffects._triggerPluginTUI;
      setShowPluginTUI(true);
      return;
    }

    if (sideEffects._triggerResumePicker) {
      delete sideEffects._triggerResumePicker;
      setShowSessionPicker(true);
      return;
    }

    if (sideEffects._sessionName) {
      const name = sideEffects._sessionName as string;
      delete sideEffects._sessionName;
      interactiveSession.setName(name);
      setSessionName(name);
      return;
    }
  };

  // ESC abort
  useInput(
    (_input: string, key: { escape: boolean }) => {
      if (key.escape && isThinking) {
        handleAbort();
      }
    },
    { isActive: !permissionRequest && !showPluginTUI && !showSessionPicker },
  );

  // Session may not be initialized yet (async config/context loading)
  let permissionMode: TPermissionMode = props.permissionMode ?? 'default';
  let sessionId = '';
  try {
    const session = interactiveSession.getSession();
    permissionMode = session.getPermissionMode();
    sessionId = session.getSessionId();
  } catch {
    // Not yet initialized — use defaults
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
          onSelect={(index) => {
            setPendingModelId(null);
            pendingModelChangeRef.current = null;
            if (index === 0) {
              try {
                const settingsPath = getUserSettingsPath();
                updateModelInSettings(settingsPath, pendingModelId);
                addEntry(
                  messageToHistoryEntry(
                    createSystemMessage(
                      `Model changed to ${getModelName(pendingModelId)}. Restarting...`,
                    ),
                  ),
                );
                setTimeout(() => exit(), EXIT_DELAY_MS);
              } catch (err) {
                addEntry(
                  messageToHistoryEntry(
                    createSystemMessage(
                      `Failed: ${err instanceof Error ? err.message : String(err)}`,
                    ),
                  ),
                );
              }
            } else {
              addEntry(messageToHistoryEntry(createSystemMessage('Model change cancelled.')));
            }
          }}
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
        <Box flexDirection="column" paddingX={1} marginBottom={1}>
          <Text bold color="cyan">
            Select a session to resume (ESC to cancel):
          </Text>
          <ListPicker<ISessionRecord>
            items={(props.sessionStore?.list() ?? []).filter((s) => s.cwd === props.cwd)}
            renderItem={(session: ISessionRecord, isSelected: boolean) => {
              const lastMsg = session.messages
                .slice()
                .reverse()
                .find((m) => {
                  const msg = m as { role?: string; content?: string };
                  return msg.role === 'assistant' && msg.content;
                }) as { content?: string } | undefined;
              const rawPreview = lastMsg?.content?.replace(/[\n\r]+/g, ' ').trim() ?? '';
              const preview = rawPreview
                ? rawPreview.slice(0, 60) + (rawPreview.length > 60 ? '...' : '')
                : '';
              return (
                <Text>
                  {isSelected ? '> ' : '  '}
                  <Text bold>{session.name ?? session.id.slice(0, SESSION_ID_DISPLAY_LENGTH)}</Text>
                  {'  '}
                  <Text dimColor>
                    {new Date(session.updatedAt).toLocaleString(undefined, {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </Text>
                  {'  '}
                  <Text dimColor>msgs: {session.messages.length}</Text>
                  {preview ? (
                    <>
                      {'\n    '}
                      <Text color="gray">{preview}</Text>
                    </>
                  ) : null}
                </Text>
              );
            }}
            onSelect={(session: ISessionRecord) => {
              setShowSessionPicker(false);
              props.onSessionSwitch(session.id);
            }}
            onCancel={() => {
              setShowSessionPicker(false);
              addEntry(messageToHistoryEntry(createSystemMessage('Session resume cancelled.')));
            }}
          />
        </Box>
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
      />
      {/* Permanent blank line below input — required for Korean IME stability. */}
      <Text> </Text>
    </Box>
  );
}
