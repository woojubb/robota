import { OWNER_DRIVER_ID } from '@robota-sdk/agent-interface-session';

import type { ISessionCommands } from '@robota-sdk/agent-interface-session';

/** The session roles the command port uses; a full interactive session satisfies it. */
export interface IAcpCommandSession extends Pick<ISessionCommands, 'executeCommand'> {
  on(event: 'complete', handler: (result: { response: string }) => void): void;
  off(event: 'complete', handler: (result: { response: string }) => void): void;
}

/**
 * Runs the `/command` an editor typed as a prompt and returns the text to show.
 *
 * Editor input reaches the session as a transport-origin command (`'remote'`), so a host's remote
 * command policy applies to it exactly as it does to a WebSocket client; the editor is a child of
 * this process on this machine, so it is local.
 */
export async function runAcpSlashCommand(
  session: IAcpCommandSession,
  text: string,
  signal: AbortSignal,
): Promise<string> {
  signal.throwIfAborted();
  const [name = '', ...args] = text.trimStart().slice(1).split(/\s+/);
  if (name === '') return 'Type a command name after "/".';
  // A skill command runs a model turn and answers with an empty message; its reply arrives as the turn's result.
  let turnReply = '';
  const onComplete = (result: { response: string }): void => {
    turnReply = result.response;
  };
  session.on('complete', onComplete);
  try {
    // The prompt's signal reaches the turn a skill starts, so `session/cancel` stops it even while
    // the skill is still being prepared and no turn exists for `abort()` to reach.
    const result = await session.executeCommand(
      name,
      args.join(' '),
      'remote',
      OWNER_DRIVER_ID,
      'local',
      { signal },
    );
    if (result === null) return `Unknown command "/${name}".`;
    return result.data?.['sessionExecution'] === true ? turnReply : result.message;
  } finally {
    session.off('complete', onComplete);
  }
}
