/**
 * The operator of this session, asked on this machine's own terminal.
 *
 * Not through the session's prompts: any surface attached to the session may answer those, so a
 * device already driving could approve the next one. The question is asked on the controlling
 * terminal opened for this path alone (the same one the recovery phrase uses), while the session has
 * handed the terminal over — so only someone at this machine can answer it.
 *
 * Without an interactive terminal the answer is no, and nothing waits on anybody.
 */

import { openSecretTerminal, type ISecretTerminalSession } from '../devices/secret-terminal.js';

import type {
  ICapabilityApprovalRequest,
  IOperatorApprover,
} from '@robota-sdk/agent-interface-session-mobility';

/** The part of the live session that can hand its terminal over. */
export interface ITerminalHandoffHost {
  canHandoffTerminal(): boolean;
  runWithTerminal<T>(fn: () => Promise<T>): Promise<T>;
}

export interface ITerminalOperatorApproverOptions {
  /** The live session, or `undefined` before there is one. */
  readonly getHost: () => ITerminalHandoffHost | undefined;
  /** Defaults to the process's controlling terminal. */
  readonly openTerminal?: () => ISecretTerminalSession | undefined;
}

const SUMMARY_MAX_CHARS = 200;
const FILE_SUMMARY_MAX_CHARS = 400;
const SHORT_ID_CHARS = 16;

/**
 * Peer-supplied text made safe to put on a terminal: no control characters (so no escape sequence
 * can repaint the question or forge an answer), no invisible or direction-changing characters (so
 * the text cannot hide or reorder itself), one line, bounded.
 */
export function printable(text: string, max: number): string {
  const flat = text
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069\ufeff]+/g, ' ')
    .trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

const WHAT: Readonly<Record<ICapabilityApprovalRequest['capability'], string>> = {
  drive: 'drive this session (send prompts and commands, answer its questions)',
  observe: 'observe this session (read its conversation as it happens)',
  delegate: 'have this session run a task',
  file: 'send this session a file (kept aside unopened; nothing runs it)',
  handoff: 'hand a session over to this machine',
  message: 'message this session',
  presence: 'see that this session is running',
};

function describe(request: ICapabilityApprovalRequest): string {
  const who = request.deviceId
    ? `Device ${printable(request.deviceId, SHORT_ID_CHARS)}`
    : 'A paired device';
  const where = request.locality === 'same-host' ? 'on this machine' : 'on another machine';
  const lines = [`${who} (${where}) wants to ${WHAT[request.capability]}.`];
  if (request.summary !== undefined) {
    // A file's line carries its whole hash, and a session's what taking it means; both get the room.
    const [label, max] =
      request.capability === 'file'
        ? ['File', FILE_SUMMARY_MAX_CHARS]
        : request.capability === 'handoff'
          ? ['Session', FILE_SUMMARY_MAX_CHARS]
          : ['Task', SUMMARY_MAX_CHARS];
    lines.push(`${label}: ${printable(request.summary, max)}`);
  }
  lines.push(
    request.scope === 'connection'
      ? 'This answer covers this connection only.'
      : 'This answer covers this request only.',
  );
  return lines.join('\r\n');
}

export function isYes(answer: string): boolean {
  const normalized = answer.trim().toLowerCase();
  return normalized === 'y' || normalized === 'yes';
}

export function createTerminalOperatorApprover(
  options: ITerminalOperatorApproverOptions,
): IOperatorApprover {
  const openTerminal = options.openTerminal ?? (() => openSecretTerminal());
  // One question at a time: the terminal is one person's, and two prompts would interleave.
  let queue: Promise<unknown> = Promise.resolve();

  // A question withdrawn — the peer went away — is never asked, or stops being asked.
  const ask = async (
    request: ICapabilityApprovalRequest,
    signal: AbortSignal | undefined,
  ): Promise<boolean> => {
    if (signal?.aborted === true) return false;
    const host = options.getHost();
    if (host === undefined || !host.canHandoffTerminal()) return false;
    return host.runWithTerminal(async () => {
      if (signal?.aborted === true) return false;
      const terminal = openTerminal();
      if (terminal === undefined) return false;
      return terminal.run(async (io) => {
        io.write(`${describe(request)}\r\n`);
        const answer = await io.readLine('Allow? Type yes to allow, anything else refuses: ', {
          echo: true,
          ...(signal ? { signal } : {}),
        });
        return isYes(answer) && signal?.aborted !== true;
      });
    });
  };

  return {
    approve(request, signal) {
      const answer = queue.then(() => ask(request, signal));
      queue = answer.catch(() => undefined);
      return answer.catch(() => false);
    },
  };
}
