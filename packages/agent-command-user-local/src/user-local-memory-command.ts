import type { ICommandResult, TUserLocalMemoryCategory } from '@robota-sdk/agent-sdk';
import {
  deleteUserLocalMemoryItem,
  disableUserLocalMemoryItem,
  inspectUserLocalMemoryItem,
  listUserLocalMemoryItems,
  setUserLocalMemoryItem,
} from '@robota-sdk/agent-sdk';
import { USER_LOCAL_COMMAND_USAGE } from './user-local-command-constants.js';

export interface IUserLocalMemoryCommandArgs {
  readonly action?: string;
  readonly positional: readonly string[];
  readonly format: 'text' | 'json';
  readonly summary?: string;
  readonly source?: string;
}

function formatMemoryListText(
  items: readonly { category: string; key: string; enabled: boolean }[],
): string {
  if (items.length === 0) {
    return 'No user-local memory items.';
  }
  return items
    .map((item) => `- ${item.category}/${item.key} (${item.enabled ? 'enabled' : 'disabled'})`)
    .join('\n');
}

function parseMemoryCategory(value: string | undefined): TUserLocalMemoryCategory {
  if (value === undefined) {
    throw new Error('User-local memory category is required.');
  }
  return value as TUserLocalMemoryCategory;
}

async function executeMemoryListCommand(
  activeRepositoryRoot: string,
  parsed: IUserLocalMemoryCommandArgs,
): Promise<ICommandResult> {
  const list = await listUserLocalMemoryItems({ activeRepositoryRoot });
  return {
    message:
      parsed.format === 'json' ? JSON.stringify(list, null, 2) : formatMemoryListText(list.items),
    success: true,
    data: { list },
  };
}

async function executeMemorySetCommand(
  activeRepositoryRoot: string,
  parsed: IUserLocalMemoryCommandArgs,
): Promise<ICommandResult> {
  const [category, key, value] = parsed.positional;
  const item = await setUserLocalMemoryItem({
    activeRepositoryRoot,
    category: parseMemoryCategory(category),
    key: key ?? '',
    value: value ?? '',
    summary: parsed.summary ?? '',
    source: parsed.source ?? '',
  });
  return {
    message: `Stored user-local memory item ${item.category}/${item.key} at ${item.storageLocation}`,
    success: true,
    data: { item },
  };
}

async function executeMemoryInspectCommand(
  activeRepositoryRoot: string,
  parsed: IUserLocalMemoryCommandArgs,
): Promise<ICommandResult> {
  const [category, key] = parsed.positional;
  const item = await inspectUserLocalMemoryItem({
    activeRepositoryRoot,
    category: parseMemoryCategory(category),
    key: key ?? '',
  });
  return {
    message:
      parsed.format === 'json'
        ? JSON.stringify(item, null, 2)
        : `${item.category}/${item.key}: ${item.summary}`,
    success: true,
    data: { item },
  };
}

async function executeMemoryDisableCommand(
  activeRepositoryRoot: string,
  parsed: IUserLocalMemoryCommandArgs,
): Promise<ICommandResult> {
  const [category, key] = parsed.positional;
  const item = await disableUserLocalMemoryItem({
    activeRepositoryRoot,
    category: parseMemoryCategory(category),
    key: key ?? '',
  });
  return {
    message: `Disabled user-local memory item ${item.category}/${item.key}`,
    success: true,
    data: { item },
  };
}

async function executeMemoryDeleteCommand(
  activeRepositoryRoot: string,
  parsed: IUserLocalMemoryCommandArgs,
): Promise<ICommandResult> {
  const [category, key] = parsed.positional;
  const result = await deleteUserLocalMemoryItem({
    activeRepositoryRoot,
    category: parseMemoryCategory(category),
    key: key ?? '',
  });
  return {
    message: `Deleted user-local memory item ${result.category}/${result.key}`,
    success: true,
    data: { result },
  };
}

export async function executeMemoryCommand(
  cwd: string,
  parsed: IUserLocalMemoryCommandArgs,
): Promise<ICommandResult> {
  if ((parsed.action ?? 'list') === 'list') {
    return executeMemoryListCommand(cwd, parsed);
  }
  if (parsed.action === 'set') {
    return executeMemorySetCommand(cwd, parsed);
  }
  if (parsed.action === 'inspect') {
    return executeMemoryInspectCommand(cwd, parsed);
  }
  if (parsed.action === 'disable') {
    return executeMemoryDisableCommand(cwd, parsed);
  }
  if (parsed.action === 'delete') {
    return executeMemoryDeleteCommand(cwd, parsed);
  }
  return {
    message: USER_LOCAL_COMMAND_USAGE,
    success: false,
  };
}
