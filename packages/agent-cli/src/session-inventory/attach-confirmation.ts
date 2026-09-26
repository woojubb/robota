/**
 * The yes that admits an attached terminal, asked on the attaching terminal itself.
 *
 * The session being attached to has no terminal and cannot ask anyone, so this question is the one
 * human decision in the path. It is read from the controlling terminal, not from standard input, so
 * piped input cannot answer it, and it names the session and the role so the answer is about exactly
 * that connection.
 */

import { openSecretTerminal } from '../devices/secret-terminal.js';
import { isYes, printable } from '../remote-control/operator-approval.js';

const NAME_MAX_CHARS = 80;

export interface IAttachConfirmation {
  readonly id: string;
  readonly name?: string;
  readonly mode: 'drive' | 'observe';
}

const ROLE: Readonly<Record<IAttachConfirmation['mode'], string>> = {
  drive: 'drive (send prompts, answer its questions)',
  observe: 'observe (read only)',
};

export function describeAttachConfirmation(question: IAttachConfirmation): string {
  const name = question.name === undefined ? '' : ` "${printable(question.name, NAME_MAX_CHARS)}"`;
  return [
    `Attach to supervised session${name} (${question.id}) to ${ROLE[question.mode]}.`,
    'Detaching leaves the session running.',
  ].join('\r\n');
}

/** Ask on the controlling terminal; no interactive terminal means no. */
export async function confirmAttachOnTerminal(question: IAttachConfirmation): Promise<boolean> {
  const terminal = openSecretTerminal();
  if (terminal === undefined) return false;
  try {
    return await terminal.run(async (io) => {
      io.write(`${describeAttachConfirmation(question)}\r\n`);
      return isYes(await io.readLine('Attach? Type yes to attach, anything else cancels: ', { echo: true }));
    });
  } catch {
    // Ctrl-C, Ctrl-D, or a terminal that went away: not a yes.
    return false;
  }
}
