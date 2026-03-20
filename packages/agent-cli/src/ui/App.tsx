import React, { useState, useCallback, useRef } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import { createSession, FileSessionLogger, projectPaths } from '@robota-sdk/agent-sdk';
import type { Session } from '@robota-sdk/agent-sdk';
import type {
  IResolvedConfig,
  ILoadedContext,
  IProjectInfo,
  SessionStore,
} from '@robota-sdk/agent-sdk';
import type { TPermissionMode, TToolArgs } from '@robota-sdk/agent-core';
import type { ITerminalOutput, ISpinner } from '../types.js';
import type { IChatMessage, IPermissionRequest, TPermissionResult } from './types.js';
import { CommandRegistry } from '../commands/command-registry.js';
import { BuiltinCommandSource } from '../commands/builtin-source.js';
import { SkillCommandSource } from '../commands/skill-source.js';
import MessageList from './MessageList.js';
import StatusBar from './StatusBar.js';
import InputArea from './InputArea.js';
import PermissionPrompt from './PermissionPrompt.js';
import { renderMarkdown } from './render-markdown.js';

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

/** Hook: create a Session instance once and provide a stable permission handler + streaming. */
function useSession(props: IProps): {
  session: Session;
  permissionRequest: IPermissionRequest | null;
  streamingText: string;
  clearStreamingText: () => void;
} {
  const [permissionRequest, setPermissionRequest] = useState<IPermissionRequest | null>(null);
  const [streamingText, setStreamingText] = useState('');

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
  registry: CommandRegistry,
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
    case 'permissions': {
      const mode = session.getPermissionMode();
      const sessionAllowed = session.getSessionAllowedTools();
      const lines = [`Permission mode: ${mode}`];
      if (sessionAllowed.length > 0) {
        lines.push(`Session-approved tools: ${sessionAllowed.join(', ')}`);
      } else {
        lines.push('No session-approved tools.');
      }
      addMessage({ role: 'system', content: lines.join('\n') });
      return true;
    }
    case 'context': {
      const ctx = session.getContextState();
      addMessage({
        role: 'system',
        content: `Context: ${ctx.usedTokens.toLocaleString()} / ${ctx.maxTokens.toLocaleString()} tokens (${Math.round(ctx.usedPercentage)}%)`,
      });
      return true;
    }
    case 'exit':
      exit();
      return true;
    default: {
      const skillCmd = registry.getCommands().find((c) => c.name === cmd && c.source === 'skill');
      if (skillCmd) {
        addMessage({ role: 'system', content: `Invoking skill: ${cmd}` });
        return false; // Signal caller to run as session prompt
      }
      addMessage({ role: 'system', content: `Unknown command "/${cmd}". Type /help for help.` });
      return true;
    }
  }
}

/** Hook: handle slash commands. Returns an async handler function. */
function useSlashCommands(
  session: Session,
  addMessage: TAddMessage,
  setMessages: React.Dispatch<React.SetStateAction<IChatMessage[]>>,
  exit: () => void,
  registry: CommandRegistry,
): (input: string) => Promise<boolean> {
  return useCallback(
    async (input: string): Promise<boolean> => {
      const parts = input.slice(1).split(/\s+/);
      const cmd = parts[0]?.toLowerCase() ?? '';
      return executeSlashCommand(cmd, parts, session, addMessage, setMessages, exit, registry);
    },
    [session, addMessage, setMessages, exit, registry],
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
        <Text> </Text>
        <Box marginLeft={2}>
          <Text wrap="wrap">{renderMarkdown(text)}</Text>
        </Box>
      </Box>
    );
  }
  return <Text color="yellow">Thinking...</Text>;
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

    // Extract tool calls from session history
    const history = session.getHistory();
    for (let i = historyBefore; i < history.length; i++) {
      const msg = history[i] as { role: string; toolCalls?: Array<{ function: { name: string; arguments: string } }> };
      if (msg.role === 'assistant' && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          const args = tc.function.arguments;
          const preview = args.length > 80 ? args.slice(0, 77) + '...' : args;
          addMessage({ role: 'tool', content: `${tc.function.name}(${preview})`, toolName: tc.function.name });
        }
      }
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
  return args
    ? `Use the "${cmd}" skill: ${args}`
    : `Use the "${cmd}" skill: ${skillCmd.description}`;
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
  const { session, permissionRequest, streamingText, clearStreamingText } = useSession(props);
  const { messages, setMessages, addMessage } = useMessages();
  const [isThinking, setIsThinking] = useState(false);
  const [contextPercentage, setContextPercentage] = useState(0);
  const registry = useCommandRegistry(props.cwd ?? process.cwd());

  const handleSlashCommand = useSlashCommands(session, addMessage, setMessages, exit, registry);
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
        contextUsedTokens={session.getContextState().usedTokens}
        contextMaxTokens={session.getContextState().maxTokens}
      />
      <InputArea
        onSubmit={handleSubmit}
        isDisabled={isThinking || !!permissionRequest}
        registry={registry}
      />
    </Box>
  );
}
