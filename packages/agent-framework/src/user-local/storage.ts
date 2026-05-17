import { homedir } from 'node:os';
import path from 'node:path';

import { NodeFileSystemAsync } from '../adapters/node-file-system.js';

import type { IDirent, IFileSystemAsync } from '@robota-sdk/agent-core';

export const USER_LOCAL_STORAGE_CATEGORIES = [
  'preferences',
  'view-state',
  'memory-projections',
  'task-associations',
  'workflow-metadata',
  'inspection-index',
] as const;

export type TUserLocalStorageCategory = (typeof USER_LOCAL_STORAGE_CATEGORIES)[number];

export interface IUserLocalStorageCategoryDefinition {
  readonly category: TUserLocalStorageCategory;
  readonly purpose: string;
  readonly mayExecuteCommands: false;
}

export interface IUserLocalStorageItemSummary {
  readonly root: string;
  readonly category: TUserLocalStorageCategory;
  readonly key: string;
  readonly summary: string;
  readonly source: string;
  readonly scope: string;
  readonly storageLocation: string;
  readonly createdAt?: string;
  readonly lastUsedAt?: string;
  readonly enabled: boolean;
  readonly deleteAvailable: boolean;
  readonly disableAvailable: boolean;
}

export interface IUserLocalStorageCategoryProjection {
  readonly category: TUserLocalStorageCategory;
  readonly purpose: string;
  readonly mayExecuteCommands: false;
  readonly storageLocation: string;
  readonly itemCount: number;
  readonly items: readonly IUserLocalStorageItemSummary[];
}

export interface IUserLocalStorageInspection {
  readonly root: string;
  readonly activeRepositoryRoot: string;
  readonly categories: readonly IUserLocalStorageCategoryProjection[];
  readonly generatedAt: string;
}

export interface IResolveUserLocalStorageRootOptions {
  readonly activeRepositoryRoot: string;
  readonly homeDir?: string;
  readonly storageRoot?: string;
  readonly fsAsync?: IFileSystemAsync;
}

export interface IInspectUserLocalStorageOptions extends IResolveUserLocalStorageRootOptions {
  readonly now?: () => Date;
  readonly createDirectories?: boolean;
}

export const USER_LOCAL_STORAGE_CATEGORY_DEFINITIONS: readonly IUserLocalStorageCategoryDefinition[] =
  [
    {
      category: 'preferences',
      purpose: 'User-local UI and display preferences.',
      mayExecuteCommands: false,
    },
    {
      category: 'view-state',
      purpose: 'Last selected panels, filters, and navigation state.',
      mayExecuteCommands: false,
    },
    {
      category: 'memory-projections',
      purpose: 'Inspectable local memory item projections and user choices.',
      mayExecuteCommands: false,
    },
    {
      category: 'task-associations',
      purpose: 'User-local associations between sessions, tasks, and background items.',
      mayExecuteCommands: false,
    },
    {
      category: 'workflow-metadata',
      purpose: 'Transparent workflow metadata that is not repo-owned.',
      mayExecuteCommands: false,
    },
    {
      category: 'inspection-index',
      purpose: 'Category and item summaries for user inspection and deletion.',
      mayExecuteCommands: false,
    },
  ];

function formatIsoDate(date: Date): string {
  return date.toISOString();
}

function assertAbsolutePath(name: string, value: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must not be empty.`);
  }
  if (!path.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path: ${value}`);
  }
}

function resolveDefaultHomeDir(): string {
  return process.env.HOME ?? homedir();
}

function isEqualOrInside(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function resolveForComparison(absPath: string, fsAsync: IFileSystemAsync): Promise<string> {
  let current = absPath;

  while (path.dirname(current) !== current) {
    try {
      const realCurrent = await fsAsync.realpath(current);
      const relativeMissingPath = path.relative(current, absPath);
      return path.resolve(realCurrent, relativeMissingPath);
    } catch {
      // allow-fallback: walk up to first existing ancestor, not an error suppression
      current = path.dirname(current);
    }
  }

  try {
    return await fsAsync.realpath(current);
  } catch {
    // allow-fallback: filesystem root unreachable; resolve() gives a safe absolute path
    return path.resolve(absPath);
  }
}

export async function resolveUserLocalStorageRoot(
  options: IResolveUserLocalStorageRootOptions,
): Promise<string> {
  const fsAsync = options.fsAsync ?? new NodeFileSystemAsync();
  const activeRepositoryRoot = path.resolve(options.activeRepositoryRoot);
  assertAbsolutePath('activeRepositoryRoot', activeRepositoryRoot);

  const candidateRoot =
    options.storageRoot !== undefined
      ? options.storageRoot
      : path.join(options.homeDir ?? resolveDefaultHomeDir(), '.robota');

  assertAbsolutePath('userLocalStorageRoot', candidateRoot);

  const resolvedRoot = path.resolve(candidateRoot);
  const comparableRoot = await resolveForComparison(resolvedRoot, fsAsync);
  const comparableRepositoryRoot = await resolveForComparison(activeRepositoryRoot, fsAsync);

  if (isEqualOrInside(comparableRepositoryRoot, comparableRoot)) {
    throw new Error(
      `User-local storage root must be outside the active repository: ${resolvedRoot}`,
    );
  }

  return resolvedRoot;
}

function resolveCategoryLocation(root: string, category: TUserLocalStorageCategory): string {
  return path.join(root, category);
}

async function listItemSummaries(
  root: string,
  category: TUserLocalStorageCategory,
  fsAsync: IFileSystemAsync,
): Promise<readonly IUserLocalStorageItemSummary[]> {
  const storageLocation = resolveCategoryLocation(root, category);
  let entries: readonly IDirent[];

  try {
    entries = await fsAsync.readdir(storageLocation, { withFileTypes: true });
  } catch {
    // allow-fallback: missing category directory returns empty list
    return [];
  }

  const summaries = await Promise.all(
    entries.map(async (entry): Promise<IUserLocalStorageItemSummary> => {
      const itemLocation = path.join(storageLocation, entry.name);
      const stats = await fsAsync.stat(itemLocation);
      const key = entry.name;
      return {
        root,
        category,
        key,
        summary: `${category}/${key}`,
        source: 'user-local-storage',
        scope: 'user',
        storageLocation: itemLocation,
        createdAt: formatIsoDate(new Date(stats.birthtimeMs)),
        lastUsedAt: formatIsoDate(new Date(stats.mtimeMs)),
        enabled: true,
        deleteAvailable: true,
        disableAvailable: false,
      };
    }),
  );

  return summaries.sort((left, right) => left.key.localeCompare(right.key));
}

export async function inspectUserLocalStorage(
  options: IInspectUserLocalStorageOptions,
): Promise<IUserLocalStorageInspection> {
  const fsAsync = options.fsAsync ?? new NodeFileSystemAsync();
  const root = await resolveUserLocalStorageRoot(options);
  const activeRepositoryRoot = path.resolve(options.activeRepositoryRoot);
  const createDirectories = options.createDirectories ?? true;

  if (createDirectories) {
    await fsAsync.mkdir(root, { recursive: true });
  }

  const categories = await Promise.all(
    USER_LOCAL_STORAGE_CATEGORY_DEFINITIONS.map(
      async (definition): Promise<IUserLocalStorageCategoryProjection> => {
        const storageLocation = resolveCategoryLocation(root, definition.category);
        if (createDirectories) {
          await fsAsync.mkdir(storageLocation, { recursive: true });
        }
        const items = await listItemSummaries(root, definition.category, fsAsync);
        return {
          category: definition.category,
          purpose: definition.purpose,
          mayExecuteCommands: definition.mayExecuteCommands,
          storageLocation,
          itemCount: items.length,
          items,
        };
      },
    ),
  );

  return {
    root,
    activeRepositoryRoot,
    categories,
    generatedAt: formatIsoDate((options.now ?? (() => new Date()))()),
  };
}
