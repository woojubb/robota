/**
 * How this session decides on a file another session sends, whichever carrier brought it: its name
 * must be keepable, the operator must say yes to this one file, and only then is anywhere opened to
 * write it. The operator is then told its name, size and hash, never its content.
 */

import path from 'node:path';

import { openQuarantineSink, quarantineTarget } from './quarantine.js';

import type { ConnectionAuthority } from '@robota-sdk/agent-interface-session-mobility';
import type {
  IReceiveFileOptions,
  TFileReceiveOutcome,
  TFileTransferRefusal,
} from '@robota-sdk/agent-transport/node';

/** A refusal said as a sentence, for the operator of either side. */
export function describeFileRefusal(reason: TFileTransferRefusal, detail?: string): string {
  const said: Record<TFileTransferRefusal, string> = {
    declined: 'the receiving side did not accept it',
    'too-large': 'it is over the size limit',
    'bad-name': 'its name cannot be used',
    exists: 'a file of that name was already received',
    'unsafe-path': 'the receiving directory is not safe to write',
    integrity: 'the content did not match what was offered, so it was discarded',
    protocol: 'the other side broke the transfer protocol',
    closed: 'the connection ended first',
    timeout: 'the other side stopped answering',
    unavailable: 'it could not be read or stored',
  };
  return detail !== undefined ? `${said[reason]} (${detail})` : said[reason];
}

export interface IFileReceivingOptions {
  /** `~/.robota` of this session's `HOME`; received files are kept under it. */
  readonly root: string;
  /** Names the sender's quarantine directory. */
  readonly senderId: string;
  /** The connection's authority: it asks the operator about every file. */
  readonly authority: ConnectionAuthority;
  readonly maxBytes?: number;
}

/** The receiving half of the carrier, for one sender. */
export function fileReceiving(
  options: IFileReceivingOptions,
): Omit<IReceiveFileOptions, 'channel'> {
  return {
    ...(options.maxBytes !== undefined ? { maxBytes: options.maxBytes } : {}),
    admit: async (offer, signal) => {
      const target = await quarantineTarget({
        root: options.root,
        senderId: options.senderId,
        name: offer.name,
      });
      if (!('ok' in target)) return target;
      const decision = await options.authority.authorizeFile(
        { name: target.name, size: offer.size, sha256: offer.sha256 },
        signal,
      );
      if (!decision.allowed) return { refused: 'declined', detail: decision.reason };
      return { sink: await openQuarantineSink(target) };
    },
  };
}

/** What the operator is told about a file `from` sent: its name, size and hash, never its content. */
export function describeReceived(from: string, outcome: TFileReceiveOutcome): string {
  if (outcome.ok) {
    // The name it was kept under, never the one the sender wrote.
    return (
      `[peers] file received from ${from}: ${path.basename(outcome.location)}, ` +
      `${outcome.offer.size} bytes, ` +
      `sha256 ${outcome.offer.sha256} — kept at ${outcome.location}`
    );
  }
  return `[peers] a file from ${from} was not kept: ${describeFileRefusal(outcome.reason, outcome.detail)}.`;
}
