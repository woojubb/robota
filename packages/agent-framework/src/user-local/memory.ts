import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveUserLocalStorageRoot } from './storage.js';
import type { IResolveUserLocalStorageRootOptions } from './storage.js';
import {
  USER_LOCAL_MEMORY_CATEGORIES,
  type IUserLocalMemoryDeleteResult,
  type IUserLocalMemoryFile,
  type IUserLocalMemoryItemOptions,
  type IUserLocalMemoryItemProjection,
  type IUserLocalMemoryListOptions,
  type IUserLocalMemoryListProjection,
  type IUserLocalMemorySetOptions,
  type TUserLocalMemoryCategory,
} from './memory-types.js';

type TJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly TJsonValue[]
  | { readonly [key: string]: TJsonValue };
type TJsonRecord = { readonly [key: string]: TJsonValue };

const MEMORY_STORAGE_CATEGORY = 'memory-projections';
const FILE_EXTENSION = '.json';
const MEMORY_SCHEMA_VERSION = 1;
const MAX_SEGMENT_LENGTH = 80;
const MAX_SUMMARY_LENGTH = 240;
const MAX_SOURCE_LENGTH = 80;
const MAX_SCOPE_LENGTH = 120;
const MAX_VALUE_SUMMARY_LENGTH = 240;
const DEFAULT_SCOPE = 'user';
const SAFE_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u;

const DISPLAY_NAVIGATION_RULES: Record<TUserLocalMemoryCategory, string> = {
  'view-preference': 'May affect UI panel, filter, density, or sorting display/navigation only.',
  'last-visible-cwd': 'May display or preselect an already visible workspace context only.',
  'background-selection': 'May restore the selected background entry in local UI only.',
  'task-association': 'May group visible tasks by a local association only.',
  'display-preference': 'May affect local text wrapping, compactness, or visibility only.',
  'inspection-choice': 'May affect inspection display choices only.',
};

function formatIsoDate(date: Date): string {
  return date.toISOString();
}

function isUserLocalMemoryCategory(value: string): value is TUserLocalMemoryCategory {
  return USER_LOCAL_MEMORY_CATEGORIES.includes(value as TUserLocalMemoryCategory);
}

function assertUserLocalMemoryCategory(value: string): TUserLocalMemoryCategory {
  if (!isUserLocalMemoryCategory(value)) {
    throw new Error(`Unsupported user-local memory category: ${value}`);
  }
  return value;
}

function assertSafeSegment(name: string, value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${name} must not be empty.`);
  }
  if (trimmed.length > MAX_SEGMENT_LENGTH || !SAFE_SEGMENT_PATTERN.test(trimmed)) {
    throw new Error(
      `${name} must use lowercase letters, numbers, dots, underscores, or hyphens: ${value}`,
    );
  }
  return trimmed;
}

function boundedText(name: string, value: string, maxLength: number): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (normalized.length === 0) {
    throw new Error(`${name} must not be empty.`);
  }
  if (normalized.length > maxLength) {
    return normalized.slice(0, maxLength);
  }
  return normalized;
}

function summarizeValue(value: string): string {
  return boundedText('value', value, MAX_VALUE_SUMMARY_LENGTH);
}

function memoryFileName(category: TUserLocalMemoryCategory, key: string): string {
  return `${category}__${key}${FILE_EXTENSION}`;
}

async function resolveMemoryRoot(
  options: IResolveUserLocalStorageRootOptions,
): Promise<{ readonly root: string; readonly memoryRoot: string }> {
  const root = await resolveUserLocalStorageRoot(options);
  return {
    root,
    memoryRoot: path.join(root, MEMORY_STORAGE_CATEGORY),
  };
}

function parseMemoryRecord(raw: string, storageLocation: string): IUserLocalMemoryFile {
  const record = JSON.parse(raw) as TJsonRecord;
  const category = readString(record, 'category');
  const schemaVersion = record['schemaVersion'];

  if (schemaVersion !== MEMORY_SCHEMA_VERSION) {
    throw new Error(`Unsupported user-local memory schema at ${storageLocation}`);
  }

  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    category: assertUserLocalMemoryCategory(category),
    key: readString(record, 'key'),
    value: readString(record, 'value'),
    summary: readString(record, 'summary'),
    source: readString(record, 'source'),
    scope: readString(record, 'scope'),
    createdAt: readString(record, 'createdAt'),
    lastUsedAt: readString(record, 'lastUsedAt'),
    enabled: readBoolean(record, 'enabled'),
  };
}

function readString(record: TJsonRecord, key: string): string {
  const value = record[key];
  if (typeof value !== 'string') {
    throw new Error(`Invalid user-local memory field: ${key}`);
  }
  return value;
}

function readBoolean(record: TJsonRecord, key: string): boolean {
  const value = record[key];
  if (typeof value !== 'boolean') {
    throw new Error(`Invalid user-local memory field: ${key}`);
  }
  return value;
}

function projectMemoryItem(
  root: string,
  storageLocation: string,
  item: IUserLocalMemoryFile,
): IUserLocalMemoryItemProjection {
  return {
    root,
    category: item.category,
    key: item.key,
    summary: item.summary,
    valueSummary: summarizeValue(item.value),
    source: item.source,
    scope: item.scope,
    storageLocation,
    createdAt: item.createdAt,
    lastUsedAt: item.lastUsedAt,
    enabled: item.enabled,
    displayNavigationRule: DISPLAY_NAVIGATION_RULES[item.category],
    commandExecutionEffect: 'none',
    deleteAvailable: true,
    disableAvailable: true,
  };
}

async function readMemoryFile(
  root: string,
  storageLocation: string,
): Promise<IUserLocalMemoryItemProjection> {
  return projectMemoryItem(
    root,
    storageLocation,
    parseMemoryRecord(await fs.readFile(storageLocation, 'utf8'), storageLocation),
  );
}

async function resolveMemoryFile(
  options: IUserLocalMemoryItemOptions,
): Promise<{ readonly root: string; readonly storageLocation: string }> {
  const category = assertUserLocalMemoryCategory(options.category);
  const key = assertSafeSegment('key', options.key);
  const { root, memoryRoot } = await resolveMemoryRoot(options);
  return {
    root,
    storageLocation: path.join(memoryRoot, memoryFileName(category, key)),
  };
}

export async function setUserLocalMemoryItem(
  options: IUserLocalMemorySetOptions,
): Promise<IUserLocalMemoryItemProjection> {
  const category = assertUserLocalMemoryCategory(options.category);
  const key = assertSafeSegment('key', options.key);
  const summary = boundedText('summary', options.summary, MAX_SUMMARY_LENGTH);
  const source = boundedText('source', options.source, MAX_SOURCE_LENGTH);
  const scope = boundedText('scope', options.scope ?? DEFAULT_SCOPE, MAX_SCOPE_LENGTH);
  const value = summarizeValue(options.value);
  const now = formatIsoDate((options.now ?? (() => new Date()))());
  const { root, memoryRoot } = await resolveMemoryRoot(options);
  const storageLocation = path.join(memoryRoot, memoryFileName(category, key));
  let createdAt = now;

  try {
    const existing = parseMemoryRecord(await fs.readFile(storageLocation, 'utf8'), storageLocation);
    createdAt = existing.createdAt;
  } catch (error) {
    if (error instanceof Error && error.message.includes('ENOENT')) {
      createdAt = now;
    } else {
      throw error;
    }
  }

  const item: IUserLocalMemoryFile = {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    category,
    key,
    value,
    summary,
    source,
    scope,
    createdAt,
    lastUsedAt: now,
    enabled: true,
  };

  await fs.mkdir(memoryRoot, { recursive: true });
  await fs.writeFile(storageLocation, `${JSON.stringify(item, null, 2)}\n`, 'utf8');
  return projectMemoryItem(root, storageLocation, item);
}

export async function listUserLocalMemoryItems(
  options: IUserLocalMemoryListOptions,
): Promise<IUserLocalMemoryListProjection> {
  const { root, memoryRoot } = await resolveMemoryRoot(options);
  let entries: readonly import('node:fs').Dirent[];

  try {
    entries = await fs.readdir(memoryRoot, { withFileTypes: true });
  } catch {
    entries = [];
  }

  const items = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(FILE_EXTENSION))
      .map((entry) => readMemoryFile(root, path.join(memoryRoot, entry.name))),
  );

  return {
    root,
    activeRepositoryRoot: path.resolve(options.activeRepositoryRoot),
    items: items.sort((left, right) =>
      `${left.category}/${left.key}`.localeCompare(`${right.category}/${right.key}`),
    ),
  };
}

export async function inspectUserLocalMemoryItem(
  options: IUserLocalMemoryItemOptions,
): Promise<IUserLocalMemoryItemProjection> {
  const { root, storageLocation } = await resolveMemoryFile(options);
  return readMemoryFile(root, storageLocation);
}

export async function disableUserLocalMemoryItem(
  options: IUserLocalMemoryItemOptions,
): Promise<IUserLocalMemoryItemProjection> {
  const { root, storageLocation } = await resolveMemoryFile(options);
  const existing = parseMemoryRecord(await fs.readFile(storageLocation, 'utf8'), storageLocation);
  const disabled: IUserLocalMemoryFile = {
    ...existing,
    enabled: false,
    lastUsedAt: formatIsoDate((options.now ?? (() => new Date()))()),
  };

  await fs.writeFile(storageLocation, `${JSON.stringify(disabled, null, 2)}\n`, 'utf8');
  return projectMemoryItem(root, storageLocation, disabled);
}

export async function deleteUserLocalMemoryItem(
  options: IUserLocalMemoryItemOptions,
): Promise<IUserLocalMemoryDeleteResult> {
  const { storageLocation } = await resolveMemoryFile(options);
  await fs.rm(storageLocation);
  return {
    category: options.category,
    key: options.key,
    deleted: true,
  };
}

export async function readEnabledUserLocalMemoryItem(
  options: IUserLocalMemoryItemOptions,
): Promise<IUserLocalMemoryItemProjection | null> {
  const item = await inspectUserLocalMemoryItem(options);
  return item.enabled ? item : null;
}
