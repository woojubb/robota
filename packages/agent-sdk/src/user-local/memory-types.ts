import type { IResolveUserLocalStorageRootOptions } from './storage.js';

export const USER_LOCAL_MEMORY_CATEGORIES = [
  'view-preference',
  'last-visible-cwd',
  'background-selection',
  'task-association',
  'display-preference',
  'inspection-choice',
] as const;

export type TUserLocalMemoryCategory = (typeof USER_LOCAL_MEMORY_CATEGORIES)[number];
export type TUserLocalMemoryCommandExecutionEffect = 'none';

export interface IUserLocalMemoryItemProjection {
  readonly root: string;
  readonly category: TUserLocalMemoryCategory;
  readonly key: string;
  readonly summary: string;
  readonly valueSummary: string;
  readonly source: string;
  readonly scope: string;
  readonly storageLocation: string;
  readonly createdAt: string;
  readonly lastUsedAt: string;
  readonly enabled: boolean;
  readonly displayNavigationRule: string;
  readonly commandExecutionEffect: TUserLocalMemoryCommandExecutionEffect;
  readonly deleteAvailable: true;
  readonly disableAvailable: true;
}

export interface IUserLocalMemoryListProjection {
  readonly root: string;
  readonly activeRepositoryRoot: string;
  readonly items: readonly IUserLocalMemoryItemProjection[];
}

export interface IUserLocalMemorySetOptions extends IResolveUserLocalStorageRootOptions {
  readonly category: TUserLocalMemoryCategory;
  readonly key: string;
  readonly value: string;
  readonly summary: string;
  readonly source: string;
  readonly scope?: string;
  readonly now?: () => Date;
}

export interface IUserLocalMemoryItemOptions extends IResolveUserLocalStorageRootOptions {
  readonly category: TUserLocalMemoryCategory;
  readonly key: string;
  readonly now?: () => Date;
}

export interface IUserLocalMemoryListOptions extends IResolveUserLocalStorageRootOptions {
  readonly now?: () => Date;
}

export interface IUserLocalMemoryDeleteResult {
  readonly category: TUserLocalMemoryCategory;
  readonly key: string;
  readonly deleted: boolean;
}

export interface IUserLocalMemoryFile {
  readonly schemaVersion: 1;
  readonly category: TUserLocalMemoryCategory;
  readonly key: string;
  readonly value: string;
  readonly summary: string;
  readonly source: string;
  readonly scope: string;
  readonly createdAt: string;
  readonly lastUsedAt: string;
  readonly enabled: boolean;
}
