/**
 * What of a model-invocable command the MODEL may run, and what it is told about it.
 *
 * A command is exposed to the model as one tool, but some commands mix read-only views with actions
 * only the user may take (`/mcp status` beside `/mcp approve`). Once any subcommand declares
 * `modelInvocable`, the command is an allowlist for the model: the bare command and the subcommands
 * declared `true`. Everything else is refused before the command runs — including an alias the
 * command accepts and a subcommand added later without the flag, which is why this is an allowlist
 * rather than a list of refusals.
 *
 * The same answer shapes the model-facing descriptor, so the model is never offered a subcommand it
 * would then be refused.
 */

import type { ICommandResult, ISystemCommand } from '../command-api/index.js';
import type { ICommand } from '../command-api/types.js';

type TGatedCommand = Pick<ISystemCommand, 'name' | 'subcommands'>;

/** Whether the command narrows the model to a subset of its subcommands. */
export function hasModelSubcommandGate(command: TGatedCommand): boolean {
  return (command.subcommands ?? []).some((sub) => sub.modelInvocable !== undefined);
}

/** The subcommands the model may run; every subcommand when the command declares no gate. */
export function modelInvocableSubcommands(command: TGatedCommand): readonly ICommand[] {
  const subcommands = command.subcommands ?? [];
  if (!hasModelSubcommandGate(command)) return subcommands;
  return subcommands.filter((sub) => sub.modelInvocable === true);
}

function firstToken(args: string): string {
  return (args.trim().split(/\s+/)[0] ?? '').toLowerCase();
}

/**
 * A refusal when `args` names something the model may not run under this command's gate;
 * `undefined` when there is nothing to refuse.
 */
export function refuseModelSubcommand(
  command: TGatedCommand,
  args: string,
): ICommandResult | undefined {
  if (!hasModelSubcommandGate(command)) return undefined;
  const token = firstToken(args);
  if (token === '') return undefined;
  const allowed = modelInvocableSubcommands(command).map((sub) => sub.name.toLowerCase());
  if (allowed.includes(token)) return undefined;
  const offered = allowed.length === 0 ? 'no arguments' : allowed.join(', ');
  return {
    success: false,
    message:
      `The model may not run \`${command.name} ${token}\`; only the user can. ` +
      `You may run \`${command.name}\` with: ${offered}. ` +
      `If the user needs to act, tell them the exact command to run.`,
  };
}

/** The argument grammar the model is shown: only what it may run. */
export function modelArgumentHint(
  command: Pick<ISystemCommand, 'name' | 'subcommands' | 'argumentHint'>,
): string | undefined {
  if (!hasModelSubcommandGate(command)) return command.argumentHint;
  const allowed = modelInvocableSubcommands(command);
  if (allowed.length === 0) return undefined;
  const alternatives = allowed
    .map((sub) => (sub.argumentHint ? `${sub.name} ${sub.argumentHint}` : sub.name))
    .join(' | ');
  return `[${alternatives}]`;
}

/** The description the model is shown: what, when and what it returns, plus its allowed subset. */
export function modelDescriptionOf(
  command: Pick<ISystemCommand, 'name' | 'subcommands' | 'description' | 'modelDescription'>,
): string {
  const base = (command.modelDescription ?? command.description).trim();
  if (!hasModelSubcommandGate(command)) return base;
  const allowed = modelInvocableSubcommands(command);
  if (allowed.length === 0) return `${base}\nRun it with no arguments.`;
  const lines = allowed.map((sub) => `- ${sub.name}: ${sub.description}`);
  return [base, `Subcommands you may run (bare \`${command.name}\` is also allowed):`, ...lines]
    .filter((line) => line.length > 0)
    .join('\n');
}
