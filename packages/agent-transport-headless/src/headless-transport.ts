/**
 * ITransportAdapter implementation for headless transport.
 *
 * Wraps createHeadlessRunner into the unified ITransportAdapter interface.
 * After start() completes, getExitCode() returns the runner's exit code.
 */

import type { InteractiveSession, ITransportAdapter } from '@robota-sdk/agent-sdk';
import { createHeadlessRunner } from './headless-runner.js';
import type { TOutputFormat } from './headless-runner.js';

export interface IHeadlessTransportOptions {
  /** Output format: 'text', 'json', or 'stream-json'. */
  outputFormat: TOutputFormat;
  /** The prompt to execute. */
  prompt: string;
}

export function createHeadlessTransport(
  options: IHeadlessTransportOptions,
): ITransportAdapter & { getExitCode(): number } {
  let session: InteractiveSession | null = null;
  let exitCode = 0;

  return {
    name: 'headless',
    attach(s: InteractiveSession) {
      session = s;
    },
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
