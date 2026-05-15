import { randomUUID } from 'node:crypto';
import type {
  IInteractiveSession,
  IExecutionResult,
  ICommandResult,
  TBackgroundJobGroupEvent,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-sdk';

type TSlashCommandExecution =
  | { readonly kind: 'not-slash' }
  | { readonly kind: 'command-result'; readonly result: ICommandResult }
  | { readonly kind: 'session-execution' };

function parseSlashCommand(prompt: string): { name: string; args: string } | null {
  const trimmed = prompt.trimStart();
  if (!trimmed.startsWith('/')) return null;
  const withoutSlash = trimmed.slice(1);
  const [name = '', ...args] = withoutSlash.split(/\s+/);
  if (name.length === 0) return null;
  return { name, args: args.join(' ') };
}

export async function executeSlashCommandIfPresent(
  session: IInteractiveSession,
  prompt: string,
): Promise<TSlashCommandExecution> {
  const command = parseSlashCommand(prompt);
  if (!command) return { kind: 'not-slash' };

  const result = await session.executeCommand(command.name, command.args);
  if (result) {
    if (result.effects?.some((effect) => effect.type === 'session-execution-started')) {
      return { kind: 'session-execution' };
    }
    return { kind: 'command-result', result };
  }
  return {
    kind: 'command-result',
    result: { message: `Unknown command "/${command.name}".`, success: false },
  };
}

type TStreamJsonEvent =
  | {
      type: 'content_block_delta';
      delta: { type: 'text_delta'; text: string };
    }
  | {
      type: 'background_task_event';
      background_task_event: TBackgroundTaskEvent;
    }
  | {
      type: 'background_job_group_event';
      background_job_group_event: TBackgroundJobGroupEvent;
    };

interface IStreamJsonHandlers {
  onTextDelta: (text: string) => void;
  onBackgroundTaskEvent: (event: TBackgroundTaskEvent) => void;
  onBackgroundJobGroupEvent: (event: TBackgroundJobGroupEvent) => void;
  onComplete: (result: IExecutionResult) => void;
  onInterrupted: (result: IExecutionResult) => void;
  onError: (error: Error) => void;
}

export function writeStreamJsonEvent(
  session: IInteractiveSession,
  getSessionId: (s: IInteractiveSession) => string,
  event: TStreamJsonEvent,
): void {
  const output = JSON.stringify({
    type: 'stream_event',
    event,
    session_id: getSessionId(session),
    uuid: randomUUID(),
  });
  process.stdout.write(output + '\n');
}

export function subscribeStreamJsonEvents(
  session: IInteractiveSession,
  getSessionId: (s: IInteractiveSession) => string,
  writeJsonResult: (sessionId: string, result: string, subtype: 'success' | 'error') => void,
  resolve: (exitCode: number) => void,
): () => void {
  const emit = (event: TStreamJsonEvent): void =>
    writeStreamJsonEvent(session, getSessionId, event);

  const onTextDelta = (text: string): void =>
    emit({ type: 'content_block_delta', delta: { type: 'text_delta', text } });
  const onBackgroundTaskEvent = (event: TBackgroundTaskEvent): void =>
    emit({ type: 'background_task_event', background_task_event: event });
  const onBackgroundJobGroupEvent = (event: TBackgroundJobGroupEvent): void =>
    emit({ type: 'background_job_group_event', background_job_group_event: event });

  const cleanup = (): void =>
    unsubscribeStreamJsonEvents(session, {
      onTextDelta,
      onBackgroundTaskEvent,
      onBackgroundJobGroupEvent,
      onComplete,
      onInterrupted,
      onError,
    });

  const onComplete = (result: IExecutionResult): void => {
    cleanup();
    writeJsonResult(getSessionId(session), result.response, 'success');
    resolve(0);
  };
  const onInterrupted = (result: IExecutionResult): void => {
    cleanup();
    writeJsonResult(getSessionId(session), result.response, 'success');
    resolve(0);
  };
  const onError = (_error: Error): void => {
    cleanup();
    writeJsonResult(getSessionId(session), '', 'error');
    resolve(1);
  };

  session.on('text_delta', onTextDelta);
  session.on('background_task_event', onBackgroundTaskEvent);
  session.on('background_job_group_event', onBackgroundJobGroupEvent);
  session.on('complete', onComplete);
  session.on('interrupted', onInterrupted);
  session.on('error', onError);
  return cleanup;
}

function unsubscribeStreamJsonEvents(
  session: IInteractiveSession,
  handlers: IStreamJsonHandlers,
): void {
  session.off('text_delta', handlers.onTextDelta);
  session.off('background_task_event', handlers.onBackgroundTaskEvent);
  session.off('background_job_group_event', handlers.onBackgroundJobGroupEvent);
  session.off('complete', handlers.onComplete);
  session.off('interrupted', handlers.onInterrupted);
  session.off('error', handlers.onError);
}
