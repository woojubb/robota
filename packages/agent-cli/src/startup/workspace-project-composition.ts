import { homedir } from 'node:os';
import { join } from 'node:path';

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
  getWorkspaceProjectReader,
  getWorkspaceProjectStateStorage,
} from '@robota-sdk/agent-framework';

import type {
  IContributionSource,
  IMemoryStore,
  ISettingsDocumentStore,
  IWorkspaceProjectSettingsWriter,
  TSettingsSource,
  TWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-transport';

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
