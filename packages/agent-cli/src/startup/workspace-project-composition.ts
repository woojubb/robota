import { realpathSync } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';

import {
  WorkspaceAuthorityRequiredError,
  createWorkspaceProjectContributionSource,
  createRestrictedWorkspaceProjectAccess,
  createWorkspaceProjectSettingsSources,
  createWorkspaceProjectSettingsStore,
  createWorkspaceMemoryStore,
  getWorkspaceProjectIdentity,
  getWorkspaceProjectReader,
  getWorkspaceProjectStateStorage,
} from '@robota-sdk/agent-framework';
import {
  createNodeHostContributionSource,
  createNodeHostSettingsStore,
  supportsWorkspaceProjectMutation,
} from '@robota-sdk/agent-framework/node';
import { BrokeredWorkspaceTrustService } from './brokered-workspace-trust.js';

import type {
  IEditCheckpointStore,
  IContributionSource,
  IMemoryStore,
  ISettingsDocumentStore,
  ITrustedWorkspaceProjectAccess,
  IWorkspaceProjectSettingsWriter,
  TSettingsSource,
  TWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface/session';
import type { ICliRuntimeContext } from '../product/runtime-context.js';

import {
  createProductEditCheckpointStoreFactory,
  createProductProjectSessionStore,
  createProductUserSessionStore,
} from '../product/session-stores.js';
import { createProductUserSettingsSources } from '../product/user-settings.js';
import { optionArgv } from '../utils/option-argv.js';

export interface ICreateCliWorkspaceCompositionOptions {
  readonly cwd: string;
  readonly userHome?: string;
  readonly productRuntime: ICliRuntimeContext;
  readonly projectAccess?: TWorkspaceProjectAccess;
  readonly projectSettingsWriter?: IWorkspaceProjectSettingsWriter;
  /** `--safe-mode`: no skills, commands or agents from any scope, the user's included. */
  readonly safeMode?: boolean;
  /** The host platform, which decides whether a trusted workspace's state can live in it. */
  readonly platform?: NodeJS.Platform;
  /**
   * A run that persists no session (`--no-session-persistence`): edit checkpoints still work for the
   * run, but their pre-images and manifests live in an owner-only per-process directory under the
   * user's state root, removed at exit, and nothing is written under the project.
   */
  readonly ephemeralEditCheckpoints?: boolean;
}

export interface ICliWorkspaceComposition {
  readonly projectAccess: TWorkspaceProjectAccess;
  readonly contributionSources: readonly IContributionSource[];
  readonly skillRoots: ICliRuntimeContext['layout']['skillRoots'];
  readonly settingsSources: readonly TSettingsSource[];
  readonly settingsStores: readonly ISettingsDocumentStore[];
  readonly sessionStore: IInteractiveSessionStore;
  /** Where `sessionStore` keeps records: the trusted project, or the user's own store. */
  readonly sessionStoreScope: 'project' | 'user';
  /** Absent when the workspace is Restricted, or its host cannot write project memory safely. */
  readonly memoryStore?: IMemoryStore;
  /**
   * Builds one session's edit checkpoint store; absent under the same conditions as `memoryStore`.
   * A factory, not a store: a store holds its session's turn in progress, so sessions that run at
   * the same time each need their own.
   */
  readonly createEditCheckpointStore?: () => IEditCheckpointStore;
}

export type TCliWorkspaceCompositionOverrides = Partial<
  Pick<
    ICreateCliWorkspaceCompositionOptions,
    'projectAccess' | 'projectSettingsWriter' | 'safeMode' | 'productRuntime'
  >
>;

/**
 * A run that must start Restricted: set by `/cd` into a Restricted folder, and for a
 * background session a person chose to start Restricted from the session view.
 */
export const RESTRICTED_WORKSPACE_FLAG = '--restricted-workspace';

/** Starts with every customization off, to rule one out. */
export const SAFE_MODE_FLAG = '--safe-mode';

export const SAFE_MODE_NOTICE =
  'Safe mode: project and user instruction files, skills, commands, agents, output styles, ' +
  'plugins, hooks and MCP servers are off. Provider, model, built-in tools and permissions work as ' +
  'usual.';

/**
 * The startup access decision. A `/cd` from a Restricted session never widens access, whatever the
 * target's own trust decision — read from argv because access is decided before the
 * arguments are parsed.
 */
export async function resolveStartupWorkspaceProjectAccess(
  argv: readonly string[],
  cwd: string,
  options: {
    readonly productRuntime?: ICliRuntimeContext;
    readonly projectAccess?: TWorkspaceProjectAccess;
    /** An embedder's `startCli({ safeMode: true })`, which leaves no flag in argv. */
    readonly safeMode?: boolean;
  } = {},
): Promise<TWorkspaceProjectAccess> {
  // Information-only invocations never need a durable broker or project admission.
  if (argv.length === 3 &&
      (argv[2] === '--help' || argv[2] === '-h' || argv[2] === '--version')) {
    return createRestrictedWorkspaceProjectAccess('untrusted', cwd);
  }
  // Safe mode loads nothing from the project, so it starts Restricted whatever the trust store says.
  const flags = optionArgv(argv);
  if (
    options.safeMode === true ||
    flags.includes(RESTRICTED_WORKSPACE_FLAG) ||
    flags.includes(SAFE_MODE_FLAG)
  ) {
    return createRestrictedWorkspaceProjectAccess('untrusted', cwd);
  }
  return resolveInitialCliWorkspaceProjectAccess(cwd, options);
}

/** Resolve one host-owned admission decision before any project source is composed. */
export async function resolveInitialCliWorkspaceProjectAccess(
  cwd: string,
  options: Partial<TCliWorkspaceCompositionOverrides> = {},
): Promise<TWorkspaceProjectAccess> {
  if (options.projectAccess !== undefined) return options.projectAccess;
  const runtime = options.productRuntime;
  if (runtime === undefined)
    throw new Error('Workspace admission requires an explicit CLI runtime context.');
  try {
    return await (await BrokeredWorkspaceTrustService.create(runtime)).inspect(cwd);
  } catch (error) {
    return createRestrictedWorkspaceProjectAccess(
      'store-unavailable', cwd, error instanceof Error ? error : new Error(String(error)),
    );
  }
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
      options.productRuntime.layout.projectStateDirectories[namespace]
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
    contributionSources: createProductContributionSources(projectAccess, options.productRuntime),
    skillRoots: options.productRuntime.layout.skillRoots,
    settingsSources: [
      ...createProductUserSettingsSources(options.productRuntime),
      ...createWorkspaceProjectSettingsSources(
        getWorkspaceProjectReader(authority),
        options.productRuntime.layout.projectSettingsPaths,
      ),
    ],
    settingsStores,
    ...trustedSessionStore(authority, options),
    ...trustedMemoryStore(authority, options),
    ...trustedEditCheckpointStore(authority, options),
  };
}

/**
 * Checkpoints are kept under the project and a restore writes the project's files back, so a host
 * that cannot prove a project write stays under the trusted root gets none, and `/rewind` says why.
 */
function trustedEditCheckpointStore(
  authority: ITrustedWorkspaceProjectAccess['authority'],
  options: ICreateCliWorkspaceCompositionOptions,
): Pick<ICliWorkspaceComposition, 'createEditCheckpointStore'> {
  if (!supportsWorkspaceProjectMutation(options.platform)) return {};
  return {
    createEditCheckpointStore: createProductEditCheckpointStoreFactory(
      authority,
      options.productRuntime,
      { ephemeral: options.ephemeralEditCheckpoints === true },
    ),
  };
}

/**
 * Project memory is shared through the repository, so moving it to the user's own store would split
 * it from what the project keeps; where a host cannot prove a project write stays under the trusted
 * root, the workspace gets no memory store and memory reports itself off.
 */
function trustedMemoryStore(
  authority: ITrustedWorkspaceProjectAccess['authority'],
  options: ICreateCliWorkspaceCompositionOptions,
): Pick<ICliWorkspaceComposition, 'memoryStore'> {
  if (!supportsWorkspaceProjectMutation(options.platform)) return {};
  return {
    memoryStore: createWorkspaceMemoryStore(getWorkspaceProjectStateStorage(authority, 'memory')),
  };
}

/**
 * Where a host cannot prove a project write stays under the trusted root, the project store would
 * refuse every save; the workspace's sessions go to the user's store instead, where listing finds
 * them by their working directory. Nothing is written under the project root either way. Both stores
 * come from the product factory, so both seal exactly as every other store of this process does.
 */
function trustedSessionStore(
  authority: ITrustedWorkspaceProjectAccess['authority'],
  options: ICreateCliWorkspaceCompositionOptions,
): Pick<ICliWorkspaceComposition, 'sessionStore' | 'sessionStoreScope'> {
  if (!supportsWorkspaceProjectMutation(options.platform)) {
    return {
      sessionStore: createProductUserSessionStore(options.productRuntime),
      sessionStoreScope: 'user',
    };
  }
  return {
    sessionStore: createProductProjectSessionStore(authority, options.productRuntime),
    sessionStoreScope: 'project',
  };
}

export function createInitialCliWorkspaceComposition(
  cwd: string,
  overrides: TCliWorkspaceCompositionOverrides,
): ICliWorkspaceComposition {
  return createCliWorkspaceComposition({
    cwd,
    ...overrides,
    productRuntime: requiredProductRuntime(overrides.productRuntime),
  });
}

/** Read settings for a supervisor before a secure runtime has unlocked its session store. */
export function createInitialCliWorkspaceSettingsSources(
  cwd: string,
  runtime: ICliRuntimeContext,
  projectAccess: TWorkspaceProjectAccess,
): readonly TSettingsSource[] {
  const user = createProductUserSettingsSources(runtime);
  if (projectAccess.status !== 'trusted') return user;
  const authority = projectAccess.authority;
  const trustedRoot = getWorkspaceProjectIdentity(authority).worktreeRoot;
  const remainder = relative(trustedRoot, realpathSync(cwd));
  if (remainder === '..' || remainder.startsWith(`..${sep}`) || isAbsolute(remainder)) {
    throw new WorkspaceAuthorityRequiredError('Trusted project access does not cover the requested working directory.');
  }
  for (const namespace of ['sessions', 'session-logs', 'memory', 'checkpoints'] as const) {
    if (getWorkspaceProjectStateStorage(authority, namespace).rootRelativePath !== runtime.layout.projectStateDirectories[namespace]) {
      throw new WorkspaceAuthorityRequiredError('Trusted project state directories do not match this CLI product.');
    }
  }
  return [
    ...user,
    ...createWorkspaceProjectSettingsSources(getWorkspaceProjectReader(authority), runtime.layout.projectSettingsPaths),
  ];
}

export function createCliWorkspaceComposition(
  options: ICreateCliWorkspaceCompositionOptions,
): ICliWorkspaceComposition {
  const projectAccess =
    options.projectAccess ??
    createRestrictedWorkspaceProjectAccess('identity-unavailable', options.cwd);
  // Contained. Reject cross-root pairs until one canonical project-root contract replaces both
  // carriers.
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
    options.productRuntime.layout.userPaths.settings,
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
          : createProductContributionSources(projectAccess, options.productRuntime),
      skillRoots: options.productRuntime.layout.skillRoots,
      settingsSources: createProductUserSettingsSources(options.productRuntime),
      settingsStores: [userSettingsStore],
      sessionStore: createProductUserSessionStore(options.productRuntime),
      sessionStoreScope: 'user',
    };
  }

  return createTrustedCliWorkspaceComposition(projectAccess, options, userSettingsStore);
}

/** Product user roots are independent of the workspace state directory and third-party home roots. */
export function createProductContributionSources(
  projectAccess: TWorkspaceProjectAccess,
  runtime: ICliRuntimeContext,
): readonly IContributionSource[] {
  const projectSources =
    projectAccess.status === 'trusted'
      ? [
          createWorkspaceProjectContributionSource(
            getWorkspaceProjectReader(projectAccess.authority),
            getWorkspaceProjectIdentity(projectAccess.authority).worktreeRoot,
          ),
        ]
      : [];
  const owned = createNodeHostContributionSource(runtime.layout.userRoot);
  const compatibility =
    runtime.userHome === undefined ? undefined : createNodeHostContributionSource(runtime.userHome);
  const prefix = `${runtime.layout.projectDirectory}/`;
  const route = (path: string): { source: IContributionSource; path: string } | undefined => {
    const normalized = path.replace(/\\/gu, '/');
    if (normalized.startsWith(prefix))
      return { source: owned, path: normalized.slice(prefix.length) };
    if (/^\.(?:agents|claude)\//u.test(normalized) && compatibility !== undefined)
      return { source: compatibility, path: normalized };
    return undefined;
  };
  const user: IContributionSource = Object.freeze({
    kind: 'host',
    displayName: runtime.layout.userRoot,
    readText: (path: string, purpose: string) => {
      const entry = route(path);
      return entry?.source.readText(entry.path, purpose);
    },
    listDirectory: (path: string, purpose: string) => {
      const entry = route(path);
      return entry?.source.listDirectory(entry.path, purpose) ?? [];
    },
    inspectKind: (path: string, purpose: string) => {
      const entry = route(path);
      return entry?.source.inspectKind(entry.path, purpose);
    },
    locate: (path: string) => {
      const entry = route(path);
      if (entry?.source.locate === undefined)
        throw new Error('Unconfigured host contribution path.');
      return entry.source.locate(entry.path);
    },
  });
  return [...projectSources, user];
}

function requiredProductRuntime(runtime: ICliRuntimeContext | undefined): ICliRuntimeContext {
  if (runtime === undefined)
    throw new Error('Workspace composition requires an explicit CLI runtime context.');
  return runtime;
}
