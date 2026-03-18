import React, { useState, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { Session } from '../session.js';
import type { TPermissionMode, ITerminalOutput, ISpinner } from '../types.js';
import type { TToolArgs } from '../permissions/permission-gate.js';
import type { IResolvedConfig } from '../config/config-types.js';
import type { ILoadedContext } from '../context/context-loader.js';
import type { IProjectInfo } from '../context/project-detector.js';
import type { SessionStore } from '../session-store.js';
import type { IChatMessage, IPermissionRequest } from './types.js';
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

/** Hook: create a Session instance once and provide a stable permission handler. */
function useSession(props: IProps): {
  session: Session;
  permissionRequest: IPermissionRequest | null;
  setPermissionRequest: React.Dispatch<React.SetStateAction<IPermissionRequest | null>>;
} {
  const [permissionRequest, setPermissionRequest] = useState<IPermissionRequest | null>(null);

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

    sessionRef.current = new Session({
      config: props.config,
      context: props.context,
      terminal: NOOP_TERMINAL,
      projectInfo: props.projectInfo,
      sessionStore: props.sessionStore,
      permissionMode: props.permissionMode,
      maxTurns: props.maxTurns,
      permissionHandler,
    });
  }

  return { session: sessionRef.current, permissionRequest, setPermissionRequest };
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

/** Hook: handle slash commands. Returns a handler function. */
function useSlashCommands(
  session: Session,
  addMessage: (msg: Omit<IChatMessage, 'id' | 'timestamp'>) => void,
  setMessages: React.Dispatch<React.SetStateAction<IChatMessage[]>>,
  exit: () => void,
): (input: string) => boolean {
  return useCallback(
    (input: string): boolean => {
      const parts = input.slice(1).split(/\s+/);
      const cmd = parts[0]?.toLowerCase() ?? '';

      switch (cmd) {
        case 'help':
          addMessage({
            role: 'system',
            content: [
              'Available commands:',
              '  /help      — Show this help',
              '  /clear     — Clear conversation',
              '  /mode [m]  — Show/change permission mode',
              '  /cost      — Show session info',
              '  /exit      — Exit CLI',
            ].join('\n'),
          });
          return true;

        case 'clear':
          setMessages([]);
          session.clearHistory();
          addMessage({ role: 'system', content: 'Conversation cleared.' });
          return true;

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
          addMessage({
            role: 'system',
            content: `Unknown command "/${cmd}". Type /help for help.`,
          });
          return true;
      }
    },
    [session, addMessage, setMessages, exit],
  );
}

/** Handle the /mode slash command. */
function handleModeCommand(
  arg: string | undefined,
  session: Session,
  addMessage: (msg: Omit<IChatMessage, 'id' | 'timestamp'>) => void,
): boolean {
  const validModes: TPermissionMode[] = ['plan', 'default', 'acceptEdits', 'bypassPermissions'];
  if (!arg) {
    addMessage({ role: 'system', content: `Current mode: ${session.getPermissionMode()}` });
  } else if (validModes.includes(arg as TPermissionMode)) {
    session.setPermissionMode(arg as TPermissionMode);
    addMessage({ role: 'system', content: `Permission mode set to: ${arg}` });
  } else {
    addMessage({
      role: 'system',
      content: `Invalid mode. Valid: ${validModes.join(' | ')}`,
    });
  }
  return true;
}

export default function App(props: IProps): React.ReactElement {
  const { exit } = useApp();
  const { session, permissionRequest } = useSession(props);
  const { messages, setMessages, addMessage } = useMessages();
  const [isThinking, setIsThinking] = useState(false);

  const handleSlashCommand = useSlashCommands(session, addMessage, setMessages, exit);

  // Ctrl+C to exit (only when permission prompt is not shown)
  useInput(
    (_input, key) => {
      if (key.ctrl && _input === 'c') {
        exit();
      }
    },
    { isActive: !permissionRequest && !isThinking },
  );

  const handleSubmit = useCallback(
    async (input: string) => {
      if (input.startsWith('/')) {
        handleSlashCommand(input);
        return;
      }

      addMessage({ role: 'user', content: input });
      setIsThinking(true);

      try {
        const response = await session.run(input);
        addMessage({ role: 'assistant', content: response || '(empty response)' });
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        addMessage({ role: 'system', content: `Error: ${errMsg}` });
      } finally {
        setIsThinking(false);
      }
    },
    [session, addMessage, handleSlashCommand],
  );

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box paddingX={1}>
        <Text color="cyan" bold>
          ROBOTA
        </Text>
        {props.projectInfo?.name && <Text dimColor> — {props.projectInfo.name}</Text>}
      </Box>

      {/* Messages */}
      <Box flexDirection="column" paddingX={1} flexGrow={1}>
        <MessageList messages={messages} />
        {isThinking && (
          <Box marginBottom={1}>
            <Text color="yellow">Thinking...</Text>
          </Box>
        )}
      </Box>

      {/* Permission prompt */}
      {permissionRequest && <PermissionPrompt request={permissionRequest} />}

      {/* Status bar */}
      <StatusBar
        permissionMode={session.getPermissionMode()}
        sessionId={session.getSessionId()}
        messageCount={messages.length}
        isThinking={isThinking}
      />

      {/* Input */}
      <InputArea onSubmit={handleSubmit} isDisabled={isThinking || !!permissionRequest} />
    </Box>
  );
}
