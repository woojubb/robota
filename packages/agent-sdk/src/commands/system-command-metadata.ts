import type { TPermissionMode } from '@robota-sdk/agent-core';
import type { ICommand } from '../command-api/types.js';

export const VALID_MODES: readonly TPermissionMode[] = [
  'plan',
  'default',
  'acceptEdits',
  'bypassPermissions',
];
export const MEMORY_COMMAND_DESCRIPTION =
  'Project memory command. Use it to inspect project memory when stored context may help, save durable preferences, project conventions, feedback, or references worth reusing across sessions, review pending candidates, and report memory provenance. Do not store secrets, credentials, or transient facts.';
export const MEMORY_COMMAND_ARGUMENT_HINT =
  'list | show [topic] | add <user|feedback|project|reference> <topic> <text> | pending | approve <id> | reject <id> | used';

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
