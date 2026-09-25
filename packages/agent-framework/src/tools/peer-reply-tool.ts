/**
 * `peer_reply` — how the model answers the agent session that drove the current turn.
 *
 * The model chooses only the text. Where it goes and what it answers are the turn's own facts, set
 * by the host that admitted the incoming message: a reply goes to that message's sender and names
 * that message, so the model cannot address another session or thread into another conversation.
 *
 * Whether it may go out at all is the permission policy's decision, like any tool's: the tool is
 * offered only in a peer turn, and after the turn used another tool the operator reads the full text
 * first. The loop limits belong to the carrier, which sees every conversation this session is in.
 */

import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import { z } from 'zod';

// Defining a tool and telling the permission system what it does arrive together.
import './tool-permission-profiles.js';

import type { ILocalPeerSendResult } from '../command-api/host-adapters.js';
import type { IToolWithEventService } from '@robota-sdk/agent-core';
import type { IPeerTurnContext } from '@robota-sdk/agent-interface-session';

export const PEER_REPLY_TOOL_NAME = 'peer_reply';

/** Hand a reply to the carrier. Answers with a delivery state rather than throwing. */
export type TPeerReplySend = (
  targetSessionId: string,
  text: string,
  options: { readonly inReplyTo: string },
) => Promise<ILocalPeerSendResult>;

/** What the tool needs from its session: the turn it answers, and a way to reach its sender. */
export interface IPeerReplyPort {
  /** The peer turn in progress, or undefined outside one. */
  activeTurn(): IPeerTurnContext | undefined;
  /** Undefined while this session cannot address other sessions. */
  sender(): TPeerReplySend | undefined;
}

const peerReplySchema = z.object({
  text: z
    .string()
    .min(1)
    .describe('The full text of the answer to send to the session that asked.'),
});

export function createPeerReplyTool(port: IPeerReplyPort): IToolWithEventService {
  return createZodFunctionTool(
    PEER_REPLY_TOOL_NAME,
    'Send an answer to the other agent session whose message started this turn. Available only ' +
      'while answering such a message; the answer goes to that session and nowhere else. Your ' +
      'final text is not sent to it — call this to reply. Returns whether it was delivered.',
    peerReplySchema,
    async ({ text }) => {
      const turn = port.activeTurn();
      if (turn === undefined) {
        throw new Error(
          'There is no session to reply to: this turn was not sent by another session.',
        );
      }
      const send = port.sender();
      if (send === undefined) {
        throw new Error('This session cannot reach other sessions; the reply was not sent.');
      }
      const result = await send(turn.replyTo, text, { inReplyTo: turn.messageId });
      if (result.state === 'refused' || result.state === 'failed') {
        throw new Error(`The reply was not delivered: ${result.reason ?? result.state}`);
      }
      return { delivered: true, state: result.state };
    },
  ) as unknown as IToolWithEventService;
}
