/**
 * Where the product runs a session's commands, named in one place (issues #3081, #3082).
 *
 * The composition root builds the sandbox here from the merged `sandbox` settings, passes it to the
 * pack set and the session, and `the product doctor` reports the same value. On a platform with a backend
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
import type {
  IOsSandboxAvailability,
  IOsSandboxSettings,
  ISandboxClient,
} from '@robota-sdk/agent-tools';

export interface IProductSandbox {
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

import type { ICliRuntimeContext } from './runtime-context.js';

export interface ICreateProductSandboxOptions {
  readonly productRuntime: ICliRuntimeContext;
  readonly cwd: string;
  readonly settingsSources: readonly TSettingsSource[];
  readonly detect?: () => IOsSandboxAvailability;
  /**
   * Settings already in force elsewhere, in place of the files': a subagent's sandbox takes its
   * parent's live settings, which `/sandbox` may have changed since the files were read.
   */
  readonly settings?: IOsSandboxSettings;
}

export function createProductSandbox(options: ICreateProductSandboxOptions): IProductSandbox {
  const configured = inspectSettingsLayers(options.settingsSources).merged.sandbox;
  const settings = options.settings ?? toOsSandboxSettings(configured);
  const availability = (options.detect ?? detectOsSandbox)();
  const failIfUnavailable = configured?.failIfUnavailable === true;
  if (availability.backend === undefined) return { availability, settings, failIfUnavailable };
  return {
    client: new OsSandboxClient({ root: options.cwd, availability, settings, projectStateDirectory: options.productRuntime.layout.projectDirectory, userQuarantineDirectory: options.productRuntime.layout.userQuarantineDirectory, pathProtection: options.productRuntime.layout.pathProtection }),
    availability,
    settings,
    failIfUnavailable,
  };
}

/** The settings a live the product sandbox holds now, `/sandbox` changes included; none for another client. */
export function liveSandboxSettings(client: ISandboxClient | undefined): IOsSandboxSettings | undefined {
  return client instanceof OsSandboxClient ? client.status().settings : undefined;
}

/**
 * Settings a parent sent across the process boundary. A value that is not whole is refused rather
 * than replaced by the files: a child that ignores its parent's settings is the defect this carries
 * them to prevent.
 */
export function decodeOsSandboxSettings(value: Readonly<Record<string, unknown>>): IOsSandboxSettings {
  const flag = (key: keyof IOsSandboxSettings): boolean => {
    const field = value[key];
    if (typeof field !== 'boolean') throw new Error(`The parent's sandbox settings have no ${key}.`);
    return field;
  };
  const list = (key: keyof IOsSandboxSettings): readonly string[] => {
    const field = value[key];
    if (!Array.isArray(field) || !field.every((entry) => typeof entry === 'string')) {
      throw new Error(`The parent's sandbox settings have no ${key} list.`);
    }
    return field;
  };
  return {
    enabled: flag('enabled'),
    autoAllowBashIfSandboxed: flag('autoAllowBashIfSandboxed'),
    excludedCommands: list('excludedCommands'),
    allowWrite: list('allowWrite'),
    denyRead: list('denyRead'),
    network: flag('network'),
  };
}

/** The settings in force now: the live client's, which `/sandbox` changes, else the composed ones. */
function currentSettings(sandbox: IProductSandbox): IOsSandboxSettings {
  return sandbox.client?.status().settings ?? sandbox.settings;
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
  sandbox: IProductSandbox,
): { readonly message: string; readonly fatal: boolean } | undefined {
  if (!currentSettings(sandbox).enabled || sandbox.availability.executable !== undefined) {
    return undefined;
  }
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

function describeSandboxState(sandbox: IProductSandbox): string[] {
  const settings = currentSettings(sandbox);
  const { availability } = sandbox;
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

export function checkExecutionContainment(sandbox: IProductSandbox): IDoctorCheck {
  const problem = sandboxStartupProblem(sandbox);
  const active = currentSettings(sandbox).enabled && sandbox.availability.executable !== undefined;
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
  sandbox: IProductSandbox,
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
