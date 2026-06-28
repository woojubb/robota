import { parseInput } from './input-parser.js';
import { InteractiveSession } from '../interactive/index.js';

import type { IInteractionChannel } from './IInteractionChannel.js';
import type { IInteractiveRuntime } from './InteractiveRuntime.js';
import type {
  TActionRequest,
  TActionResponse,
  TCommandInteractionHint,
  ICommandInfo,
} from './types.js';
import type { ICommandModule } from '../command-api/command-module.js';
import type { IInteractiveSession } from '../interactive/i-interactive-session.js';
import type { IInteractiveSessionStore } from '../interactive/session-persistence.js';
import type { IInteractiveSessionEvents } from '../interactive/types.js';
import type { IAIProvider, TPermissionMode } from '@robota-sdk/agent-core';

export interface IInteractiveRuntimeOptions {
  channel: IInteractionChannel;
  commandModules: readonly ICommandModule[];
  /** Provider for session creation (production path). */
  provider?: IAIProvider;
  /** Working directory for session creation. */
  cwd?: string;
  /** Session store for persistence. */
  sessionStore?: IInteractiveSessionStore;
  /** Permission mode for tool execution (parity with the TUI/headless channels). */
  permissionMode?: TPermissionMode;
  /** Test escape hatch — skips session creation when supplied. */
  _testSession?: IInteractiveSession;
}

function buildActionRequest(commandName: string, hint: TCommandInteractionHint): TActionRequest {
  if (hint.type === 'pick') {
    return {
      type: 'pick',
      id: commandName,
      title: `/${commandName}`,
      items: hint.getItems(),
    };
  }
  return {
    type: 'confirm',
    id: commandName,
    message: hint.message,
  };
}

function resolveArgsFromResponse(
  hint: TCommandInteractionHint,
  response: TActionResponse,
): string[] | null {
  if (response.type === 'cancelled') return null;
  if (hint.type === 'pick' && response.type === 'pick') return [response.item.value];
  if (hint.type === 'confirm' && response.type === 'confirm') return [];
  return null;
}

function commandsToCommandInfo(
  commands: ReturnType<IInteractiveSession['listCommands']>,
): ICommandInfo[] {
  return commands.map((c) => ({ name: c.name, description: c.description }));
}

function wireSessionEvents(session: IInteractiveSession, channel: IInteractionChannel): () => void {
  let fullText = '';

  const onDelta: IInteractiveSessionEvents['text_delta'] = (delta) => {
    fullText += delta;
    channel.write({ type: 'assistant-chunk', chunk: delta });
  };

  const onComplete: IInteractiveSessionEvents['complete'] = (result) => {
    // Prefer the authoritative final response from the execution result; fall back to the
    // accumulated stream deltas (e.g. if a result is unavailable). This keeps assistant-done
    // correct for both streaming and non-streaming providers.
    channel.write({ type: 'assistant-done', fullText: result?.response ?? fullText });
    fullText = '';
    channel.setBusy(false);
  };

  const onToolStart: IInteractiveSessionEvents['tool_start'] = (state) => {
    channel.write({
      type: 'tool-call',
      id: state.executionId ?? state.toolName,
      name: state.toolName,
      args: state.firstArg,
    });
  };

  const onToolEnd: IInteractiveSessionEvents['tool_end'] = (state) => {
    channel.write({
      type: 'tool-result',
      id: state.executionId ?? state.toolName,
      name: state.toolName,
      result: state.toolResultData ?? state.result,
    });
  };

  const onError: IInteractiveSessionEvents['error'] = (error) => {
    channel.setBusy(false);
    channel.write({ type: 'error', error });
  };

  const onInterrupted: IInteractiveSessionEvents['interrupted'] = () => {
    channel.setBusy(false);
  };

  session.on('text_delta', onDelta);
  session.on('complete', onComplete);
  session.on('tool_start', onToolStart);
  session.on('tool_end', onToolEnd);
  session.on('error', onError);
  session.on('interrupted', onInterrupted);

  return () => {
    session.off('text_delta', onDelta);
    session.off('complete', onComplete);
    session.off('tool_start', onToolStart);
    session.off('tool_end', onToolEnd);
    session.off('error', onError);
    session.off('interrupted', onInterrupted);
  };
}

export function createInteractiveRuntime(options: IInteractiveRuntimeOptions): IInteractiveRuntime {
  const { channel, commandModules, _testSession } = options;

  let session: IInteractiveSession | null = null;
  let unwireEvents: (() => void) | null = null;

  const interactionHints: Record<string, TCommandInteractionHint> = {};
  for (const mod of commandModules) {
    if (mod.interactionHints) {
      Object.assign(interactionHints, mod.interactionHints);
    }
  }

  async function handleSubmit(text: string): Promise<void> {
    if (!session) return;
    const parsed = parseInput(text);

    if (parsed.type === 'user-message') {
      channel.write({ type: 'user-message', text });
      channel.setBusy(true);
      await session.submit(text);
      return;
    }

    const { name, args } = parsed;
    const hint = interactionHints[name];

    let resolvedArgs = args;
    if (hint && args.length === 0) {
      const response = await channel.requestAction(buildActionRequest(name, hint));
      const fromResponse = resolveArgsFromResponse(hint, response);
      if (fromResponse === null) return; // cancelled
      resolvedArgs = fromResponse;
    }

    const result = await session.executeCommand(name, resolvedArgs.join(' '));
    if (result) {
      channel.write({ type: 'command-result', name, output: result.message });
    } else {
      channel.write({
        type: 'error',
        error: new Error(`Unknown command "/${name}". Type /help for help.`),
      });
    }
  }

  return {
    async start(): Promise<void> {
      if (_testSession) {
        session = _testSession;
      } else {
        const { provider, cwd, sessionStore, permissionMode } = options;
        if (!provider) throw new Error('createInteractiveRuntime: provider is required');
        if (!cwd) throw new Error('createInteractiveRuntime: cwd is required');
        session = new InteractiveSession({
          provider,
          cwd,
          sessionStore,
          commandModules,
          permissionMode,
        });
      }

      unwireEvents = wireSessionEvents(session, channel);

      const commands = session.listCommands();
      channel.setAvailableCommands(commandsToCommandInfo(commands));
      channel.onSubmit(handleSubmit);
      await channel.start();
    },

    async stop(): Promise<void> {
      unwireEvents?.();
      await channel.stop();
      await session?.shutdown();
      session = null;
    },
  };
}
