import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, relative, sep } from 'node:path';

import {
  WorkspaceAuthorityRequiredError,
  createContributionSourcesForProjectAccess,
  createDefaultUserSettingsSources,
  createNodeHostSettingsStore,
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

export interface ICreateCliWorkspaceCompositionOptions {
  readonly cwd: string;
  readonly userHome: string;
  readonly projectAccess?: TWorkspaceProjectAccess;
  readonly projectSettingsWriter?: IWorkspaceProjectSettingsWriter;
}

export interface ICliWorkspaceComposition {
  readonly projectAccess: TWorkspaceProjectAccess;
  readonly contributionSources: readonly IContributionSource[];
  readonly settingsSources: readonly TSettingsSource[];
  readonly settingsStores: readonly ISettingsDocumentStore[];
  readonly sessionStore: IInteractiveSessionStore;
  readonly memoryStore?: IMemoryStore;
}

export type TCliWorkspaceCompositionOverrides = Pick<
  ICreateCliWorkspaceCompositionOptions,
  'projectAccess' | 'projectSettingsWriter'
>;

function createTrustedCliWorkspaceComposition(
  projectAccess: ITrustedWorkspaceProjectAccess,
  options: ICreateCliWorkspaceCompositionOptions,
  userSettingsStore: ISettingsDocumentStore,
): ICliWorkspaceComposition {
  const authority = projectAccess.authority;
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
    settingsSources: [
      ...createDefaultUserSettingsSources(options.userHome),
      ...createWorkspaceProjectSettingsSources(getWorkspaceProjectReader(authority)),
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
    join(options.userHome, '.robota', 'settings.json'),
  );

  if (projectAccess.status === 'restricted') {
    if (options.projectSettingsWriter !== undefined) {
      throw new WorkspaceAuthorityRequiredError(
        'A project settings writer requires trusted workspace project access.',
      );
    }
    return {
      projectAccess,
      contributionSources: createContributionSourcesForProjectAccess(
        projectAccess,
        options.userHome,
      ),
      settingsSources: createDefaultUserSettingsSources(options.userHome),
      settingsStores: [userSettingsStore],
      sessionStore: createUserSessionStore(),
    };
  }

  return createTrustedCliWorkspaceComposition(projectAccess, options, userSettingsStore);
}
