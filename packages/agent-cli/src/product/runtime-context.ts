import { isAbsolute, join } from 'node:path';

import { createIdentityContext } from '@robota-sdk/agent-remote-pairing';

import type { IPathProtectionPolicy } from '@robota-sdk/agent-core';
import type { IDoctorDisplayVocabulary } from '@robota-sdk/agent-command';
import type {
  ICommandProductVocabulary,
  IProjectSettingsPath,
  ISkillRootDescriptor,
  TWorkspaceProjectStateDirectories,
} from '@robota-sdk/agent-framework';
import type { IProductConfig, TConfigEnvironment } from '@robota-sdk/product-config';
import type { IIdentityContext } from '@robota-sdk/agent-remote-pairing';

export interface ICliProductLayout {
  readonly userRoot: string;
  readonly projectDirectory: string;
  readonly userPaths: {
    readonly settings: string;
    readonly sessions: string;
    readonly onboarded: string;
    readonly history: string;
    readonly workspaceTrust: string;
    readonly orgPolicy: string;
    readonly mcpApprovals: string;
  };
  readonly projectStateDirectories: TWorkspaceProjectStateDirectories;
  readonly projectSettingsPaths: readonly IProjectSettingsPath[];
  readonly agentDefinitionRoots: readonly string[];
  readonly skillRoots: readonly ISkillRootDescriptor[];
  readonly pluginRelativeDirectory: string;
  readonly taskContext: { readonly enabled: true; readonly dir: string };
  readonly baselinePermissionAllow: readonly string[];
  readonly projectWorktreesDirectory: string;
  readonly userQuarantineDirectory: string;
  readonly pathProtection: IPathProtectionPolicy;
  /**
   * User-state entries that hold credentials (a settings file may carry a literal key; the owner-only
   * stores and the host identity hold secrets). A confined command never reads them.
   */
  readonly credentialPaths: readonly string[];
}

export interface ICliProductVocabulary extends ICommandProductVocabulary {
  readonly editorTemporaryDirectoryPrefix: string;
  readonly doctor: IDoctorDisplayVocabulary;
  readonly doctorSlash: IDoctorDisplayVocabulary;
  readonly resumeCommand: (sessionId: string) => string;
}

/** One host invocation owns its config, path layout and cryptographic domain. */
export interface ICliRuntimeContext {
  readonly config: IProductConfig;
  readonly environment: TConfigEnvironment;
  readonly userHome?: string;
  readonly layout: ICliProductLayout;
  readonly vocabulary: ICliProductVocabulary;
  readonly cryptoContext: IIdentityContext;
}

function freeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.values(value).forEach((child) => freeze(child));
    Object.freeze(value);
  }
  return value;
}

/** Pure product layout derivation; callers perform no discovery by a former product's name. */
export function createCliRuntimeContext(config: IProductConfig, environment: TConfigEnvironment = {}): ICliRuntimeContext {
  for (const root of [config.storage.userRoot, config.storage.cacheRoot, config.storage.logRoot]) {
    if (!isAbsolute(root)) throw new Error('CLI product state, cache and log roots must be resolved absolute paths.');
  }
  const directory = config.storage.projectDirectory;
  const userRoot = config.storage.userRoot;
  const doctor: IDoctorDisplayVocabulary = {
    title: `${config.identity.cliName} doctor`,
    productName: config.identity.displayName,
    formatRepairCommand: (checkId) => `${config.identity.cliName} doctor --repair ${checkId}`,
    repairOffer: 'run with --repair <check-id> (asks before writing; --yes skips the prompt)',
  };
  const projectWorktreesDirectory = join(directory, 'worktrees');
  const layout: ICliProductLayout = {
    userRoot,
    projectDirectory: directory,
    userPaths: {
      settings: join(userRoot, 'settings.json'),
      sessions: join(userRoot, 'sessions'),
      onboarded: join(userRoot, 'onboarded'),
      history: join(userRoot, 'history.jsonl'),
      workspaceTrust: join(userRoot, 'workspace-trust.json'),
      orgPolicy: join(userRoot, 'org-policy.json'),
      mcpApprovals: join(userRoot, 'mcp-approvals.json'),
    },
    projectStateDirectories: {
      sessions: join(directory, 'sessions'),
      'session-logs': join(directory, 'logs'),
      memory: join(directory, 'memory'),
      checkpoints: join(directory, 'checkpoints'),
    },
    projectSettingsPaths: [
      { scope: 'project', relativePath: join(directory, 'settings.json') },
      { scope: 'project-local', relativePath: join(directory, 'settings.local.json') },
      ...(config.settings.sharedProjectFiles ?? []),
    ],
    agentDefinitionRoots: [
      join(directory, 'agents'),
      join('.agents', 'agents'),
      join('.claude', 'agents'),
    ],
    skillRoots: [
      { root: join(directory, 'skills'), kind: 'skills' },
      { root: join('.claude', 'skills'), kind: 'skills' },
      { root: join('.claude', 'commands'), kind: 'commands' },
      { root: join('.agents', 'skills'), kind: 'skills' },
    ],
    pluginRelativeDirectory: join(directory, 'plugins'),
    taskContext: { enabled: true, dir: join(directory, 'tasks') },
    baselinePermissionAllow: [directory, '.agents', '.claude'].flatMap((root) => [
      `Read(${root}/**)`,
      `Glob(${root}/**)`,
    ]),
    projectWorktreesDirectory,
    userQuarantineDirectory: join(userRoot, 'sandbox-quarantine'),
    pathProtection: {
      protectedDirectoryNames: [directory],
      protectedPaths: [userRoot],
      writableWorktreeContainers: [projectWorktreesDirectory, '.claude/worktrees'],
    },
    credentialPaths: [
      'settings.json',
      'credentials',
      'mcp-credentials',
      'remote-host-identity.json',
    ].map((entry) => join(userRoot, entry)),
  };
  return freeze({
    config,
    environment: { ...environment },
    ...((environment.HOME ?? environment.USERPROFILE) !== undefined
      ? { userHome: environment.HOME ?? environment.USERPROFILE }
      : {}),
    layout,
    cryptoContext: createIdentityContext(config.crypto.namespace),
    vocabulary: {
      displayName: config.identity.displayName,
      cliName: config.identity.cliName,
      editorTemporaryDirectoryPrefix: config.identity.editorTemporaryDirectoryPrefix,
      doctor,
      doctorSlash: {
        ...doctor,
        formatRepairCommand: (checkId: string) => `/doctor repair ${checkId}`,
        repairOffer: 'use /doctor repair <check-id> (asks before writing)',
      },
      resumeCommand: (sessionId: string) => `${config.identity.cliName} --resume ${sessionId}`,
    },
  });
}
