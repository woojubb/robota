import type { ICommand, ICommandResult } from '@robota-sdk/agent-interface-command';
import type { ICommandHostContext, ISystemCommand } from '@robota-sdk/agent-framework';

/** Build executable metadata from the palette entry so user and model views cannot drift. */
export function createSystemCommandFromEntry(
  entry: ICommand,
  behavior: {
    lifecycle: NonNullable<ISystemCommand['lifecycle']>;
    requiresPermission: boolean;
    execute: (context: ICommandHostContext, args: string) => ICommandResult | Promise<ICommandResult>;
    semanticRole?: ISystemCommand['semanticRole'];
  },
): ISystemCommand {
  return {
    name: entry.name,
    ...(entry.displayName !== undefined ? { displayName: entry.displayName } : {}),
    description: entry.description,
    ...(entry.example !== undefined ? { example: entry.example } : {}),
    ...(entry.modelInvocable !== undefined ? { modelInvocable: entry.modelInvocable } : {}),
    ...(entry.userInvocable !== undefined ? { userInvocable: entry.userInvocable } : {}),
    ...(entry.argumentHint !== undefined ? { argumentHint: entry.argumentHint } : {}),
    ...(entry.safety !== undefined ? { safety: entry.safety } : {}),
    ...(entry.subcommands !== undefined ? { subcommands: entry.subcommands } : {}),
    ...(behavior.semanticRole !== undefined ? { semanticRole: behavior.semanticRole } : {}),
    lifecycle: behavior.lifecycle,
    requiresPermission: behavior.requiresPermission,
    execute: behavior.execute,
  };
}
