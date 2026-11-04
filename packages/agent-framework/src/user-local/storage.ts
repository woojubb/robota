import {
  dirnamePath,
  isAbsolutePath,
  joinPath,
  relativeSegments,
  resolvePath,
} from '@robota-sdk/agent-core';

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
  /** Absolute: a relative path would have to be anchored to the process directory, which is not read here. */
  readonly activeRepositoryRoot: string;
  /** Absolute, for the same reason. */
  readonly storageRoot: string;
  /** The files the storage root is read and written through. No default: the host names them. */
  readonly fsAsync: IFileSystemAsync;
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
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required and must not be empty.`);
  }
  if (!isAbsolutePath(value)) {
    throw new Error(`${name} must be an absolute path: ${value}`);
  }
}

/** Whether `candidatePath` is `parentPath` or below it; a path on another root is not. */
function isEqualOrInside(parentPath: string, candidatePath: string): boolean {
  const segments = relativeSegments(parentPath, candidatePath);
  return segments !== undefined && segments[0] !== '..';
}

async function resolveForComparison(absPath: string, fsAsync: IFileSystemAsync): Promise<string> {
  let current = absPath;

  while (dirnamePath(current) !== current) {
    try {
      const realCurrent = await fsAsync.realpath(current);
      // The missing part is joined as names, in the platform of the path it extends: a directory
      // called `C:\x` is a drive only to a Windows path, and `resolvePath` would read it as one.
      return joinPath(realCurrent, ...(relativeSegments(current, absPath) ?? []));
    } catch {
      // allow-fallback: walk up to first existing ancestor, not an error suppression
      current = dirnamePath(current);
    }
  }

  try {
    return await fsAsync.realpath(current);
  } catch {
    // allow-fallback: filesystem root unreachable; the path itself, normalised, is the answer
    return resolvePath(absPath, '.');
  }
}

export async function resolveUserLocalStorageRoot(
  options: IResolveUserLocalStorageRootOptions,
): Promise<string> {
  const fsAsync = options.fsAsync;
  if (typeof fsAsync !== 'object' || fsAsync === null) {
    throw new Error(
      'User-local storage requires `fsAsync`: the file system the storage root is read and written ' +
        'through. On Node pass `new NodeFileSystemAsync()` from `@robota-sdk/agent-framework/node`.',
    );
  }
  assertAbsolutePath('activeRepositoryRoot', options.activeRepositoryRoot);
  const activeRepositoryRoot = resolvePath(options.activeRepositoryRoot, '.');

  const candidateRoot = options.storageRoot;

  assertAbsolutePath('userLocalStorageRoot', candidateRoot);

  const resolvedRoot = resolvePath(candidateRoot, '.');
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
  return joinPath(root, category);
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
      const itemLocation = joinPath(storageLocation, entry.name);
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
  const fsAsync = options.fsAsync;
  const root = await resolveUserLocalStorageRoot(options);
  const activeRepositoryRoot = resolvePath(options.activeRepositoryRoot, '.');
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
