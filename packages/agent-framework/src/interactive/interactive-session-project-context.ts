import { relative, resolve } from 'node:path';

import { loadConfigWithHookSources } from '../config/config-loader.js';
import { createWorkspaceProjectSettingsSources } from '../config/settings-source.js';
import { loadContext } from '../context/context-loader.js';
import { detectProject } from '../context/project-detector.js';
import {
  createRestrictedWorkspaceProjectAccess,
  getWorkspaceProjectReader,
} from '../workspace-trust/index.js';

import type { IInitOptions } from './interactive-session-options.js';
import type { IHookDefinitionSource } from '../config/config-merge.js';
import type { INodeHostSettingsSource } from '../config/node-host-settings-source.js';
import type { IProjectSettingsPath } from '../config/settings-source.js';
import type { IResolvedConfig } from '../config/config-types.js';
import type { ILoadedContext } from '../context/context-loader.js';
import type { IProjectInfo } from '../context/project-detector.js';
import type { IContributionSource } from '../contributions/index.js';
import type { TWorkspaceProjectAccess } from '../workspace-trust/index.js';

interface IInteractiveProjectContext {
  projectAccess: TWorkspaceProjectAccess;
  config: IResolvedConfig;
  context: ILoadedContext;
  projectInfo: IProjectInfo;
  contributionSources: readonly IContributionSource[];
  hookSources: readonly IHookDefinitionSource[];
}

export async function loadInteractiveProjectConfig(
  supplied: IResolvedConfig | undefined,
  projectAccess: TWorkspaceProjectAccess | undefined,
  projectSettingsPaths: readonly IProjectSettingsPath[] = [],
  userSettingsSources: readonly INodeHostSettingsSource[] = [],
): Promise<{ config: IResolvedConfig; hookSources: readonly IHookDefinitionSource[] }> {
  if (supplied !== undefined) return { config: supplied, hookSources: [] };
  const projectReader =
    projectAccess?.status === 'trusted'
      ? getWorkspaceProjectReader(projectAccess.authority)
      : undefined;
  return loadConfigWithHookSources([
    ...userSettingsSources,
    ...(projectReader === undefined
      ? []
      : createWorkspaceProjectSettingsSources(projectReader, projectSettingsPaths)),
  ]);
}

async function resolveInteractiveProjectConfig(
  options: IInitOptions,
  projectAccess: TWorkspaceProjectAccess,
): Promise<{ config: IResolvedConfig; hookSources: readonly IHookDefinitionSource[] }> {
  if (options.config === undefined)
    return loadInteractiveProjectConfig(
      undefined,
      projectAccess,
      options.projectSettingsPaths,
      options.userSettingsSources,
    );
  return { config: options.config, hookSources: options.hookSources ?? [] };
}

export async function loadInteractiveProjectContext(
  options: IInitOptions,
): Promise<IInteractiveProjectContext> {
  const projectAccess =
    options.projectAccess ??
    createRestrictedWorkspaceProjectAccess('identity-unavailable', options.cwd);
  const projectReader =
    projectAccess.status === 'trusted'
      ? getWorkspaceProjectReader(projectAccess.authority)
      : undefined;
  const contextSource =
    projectAccess.status !== 'trusted' || projectReader === undefined
      ? undefined
      : {
          reader: projectReader,
          startRelativeDirectory: relative(
            projectAccess.identity.worktreeRoot,
            resolve(options.cwd),
          ),
        };
  const loadedConfig = await resolveInteractiveProjectConfig(options, projectAccess);
  const { config, hookSources } = loadedConfig;
  const taskContext = { ...options.taskContext, ...config.taskContext };
  const [context, projectInfo] = await Promise.all([
    options.bare
      ? Promise.resolve({
          agentsMd: '',
          projectNotesMd: '',
          agentsFileEntries: [],
          projectNotesFileEntries: [],
        })
      : loadContext(
          contextSource,
          options.memoryStore,
          taskContext.dir !== undefined || taskContext.enabled !== undefined
            ? { taskContext }
            : {},
        ),
    options.bare || projectReader === undefined
      ? Promise.resolve({ type: 'unknown' as const, language: 'unknown' as const })
      : detectProject(projectReader),
  ]);
  return {
    projectAccess,
    config,
    context,
    projectInfo,
    contributionSources: options.contributionSources ?? [],
    hookSources,
  };
}
