/**
 * Pure prompt-state derivation for the web UI (REMOTE-009 Step 4 / REMOTE-007 render+answer).
 *
 * The paired browser is the session OWNER (local == remote), so it must render and ANSWER the owner's own
 * permission/ask prompts. The server carries `permission_request`/`ask_request` (a prompt appears) and
 * `prompt_resolved` (it was answered — by this or a co-driving surface — and must dismiss). The answer travels
 * back as `permission-response`/`ask-response`. This module is the pure list-transition + message-builder logic,
 * consumed by `useWsSession` and shared unchanged by BOTH the WS and RTC session clients (same `TServerMessage`s).
 */

import type {
  IAskRequestEvent,
  IPermissionRequestEvent,
  TActionResponse,
  TPermissionResultValue,
} from '@robota-sdk/agent-interface-transport';
import type { TClientMessage, TServerMessage } from '@robota-sdk/agent-transport-protocol';

/** A prompt awaiting the owner's answer, rendered by the UI (built from the server event payloads). */
export type TPendingPrompt =
  | ({ readonly kind: 'permission' } & IPermissionRequestEvent)
  | ({ readonly kind: 'ask' } & IAskRequestEvent);

/**
 * Fold a server message into the pending-prompt list: append on `permission_request`/`ask_request`, remove on
 * `prompt_resolved`. Any other message returns the list unchanged (referential-equality preserved). Duplicate
 * ids are not re-appended (idempotent against a resend).
 */
export function applyPromptEvent(
  prompts: readonly TPendingPrompt[],
  msg: TServerMessage,
): readonly TPendingPrompt[] {
  switch (msg.type) {
    case 'permission_request': {
      // REMOTE-014 E5: keep requesterDriverId so the surface can show WHICH driver's turn raised the prompt.
      const { id, toolName, toolArgs, requesterDriverId } = msg.event;
      if (prompts.some((p) => p.id === id)) return prompts;
      return [
        ...prompts,
        {
          kind: 'permission',
          id,
          toolName,
          toolArgs,
          ...(requesterDriverId ? { requesterDriverId } : {}),
        },
      ];
    }
    case 'ask_request': {
      const { id, request, requesterDriverId } = msg.event;
      if (prompts.some((p) => p.id === id)) return prompts;
      return [
        ...prompts,
        { kind: 'ask', id, request, ...(requesterDriverId ? { requesterDriverId } : {}) },
      ];
    }
    case 'prompt_resolved': {
      const { id } = msg.event;
      const next = prompts.filter((p) => p.id !== id);
      return next.length === prompts.length ? prompts : next;
    }
    default:
      return prompts;
  }
}

/** Build the client message that answers a permission prompt. */
export function permissionResponse(id: string, result: TPermissionResultValue): TClientMessage {
  return { type: 'permission-response', id, result };
}

/** Build the client message that answers an ask prompt. */
export function askResponse(id: string, response: TActionResponse): TClientMessage {
  return { type: 'ask-response', id, response };
}
