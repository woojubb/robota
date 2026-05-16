import type { TCapabilitySafety } from '../capabilities/types.js';
import type { ICommandResult } from './command-result.js';
import type { ICommandHostContext } from './host-context.js';
import type { ICommand } from './types.js';

export type TSystemCommandLifecycle = 'inline' | 'blocking' | 'background';

/** A user-visible command with descriptor metadata and execute logic. */
export interface ISystemCommand {
  name: string;
  description: string;
  modelInvocable?: boolean;
  userInvocable?: boolean;
  argumentHint?: string;
  safety?: TCapabilitySafety;
  subcommands?: readonly ICommand[];
  lifecycle?: TSystemCommandLifecycle;
  execute(context: ICommandHostContext, args: string): Promise<ICommandResult> | ICommandResult;
}
