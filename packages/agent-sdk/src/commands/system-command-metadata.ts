import type { TPermissionMode } from '@robota-sdk/agent-core';
import { CLAUDE_MODELS, formatTokenCount } from '@robota-sdk/agent-core';
import type { ICommandHostContext } from '../command-api/index.js';
import type { ICommand } from '../command-api/types.js';

export const VALID_MODES: readonly TPermissionMode[] = [
  'plan',
  'default',
  'acceptEdits',
  'bypassPermissions',
];
export const PERCENT = 100;
export const MEMORY_COMMAND_DESCRIPTION =
  'Project memory command. Use it to inspect project memory when stored context may help, save durable preferences, project conventions, feedback, or references worth reusing across sessions, review pending candidates, and report memory provenance. Do not store secrets, credentials, or transient facts.';
export const MEMORY_COMMAND_ARGUMENT_HINT =
  'list | show [topic] | add <user|feedback|project|reference> <topic> <text> | pending | approve <id> | reject <id> | used';

const DEFAULT_AUTO_COMPACT_THRESHOLD = 0.835;

export function buildModelSubcommands(): ICommand[] {
  const seen = new Set<string>();
  const commands: ICommand[] = [];
  for (const model of Object.values(CLAUDE_MODELS)) {
    if (seen.has(model.name)) continue;
    seen.add(model.name);
    commands.push({
      name: model.id,
      description: `${model.name} (${formatTokenCount(model.contextWindow).toUpperCase()})`,
      source: 'builtin',
    });
  }
  return commands;
}

export function buildBackgroundSubcommands(): ICommand[] {
  return [
    { name: 'list', description: 'List background tasks', source: 'builtin' },
    { name: 'read', description: 'Read a background task log page', source: 'builtin' },
    { name: 'cancel', description: 'Cancel a running background task', source: 'builtin' },
    { name: 'close', description: 'Dismiss a terminal background task', source: 'builtin' },
  ];
}

export function buildRewindSubcommands(): ICommand[] {
  return [
    { name: 'list', description: 'List edit checkpoints', source: 'builtin' },
    { name: 'restore', description: 'Restore code to a checkpoint', source: 'builtin' },
    { name: 'code', description: 'Restore code to a checkpoint', source: 'builtin' },
    { name: 'rollback', description: 'Rollback code through a checkpoint', source: 'builtin' },
  ];
}

export function buildMemorySubcommands(): ICommand[] {
  return [
    { name: 'list', description: 'List project memory topics', source: 'builtin' },
    { name: 'show', description: 'Show project memory index or a topic', source: 'builtin' },
    { name: 'add', description: 'Save durable project memory', source: 'builtin' },
    { name: 'pending', description: 'List pending memory candidates', source: 'builtin' },
    { name: 'approve', description: 'Approve a pending memory candidate', source: 'builtin' },
    { name: 'reject', description: 'Reject a pending memory candidate', source: 'builtin' },
    {
      name: 'used',
      description: 'Show memory references used in the current turn',
      source: 'builtin',
    },
  ];
}

export function getAutoCompactThreshold(session: ICommandHostContext): number | false {
  return session.getSession().getAutoCompactThreshold?.() ?? DEFAULT_AUTO_COMPACT_THRESHOLD;
}
