import { relative, resolve } from 'node:path';

import { loadConfig } from '../config/config-loader.js';
import {
  createDefaultUserSettingsSources,
  createWorkspaceProjectSettingsSources,
} from '../config/settings-source.js';
import { loadContext } from '../context/context-loader.js';
import { detectProject } from '../context/project-detector.js';
import { createContributionSourcesForProjectAccess } from '../contributions/index.js';
import {
  createRestrictedWorkspaceProjectAccess,
  getWorkspaceProjectReader,
} from '../workspace-trust/index.js';

import type { IInitOptions } from './interactive-session-options.js';
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
}

export async function loadInteractiveProjectConfig(
  supplied: IResolvedConfig | undefined,
  projectAccess: TWorkspaceProjectAccess | undefined,
): Promise<IResolvedConfig> {
  if (supplied !== undefined) return supplied;
  const projectReader =
    projectAccess?.status === 'trusted'
      ? getWorkspaceProjectReader(projectAccess.authority)
      : undefined;
  return loadConfig([
    ...createDefaultUserSettingsSources(),
    ...(projectReader === undefined ? [] : createWorkspaceProjectSettingsSources(projectReader)),
  ]);
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
  const config = await loadInteractiveProjectConfig(options.config, projectAccess);
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
          config.taskContext ? { taskContext: config.taskContext } : {},
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
    contributionSources: createContributionSourcesForProjectAccess(projectAccess),
  };
}
