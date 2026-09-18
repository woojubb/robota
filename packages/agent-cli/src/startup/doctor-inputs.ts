/**
 * The shell's half of the doctor (OBSERVABILITY-1991): compose what the runner cannot know — the
 * workspace composition this CLI would build, the plugin scope layout, and the checks only the host
 * can make — inside the doctor's own failure boundary, so a composition that throws becomes a `fail`
 * check instead of an exit. Shared by the pre-parse route and by `/doctor`.
 */
import { homedir } from 'node:os';

import { pluginScopeDirs } from '@robota-sdk/agent-command';
import {
  createContributionSourcesForProjectAccess,
  createDefaultUserSettingsSources,
  createRestrictedWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';

import {
  createCliWorkspaceComposition,
  resolveInitialCliWorkspaceProjectAccess,
} from './workspace-project-composition.js';

import type { IStartCliOptions } from './command-setup.js';
import type { IDoctorCheck, IDoctorInputs } from '@robota-sdk/agent-command';
import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type {
  IContributionSource,
  TSettingsSource,
  TWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';

const MINIMUM_SUPPORTED_NODE_MAJOR = 22;

export function checkNodeVersion(nodeVersion: string = process.versions.node): IDoctorCheck {
  const [major] = nodeVersion.split('.').map(Number);
  if (major !== undefined && major >= MINIMUM_SUPPORTED_NODE_MAJOR) {
    return { id: 'host.node', label: 'Node.js version', status: 'ok', cause: `v${nodeVersion}` };
  }
  return {
    id: 'host.node',
    label: 'Node.js version',
    status: 'fail',
    cause: `v${nodeVersion} (requires >=${MINIMUM_SUPPORTED_NODE_MAJOR})`,
    detail: ['nvm:   nvm install 22 && nvm use 22', 'Volta: volta install node@22'],
  };
}

export function checkCliVersion(version: string): IDoctorCheck {
  return { id: 'host.cli', label: 'robota version', status: 'ok', cause: version };
}

export function checkTerminal(
  env: Readonly<Record<string, string | undefined>>,
  platform: string = process.platform,
): IDoctorCheck {
  const term = env['TERM_PROGRAM'] ?? 'unknown';
  if (platform === 'darwin' && term === 'Apple_Terminal') {
    return {
      id: 'host.terminal',
      label: 'Terminal',
      status: 'warn',
      cause: 'macOS Terminal.app — CJK/IME input may be unstable',
      detail: ['Recommendation: use iTerm2 (https://iterm2.com)'],
    };
  }
  return { id: 'host.terminal', label: 'Terminal', status: 'ok', cause: term };
}

export interface IBuildDoctorInputsOptions {
  readonly cwd: string;
  readonly version: string;
  readonly options: IStartCliOptions;
  /** The admission decision already made; `resolveDoctorProjectAccess` produces it with its boundary. */
  readonly projectAccess: TWorkspaceProjectAccess;
  readonly accessFailure?: IDoctorCheck;
  readonly providerDefinitions: readonly IProviderDefinition[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly userHome?: string;
}

export function compositionFailure(error: Error): IDoctorCheck {
  return {
    id: 'workspace.composition',
    label: 'Workspace composition',
    status: 'fail',
    cause: `${error.name}: ${error.message}`,
    detail: [
      'Project settings and contributions could not be composed; user-level sources are reported below.',
    ],
  };
}

/** The admission decision, with its own failure boundary: a throw yields a restricted access plus a check. */
export async function resolveDoctorProjectAccess(
  cwd: string,
  options: IStartCliOptions,
): Promise<{ projectAccess: TWorkspaceProjectAccess; accessFailure?: IDoctorCheck }> {
  try {
    return { projectAccess: await resolveInitialCliWorkspaceProjectAccess(cwd, options) };
  } catch (error) {
    // allow-fallback: the failure is reported as a check; the doctor continues on user-level sources
    const failure = error instanceof Error ? error : new Error(String(error));
    return {
      projectAccess: createRestrictedWorkspaceProjectAccess('identity-unavailable', cwd, failure),
      accessFailure: compositionFailure(failure),
    };
  }
}

/** Compose the doctor's inputs; a composition throw is a check, never a crash. */
export function buildDoctorInputs(opts: IBuildDoctorInputsOptions): IDoctorInputs {
  const userHome = opts.userHome ?? homedir();
  const projectAccess = opts.projectAccess;
  let failure: IDoctorCheck | undefined = opts.accessFailure;
  let settingsSources: readonly TSettingsSource[] = createDefaultUserSettingsSources(userHome);
  let contributionSources: readonly IContributionSource[] =
    createContributionSourcesForProjectAccess(projectAccess, userHome);
  if (failure === undefined) {
    try {
      const composition = createCliWorkspaceComposition({
        cwd: opts.cwd,
        userHome,
        projectAccess,
        ...(opts.options.projectSettingsWriter === undefined
          ? {}
          : { projectSettingsWriter: opts.options.projectSettingsWriter }),
      });
      settingsSources = composition.settingsSources;
      contributionSources = composition.contributionSources;
    } catch (error) {
      // allow-fallback: same boundary — reported, and the user-level sources stand in
      failure = compositionFailure(error instanceof Error ? error : new Error(String(error)));
    }
  }
  return {
    cwd: opts.cwd,
    userHome,
    settingsSources,
    projectAccess,
    providerDefinitions: opts.providerDefinitions,
    env: opts.env,
    contributionSources,
    pluginsDirs: pluginScopeDirs(opts.cwd, userHome),
    ...(opts.options.mcpActivationAdapter === undefined
      ? {}
      : { mcpActivation: opts.options.mcpActivationAdapter }),
    hostChecks: [checkNodeVersion(), checkCliVersion(opts.version), checkTerminal(opts.env)],
    ...(failure === undefined ? {} : { compositionFailure: failure }),
  };
}
