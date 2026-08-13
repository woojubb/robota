/**
 * ITransportAdapter implementation for headless transport.
 *
 * Wraps createHeadlessRunner into the unified ITransportAdapter interface.
 * After start() completes, getExitCode() returns the runner's exit code.
 *
 * ARCH-011: this transport declares `runsToCompletion`, so a registry does not await it — read
 * `getExitCode()` only after `waitForCompletion()`, never straight after `startAll()`. Note that the
 * runner ABSORBS failures and always resolves, so failure arrives here as a non-zero exit code and
 * never as a rejection: `waitForCompletion()` will not report it.
 */

import { createHeadlessRunner } from './headless-runner.js';

import type { TOutputFormat } from './headless-runner.js';
import type { IHeadlessSession } from './headless-session.js';
import type { IInteractiveSession, ITransportAdapter } from '@robota-sdk/agent-interface-transport';

export interface IHeadlessTransportOptions {
  /** Output format: 'text', 'json', or 'stream-json'. */
  outputFormat: TOutputFormat;
  /** The prompt to execute. */
  prompt: string;
}

export interface IHeadlessTransport extends ITransportAdapter<IInteractiveSession> {
  attach(session: IHeadlessSession): void;
  getExitCode(): number;
}

export function createHeadlessTransport(options: IHeadlessTransportOptions): IHeadlessTransport {
  let session: IHeadlessSession | null = null;
  let exitCode = 0;

  return {
    name: 'headless',
    attach(s: IHeadlessSession) {
      session = s;
    },
    // ARCH-011: `start()` here runs the entire prompt. Declared, so `startAll` does not await it and
    // block every transport registered behind this one.
    runsToCompletion: true,
    async start() {
      if (!session) throw new Error('No session attached. Call attach() first.');
      const runner = createHeadlessRunner({ session, outputFormat: options.outputFormat });
      exitCode = await runner.run(options.prompt);
    },
    async stop() {
      /* no-op: headless runner completes in start() */
    },
    getExitCode() {
      return exitCode;
    },
  };
}
