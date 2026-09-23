/**
 * ITransportAdapter implementation for headless transport.
 *
 * Wraps createHeadlessRunner into the unified ITransportAdapter interface.
 * `start()` launches the work and returns; `waitForCompletion()` owns the typed terminal outcome.
 */

import { createTransportFailedOutcome } from '@robota-sdk/agent-interface-transport';

import { createHeadlessRunner } from './headless-runner.js';

import type { TOutputFormat } from './headless-runner.js';
import type { IHeadlessSession } from './headless-session.js';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';
import type {
  ITransportLifecycleError,
  ITransportRunnerAdapter,
  TTransportRunOutcome,
} from '@robota-sdk/agent-interface-transport';

export interface IHeadlessTransportOptions {
  /** Output format: 'text', 'json', or 'stream-json'. */
  outputFormat: TOutputFormat;
  /** The prompt to execute. */
  prompt: string;
}

export interface IHeadlessTransport extends ITransportRunnerAdapter<IInteractiveSession> {
  attach(session: IHeadlessSession): void;
  getExitCode(): number;
}

export function createHeadlessTransport(options: IHeadlessTransportOptions): IHeadlessTransport {
  let session: IHeadlessSession | null = null;
  let exitCode = 0;
  let active = false;
  let generation = 0;
  let completion: Promise<TTransportRunOutcome> | undefined;

  const createLifecycleError = (code: ITransportLifecycleError['code']): ITransportLifecycleError =>
    Object.assign(new Error(`Headless transport ${code}.`), {
      name: 'TransportLifecycleError' as const,
      code,
      transportName: 'headless',
    });

  return {
    name: 'headless',
    lifecycle: Object.freeze({ kind: 'runner' }),
    attach(s: IHeadlessSession) {
      session = s;
    },
    async start() {
      if (!session) throw createLifecycleError('not-attached');
      if (active) throw createLifecycleError('already-started');
      active = true;
      const runGeneration = ++generation;
      const runner = createHeadlessRunner({ session, outputFormat: options.outputFormat });
      completion = runner.run(options.prompt).then((code): TTransportRunOutcome => {
        if (runGeneration === generation) exitCode = code;
        return code === 0
          ? { status: 'succeeded', exitCode: 0 }
          : createTransportFailedOutcome(code);
      });
      void completion.catch(() => undefined);
    },
    async waitForCompletion() {
      if (!completion) throw createLifecycleError('not-attached');
      return completion;
    },
    async stop() {
      active = false;
      generation += 1;
      session = null;
    },
    getExitCode() {
      return exitCode;
    },
  };
}
