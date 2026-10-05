import { parseCliArgs, subcommandWord } from '../utils/cli-args.js';
import { isSubcommandName } from '../utils/cli-help.js';
import { validateMcpServeInvocation } from '../startup/mcp-serve-invocation.js';
import { hostedAdmissionError } from './hosted-runtime-config.js';
import { HostedRuntimeController } from './hosted-runtime-controller.js';
import { createE2BHostedRuntimeExecutorFactory } from './e2b-hosted-executor.js';

import type { TConfigEnvironment } from '@robota-sdk/product-config';
import type { IStartCliOptions } from '../startup/cli-options-types.js';
import type { IHostedRuntimeInvocation } from './hosted-runtime-types.js';

/** Hosted process lifecycle stays separate from local launch/workspace composition. */
export async function runHostedRuntime(
  options: IStartCliOptions,
  environment: TConfigEnvironment,
  cliName: string,
): Promise<void> {
  if (options.toolExecutionPolicy !== undefined) {
    throw hostedAdmissionError(
      'host tool scheduling functions cannot cross the task-worker boundary; configure policy in the worker host',
    );
  }
  const argv = Object.freeze(process.argv.slice(2));
  const args = parseCliArgs([...argv]);
  if (args.apiKey !== undefined) {
    throw hostedAdmissionError(
      'direct API-key configuration cannot be sent to a task worker; configure its broker outside the task',
    );
  }
  const command = subcommandWord(args);
  const { mcpServe } = validateMcpServeInvocation(args, cliName);
  if (args.serve && args.httpPort !== undefined) {
    throw hostedAdmissionError(
      '--serve --http-port is not served by a task worker; only its WebSocket ingress is reachable',
    );
  }
  const invocation: IHostedRuntimeInvocation = Object.freeze({
    argv,
    mode:
      args.help ||
      args.version ||
      args.checkUpdate ||
      args.reset ||
      args.configure ||
      args.configureProvider !== undefined
        ? 'command'
        : args.printMode || args.goal
          ? 'headless'
          : mcpServe
            ? 'mcp'
            : args.serve
              ? 'serve'
              : command !== undefined && isSubcommandName(command)
                ? 'command'
                : 'interactive',
    resume: args.continueMode || args.resumeId !== undefined || args.forkSession,
  });
  const factory =
    options.hostedRuntimeExecutorFactory ??
    (environment.PRODUCT_HOSTED_WORKER_EXECUTION_CONFIG !== undefined
      ? createE2BHostedRuntimeExecutorFactory(environment)
      : undefined);
  const controller = new HostedRuntimeController({
    environment,
    resume: invocation.resume,
    createExecutor: async (admission, signal) => {
      if (factory === undefined) {
        throw hostedAdmissionError(
          'mandatory task worker execution adapter is unavailable; host execution is refused',
        );
      }
      return factory(admission, signal, invocation);
    },
  });
  const stop = (): void => {
    void controller.stop('process signal stopped the hosted runtime').catch(() => undefined);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    await controller.run();
  } finally {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
  }
}
