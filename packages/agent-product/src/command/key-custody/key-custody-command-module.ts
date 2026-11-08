/**
 * `/unlock` and `/lock` — open and drop the keys of secure conversations in this process.
 *
 * Credential actions, so they are the person's at this terminal and no one else's: neither is
 * model-invocable, and each refuses any invocation that is not the operator's own (the model, a
 * remote surface), as `/devices` does. `/unlock` reads the passphrase inside the terminal handoff, so
 * what is typed goes to the host's secret terminal and never through the session's input, prompt
 * history or conversation; without an interactive terminal it refuses rather than ask anywhere else.
 * The host registers the module only where it holds keys, so with secure mode off neither exists.
 */
import { createSystemCommandFromEntry } from '../command-module-utils.js';

import type { IKeyCustodyCommandPort, IUnlockResult } from './key-custody-command-port.js';
import type { ICommandHostContext, ICommandModule } from '@robota-sdk/agent-framework';
import type { ICommand, ICommandResult, ICommandSource } from '@robota-sdk/agent-interface/command';

const UNLOCK_DESCRIPTION =
  'Unlock secure conversations: type your passphrase at this terminal to read sealed sessions in this process';
const LOCK_DESCRIPTION =
  'Lock secure conversations now: sealed sessions cannot be read again until /unlock';

function createUnlockCommandEntry(): ICommand {
  return {
    name: 'unlock',
    displayName: 'Unlock',
    description: UNLOCK_DESCRIPTION,
    source: 'key-custody',
    // User-only: a credential action, typed by the person at this terminal.
    modelInvocable: false,
    userInvocable: true,
  };
}

function createLockCommandEntry(): ICommand {
  return {
    name: 'lock',
    displayName: 'Lock',
    description: LOCK_DESCRIPTION,
    source: 'key-custody',
    // User-only: when the keys close is the person's decision, beside its counterpart.
    modelInvocable: false,
    userInvocable: true,
  };
}

/** Why a command refused to run for this invocation; said the same way for both commands. */
function notTheOperator(name: string): ICommandResult {
  return {
    success: false,
    message: `\`/${name}\` runs only for the person at this terminal, never for the model or a remote surface.`,
  };
}

function withNotices(message: string, result: IUnlockResult): string {
  return [message, ...result.notices].join('\n');
}

export async function executeUnlockCommand(
  port: IKeyCustodyCommandPort,
  context: ICommandHostContext,
): Promise<ICommandResult> {
  if (context.getCommandInvocationSource() !== 'user') return notTheOperator('unlock');
  if (port.isUnlocked()) {
    return { success: true, message: 'Already unlocked: sealed sessions can be read here.' };
  }
  if (!context.canHandoffTerminal()) {
    return {
      success: false,
      message:
        '`/unlock` needs this interactive terminal: the passphrase is typed there and nowhere else.',
    };
  }
  let result: IUnlockResult;
  try {
    result = await context.runWithTerminal(() => port.unlock());
  } catch (error) {
    return {
      success: false,
      message: `Not unlocked: ${error instanceof Error ? error.message : 'the terminal could not be handed over'}.`,
    };
  }
  switch (result.outcome) {
    case 'unlocked':
      return {
        success: true,
        message: withNotices(
          'Unlocked: sealed sessions can be read in this process until it locks (`/lock`).',
          result,
        ),
      };
    case 'declined':
      return {
        success: false,
        message: withNotices('Not unlocked; the keys stay locked.', result),
      };
    default:
      return {
        success: false,
        message: withNotices(
          'Not unlocked: this terminal could not take a passphrase, so the keys stay locked.',
          result,
        ),
      };
  }
}

export function executeLockCommand(
  port: IKeyCustodyCommandPort,
  context: ICommandHostContext,
): ICommandResult {
  if (context.getCommandInvocationSource() !== 'user') return notTheOperator('lock');
  if (!port.isUnlocked()) return { success: true, message: 'Already locked.' };
  port.lock();
  return {
    success: true,
    message:
      'Locked: new conversations are still sealed as you go; `/unlock` reads sealed sessions again.',
  };
}

export class KeyCustodyCommandSource implements ICommandSource {
  readonly name = 'key-custody';

  getCommands(): ICommand[] {
    return [createUnlockCommandEntry(), createLockCommandEntry()];
  }
}

export function createKeyCustodyCommandModule(port: IKeyCustodyCommandPort): ICommandModule {
  return {
    name: 'agent-command-key-custody',
    commandSources: [new KeyCustodyCommandSource()],
    systemCommands: [
      createSystemCommandFromEntry(createUnlockCommandEntry(), {
        requiresPermission: false,
        lifecycle: 'inline',
        execute: (context) => executeUnlockCommand(port, context),
      }),
      createSystemCommandFromEntry(createLockCommandEntry(), {
        requiresPermission: false,
        lifecycle: 'inline',
        execute: (context) => executeLockCommand(port, context),
      }),
    ],
  };
}
