/**
 * The permission and ask prompts a `/submit` stream forwarded and that are still open, per session.
 *
 * The session emits a prompt once, when it is asked, so a client that comes later would never see
 * it; `GET /prompts` answers from here, and `POST /prompts/:id` refuses an id that is not here.
 *
 * Keyed by the session's id, the same key as the turn claim, and not by object identity: the session
 * factory may return a fresh wrapper per request, so the `agent-transport` registry (a WeakMap on the
 * session object) would never find the prompt a different request recorded.
 *
 * It learns only through the prompt-receiving stream's own subscriptions and never listens to the
 * session itself. A listener of its own would keep an unattended turn's prompt parked instead of
 * letting the session fail it closed. A session's entries go when that stream's claim is released.
 */

import type {
  IAskRequestEvent,
  IPermissionRequestEvent,
} from '@robota-sdk/agent-interface-session';

export type THttpPromptFrame =
  | { readonly type: 'permission_request'; readonly event: IPermissionRequestEvent }
  | { readonly type: 'ask_request'; readonly event: IAskRequestEvent };

export interface IHttpOpenPrompts {
  record(sessionKey: string, frame: THttpPromptFrame): void;
  forget(sessionKey: string, id: string): void;
  /** The session's open prompts, oldest first. */
  list(sessionKey: string): readonly THttpPromptFrame[];
  find(sessionKey: string, id: string): THttpPromptFrame | undefined;
  /** The stream that received the session's prompts has ended. */
  clear(sessionKey: string): void;
}

export function createHttpOpenPrompts(): IHttpOpenPrompts {
  const bySession = new Map<string, Map<string, THttpPromptFrame>>();

  return {
    record(sessionKey, frame) {
      let open = bySession.get(sessionKey);
      if (open === undefined) {
        open = new Map();
        bySession.set(sessionKey, open);
      }
      open.set(frame.event.id, frame);
    },
    forget(sessionKey, id) {
      bySession.get(sessionKey)?.delete(id);
    },
    list: (sessionKey) => [...(bySession.get(sessionKey)?.values() ?? [])],
    find: (sessionKey, id) => bySession.get(sessionKey)?.get(id),
    clear(sessionKey) {
      bySession.delete(sessionKey);
    },
  };
}
