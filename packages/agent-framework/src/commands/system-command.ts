import type { ISystemCommand } from '../command-api/index.js';
export { SystemCommandExecutor } from './system-command-executor.js';
export type { ICommandResult, TCommandResultDataValue } from '../command-api/index.js';
export type { ISystemCommand, TSystemCommandLifecycle } from '../command-api/index.js';

/** Built-in system commands. */
export function createSystemCommands(): ISystemCommand[] {
  return [];
}
