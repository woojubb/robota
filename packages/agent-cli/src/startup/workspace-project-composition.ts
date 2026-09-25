import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, relative, sep } from 'node:path';

import {
  WorkspaceAuthorityRequiredError,
  createContributionSourcesForProjectAccess,
  createNodeHostSettingsStore,
  createNodeWorkspaceTrustService,
  createProjectSessionStore,
  createRestrictedWorkspaceProjectAccess,
  createUserSessionStore,
  createWorkspaceProjectSettingsSources,
  createWorkspaceProjectSettingsStore,
  createWorkspaceMemoryStore,
  getWorkspaceProjectIdentity,
  getWorkspaceProjectReader,
  getWorkspaceProjectStateStorage,
} from '@robota-sdk/agent-framework';

import type {
  IContributionSource,
  IMemoryStore,
  ISettingsDocumentStore,
  ITrustedWorkspaceProjectAccess,
  IWorkspaceProjectSettingsWriter,
  TSettingsSource,
  TWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';
import { userPaths } from '../product/user-paths.js';
import { ROBOTA_PROJECT_SETTINGS } from '../product/robota-project-settings.js';
import { ROBOTA_PROJECT_STATE_DIRECTORIES } from '../product/robota-project-state-directories.js';
import { createRobotaUserSettingsSources } from '../product/robota-user-settings.js';
import { ROBOTA_SKILL_ROOTS } from '../product/robota-skill-roots.js';

export interface ICreateCliWorkspaceCompositionOptions {
  readonly cwd: string;
  readonly userHome: string;
  readonly projectAccess?: TWorkspaceProjectAccess;
  readonly projectSettingsWriter?: IWorkspaceProjectSettingsWriter;
  /** `--safe-mode`: no skills, commands or agents from any scope, the user's included. */
  readonly safeMode?: boolean;
}

export interface ICliWorkspaceComposition {
  readonly projectAccess: TWorkspaceProjectAccess;
  readonly contributionSources: readonly IContributionSource[];
  readonly skillRoots: typeof ROBOTA_SKILL_ROOTS;
  readonly settingsSources: readonly TSettingsSource[];
  readonly settingsStores: readonly ISettingsDocumentStore[];
  readonly sessionStore: IInteractiveSessionStore;
  readonly memoryStore?: IMemoryStore;
}

export type TCliWorkspaceCompositionOverrides = Pick<
  ICreateCliWorkspaceCompositionOptions,
  'projectAccess' | 'projectSettingsWriter' | 'safeMode'
>;

/** Set only by `/cd` when the session it moves is Restricted (issue #3081). */
export const RESTRICTED_WORKSPACE_FLAG = '--restricted-workspace';

/** Starts with every customization off, to rule one out (issue #3082). */
export const SAFE_MODE_FLAG = '--safe-mode';

export const SAFE_MODE_NOTICE =
  'Safe mode: project and user instruction files, skills, commands, agents, output styles, ' +
  'plugins, hooks and MCP servers are off. Provider, model, built-in tools and permissions work as ' +
  'usual.';

/**
 * The startup access decision. A `/cd` from a Restricted session never widens access, whatever the
 * target's own trust decision (issue #3081) — read from argv because access is decided before the
 * arguments are parsed.
 */
export async function resolveStartupWorkspaceProjectAccess(
  argv: readonly string[],
  cwd: string,
  options: { readonly projectAccess?: TWorkspaceProjectAccess } = {},
): Promise<TWorkspaceProjectAccess> {
  // Safe mode loads nothing from the project, so it starts Restricted whatever the trust store says.
  if (argv.includes(RESTRICTED_WORKSPACE_FLAG) || argv.includes(SAFE_MODE_FLAG)) {
    return createRestrictedWorkspaceProjectAccess('untrusted', cwd);
  }
  return resolveInitialCliWorkspaceProjectAccess(cwd, options);
}

/** Resolve one host-owned admission decision before any project source is composed. */
export async function resolveInitialCliWorkspaceProjectAccess(
  cwd: string,
  options: TCliWorkspaceCompositionOverrides = {},
): Promise<TWorkspaceProjectAccess> {
  if (options.projectAccess !== undefined) return options.projectAccess;
  return createNodeWorkspaceTrustService(
    userPaths().workspaceTrust,
    ROBOTA_PROJECT_STATE_DIRECTORIES,
  ).inspect(cwd);
}

function createTrustedCliWorkspaceComposition(
  projectAccess: ITrustedWorkspaceProjectAccess,
  options: ICreateCliWorkspaceCompositionOptions,
  userSettingsStore: ISettingsDocumentStore,
): ICliWorkspaceComposition {
  const authority = projectAccess.authority;
  for (const namespace of ['sessions', 'session-logs', 'memory', 'checkpoints'] as const) {
    if (
      getWorkspaceProjectStateStorage(authority, namespace).rootRelativePath !==
      ROBOTA_PROJECT_STATE_DIRECTORIES[namespace]
    ) {
      throw new WorkspaceAuthorityRequiredError(
        'Trusted project state directories do not match this CLI product.',
      );
    }
  }
  const settingsStores =
    options.projectSettingsWriter === undefined
      ? [userSettingsStore]
      : [
          userSettingsStore,
          createWorkspaceProjectSettingsStore(authority, options.projectSettingsWriter),
        ];
  return {
    projectAccess,
    contributionSources: createContributionSourcesForProjectAccess(projectAccess, options.userHome),
    skillRoots: ROBOTA_SKILL_ROOTS,
    settingsSources: [
      ...createRobotaUserSettingsSources(options.userHome),
      ...createWorkspaceProjectSettingsSources(
        getWorkspaceProjectReader(authority),
        ROBOTA_PROJECT_SETTINGS,
      ),
    ],
    settingsStores,
    sessionStore: createProjectSessionStore(
      getWorkspaceProjectStateStorage(authority, 'sessions'),
      getWorkspaceProjectStateStorage(authority, 'session-logs'),
    ),
    memoryStore: createWorkspaceMemoryStore(getWorkspaceProjectStateStorage(authority, 'memory')),
  };
}

export function createInitialCliWorkspaceComposition(
  cwd: string,
  overrides: TCliWorkspaceCompositionOverrides,
): ICliWorkspaceComposition {
  return createCliWorkspaceComposition({ cwd, userHome: homedir(), ...overrides });
}

export function createCliWorkspaceComposition(
  options: ICreateCliWorkspaceCompositionOptions,
): ICliWorkspaceComposition {
  const projectAccess =
    options.projectAccess ??
    createRestrictedWorkspaceProjectAccess('identity-unavailable', options.cwd);
  // Contained — ARCH-048. Reject cross-root pairs until one canonical project-root contract replaces both carriers.
  if (projectAccess.status === 'trusted') {
    const trustedRoot = getWorkspaceProjectIdentity(projectAccess.authority).worktreeRoot;
    let resolvedCwd: string;
    try {
      resolvedCwd = realpathSync(options.cwd);
    } catch {
      throw new WorkspaceAuthorityRequiredError(
        'Trusted project access cannot validate the requested working directory.',
      );
    }
    const remainder = relative(trustedRoot, resolvedCwd);
    if (remainder === '..' || remainder.startsWith(`..${sep}`) || isAbsolute(remainder)) {
      throw new WorkspaceAuthorityRequiredError(
        'Trusted project access does not cover the requested working directory.',
      );
    }
  }
  const userSettingsStore = createNodeHostSettingsStore(
    'user',
    userPaths(options.userHome).settings,
  );

  if (projectAccess.status === 'restricted') {
    if (options.projectSettingsWriter !== undefined) {
      throw new WorkspaceAuthorityRequiredError(
        'A project settings writer requires trusted workspace project access.',
      );
    }
    return {
      projectAccess,
      contributionSources:
        options.safeMode === true
          ? []
          : createContributionSourcesForProjectAccess(projectAccess, options.userHome),
      skillRoots: ROBOTA_SKILL_ROOTS,
      settingsSources: createRobotaUserSettingsSources(options.userHome),
      settingsStores: [userSettingsStore],
      sessionStore: createUserSessionStore(userPaths(options.userHome).sessions),
    };
  }

  return createTrustedCliWorkspaceComposition(projectAccess, options, userSettingsStore);
}
