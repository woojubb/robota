import { PrintTerminal } from '@robota-sdk/agent-transport/headless';
import { createAgentRuntime } from '@robota-sdk/agent-framework';
import { createDefaultTransportRegistry } from '@robota-sdk/agent-transport';
import { parseCliArgs } from './utils/cli-args.js';
import type { IParsedCliArgs } from './utils/cli-args.js';
import { handlePreflightCommands } from './startup/preflight.js';
import {
  toConfigPhaseOptions,
  toSessionRunOptions,
  toUserLocalCommandOptions,
  toStartupUpdatePolicyOptions,
} from './startup/args-to-options.js';
import type { IStartCliOptions } from './startup/command-setup.js';
import { createCommandSetup } from './startup/command-setup.js';
import { handleConfigPhase } from './startup/config-phase.js';
import { createProviderSetup } from './startup/provider-setup.js';
import { createSessionSetup } from './startup/session-setup.js';
import { resolveStartupUpdateNotice } from './startup/update-notice.js';
import { runUserLocalDirectCommandIfRequested } from './user-local-direct-command.js';
import { readVersion } from './startup/version.js';
import { runPrintMode } from './modes/print-mode.js';
import { runTuiMode } from './modes/tui-mode.js';

export type { IStartCliOptions };

export async function startCli(options: IStartCliOptions = {}): Promise<void> {
  let args: IParsedCliArgs;
  try {
    // allow-fallback: argument validation errors are terminal — exit is the correct response
    args = parseCliArgs();
  } catch (error) {
    // allow-fallback: argument validation errors are terminal — exit is the correct response
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
  const version = readVersion();
  const terminal = new PrintTerminal();

  // Layer 0: pre-flight — single point for all early-exit commands
  if ((await handlePreflightCommands(args, { version, terminal })).handled) return;

  const cwd = process.cwd();

  // Layer 1: IParsedCliArgs → typed option objects (boundary)
  const configPhaseOpts = toConfigPhaseOptions(args);
  const sessionOpts = toSessionRunOptions(args);
  const updatePolicyOpts = toStartupUpdatePolicyOptions(args);

  try {
    // allow-fallback: user-local command failure is terminal — exit is the correct response
    if (await runUserLocalDirectCommandIfRequested(toUserLocalCommandOptions(args), cwd, terminal))
      return;
  } catch (error) {
    // allow-fallback: user-local command failure is terminal — exit is the correct response
    terminal.writeError(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }

  // Layer 2: sub-layer assembly (same-level grouping)
  const commandSetup = createCommandSetup(cwd, options);
  if ((await handleConfigPhase(cwd, configPhaseOpts, commandSetup, terminal)).handled) return;

  const providerSetup = createProviderSetup(cwd, configPhaseOpts, commandSetup);
  const sessionSetup = createSessionSetup(cwd, sessionOpts);

  // Layer 3: runtime assembly
  const runtime = createAgentRuntime({
    cwd,
    provider: providerSetup.provider,
    commandModules: commandSetup.commandModules,
    commandHostAdapters: commandSetup.commandHostAdapters,
    reloadPluginCommandSource: commandSetup.reloadPluginCommandSource,
    subagentRunnerFactory: providerSetup.subagentRunnerFactory,
    sessionStore: sessionSetup.sessionStore,
    transportRegistry: createDefaultTransportRegistry(),
  });

  // Layer 4: mode / transport
  if (configPhaseOpts.printMode) {
    await runPrintMode(sessionOpts, runtime);
    return;
  }

  await runTuiMode({
    runtime,
    version,
    commandSetup,
    providerSetup,
    sessionSetup,
    sessionOpts,
    startupUpdateNotice: resolveStartupUpdateNotice(version, updatePolicyOpts),
  });
  process.exit(0);
}
