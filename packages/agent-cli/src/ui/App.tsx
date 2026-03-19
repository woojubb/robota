import React, { useState, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Session } from '@robota-sdk/agent-sdk';
import type {
  IResolvedConfig,
  ILoadedContext,
  IProjectInfo,
  SessionStore,
} from '@robota-sdk/agent-sdk';
import type { TPermissionMode, TToolArgs } from '@robota-sdk/agent-core';
import type { ITerminalOutput, ISpinner } from '../types.js';
import type { IChatMessage, IPermissionRequest } from './types.js';
import { CommandRegistry } from '../commands/command-registry.js';
import { BuiltinCommandSource } from '../commands/builtin-source.js';
import MessageList from './MessageList.js';
import StatusBar from './StatusBar.js';
import InputArea from './InputArea.js';
import PermissionPrompt from './PermissionPrompt.js';

interface IProps {
  config: IResolvedConfig;
  context: ILoadedContext;
  projectInfo?: IProjectInfo;
  sessionStore?: SessionStore;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
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

/** Hook: create a Session instance once and provide a stable permission handler + streaming. */
function useSession(props: IProps): {
  session: Session;
  permissionRequest: IPermissionRequest | null;
  streamingText: string;
  clearStreamingText: () => void;
} {
  const [permissionRequest, setPermissionRequest] = useState<IPermissionRequest | null>(null);
  const [streamingText, setStreamingText] = useState('');

  const sessionRef = useRef<Session | null>(null);
  if (sessionRef.current === null) {
    const permissionHandler = (toolName: string, toolArgs: TToolArgs): Promise<boolean> => {
      return new Promise<boolean>((resolve) => {
        setPermissionRequest({
          toolName,
          toolArgs,
          resolve: (allowed: boolean) => {
            setPermissionRequest(null);
            resolve(allowed);
          },
        });
      });
    };

    const onTextDelta = (delta: string): void => {
      setStreamingText((prev) => prev + delta);
    };

    sessionRef.current = new Session({
      config: props.config,
      context: props.context,
      terminal: NOOP_TERMINAL,
      projectInfo: props.projectInfo,
      sessionStore: props.sessionStore,
      permissionMode: props.permissionMode,
      maxTurns: props.maxTurns,
      permissionHandler,
      onTextDelta,
    });
  }

  const clearStreamingText = useCallback(() => setStreamingText(''), []);

  return { session: sessionRef.current, permissionRequest, streamingText, clearStreamingText };
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

const HELP_TEXT = [
  'Available commands:',
  '  /help              — Show this help',
  '  /clear             — Clear conversation',
  '  /compact [instr]   — Compact context (optional focus instructions)',
  '  /mode [m]          — Show/change permission mode',
  '  /cost              — Show session info',
  '  /exit              — Exit CLI',
].join('\n');

/** Handle the /mode slash command. */
function handleModeCommand(
  arg: string | undefined,
  session: Session,
  addMessage: TAddMessage,
): boolean {
  const validModes: TPermissionMode[] = ['plan', 'default', 'acceptEdits', 'bypassPermissions'];
  if (!arg) {
    addMessage({ role: 'system', content: `Current mode: ${session.getPermissionMode()}` });
  } else if (validModes.includes(arg as TPermissionMode)) {
    session.setPermissionMode(arg as TPermissionMode);
    addMessage({ role: 'system', content: `Permission mode set to: ${arg}` });
  } else {
    addMessage({ role: 'system', content: `Invalid mode. Valid: ${validModes.join(' | ')}` });
  }
  return true;
}

/** Execute a parsed slash command. Returns true if handled. */
async function executeSlashCommand(
  cmd: string,
  parts: string[],
  session: Session,
  addMessage: TAddMessage,
  setMessages: React.Dispatch<React.SetStateAction<IChatMessage[]>>,
  exit: () => void,
): Promise<boolean> {
  switch (cmd) {
    case 'help':
      addMessage({ role: 'system', content: HELP_TEXT });
      return true;
    case 'clear':
      setMessages([]);
      session.clearHistory();
      addMessage({ role: 'system', content: 'Conversation cleared.' });
      return true;
    case 'compact': {
      const instructions = parts.slice(1).join(' ').trim() || undefined;
      const before = session.getContextState().usedPercentage;
      addMessage({ role: 'system', content: 'Compacting context...' });
      await session.compact(instructions);
      const after = session.getContextState().usedPercentage;
      addMessage({
        role: 'system',
        content: `Context compacted: ${Math.round(before)}% -> ${Math.round(after)}%`,
      });
      return true;
    }
    case 'mode':
      return handleModeCommand(parts[1], session, addMessage);
    case 'cost':
      addMessage({
        role: 'system',
        content: `Session: ${session.getSessionId()}\nMessages: ${session.getMessageCount()}`,
      });
      return true;
    case 'exit':
      exit();
      return true;
    default:
      addMessage({ role: 'system', content: `Unknown command "/${cmd}". Type /help for help.` });
      return true;
  }
}

/** Hook: handle slash commands. Returns an async handler function. */
function useSlashCommands(
  session: Session,
  addMessage: TAddMessage,
  setMessages: React.Dispatch<React.SetStateAction<IChatMessage[]>>,
  exit: () => void,
): (input: string) => Promise<boolean> {
  return useCallback(
    async (input: string): Promise<boolean> => {
      const parts = input.slice(1).split(/\s+/);
      const cmd = parts[0]?.toLowerCase() ?? '';
      return executeSlashCommand(cmd, parts, session, addMessage, setMessages, exit);
    },
    [session, addMessage, setMessages, exit],
  );
}

/** Streaming text indicator shown while the agent is generating a response */
function StreamingIndicator({ text }: { text: string }): React.ReactElement {
  if (text) {
    return (
      <Box flexDirection="column">
        <Text color="cyan" bold>
          Robota:{' '}
        </Text>
        <Box marginLeft={2}>
          <Text wrap="wrap">{text}</Text>
        </Box>
      </Box>
    );
  }
  return <Text color="yellow">Thinking...</Text>;
}

/** Hook: build the handleSubmit callback for user input */
function useSubmitHandler(
  session: Session,
  addMessage: TAddMessage,
  handleSlashCommand: (input: string) => Promise<boolean>,
  clearStreamingText: () => void,
  setIsThinking: React.Dispatch<React.SetStateAction<boolean>>,
  setContextPercentage: React.Dispatch<React.SetStateAction<number>>,
): (input: string) => Promise<void> {
  return useCallback(
    async (input: string) => {
      if (input.startsWith('/')) {
        await handleSlashCommand(input);
        // Update context percentage after slash commands (e.g. /compact, /clear)
        setContextPercentage(session.getContextState().usedPercentage);
        return;
      }

      addMessage({ role: 'user', content: input });
      setIsThinking(true);
      clearStreamingText();

      try {
        const response = await session.run(input);
        clearStreamingText();
        addMessage({ role: 'assistant', content: response || '(empty response)' });
        // Update context percentage after each run
        setContextPercentage(session.getContextState().usedPercentage);
      } catch (err) {
        clearStreamingText();
        const errMsg = err instanceof Error ? err.message : String(err);
        addMessage({ role: 'system', content: `Error: ${errMsg}` });
      } finally {
        setIsThinking(false);
      }
    },
    [
      session,
      addMessage,
      handleSlashCommand,
      clearStreamingText,
      setIsThinking,
      setContextPercentage,
    ],
  );
}

/** Hook: create a CommandRegistry once with builtin commands */
function useCommandRegistry(): CommandRegistry {
  const registryRef = useRef<CommandRegistry | null>(null);
  if (registryRef.current === null) {
    const registry = new CommandRegistry();
    registry.addSource(new BuiltinCommandSource());
    registryRef.current = registry;
  }
  return registryRef.current;
}

export default function App(props: IProps): React.ReactElement {
  const { exit } = useApp();
  const { session, permissionRequest, streamingText, clearStreamingText } = useSession(props);
  const { messages, setMessages, addMessage } = useMessages();
  const [isThinking, setIsThinking] = useState(false);
  const [contextPercentage, setContextPercentage] = useState(0);
  const registry = useCommandRegistry();

  const handleSlashCommand = useSlashCommands(session, addMessage, setMessages, exit);
  const handleSubmit = useSubmitHandler(
    session,
    addMessage,
    handleSlashCommand,
    clearStreamingText,
    setIsThinking,
    setContextPercentage,
  );

  useInput(
    (_input: string, key: { ctrl: boolean }) => {
      if (key.ctrl && _input === 'c') exit();
    },
    { isActive: !permissionRequest && !isThinking },
  );

  return (
    <Box flexDirection="column">
      <Box paddingX={1}>
        <Text color="cyan" bold>
          ROBOTA
        </Text>
        {props.projectInfo?.name && <Text dimColor> — {props.projectInfo.name}</Text>}
      </Box>
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        <MessageList messages={messages} />
        {isThinking && (
          <Box flexDirection="column" marginBottom={1}>
            <StreamingIndicator text={streamingText} />
          </Box>
        )}
      </Box>
      {permissionRequest && <PermissionPrompt request={permissionRequest} />}
      <StatusBar
        permissionMode={session.getPermissionMode()}
        modelName={props.config.provider.model}
        sessionId={session.getSessionId()}
        messageCount={messages.length}
        isThinking={isThinking}
        contextPercentage={contextPercentage}
      />
      <InputArea
        onSubmit={handleSubmit}
        isDisabled={isThinking || !!permissionRequest}
        registry={registry}
      />
    </Box>
  );
}
