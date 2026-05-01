import { randomUUID } from 'node:crypto';
import type {
  InteractiveSession,
  IExecutionResult,
  ICommandResult,
  TBackgroundJobGroupEvent,
  TBackgroundTaskEvent,
} from '@robota-sdk/agent-sdk';

export type TOutputFormat = 'text' | 'json' | 'stream-json';

export interface IHeadlessRunnerOptions {
  session: InteractiveSession;
  outputFormat: TOutputFormat;
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

interface ISlashCommandExecution {
  readonly isSlashCommand: boolean;
  readonly result: ICommandResult | null;
}

export function createHeadlessRunner(options: IHeadlessRunnerOptions): {
  run: (prompt: string) => Promise<number>;
} {
  const { session, outputFormat } = options;

  return {
    run: (prompt: string): Promise<number> => {
      if (outputFormat === 'text') {
        return runTextFormat(session, prompt);
      }
      if (outputFormat === 'json') {
        return runJsonFormat(session, prompt);
      }
      return runStreamJsonFormat(session, prompt);
    },
  };
}

function writeJsonResult(sessionId: string, result: string, subtype: 'success' | 'error'): void {
  const output = JSON.stringify({ type: 'result', result, session_id: sessionId, subtype });
  process.stdout.write(output + '\n');
}

function parseSlashCommand(prompt: string): { name: string; args: string } | null {
  const trimmed = prompt.trimStart();
  if (!trimmed.startsWith('/')) return null;
  const withoutSlash = trimmed.slice(1);
  const [name = '', ...args] = withoutSlash.split(/\s+/);
  if (name.length === 0) return null;
  return { name, args: args.join(' ') };
}

async function executeSlashCommandIfPresent(
  session: InteractiveSession,
  prompt: string,
): Promise<ISlashCommandExecution> {
  const command = parseSlashCommand(prompt);
  if (!command) return { isSlashCommand: false, result: null };
  const result = await session.executeCommand(command.name, command.args);
  return {
    isSlashCommand: true,
    result:
      result ??
      ({
        message: `Unknown command "/${command.name}".`,
        success: false,
      } satisfies ICommandResult),
  };
}

function getSessionId(session: InteractiveSession): string {
  try {
    return session.getSession().getSessionId();
  } catch {
    return '';
  }
}

function writeStreamJsonEvent(session: InteractiveSession, event: TStreamJsonEvent): void {
  const output = JSON.stringify({
    type: 'stream_event',
    event,
    session_id: getSessionId(session),
    uuid: randomUUID(),
  });
  process.stdout.write(output + '\n');
}

function runJsonFormat(session: InteractiveSession, prompt: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const cleanup = (): void => {
      session.off('complete', onComplete);
      session.off('interrupted', onInterrupted);
      session.off('error', onError);
    };

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

    session.on('complete', onComplete);
    session.on('interrupted', onInterrupted);
    session.on('error', onError);

    void executeSlashCommandIfPresent(session, prompt).then((commandExecution) => {
      if (commandExecution.isSlashCommand && commandExecution.result) {
        cleanup();
        writeJsonResult(
          getSessionId(session),
          commandExecution.result.message,
          commandExecution.result.success ? 'success' : 'error',
        );
        resolve(commandExecution.result.success ? 0 : 1);
        return;
      }
      void session.submit(prompt);
    });
  });
}

function runStreamJsonFormat(session: InteractiveSession, prompt: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const cleanup = subscribeStreamJsonEvents(session, resolve);

    void executeSlashCommandIfPresent(session, prompt).then((commandExecution) => {
      if (commandExecution.isSlashCommand && commandExecution.result) {
        cleanup();
        writeJsonResult(
          getSessionId(session),
          commandExecution.result.message,
          commandExecution.result.success ? 'success' : 'error',
        );
        resolve(commandExecution.result.success ? 0 : 1);
        return;
      }
      void session.submit(prompt);
    });
  });
}

function subscribeStreamJsonEvents(
  session: InteractiveSession,
  resolve: (exitCode: number) => void,
): () => void {
  const onTextDelta = (text: string): void => {
    writeStreamJsonEvent(session, {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text },
    });
  };
  const onBackgroundTaskEvent = (event: TBackgroundTaskEvent): void =>
    writeStreamJsonEvent(session, { type: 'background_task_event', background_task_event: event });
  const onBackgroundJobGroupEvent = (event: TBackgroundJobGroupEvent): void =>
    writeStreamJsonEvent(session, {
      type: 'background_job_group_event',
      background_job_group_event: event,
    });
  const cleanup = (): void =>
    unsubscribeStreamJsonEvents(session, {
      onTextDelta,
      onBackgroundTaskEvent,
      onBackgroundJobGroupEvent,
      onComplete,
      onInterrupted,
      onError,
    });
  const onComplete = (result: IExecutionResult): void =>
    completeStream(session, cleanup, result, resolve);
  const onInterrupted = (result: IExecutionResult): void =>
    completeStream(session, cleanup, result, resolve);
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

interface IStreamJsonHandlers {
  onTextDelta: (text: string) => void;
  onBackgroundTaskEvent: (event: TBackgroundTaskEvent) => void;
  onBackgroundJobGroupEvent: (event: TBackgroundJobGroupEvent) => void;
  onComplete: (result: IExecutionResult) => void;
  onInterrupted: (result: IExecutionResult) => void;
  onError: (error: Error) => void;
}

function unsubscribeStreamJsonEvents(
  session: InteractiveSession,
  handlers: IStreamJsonHandlers,
): void {
  session.off('text_delta', handlers.onTextDelta);
  session.off('background_task_event', handlers.onBackgroundTaskEvent);
  session.off('background_job_group_event', handlers.onBackgroundJobGroupEvent);
  session.off('complete', handlers.onComplete);
  session.off('interrupted', handlers.onInterrupted);
  session.off('error', handlers.onError);
}

function completeStream(
  session: InteractiveSession,
  cleanup: () => void,
  result: IExecutionResult,
  resolve: (exitCode: number) => void,
): void {
  cleanup();
  writeJsonResult(getSessionId(session), result.response, 'success');
  resolve(0);
}

function runTextFormat(session: InteractiveSession, prompt: string): Promise<number> {
  return new Promise<number>((resolve) => {
    const cleanup = (): void => {
      session.off('complete', onComplete);
      session.off('interrupted', onInterrupted);
      session.off('error', onError);
    };

    const onComplete = (result: IExecutionResult): void => {
      cleanup();
      process.stdout.write(result.response + '\n');
      resolve(0);
    };

    const onInterrupted = (result: IExecutionResult): void => {
      cleanup();
      if (result.response) {
        process.stdout.write(result.response + '\n');
      }
      resolve(0);
    };

    const onError = (_error: Error): void => {
      cleanup();
      resolve(1);
    };

    session.on('complete', onComplete);
    session.on('interrupted', onInterrupted);
    session.on('error', onError);

    void executeSlashCommandIfPresent(session, prompt).then((commandExecution) => {
      if (commandExecution.isSlashCommand && commandExecution.result) {
        cleanup();
        process.stdout.write(commandExecution.result.message + '\n');
        resolve(commandExecution.result.success ? 0 : 1);
        return;
      }
      void session.submit(prompt);
    });
  });
}
