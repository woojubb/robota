/**
 * Slash command handler for the Robota REPL.
 *
 * Commands: /help, /clear, /mode, /resume, /cost, /model, /exit
 *
 * handleSlashCommand returns { handled: boolean, exit?: boolean }.
 * When `handled` is false the caller should treat the input as a regular message.
 * When `exit` is true the REPL should terminate.
 */

import type { ITerminalOutput, TPermissionMode } from '../types.js';
import type { Session } from '../session.js';
import type { SessionStore } from '../session-store.js';

/** Return value from handleSlashCommand */
export interface ISlashCommandResult {
  /** Whether the input was recognised as a slash command */
  handled: boolean;
  /** Whether the REPL should exit after this command */
  exit?: boolean;
}

const VALID_MODES: TPermissionMode[] = ['plan', 'default', 'acceptEdits', 'bypassPermissions'];

const HELP_TEXT = `
Robota CLI — available commands:

  /help                     Show this help message
  /clear                    Clear conversation history
  /mode [mode]              Show or change permission mode
                            Modes: plan | default | acceptEdits | bypassPermissions
  /resume                   List saved sessions (use robota -r <id> to resume)
  /cost                     Show approximate token / message count for this session
  /model                    Show the current model
  /exit                     Exit the REPL (also: Ctrl+C, Ctrl+D)

Any other input is sent to the AI agent.
`.trim();

/**
 * Handle a slash command entered in the REPL.
 *
 * @param input        Raw line from the user (may or may not start with /)
 * @param session      Active Session instance
 * @param terminal     Terminal output for displaying results
 * @param sessionStore Optional store for listing/resuming sessions
 * @returns            { handled, exit? }
 */
export function handleSlashCommand(
  input: string,
  session: Session,
  terminal: ITerminalOutput,
  sessionStore?: SessionStore,
): ISlashCommandResult {
  const trimmed = input.trim();

  if (!trimmed.startsWith('/')) {
    return { handled: false };
  }

  const parts = trimmed.slice(1).split(/\s+/);
  const command = parts[0]?.toLowerCase() ?? '';
  const args = parts.slice(1);

  switch (command) {
    case 'help': {
      terminal.writeLine(HELP_TEXT);
      return { handled: true };
    }

    case 'clear': {
      session.clearHistory();
      terminal.writeLine('Conversation history cleared.');
      return { handled: true };
    }

    case 'mode': {
      if (args.length === 0) {
        terminal.writeLine(`Current permission mode: ${session.getPermissionMode()}`);
        return { handled: true };
      }

      const requested = args[0] as TPermissionMode;
      if (!VALID_MODES.includes(requested)) {
        terminal.writeError(`Unknown mode "${args[0]}". Valid modes: ${VALID_MODES.join(' | ')}`);
        return { handled: true };
      }

      session.setPermissionMode(requested);
      terminal.writeLine(`Permission mode set to: ${requested}`);
      return { handled: true };
    }

    case 'resume': {
      if (!sessionStore) {
        terminal.writeLine('No session store configured.');
        return { handled: true };
      }

      const sessions = sessionStore.list();
      if (sessions.length === 0) {
        terminal.writeLine('No saved sessions found.');
        return { handled: true };
      }

      terminal.writeLine('Saved sessions (most recent first):');
      for (const s of sessions) {
        const label = s.name ?? s.id;
        terminal.writeLine(`  ${label}  (${s.updatedAt})  cwd: ${s.cwd}`);
      }
      terminal.writeLine('\nUse: robota -r <id>  to resume a session.');
      return { handled: true };
    }

    case 'cost': {
      const count = session.getMessageCount();
      const historyLen = session.getHistory().length;
      terminal.writeLine(`Session: ${session.getSessionId()}`);
      terminal.writeLine(`  run() calls completed : ${count}`);
      terminal.writeLine(`  conversation messages : ${historyLen}`);
      terminal.writeLine('(Token cost tracking is not yet implemented.)');
      return { handled: true };
    }

    case 'model': {
      terminal.writeLine('(Model information is not exposed in the current API.)');
      return { handled: true };
    }

    case 'exit': {
      return { handled: true, exit: true };
    }

    default: {
      terminal.writeError(`Unknown command "/${command}". Type /help to see available commands.`);
      return { handled: true };
    }
  }
}
