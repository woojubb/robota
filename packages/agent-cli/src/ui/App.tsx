import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type {
  IResolvedConfig,
  ILoadedContext,
  IProjectInfo,
  SessionStore,
} from '@robota-sdk/agent-sdk';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import { getModelName } from '@robota-sdk/agent-core';
import { getUserSettingsPath, updateModelInSettings } from '../utils/settings-io.js';
import { createSystemMessage } from '@robota-sdk/agent-core';
import { useSession } from './hooks/useSession.js';
import { useMessages } from './hooks/useMessages.js';
import { useSlashCommands } from './hooks/useSlashCommands.js';
import { useSubmitHandler } from './hooks/useSubmitHandler.js';
import { useCommandRegistry } from './hooks/useCommandRegistry.js';
import { usePluginCallbacks } from './hooks/usePluginCallbacks.js';
import MessageList from './MessageList.js';
import StatusBar from './StatusBar.js';
import InputArea from './InputArea.js';
import ConfirmPrompt from './ConfirmPrompt.js';
import PermissionPrompt from './PermissionPrompt.js';
import StreamingIndicator from './StreamingIndicator.js';
import PluginTUI from './PluginTUI.js';

interface IProps {
  config: IResolvedConfig;
  context: ILoadedContext;
  projectInfo?: IProjectInfo;
  sessionStore?: SessionStore;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  cwd?: string;
  version?: string;
}

const EXIT_DELAY_MS = 500;

/** Merge plugin hooks into config hooks (plugin hooks have lowest priority). */
function mergeHooksIntoConfig(
  configHooks: Record<string, unknown[]> | undefined,
  pluginHooks: Record<string, unknown[]>,
): Record<string, unknown[]> | undefined {
  const pluginKeys = Object.keys(pluginHooks);
  if (pluginKeys.length === 0) return configHooks;

  const merged: Record<string, unknown[]> = {};
  // Plugin hooks first (lower priority)
  for (const [event, groups] of Object.entries(pluginHooks)) {
    merged[event] = [...groups];
  }
  // Config hooks override/append (higher priority)
  if (configHooks) {
    for (const [event, groups] of Object.entries(configHooks)) {
      if (!Array.isArray(groups)) continue;
      if (!merged[event]) merged[event] = [];
      merged[event].push(...groups);
    }
  }
  return merged;
}

export default function App(props: IProps): React.ReactElement {
  const { exit } = useApp();
  // Load plugins first — hooks must be available before session creation
  const { registry, pluginHooks } = useCommandRegistry(props.cwd ?? process.cwd());

  // Merge plugin hooks into config before session creation
  const configWithPluginHooks = {
    ...props.config,
    hooks: mergeHooksIntoConfig(
      props.config.hooks as Record<string, unknown[]> | undefined,
      pluginHooks as Record<string, unknown[]>,
    ),
  };

  const { session, permissionRequest, streamingText, clearStreamingText, activeTools } = useSession(
    { ...props, config: configWithPluginHooks },
  );
  const { messages, setMessages, addMessage } = useMessages();
  const [isThinking, setIsThinking] = useState(false);
  const initialCtx = session.getContextState();
  const [contextState, setContextState] = useState({
    percentage: initialCtx.usedPercentage,
    usedTokens: initialCtx.usedTokens,
    maxTokens: initialCtx.maxTokens,
  });
  const pendingModelChangeRef = useRef<string | null>(null);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);
  const [showPluginTUI, setShowPluginTUI] = useState(false);
  const [isAborting, setIsAborting] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const pendingPromptRef = useRef<string | null>(null);

  const pluginCallbacks = usePluginCallbacks(props.cwd ?? process.cwd());
  const handleSlashCommand = useSlashCommands(
    session,
    addMessage,
    setMessages,
    exit,
    registry,
    pendingModelChangeRef,
    setPendingModelId,
    pluginCallbacks,
    setShowPluginTUI,
  );
  const executePrompt = useSubmitHandler(
    session,
    addMessage,
    handleSlashCommand,
    clearStreamingText,
    setIsThinking,
    setContextState,
    registry,
  );

  // Wrap submit: if thinking, queue the prompt (max 1) instead of executing
  const handleSubmit = useCallback(
    async (input: string) => {
      if (isThinking) {
        setPendingPrompt(input);
        pendingPromptRef.current = input;
        return;
      }
      await executePrompt(input);
    },
    [isThinking, executePrompt],
  );

  useInput(
    (_input: string, key: { escape: boolean }) => {
      // Ctrl+C is handled by Ink's exitOnCtrlC:true (always exits, bypasses useInput)
      if (key.escape && isThinking) {
        setIsAborting(true);
        setPendingPrompt(null);
        pendingPromptRef.current = null;
        session.abort();
      }
    },
    { isActive: !permissionRequest && !showPluginTUI },
  );

  // When execution ends: reset aborting, auto-execute queued prompt
  useEffect(() => {
    if (!isThinking) {
      setIsAborting(false);
      if (pendingPromptRef.current) {
        const prompt = pendingPromptRef.current;
        setPendingPrompt(null);
        pendingPromptRef.current = null;
        // Execute on next tick to avoid state update during render
        setTimeout(() => executePrompt(prompt), 0);
      }
    }
  }, [isThinking, pendingPrompt, executePrompt]);

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
        {isThinking && (
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
        permissionMode={session.getPermissionMode()}
        modelName={getModelName(props.config.provider.model)}
        sessionId={session.getSessionId()}
        messageCount={messages.length}
        isThinking={isThinking}
        contextPercentage={contextState.percentage}
        contextUsedTokens={contextState.usedTokens}
        contextMaxTokens={contextState.maxTokens}
      />
      <InputArea
        onSubmit={handleSubmit}
        onCancelQueue={() => {
          setPendingPrompt(null);
          pendingPromptRef.current = null;
        }}
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
