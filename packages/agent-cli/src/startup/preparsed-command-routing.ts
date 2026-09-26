import { isIP } from 'node:net';

import { runEvalCommand } from '../eval/eval-command.js';
import { PrintTerminal } from '../print-terminal.js';
import { isDoctorCommandName, runDoctorRoute } from './doctor-route.js';
import { readVersion } from './version.js';
import { runSessionAnalyze } from '../session-analyzer/session-analyze-command.js';
import { runSessionListCommand } from '../session-inventory/session-list-command.js';
import { launchSupervisedSession } from '../session-inventory/supervised-session-launch.js';
import {
  isSupervisedSessionName,
  linkSupervisedPr,
  listSupervisedExternalEvents,
  parseSupervisedPr,
  renameSupervisedSession,
  revokeSupervisedExternalEventGrant,
  stopSupervisedSession,
  unlinkSupervisedPr,
} from '../session-inventory/supervised-session-control.js';
import { readExternalEventGrantFiles } from '../external-events/external-event-grant-file.js';
import { validateExternalEventEndpoint } from '../external-events/external-event-http-host.js';
import { formatExternalEventGrantRows } from '../external-events/external-event-grant-format.js';

import type { IExternalEventGrant } from '@robota-sdk/agent-interface-transport';
import { runSessionViewCommand } from '../session-inventory/session-view-command.js';
import { runDaemonCommand } from '../session-inventory/daemon-command.js';
import {
  isDaemonAttachInvocation,
  runDaemonAttachCommand,
} from '../session-inventory/daemon-attach-command.js';
import { createAttachedAppRender, type IAttachedAppPresentation } from './attached-app-render.js';
import { runSessionAttachCommand } from '../session-inventory/session-attach-command.js';
import type { ISessionAttachCommandOptions } from '../session-inventory/session-attach-command.js';
import type { ISessionViewCommandOptions } from '../session-inventory/session-view-command.js';
import { validateNodeOtlpLiveTelemetrySettings } from '../telemetry/live-trace-otlp.js';
import { runUsageCommand } from '../usage/usage-command.js';
import { runUsageExportCommand } from '../usage/usage-export-command.js';
import {
  createInitialCliWorkspaceComposition,
  resolveInitialCliWorkspaceProjectAccess,
} from './workspace-project-composition.js';
import { runMcpLoginCommand, runMcpLogoutCommand } from './mcp-login-command.js';
import { runWorkspaceTrustCommand } from './workspace-trust-command.js';
import {
  formatHeadlessWorkspaceTrustError,
  requiresHeadlessWorkspaceTrust,
} from './workspace-trust-admission.js';

import type { IStartCliOptions } from './command-setup.js';

const SUBCOMMAND_INDEX = 2;
const ACTION_INDEX = 3;
const SUBCOMMAND_ARGUMENT_INDEX = 4;
const START_USAGE =
  'Usage: robota session start --background [--name <name>]\n' +
  '         [--external-event-grant <file>]... [--external-event-port <port>]\n' +
  '         [--external-event-trusted-proxy <ip>]...\n';
const EVENTS_USAGE =
  'Usage: robota session events list <supervised-id> [--json]\n' +
  '       robota session events revoke <supervised-id> <grant-id>\n';

/** `session start` arguments; `undefined` when they do not fit the usage. */
function parseStartArgs(args: readonly string[]):
  | {
      readonly name?: string;
      readonly grantFiles: readonly string[];
      readonly port?: string;
      readonly trustedProxies: readonly string[];
    }
  | undefined {
  if (args[0] !== '--background') return undefined;
  let name: string | undefined;
  let port: string | undefined;
  const grantFiles: string[] = [];
  const trustedProxies: string[] = [];
  for (let index = 1; index < args.length; index += 2) {
    const value = args[index + 1];
    if (value === undefined) return undefined;
    if (args[index] === '--name' && name === undefined) name = value;
    else if (args[index] === '--external-event-grant') grantFiles.push(value);
    else if (args[index] === '--external-event-port' && port === undefined) port = value;
    else if (args[index] === '--external-event-trusted-proxy') trustedProxies.push(value);
    else return undefined;
  }
  return {
    ...(name !== undefined ? { name } : {}),
    grantFiles,
    ...(port !== undefined ? { port } : {}),
    trustedProxies,
  };
}

/** The endpoint a background session's grants are served on: a port, and proxies to believe. */
function parseEventEndpoint(start: {
  readonly grantFiles: readonly string[];
  readonly port?: string;
  readonly trustedProxies: readonly string[];
}): { readonly port: number; readonly trustedProxies: readonly string[] } | undefined {
  if (start.grantFiles.length === 0) {
    if (start.port !== undefined || start.trustedProxies.length > 0) {
      throw new Error(
        '--external-event-port and --external-event-trusted-proxy go only with external event grants',
      );
    }
    return undefined;
  }
  if (start.port === undefined) {
    throw new Error(
      "--external-event-grant needs --external-event-port: the loopback port the owner's proxy forwards to",
    );
  }
  const port = Number(start.port);
  if (!/^[0-9]+$/u.test(start.port) || port < 1 || port > 65535) {
    throw new Error('--external-event-port must be an integer in 1..65535');
  }
  if (!start.trustedProxies.every((proxy) => isIP(proxy) !== 0)) {
    throw new Error('--external-event-trusted-proxy must be a literal IP address');
  }
  return { port, trustedProxies: start.trustedProxies };
}

/**
 * `session events list|revoke` — the owner's view of a background session's external-event grants,
 * and the way to withdraw one. Bound to the live registration like every other control action.
 */
async function runSessionEventsCommand(args: readonly string[]): Promise<number> {
  const [action, id, argument, extra] = args;
  const list = action === 'list' && id !== undefined &&
    (argument === undefined || (argument === '--json' && extra === undefined));
  const revoke = action === 'revoke' && id !== undefined && argument !== undefined && extra === undefined;
  if (!list && !revoke) {
    process.stderr.write(EVENTS_USAGE);
    return 1;
  }
  try {
    if (revoke) {
      await revokeSupervisedExternalEventGrant(id!, argument!);
      process.stdout.write(`Revoked external event grant ${argument} on supervised session ${id}.\n`);
      return 0;
    }
    const grants = await listSupervisedExternalEvents(id!);
    process.stdout.write(argument === '--json'
      ? `${JSON.stringify({ id, grants })}\n`
      : formatExternalEventGrantRows(grants));
    return 0;
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Supervised session external events are unavailable.'}\n`,
    );
    return 1;
  }
}

/** Route subcommands whose own flags must bypass the strict global CLI parser. */
export async function runPreparsedCliCommand(
  options: IStartCliOptions,
  argv: readonly string[] = process.argv,
  cwd: string = process.cwd(),
  telemetryEnvironment: Readonly<Record<string, string>> = {},
  renderSessionView?: ISessionViewCommandOptions['render'],
  renderAttachedView?: ISessionAttachCommandOptions['render'],
  attachedAppPresentation?: IAttachedAppPresentation,
): Promise<boolean> {
  // The Robota telemetry settings were removed from process.env at startup; the supervised runtime is
  // the one child that receives them, through its explicit spawn environment.
  const supervisedEnv = (): NodeJS.ProcessEnv => ({ ...process.env, ...telemetryEnvironment });
  // OBSERVABILITY-1991: the doctor is matched BEFORE the shared composition below, and composes its
  // own inside a failure boundary — a configuration broken enough to throw here must still be
  // diagnosable, and `--repair <id>` / `--yes` must never reach the strict global parser.
  if (isDoctorCommandName(argv[SUBCOMMAND_INDEX])) {
    process.exitCode = await runDoctorRoute(
      {
        version: readVersion(),
        terminal: new PrintTerminal(),
        cwd,
        options,
        isTTY: process.stdin.isTTY === true,
      },
      argv.slice(ACTION_INDEX),
      argv[SUBCOMMAND_INDEX],
    );
    return true;
  }
  // `robota --attach`: the full TUI on this workspace's daemon. Its only flags are presentation
  // flags, so the strict global parser, which knows the session-shaping ones, never sees it.
  if (isDaemonAttachInvocation(argv.slice(SUBCOMMAND_INDEX))) {
    process.exitCode = await runDaemonAttachCommand(argv.slice(SUBCOMMAND_INDEX), {
      cwd,
      ...(attachedAppPresentation === undefined
        ? {}
        : {
            render: createAttachedAppRender(attachedAppPresentation, {
              cwd,
              projectAccess: await resolveInitialCliWorkspaceProjectAccess(cwd, options),
              ...(options.providerDefinitions !== undefined
                ? { providerDefinitions: options.providerDefinitions }
                : {}),
              ...(options.safeMode === true ? { safeMode: true } : {}),
            }),
          }),
    });
    return true;
  }
  if (argv[SUBCOMMAND_INDEX] === 'session' && argv[ACTION_INDEX] === 'stop') {
    if (argv.length !== SUBCOMMAND_ARGUMENT_INDEX + 1) {
      process.stderr.write('Usage: robota session stop <supervised-id>\n');
      process.exitCode = 1;
      return true;
    }
    try {
      await stopSupervisedSession(argv[SUBCOMMAND_ARGUMENT_INDEX]!);
      process.stdout.write(`Stopped supervised session ${argv[SUBCOMMAND_ARGUMENT_INDEX]}.\n`);
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'Unable to stop supervised session.'}\n`,
      );
      process.exitCode = 1;
    }
    return true;
  }
  if (argv[SUBCOMMAND_INDEX] === 'session' && argv[ACTION_INDEX] === 'events') {
    process.exitCode = await runSessionEventsCommand(argv.slice(SUBCOMMAND_ARGUMENT_INDEX));
    return true;
  }
  if (argv[SUBCOMMAND_INDEX] === 'session' && argv[ACTION_INDEX] === 'rename') {
    if (
      argv.length !== SUBCOMMAND_ARGUMENT_INDEX + 2 ||
      !isSupervisedSessionName(argv[SUBCOMMAND_ARGUMENT_INDEX + 1])
    ) {
      process.stderr.write('Usage: robota session rename <supervised-id> <name>\n');
      process.exitCode = 1;
      return true;
    }
    try {
      const id = argv[SUBCOMMAND_ARGUMENT_INDEX]!;
      await renameSupervisedSession(id, argv[SUBCOMMAND_ARGUMENT_INDEX + 1]!);
      process.stdout.write(`Renamed supervised session ${id}.\n`);
      process.exitCode = 0;
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'Unable to rename supervised session.'}\n`,
      );
      process.exitCode = 1;
    }
    return true;
  }
  if (argv[SUBCOMMAND_INDEX] === 'session' && argv[ACTION_INDEX] === 'link-pr') {
    if (
      argv.length !== SUBCOMMAND_ARGUMENT_INDEX + 2 ||
      !parseSupervisedPr(argv[SUBCOMMAND_ARGUMENT_INDEX + 1])
    ) {
      process.stderr.write('Usage: robota session link-pr <supervised-id> <https-pr-url>\n');
      process.exitCode = 1;
      return true;
    }
    try {
      const id = argv[SUBCOMMAND_ARGUMENT_INDEX]!;
      await linkSupervisedPr(id, argv[SUBCOMMAND_ARGUMENT_INDEX + 1]!);
      process.stdout.write(`Linked PR to supervised session ${id}.\n`);
      process.exitCode = 0;
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'Unable to link supervised session PR.'}\n`,
      );
      process.exitCode = 1;
    }
    return true;
  }
  if (argv[SUBCOMMAND_INDEX] === 'session' && argv[ACTION_INDEX] === 'unlink-pr') {
    if (argv.length !== SUBCOMMAND_ARGUMENT_INDEX + 1) {
      process.stderr.write('Usage: robota session unlink-pr <supervised-id>\n');
      process.exitCode = 1;
      return true;
    }
    try {
      const id = argv[SUBCOMMAND_ARGUMENT_INDEX]!;
      await unlinkSupervisedPr(id);
      process.stdout.write(`Unlinked PR from supervised session ${id}.\n`);
      process.exitCode = 0;
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'Unable to unlink supervised session PR.'}\n`,
      );
      process.exitCode = 1;
    }
    return true;
  }
  if (argv[SUBCOMMAND_INDEX] === 'session' && argv[ACTION_INDEX] === 'attach') {
    process.exitCode = await runSessionAttachCommand(argv.slice(SUBCOMMAND_ARGUMENT_INDEX), {
      ...(renderAttachedView === undefined ? {} : { render: renderAttachedView }),
    });
    return true;
  }
  if (argv[SUBCOMMAND_INDEX] === 'session' && argv[ACTION_INDEX] === 'view') {
    process.exitCode = await runSessionViewCommand(argv.slice(SUBCOMMAND_ARGUMENT_INDEX), {
      launchCwd: cwd,
      render: renderSessionView,
      ...(renderAttachedView === undefined ? {} : { renderAttached: renderAttachedView }),
      start: async (targetCwd) => {
        const access = await resolveInitialCliWorkspaceProjectAccess(targetCwd);
        if (requiresHeadlessWorkspaceTrust(access)) {
          throw new Error(formatHeadlessWorkspaceTrustError(access, targetCwd));
        }
        // The child validates the very same settings when it starts; asking here first avoids
        // spawning one that will only exit unexplained. The view itself still shows only its
        // generic "Start failed" text and points the user at `session start`, where this message
        // (thrown here, not swallowed there) actually surfaces.
        validateNodeOtlpLiveTelemetrySettings(telemetryEnvironment, {
          serviceVersion: readVersion(),
          surface: 'serve',
        });
        return launchSupervisedSession(targetCwd, { env: supervisedEnv() });
      },
    });
    return true;
  }
  if (argv[SUBCOMMAND_INDEX] === 'daemon') {
    process.exitCode = await runDaemonCommand(argv.slice(ACTION_INDEX), {
      cwd,
      env: supervisedEnv,
      // The same admission as `session start`, asked before anything is spawned.
      admit: async (workspace) => {
        const access = await resolveInitialCliWorkspaceProjectAccess(workspace, options);
        if (requiresHeadlessWorkspaceTrust(access)) {
          throw new Error(formatHeadlessWorkspaceTrustError(access, workspace));
        }
        validateNodeOtlpLiveTelemetrySettings(telemetryEnvironment, {
          serviceVersion: readVersion(),
          surface: 'serve',
        });
      },
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    });
    return true;
  }
  const projectAccess = await resolveInitialCliWorkspaceProjectAccess(cwd, options);
  const composition = createInitialCliWorkspaceComposition(cwd, {
    ...options,
    projectAccess,
  });
  if (
    argv[SUBCOMMAND_INDEX] === 'mcp' &&
    (argv[ACTION_INDEX] === 'login' || argv[ACTION_INDEX] === 'logout')
  ) {
    const run = argv[ACTION_INDEX] === 'login' ? runMcpLoginCommand : runMcpLogoutCommand;
    process.exitCode = await run(argv.slice(SUBCOMMAND_ARGUMENT_INDEX), {
      settingsSources: composition.settingsSources,
      env: process.env,
      stdout: (text) => process.stdout.write(text),
      stderr: (text) => process.stderr.write(text),
    });
    return true;
  }
  if (argv[SUBCOMMAND_INDEX] === 'trust') {
    process.exitCode = await runWorkspaceTrustCommand(argv.slice(ACTION_INDEX), cwd);
    return true;
  }
  if (argv[SUBCOMMAND_INDEX] === 'usage') {
    const usageArgs = argv.slice(ACTION_INDEX);
    const projectSessionStore =
      composition.sessionStoreScope === 'project' ? composition.sessionStore : undefined;
    process.exitCode =
      usageArgs[0] === 'export'
        ? await runUsageExportCommand(usageArgs.slice(1), projectSessionStore)
        : runUsageCommand(usageArgs, projectSessionStore);
    return true;
  }
  if (argv[SUBCOMMAND_INDEX] === 'session' && argv[ACTION_INDEX] === 'analyze') {
    await runSessionAnalyze(
      argv.slice(SUBCOMMAND_ARGUMENT_INDEX),
      cwd,
      composition.sessionStoreScope === 'project' ? composition.sessionStore : undefined,
    );
    return true;
  }
  if (argv[SUBCOMMAND_INDEX] === 'session' && argv[ACTION_INDEX] === 'list') {
    process.exitCode = await runSessionListCommand(
      argv.slice(SUBCOMMAND_ARGUMENT_INDEX),
      composition.sessionStoreScope === 'project' ? composition.sessionStore : undefined,
    );
    return true;
  }
  if (argv[SUBCOMMAND_INDEX] === 'session' && argv[ACTION_INDEX] === 'start') {
    const start = parseStartArgs(argv.slice(SUBCOMMAND_ARGUMENT_INDEX));
    if (start === undefined) {
      process.stderr.write(START_USAGE);
      process.exitCode = 1;
      return true;
    }
    // Every grant is validated before anything starts; a refusal names the grant, never a value.
    let grants: IExternalEventGrant[];
    let eventEndpoint: ReturnType<typeof parseEventEndpoint>;
    try {
      eventEndpoint = parseEventEndpoint(start);
      grants = readExternalEventGrantFiles(start.grantFiles);
      // Everything the child's endpoint will check is checked here, so a start fails before it spawns.
      if (eventEndpoint !== undefined) {
        validateExternalEventEndpoint({ grants, trustedProxies: eventEndpoint.trustedProxies });
      }
    } catch (error) {
      process.stderr.write(`${error instanceof Error ? error.message : 'grant refused'}\n`);
      process.exitCode = 1;
      return true;
    }
    if (requiresHeadlessWorkspaceTrust(composition.projectAccess)) {
      process.stderr.write(
        `${formatHeadlessWorkspaceTrustError(composition.projectAccess, cwd)}\n`,
      );
      process.exitCode = 1;
      return true;
    }
    try {
      // Validated here, before spawning, so a refused telemetry setting is reported with the real
      // message instead of only the child's generic "exited before it was ready".
      validateNodeOtlpLiveTelemetrySettings(telemetryEnvironment, {
        serviceVersion: readVersion(),
        surface: 'serve',
      });
      const id = await launchSupervisedSession(cwd, {
        env: supervisedEnv(),
        ...(start.name !== undefined ? { name: start.name } : {}),
        ...(grants.length > 0 && eventEndpoint !== undefined ? { grants, eventEndpoint } : {}),
      });
      process.stdout.write(`Supervised session: ${id}\n`);
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : 'Supervised session could not start.'}\n`,
      );
      process.exitCode = 1;
    }
    return true;
  }
  if (argv[SUBCOMMAND_INDEX] !== 'eval') return false;
  process.exitCode = await runEvalCommand(argv.slice(ACTION_INDEX), cwd, {
    settingsSources: composition.settingsSources,
    projectAccess: composition.projectAccess,
  });
  return true;
}
