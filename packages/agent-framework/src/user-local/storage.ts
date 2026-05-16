import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

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

async function resolveForComparison(absPath: string): Promise<string> {
  let current = absPath;

  while (path.dirname(current) !== current) {
    try {
      const realCurrent = await fs.realpath(current);
      const relativeMissingPath = path.relative(current, absPath);
      return path.resolve(realCurrent, relativeMissingPath);
    } catch {
      current = path.dirname(current);
    }
  }

  try {
    return await fs.realpath(current);
  } catch {
    return path.resolve(absPath);
  }
}

export async function resolveUserLocalStorageRoot(
  options: IResolveUserLocalStorageRootOptions,
): Promise<string> {
  const activeRepositoryRoot = path.resolve(options.activeRepositoryRoot);
  assertAbsolutePath('activeRepositoryRoot', activeRepositoryRoot);

  const candidateRoot =
    options.storageRoot !== undefined
      ? options.storageRoot
      : path.join(options.homeDir ?? resolveDefaultHomeDir(), '.robota');

  assertAbsolutePath('userLocalStorageRoot', candidateRoot);

  const resolvedRoot = path.resolve(candidateRoot);
  const comparableRoot = await resolveForComparison(resolvedRoot);
  const comparableRepositoryRoot = await resolveForComparison(activeRepositoryRoot);

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
): Promise<readonly IUserLocalStorageItemSummary[]> {
  const storageLocation = resolveCategoryLocation(root, category);
  let entries: readonly import('node:fs').Dirent[];

  try {
    entries = await fs.readdir(storageLocation, { withFileTypes: true });
  } catch {
    return [];
  }

  const summaries = await Promise.all(
    entries.map(async (entry): Promise<IUserLocalStorageItemSummary> => {
      const itemLocation = path.join(storageLocation, entry.name);
      const stats = await fs.stat(itemLocation);
      const key = entry.name;
      return {
        root,
        category,
        key,
        summary: `${category}/${key}`,
        source: 'user-local-storage',
        scope: 'user',
        storageLocation: itemLocation,
        createdAt: formatIsoDate(stats.birthtime),
        lastUsedAt: formatIsoDate(stats.mtime),
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
  const root = await resolveUserLocalStorageRoot(options);
  const activeRepositoryRoot = path.resolve(options.activeRepositoryRoot);
  const createDirectories = options.createDirectories ?? true;

  if (createDirectories) {
    await fs.mkdir(root, { recursive: true });
  }

  const categories = await Promise.all(
    USER_LOCAL_STORAGE_CATEGORY_DEFINITIONS.map(
      async (definition): Promise<IUserLocalStorageCategoryProjection> => {
        const storageLocation = resolveCategoryLocation(root, definition.category);
        if (createDirectories) {
          await fs.mkdir(storageLocation, { recursive: true });
        }
        const items = await listItemSummaries(root, definition.category);
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
