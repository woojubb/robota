import React, { useState, useRef } from 'react';
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
import { useSession } from './hooks/useSession.js';
import { useMessages } from './hooks/useMessages.js';
import { useSlashCommands } from './hooks/useSlashCommands.js';
import { useSubmitHandler } from './hooks/useSubmitHandler.js';
import { useCommandRegistry } from './hooks/useCommandRegistry.js';
import MessageList from './MessageList.js';
import StatusBar from './StatusBar.js';
import InputArea from './InputArea.js';
import ConfirmPrompt from './ConfirmPrompt.js';
import PermissionPrompt from './PermissionPrompt.js';
import StreamingIndicator from './StreamingIndicator.js';

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

export default function App(props: IProps): React.ReactElement {
  const { exit } = useApp();
  const { session, permissionRequest, streamingText, clearStreamingText, activeTools } =
    useSession(props);
  const { messages, setMessages, addMessage } = useMessages();
  const [isThinking, setIsThinking] = useState(false);
  const initialCtx = session.getContextState();
  const [contextState, setContextState] = useState({
    percentage: initialCtx.usedPercentage,
    usedTokens: initialCtx.usedTokens,
    maxTokens: initialCtx.maxTokens,
  });
  const registry = useCommandRegistry(props.cwd ?? process.cwd());
  const pendingModelChangeRef = useRef<string | null>(null);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);

  const handleSlashCommand = useSlashCommands(
    session,
    addMessage,
    setMessages,
    exit,
    registry,
    pendingModelChangeRef,
    setPendingModelId,
  );
  const handleSubmit = useSubmitHandler(
    session,
    addMessage,
    handleSlashCommand,
    clearStreamingText,
    setIsThinking,
    setContextState,
    registry,
  );

  useInput(
    (_input: string, key: { ctrl: boolean; escape: boolean }) => {
      if (key.ctrl && _input === 'c') exit();
      if (key.escape && isThinking) session.abort();
    },
    { isActive: !permissionRequest },
  );

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
                addMessage({
                  role: 'system',
                  content: `Model changed to ${getModelName(pendingModelId)}. Restarting...`,
                });
                setTimeout(() => exit(), EXIT_DELAY_MS);
              } catch (err) {
                addMessage({
                  role: 'system',
                  content: `Failed: ${err instanceof Error ? err.message : String(err)}`,
                });
              }
            } else {
              addMessage({ role: 'system', content: 'Model change cancelled.' });
            }
          }}
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
        isDisabled={isThinking || !!permissionRequest}
        registry={registry}
      />
      {/* Permanent blank line below input — required for Korean IME stability. */}
      <Text> </Text>
    </Box>
  );
}
