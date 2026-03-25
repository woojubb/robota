import React, { useState, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { InteractiveSession } from '@robota-sdk/agent-sdk';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import { getModelName, createSystemMessage } from '@robota-sdk/agent-core';
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

interface IProps {
  cwd: string;
  provider: IAIProvider;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  version?: string;
}

const EXIT_DELAY_MS = 500;

export default function App(props: IProps): React.ReactElement {
  const { exit } = useApp();
  const cwd = props.cwd;

  const {
    interactiveSession,
    registry,
    messages,
    addMessage,
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
  });

  const pluginCallbacks = usePluginCallbacks(cwd);

  // TUI-specific state
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const pendingModelChangeRef = useRef<string | null>(null);
  const [showPluginTUI, setShowPluginTUI] = useState(false);

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
      addMessage(createSystemMessage(`Language set to "${lang}". Restarting...`));
      setTimeout(() => exit(), EXIT_DELAY_MS);
      return;
    }

    if (sideEffects._resetRequested) {
      delete sideEffects._resetRequested;
      const settingsPath = getUserSettingsPath();
      if (deleteSettings(settingsPath)) {
        addMessage(createSystemMessage(`Deleted ${settingsPath}. Exiting...`));
      } else {
        addMessage(createSystemMessage('No user settings found.'));
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
  };

  // ESC abort
  useInput(
    (_input: string, key: { escape: boolean }) => {
      if (key.escape && isThinking) {
        handleAbort();
      }
    },
    { isActive: !permissionRequest && !showPluginTUI },
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
        <MessageList messages={messages} />
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
                addMessage(
                  createSystemMessage(
                    `Model changed to ${getModelName(pendingModelId)}. Restarting...`,
                  ),
                );
                setTimeout(() => exit(), EXIT_DELAY_MS);
              } catch (err) {
                addMessage(
                  createSystemMessage(
                    `Failed: ${err instanceof Error ? err.message : String(err)}`,
                  ),
                );
              }
            } else {
              addMessage(createSystemMessage('Model change cancelled.'));
            }
          }}
        />
      )}
      {showPluginTUI && (
        <PluginTUI
          callbacks={pluginCallbacks}
          onClose={() => setShowPluginTUI(false)}
          addMessage={(msg) => addMessage(createSystemMessage(msg.content))}
        />
      )}
      <StatusBar
        permissionMode={permissionMode}
        modelName=""
        sessionId={sessionId}
        messageCount={messages.length}
        isThinking={isThinking}
        contextPercentage={contextState.percentage}
        contextUsedTokens={contextState.usedTokens}
        contextMaxTokens={contextState.maxTokens}
      />
      <InputArea
        onSubmit={handleSubmit}
        onCancelQueue={handleCancelQueue}
        isDisabled={!!permissionRequest || showPluginTUI || (isThinking && !!pendingPrompt)}
        isAborting={isAborting}
        pendingPrompt={pendingPrompt}
        registry={registry}
      />
      {/* Permanent blank line below input — required for Korean IME stability. */}
      <Text> </Text>
    </Box>
  );
}
