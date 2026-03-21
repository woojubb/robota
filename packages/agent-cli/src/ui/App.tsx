import React, { useState, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { getUserSettingsPath, updateModelInSettings } from '../utils/settings-io.js';
import { executeSlashCommand as execSlash } from '../commands/slash-executor.js';
import { createSession, FileSessionLogger, projectPaths } from '@robota-sdk/agent-sdk';
import type { Session } from '@robota-sdk/agent-sdk';
import type {
  IResolvedConfig,
  ILoadedContext,
  IProjectInfo,
  SessionStore,
} from '@robota-sdk/agent-sdk';
import type { TPermissionMode, TToolArgs } from '@robota-sdk/agent-core';
import { getModelName } from '@robota-sdk/agent-core';
import type { ITerminalOutput, ISpinner } from '../types.js';
import type { IChatMessage, IPermissionRequest, TPermissionResult } from './types.js';
import { CommandRegistry } from '../commands/command-registry.js';
import { BuiltinCommandSource } from '../commands/builtin-source.js';
import { SkillCommandSource } from '../commands/skill-source.js';
import MessageList from './MessageList.js';
import StatusBar from './StatusBar.js';
import InputArea from './InputArea.js';
import ConfirmPrompt from './ConfirmPrompt.js';
import PermissionPrompt from './PermissionPrompt.js';
import { renderMarkdown } from './render-markdown.js';
import { extractToolCalls } from '../utils/tool-call-extractor.js';

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

let msgIdCounter = 0;
function nextId(): string {
  msgIdCounter += 1;
  return `msg_${msgIdCounter}`;
}

/** No-op ITerminalOutput for Ink mode (permissions handled via permissionHandler) */
const NOOP_TERMINAL: ITerminalOutput = {
  write: () => {},
  writeLine: () => {},
  writeMarkdown: () => {},
  writeError: () => {},
  prompt: () => Promise.resolve(''),
  select: () => Promise.resolve(0),
  spinner: (): ISpinner => ({ stop: () => {}, update: () => {} }),
};

/** Tool execution event for real-time UI display */
interface IToolExecutionState {
  toolName: string;
  isRunning: boolean;
}

/** Hook: create a Session instance once and provide a stable permission handler + streaming. */
function useSession(props: IProps): {
  session: Session;
  permissionRequest: IPermissionRequest | null;
  streamingText: string;
  clearStreamingText: () => void;
  activeTools: IToolExecutionState[];
} {
  const [permissionRequest, setPermissionRequest] = useState<IPermissionRequest | null>(null);
  const [streamingText, setStreamingText] = useState('');
  const [activeTools, setActiveTools] = useState<IToolExecutionState[]>([]);

  // Permission queue — handles concurrent tool permission requests sequentially
  const permissionQueueRef = useRef<
    Array<{
      toolName: string;
      toolArgs: TToolArgs;
      resolve: (result: TPermissionResult) => void;
    }>
  >([]);
  const processingRef = useRef(false);

  const processNextPermission = useCallback(() => {
    if (processingRef.current) return;
    const next = permissionQueueRef.current[0];
    if (!next) {
      setPermissionRequest(null);
      return;
    }
    processingRef.current = true;
    setPermissionRequest({
      toolName: next.toolName,
      toolArgs: next.toolArgs,
      resolve: (result: TPermissionResult) => {
        permissionQueueRef.current.shift();
        processingRef.current = false;
        setPermissionRequest(null);
        next.resolve(result);
        // Process next in queue after a tick
        setTimeout(() => processNextPermission(), 0);
      },
    });
  }, []);

  const sessionRef = useRef<Session | null>(null);
  if (sessionRef.current === null) {
    const permissionHandler = (
      toolName: string,
      toolArgs: TToolArgs,
    ): Promise<TPermissionResult> => {
      return new Promise<TPermissionResult>((resolve) => {
        permissionQueueRef.current.push({ toolName, toolArgs, resolve });
        processNextPermission();
      });
    };

    const onTextDelta = (delta: string): void => {
      setStreamingText((prev) => prev + delta);
    };

    const onToolExecution = (event: { type: 'start' | 'end'; toolName: string }): void => {
      if (event.type === 'start') {
        setActiveTools((prev) => [...prev, { toolName: event.toolName, isRunning: true }]);
      } else {
        // Mark as done but keep in list — cleared on run() completion by clearStreamingText
        setActiveTools((prev) =>
          prev.map((t) =>
            t.toolName === event.toolName && t.isRunning ? { ...t, isRunning: false } : t,
          ),
        );
      }
    };

    const paths = projectPaths(props.cwd ?? process.cwd());
    sessionRef.current = createSession({
      config: props.config,
      context: props.context,
      terminal: NOOP_TERMINAL,
      sessionLogger: new FileSessionLogger(paths.logs),
      projectInfo: props.projectInfo,
      sessionStore: props.sessionStore,
      permissionMode: props.permissionMode,
      maxTurns: props.maxTurns,
      permissionHandler,
      onTextDelta,
      onToolExecution,
    });
  }

  const clearStreamingText = useCallback(() => {
    setStreamingText('');
    setActiveTools([]);
  }, []);

  return { session: sessionRef.current, permissionRequest, streamingText, clearStreamingText, activeTools };
}

/** Hook: manage chat messages list. */
function useMessages(): {
  messages: IChatMessage[];
  setMessages: React.Dispatch<React.SetStateAction<IChatMessage[]>>;
  addMessage: (msg: Omit<IChatMessage, 'id' | 'timestamp'>) => void;
} {
  const [messages, setMessages] = useState<IChatMessage[]>([]);
  const addMessage = useCallback((msg: Omit<IChatMessage, 'id' | 'timestamp'>) => {
    setMessages((prev) => [...prev, { ...msg, id: nextId(), timestamp: new Date() }]);
  }, []);
  return { messages, setMessages, addMessage };
}

type TAddMessage = (msg: Omit<IChatMessage, 'id' | 'timestamp'>) => void;

const EXIT_DELAY_MS = 500;

/** Hook: handle slash commands via the extracted slash-executor module. */
function useSlashCommands(
  session: Session,
  addMessage: TAddMessage,
  setMessages: React.Dispatch<React.SetStateAction<IChatMessage[]>>,
  exit: () => void,
  registry: CommandRegistry,
  pendingModelChangeRef: React.MutableRefObject<string | null>,
  setPendingModelId: React.Dispatch<React.SetStateAction<string | null>>,
): (input: string) => Promise<boolean> {
  return useCallback(
    async (input: string): Promise<boolean> => {
      const parts = input.slice(1).split(/\s+/);
      const cmd = parts[0]?.toLowerCase() ?? '';
      const args = parts.slice(1).join(' ');
      const clearMessages = () => setMessages([]);
      const result = await execSlash(cmd, args, session, addMessage, clearMessages, registry);
      if (result.pendingModelId) {
        pendingModelChangeRef.current = result.pendingModelId;
        setPendingModelId(result.pendingModelId);
      }
      if (result.exitRequested) {
        setTimeout(() => exit(), EXIT_DELAY_MS);
      }
      return result.handled;
    },
    [session, addMessage, setMessages, exit, registry, pendingModelChangeRef, setPendingModelId],
  );
}

/** Streaming text indicator shown while the agent is generating a response */
function StreamingIndicator({ text, activeTools }: { text: string; activeTools: IToolExecutionState[] }): React.ReactElement {
  const hasTools = activeTools.length > 0;
  const hasText = text.length > 0;

  if (!hasTools && !hasText) {
    return <Text color="yellow">Thinking...</Text>;
  }

  return (
    <Box flexDirection="column">
      {hasText && (
        <>
          <Text color="cyan" bold>Robota:</Text>
          <Box marginLeft={2}>
            <Text wrap="wrap">{renderMarkdown(text)}</Text>
          </Box>
        </>
      )}
      {hasTools && (
        <>
          <Text color="gray" bold>Tools:</Text>
          {activeTools.map((t, i) => (
            <Text key={`${t.toolName}-${i}`} color={t.isRunning ? 'yellow' : 'green'}>
              {'  '}{t.isRunning ? '⟳' : '✓'} {t.toolName}
            </Text>
          ))}
        </>
      )}
    </Box>
  );
}

/** Run a prompt through the session with thinking/streaming state management */
async function runSessionPrompt(
  prompt: string,
  session: Session,
  addMessage: TAddMessage,
  clearStreamingText: () => void,
  setIsThinking: React.Dispatch<React.SetStateAction<boolean>>,
  setContextPercentage: React.Dispatch<React.SetStateAction<number>>,
): Promise<void> {
  setIsThinking(true);
  clearStreamingText();

  // Record history position to extract tool calls after run
  const historyBefore = session.getHistory().length;

  try {
    const response = await session.run(prompt);
    clearStreamingText();

    // Extract tool calls from session history — group into one message
    const history = session.getHistory();
    const toolLines = extractToolCalls(
      history as Array<{ role: string; toolCalls?: Array<{ function: { name: string; arguments: string } }> }>,
      historyBefore,
    );
    if (toolLines.length > 0) {
      addMessage({ role: 'tool', content: toolLines.join('\n'), toolName: `${toolLines.length} tools` });
    }

    addMessage({ role: 'assistant', content: response || '(empty response)' });
    setContextPercentage(session.getContextState().usedPercentage);
  } catch (err) {
    clearStreamingText();
    if (err instanceof DOMException && err.name === 'AbortError') {
      addMessage({ role: 'system', content: 'Cancelled.' });
    } else {
      const errMsg = err instanceof Error ? err.message : String(err);
      addMessage({ role: 'system', content: `Error: ${errMsg}` });
    }
  } finally {
    setIsThinking(false);
  }
}

/** Build a skill prompt from a slash command input and registry */
function buildSkillPrompt(input: string, registry: CommandRegistry): string | null {
  const parts = input.slice(1).split(/\s+/);
  const cmd = parts[0]?.toLowerCase() ?? '';
  const skillCmd = registry.getCommands().find((c) => c.name === cmd && c.source === 'skill');
  if (!skillCmd) return null;
  const args = parts.slice(1).join(' ').trim();
  const userInstruction = args || skillCmd.description;

  // Inject SKILL.md content if available
  if (skillCmd.skillContent) {
    return `<skill name="${cmd}">\n${skillCmd.skillContent}\n</skill>\n\nExecute the "${cmd}" skill: ${userInstruction}`;
  }
  return `Use the "${cmd}" skill: ${userInstruction}`;
}

/** Hook: build the handleSubmit callback for user input */
function useSubmitHandler(
  session: Session,
  addMessage: TAddMessage,
  handleSlashCommand: (input: string) => Promise<boolean>,
  clearStreamingText: () => void,
  setIsThinking: React.Dispatch<React.SetStateAction<boolean>>,
  setContextPercentage: React.Dispatch<React.SetStateAction<number>>,
  registry: CommandRegistry,
): (input: string) => Promise<void> {
  return useCallback(
    async (input: string) => {
      if (input.startsWith('/')) {
        const handled = await handleSlashCommand(input);
        if (handled) {
          setContextPercentage(session.getContextState().usedPercentage);
          return;
        }
        // Skill command — send as session prompt
        const prompt = buildSkillPrompt(input, registry);
        if (!prompt) return;
        return runSessionPrompt(
          prompt,
          session,
          addMessage,
          clearStreamingText,
          setIsThinking,
          setContextPercentage,
        );
      }

      addMessage({ role: 'user', content: input });
      return runSessionPrompt(
        input,
        session,
        addMessage,
        clearStreamingText,
        setIsThinking,
        setContextPercentage,
      );
    },
    [
      session,
      addMessage,
      handleSlashCommand,
      clearStreamingText,
      setIsThinking,
      setContextPercentage,
      registry,
    ],
  );
}

/** Hook: create a CommandRegistry once with builtin and skill commands */
function useCommandRegistry(cwd: string): CommandRegistry {
  const registryRef = useRef<CommandRegistry | null>(null);
  if (registryRef.current === null) {
    const registry = new CommandRegistry();
    registry.addSource(new BuiltinCommandSource());
    registry.addSource(new SkillCommandSource(cwd));
    registryRef.current = registry;
  }
  return registryRef.current;
}

export default function App(props: IProps): React.ReactElement {
  const { exit } = useApp();
  const { session, permissionRequest, streamingText, clearStreamingText, activeTools } = useSession(props);
  const { messages, setMessages, addMessage } = useMessages();
  const [isThinking, setIsThinking] = useState(false);
  const [contextPercentage, setContextPercentage] = useState(0);
  const registry = useCommandRegistry(props.cwd ?? process.cwd());
  const pendingModelChangeRef = useRef<string | null>(null);
  const [pendingModelId, setPendingModelId] = useState<string | null>(null);

  const handleSlashCommand = useSlashCommands(session, addMessage, setMessages, exit, registry, pendingModelChangeRef, setPendingModelId);
  const handleSubmit = useSubmitHandler(
    session,
    addMessage,
    handleSlashCommand,
    clearStreamingText,
    setIsThinking,
    setContextPercentage,
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
                addMessage({ role: 'system', content: `Model changed to ${getModelName(pendingModelId)}. Restarting...` });
                setTimeout(() => exit(), 500);
              } catch (err) {
                addMessage({ role: 'system', content: `Failed: ${err instanceof Error ? err.message : String(err)}` });
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
        contextPercentage={contextPercentage}
        contextUsedTokens={session.getContextState().usedTokens}
        contextMaxTokens={session.getContextState().maxTokens}
      />
      <InputArea
        onSubmit={handleSubmit}
        isDisabled={isThinking || !!permissionRequest}
        registry={registry}
      />
      {/* Permanent blank line below input — required for Korean IME stability.
          Without this, Ink's renderer causes the input area to shift up/down
          during IME composition, which triggers Terminal.app SIGSEGV when the
          IME queries attributedSubstringFromRange: at an unstable cursor position. */}
      <Text> </Text>
    </Box>
  );
}
