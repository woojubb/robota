/**
 * `peer_send_file` — how the model sends a file to another of the operator's live sessions.
 *
 * Every call asks the operator, showing the file's path, size and hash and the session it would go
 * to, and nothing is sent without their yes to that one file. No mode, rule or earlier answer stands
 * in for it: a file can carry what a message cannot, and the model may have been steered by something
 * it read. The host decides which files the model may name at all — inside the workspace, and not
 * one that looks like it holds secrets; the operator's own `/peers send-file` is the way to send
 * anything else.
 *
 * A turn started by another session's message cannot send files: the tool is not offered there, and
 * refuses if called. A peer asks; it does not get to make this session hand over its files.
 */

import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

// Defining a tool and telling the permission system what it does arrive together.
import './tool-permission-profiles.js';

import type { ICommandLocalPeersAdapter } from '../command-api/host-adapters.js';
import type { IToolWithEventService } from '@robota-sdk/agent-core';
import type { IPeerTurnContext } from '@robota-sdk/agent-interface-session';

export const PEER_SEND_FILE_TOOL_NAME = 'peer_send_file';

/** The host's preparation of a file for sending, as the port hands it over. */
type TPrepareFile = NonNullable<ICommandLocalPeersAdapter['prepareFile']>;

/** What the operator is shown before a file goes. */
export interface IPeerSendFileQuestion {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  /** The session it would go to. */
  readonly to: string;
}

/** What the tool needs from its session. */
export interface IPeerSendFilePort {
  /** The peer turn in progress, or undefined outside one. */
  activeTurn(): IPeerTurnContext | undefined;
  /** Undefined while this session cannot send files to other sessions. */
  prepare(): TPrepareFile | undefined;
  /** The session's working directory: where a relative path starts, and the workspace. */
  cwd(): string;
  /** Ask the operator about this one file. Resolves true only on their explicit yes. */
  confirm(question: IPeerSendFileQuestion): Promise<boolean>;
}

const peerSendFileSchema = z.object({
  session: z
    .string()
    .min(1)
    .describe('The id of the other live session on this host that should receive the file.'),
  path: z
    .string()
    .min(1)
    .describe('The file to send: a path inside the workspace, absolute or relative to it.'),
});

export function createPeerSendFileTool(port: IPeerSendFilePort): IToolWithEventService {
  return createZodFunctionTool(
    PEER_SEND_FILE_TOOL_NAME,
    'Send a copy of one file from the workspace to another live session of the same user on this ' +
      'host, when the user asks for a file to be shared with that session. The user is asked to ' +
      'approve every file, seeing its path, size and destination; the other session keeps the copy ' +
      'aside and its user decides whether to open it. Files outside the workspace, and files that ' +
      'look like they hold secrets, cannot be sent this way. Not available while answering a ' +
      'message from another session. Returns whether the other session kept the file, with its ' +
      'size and sha256.',
    peerSendFileSchema,
    async ({ session, path }) => {
      if (port.activeTurn() !== undefined) {
        throw new Error(
          'A turn started by another session cannot send files. Nothing was sent; the user can ' +
            'send it with /peers send-file.',
        );
      }
      const prepare = port.prepare();
      if (prepare === undefined) {
        throw new Error('This session cannot send files to other sessions; nothing was sent.');
      }
      const prepared = await prepare(session, path, { origin: 'model', cwd: port.cwd() });
      if (!prepared.ok) throw new Error(`The file was not sent: ${prepared.reason}`);
      const { file } = prepared;
      const yes = await port.confirm({
        path: file.path,
        size: file.size,
        sha256: file.sha256,
        to: session,
      });
      if (!yes) throw new Error('The user did not allow sending this file; nothing was sent.');
      const result = await file.send();
      if (result.state === 'refused' || result.state === 'failed') {
        throw new Error(`The file was not delivered: ${result.reason ?? result.state}`);
      }
      return { delivered: true, path: file.path, size: file.size, sha256: file.sha256 };
    },
  ) as unknown as IToolWithEventService;
}
