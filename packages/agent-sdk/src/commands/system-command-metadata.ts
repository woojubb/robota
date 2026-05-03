import type { ICommand } from '../command-api/types.js';

export function buildBackgroundSubcommands(): ICommand[] {
  return [
    { name: 'list', description: 'List background tasks', source: 'builtin' },
    { name: 'read', description: 'Read a background task log page', source: 'builtin' },
    { name: 'cancel', description: 'Cancel a running background task', source: 'builtin' },
    { name: 'close', description: 'Dismiss a terminal background task', source: 'builtin' },
  ];
}
