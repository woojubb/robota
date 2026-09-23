import type { ISystemCommand } from '../command-api/index.js';
export type { ICommandResult, TCommandResultDataValue } from '../command-api/index.js';
export type {
  ISystemCommand,
  ISystemCommandSemanticRoles,
  TSystemCommandLifecycle,
  TSystemCommandSemanticRole,
} from '../command-api/index.js';

/** Built-in system commands. */
export function createSystemCommands(): ISystemCommand[] {
  return [];
}
