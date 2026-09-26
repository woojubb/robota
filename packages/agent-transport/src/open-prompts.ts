/**
 * #3189: the permission and ask prompts a session has open, as the frames that asked them.
 *
 * The session keeps only the promise each prompt waits on, and emits the prompt once, when it is
 * asked. A client that attaches later would never see a prompt already open. This keeps what the
 * transport forwarded, per session, for a `get-prompts` reply.
 *
 * It is held by the connections that receive prompts and learns everything through their own
 * subscriptions, so it never listens to the session itself. That matters: a session asks only while
 * someone listens for prompts, and a listener of its own here would keep an unattended session's
 * prompt open instead of failing it closed. When the last such connection goes, the session settles
 * every open prompt, so nothing is kept.
 */

import type { IProtocolSession } from './protocol-session.js';
import type { TServerMessage } from './wire-messages.js';

export type TOpenPromptFrame = Extract<
  TServerMessage,
  { type: 'permission_request' | 'ask_request' }
>;

interface IOpenPrompts {
  readonly frames: Map<string, TOpenPromptFrame>;
  holders: number;
}

const openPromptsBySession = new WeakMap<IProtocolSession, IOpenPrompts>();

/** One connection's hold on its session's open prompts; every holder reports what it forwards. */
export interface IOpenPromptsHold {
  /** A prompt was asked. */
  record(frame: TOpenPromptFrame): void;
  /** A prompt was settled, by an answer or by the session. */
  forget(id: string): void;
  /** The host made another session current; the previous session's prompts are settled. */
  clear(): void;
  /** This connection no longer receives prompts. */
  release(): void;
}

/** Called by a connection that receives prompts, before it subscribes to them. */
export function holdOpenPrompts(session: IProtocolSession): IOpenPromptsHold {
  let open = openPromptsBySession.get(session);
  if (open === undefined) {
    open = { frames: new Map(), holders: 0 };
    openPromptsBySession.set(session, open);
  }
  const held = open;
  held.holders += 1;
  let released = false;
  return {
    record: (frame) => {
      if (!released) held.frames.set(frame.event.id, frame);
    },
    forget: (id) => {
      held.frames.delete(id);
    },
    clear: () => {
      held.frames.clear();
    },
    release: () => {
      if (released) return;
      released = true;
      held.holders -= 1;
      if (held.holders === 0 && openPromptsBySession.get(session) === held) {
        openPromptsBySession.delete(session);
      }
    },
  };
}

/** The prompts open now, oldest first; none when no connection that receives prompts is attached. */
export function listOpenPrompts(session: IProtocolSession): readonly TOpenPromptFrame[] {
  return [...(openPromptsBySession.get(session)?.frames.values() ?? [])];
}
