/**
 * Where robota runs a session's commands, named in one place (issues #3081, #3082).
 *
 * The composition root builds the sandbox here from the merged `sandbox` settings, passes it to the
 * pack set and the session, and `robota doctor` reports the same value. On a platform with a backend
 * (bubblewrap on Linux, Seatbelt on macOS) a client is always composed, so `/sandbox` can turn
 * confinement on and off live; on any other platform commands run on the host.
 */
import { inspectSettingsLayers } from '@robota-sdk/agent-framework';
import {
  DEFAULT_OS_SANDBOX_SETTINGS,
  describeExecutionContainment,
  detectOsSandbox,
  OsSandboxClient,
} from '@robota-sdk/agent-tools';

import type { IDoctorCheck } from '@robota-sdk/agent-command';
import type {
  ICommandSandboxAdapter,
  TSandboxCommandMode,
  TSandboxSettings,
  TSettingsData,
  TSettingsSource,
} from '@robota-sdk/agent-framework';
import type { IOsSandboxAvailability, IOsSandboxSettings } from '@robota-sdk/agent-tools';

export interface IRobotaSandbox {
  /** Absent where the platform has no backend. */
  readonly client?: OsSandboxClient;
  readonly availability: IOsSandboxAvailability;
  readonly settings: IOsSandboxSettings;
  readonly failIfUnavailable: boolean;
}

/** The settings file's shape, flattened into the client's. */
export function toOsSandboxSettings(settings: TSandboxSettings | undefined): IOsSandboxSettings {
  return {
    enabled: settings?.enabled ?? DEFAULT_OS_SANDBOX_SETTINGS.enabled,
    autoAllowBashIfSandboxed:
      settings?.autoAllowBashIfSandboxed ?? DEFAULT_OS_SANDBOX_SETTINGS.autoAllowBashIfSandboxed,
    excludedCommands: settings?.excludedCommands ?? [],
    allowWrite: settings?.filesystem?.allowWrite ?? [],
    denyRead: settings?.filesystem?.denyRead ?? [],
    network: settings?.network?.enabled ?? DEFAULT_OS_SANDBOX_SETTINGS.network,
  };
}

export interface ICreateRobotaSandboxOptions {
  readonly cwd: string;
  readonly settingsSources: readonly TSettingsSource[];
  readonly detect?: () => IOsSandboxAvailability;
}

export function createRobotaSandbox(options: ICreateRobotaSandboxOptions): IRobotaSandbox {
  const configured = inspectSettingsLayers(options.settingsSources).merged.sandbox;
  const settings = toOsSandboxSettings(configured);
  const availability = (options.detect ?? detectOsSandbox)();
  const failIfUnavailable = configured?.failIfUnavailable === true;
  if (availability.backend === undefined) return { availability, settings, failIfUnavailable };
  return {
    client: new OsSandboxClient({ root: options.cwd, availability, settings }),
    availability,
    settings,
    failIfUnavailable,
  };
}

/** Why confinement the settings ask for is not happening. */
export function describeUnavailableSandbox(availability: IOsSandboxAvailability): string {
  if (availability.unsupportedPlatform !== undefined) {
    return `no sandbox backend exists for ${availability.unsupportedPlatform} (Linux, WSL2 and macOS are supported)`;
  }
  return `missing ${availability.missing.join(', ')}`;
}

/**
 * What startup must say when sandboxing is enabled but cannot run. `fatal` when the settings ask
 * to refuse rather than run unconfined.
 */
export function sandboxStartupProblem(
  sandbox: IRobotaSandbox,
): { readonly message: string; readonly fatal: boolean } | undefined {
  if (!sandbox.settings.enabled || sandbox.availability.executable !== undefined) return undefined;
  const reason = describeUnavailableSandbox(sandbox.availability);
  return sandbox.failIfUnavailable
    ? {
        fatal: true,
        message: `Sandboxing is enabled but cannot run: ${reason}. Refusing to start (sandbox.failIfUnavailable).`,
      }
    : {
        fatal: false,
        message: `Sandboxing is enabled but cannot run: ${reason}. Commands run unconfined.`,
      };
}

function describeSandboxState(sandbox: IRobotaSandbox): string[] {
  const { settings, availability } = sandbox;
  if (!settings.enabled) {
    return [
      `Sandboxing is off; ${availability.backend ?? 'no backend'} is ${availability.executable !== undefined ? 'available' : 'not available'}.`,
      'Shell commands run directly on this machine; permission rules and prompts are the only boundary.',
    ];
  }
  if (availability.executable === undefined) {
    return [
      `Sandboxing is enabled but cannot run: ${describeUnavailableSandbox(availability)}.`,
      'Shell commands run unconfined.',
    ];
  }
  return [
    `Shell commands run under ${availability.backend}: writes limited to the workspace and temp directories, network ${settings.network ? 'allowed' : 'blocked'}.`,
    settings.autoAllowBashIfSandboxed
      ? 'Confined commands run without a prompt; deny and ask rules still apply.'
      : 'Confined commands still go through the permission prompts.',
    ...(settings.excludedCommands.length > 0
      ? [`Run unconfined: ${settings.excludedCommands.join(', ')}.`]
      : []),
  ];
}

export function checkExecutionContainment(sandbox: IRobotaSandbox): IDoctorCheck {
  const problem = sandboxStartupProblem(sandbox);
  const active = sandbox.settings.enabled && sandbox.availability.executable !== undefined;
  return {
    id: 'execution.containment',
    label: 'Command containment',
    status: problem === undefined ? 'ok' : problem.fatal ? 'fail' : 'warn',
    cause: active ? describeExecutionContainment(sandbox.client) : 'host',
    detail: describeSandboxState(sandbox),
  };
}

export interface ISandboxSettingsStore {
  read(): TSettingsData;
  write(settings: TSettingsData): void;
}

const MODE_SETTINGS: Readonly<
  Record<TSandboxCommandMode, { enabled: boolean; autoAllowBashIfSandboxed?: boolean }>
> = {
  off: { enabled: false },
  'auto-allow': { enabled: true, autoAllowBashIfSandboxed: true },
  regular: { enabled: true, autoAllowBashIfSandboxed: false },
};

/** `/sandbox`: the live client, changed for the next command and saved for the next session. */
export function createSandboxCommandAdapter(
  sandbox: IRobotaSandbox,
  store: ISandboxSettingsStore,
): ICommandSandboxAdapter {
  let settings = sandbox.settings;
  return {
    status() {
      const current = sandbox.client?.status().settings ?? settings;
      const mode: TSandboxCommandMode = !current.enabled
        ? 'off'
        : current.autoAllowBashIfSandboxed
          ? 'auto-allow'
          : 'regular';
      return {
        mode,
        ...(sandbox.availability.backend !== undefined
          ? { backend: sandbox.availability.backend }
          : {}),
        ...(sandbox.availability.executable === undefined
          ? { unavailable: describeUnavailableSandbox(sandbox.availability) }
          : {}),
        network: current.network,
        excludedCommands: current.excludedCommands,
      };
    },
    setMode(mode) {
      const change = MODE_SETTINGS[mode];
      settings = { ...settings, ...change };
      sandbox.client?.configure(change);
      const document = store.read();
      const existing = document['sandbox'];
      const base =
        typeof existing === 'object' && existing !== null && !Array.isArray(existing)
          ? existing
          : {};
      store.write({ ...document, sandbox: { ...base, ...change } });
    },
  };
}
