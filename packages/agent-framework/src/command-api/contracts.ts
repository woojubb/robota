import type { TCapabilitySafety } from '../capabilities/types.js';
import type { ICommandResult } from './command-result.js';
import type { ICommandHostContext } from './host-context.js';
import type { ICommand } from './types.js';

export type TSystemCommandLifecycle = 'inline' | 'blocking' | 'background';

/** A user-visible command with descriptor metadata and execute logic. */
export interface ISystemCommand {
  name: string;
  /** User-friendly display label (e.g., "Interaction Mode"). Falls back to `name` if not set. */
  displayName?: string;
  description: string;
  modelInvocable?: boolean;
  userInvocable?: boolean;
  argumentHint?: string;
  safety?: TCapabilitySafety;
  subcommands?: readonly ICommand[];
  lifecycle?: TSystemCommandLifecycle;
  /**
   * Whether executing this command requires explicit user permission/confirmation.
   * - `false`: runs immediately without any approval gate
   * - `true`: user confirmation is required before execution
   * - `undefined` (default): derived from `safety` — `'read-only'` → false, others → true
   */
  requiresPermission?: boolean;
  execute(context: ICommandHostContext, args: string): Promise<ICommandResult> | ICommandResult;
}
