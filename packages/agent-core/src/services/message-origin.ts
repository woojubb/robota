/**
 * How a message's origin is shown to the MODEL.
 *
 * A peer session's message is stored with the peer's driver id in its metadata (display attribution,
 * never an authorization input). The transcript shows it; the provider request did not, so the model
 * read a peer's words as its own operator's. This module is the one place the outgoing request marks
 * them: a user message whose driver id starts with `peer:` is wrapped in `<peer_message from="…">`.
 *
 * The wrapper is generated from metadata only, and wrapper-shaped text inside any message body is
 * escaped first, so no text — operator's, peer's, or a tool's output — can forge or close one. It is
 * applied to the derived request array, never to the stored history, so the transcript keeps what was
 * sent and every later request (including after resume) derives the same marking again.
 */

import type { TUniversalMessage, TUniversalMessagePart } from '../interfaces/messages';

const PEER_DRIVER_PREFIX = 'peer:';
/** A peer id is printed only when it is a plain identifier; anything else is not echoed. */
const PRINTABLE_PEER_ID = /^peer:[A-Za-z0-9._:-]{1,128}$/;
const WRAPPER_MARKUP = /<(\/?)(peer_message)/gi;

/** Neutralize `<peer_message` / `</peer_message` so text can neither open nor close a wrapper. */
export function escapeOriginMarkup(text: string): string {
  return text.replace(WRAPPER_MARKUP, '&lt;$1$2');
}

/** The peer driver id a message is attributed to, or undefined for the operator's own. */
export function peerDriverOf(message: TUniversalMessage): string | undefined {
  if (message.role !== 'user') return undefined;
  const driverId = message.metadata?.driverId;
  return typeof driverId === 'string' && driverId.startsWith(PEER_DRIVER_PREFIX) ? driverId : undefined;
}

/** A peer driver id safe to print: the id itself when it is a plain identifier, otherwise a fixed marker. */
export function printablePeerDriver(driverId: string): string {
  return PRINTABLE_PEER_ID.test(driverId) ? driverId : 'peer:unverified';
}

/** Escape text parts, keeping each unchanged part's identity so callers can tell nothing changed. */
function escapeParts(parts: TUniversalMessagePart[]): TUniversalMessagePart[] {
  return parts.map((part) => {
    if (part.type !== 'text') return part;
    const text = escapeOriginMarkup(part.text);
    return text === part.text ? part : { ...part, text };
  });
}

function presentOne(message: TUniversalMessage): TUniversalMessage {
  if (message.role === 'tool') {
    const content = escapeOriginMarkup(message.content);
    const parts = message.parts ? escapeParts(message.parts) : undefined;
    const partsChanged = parts?.some((part, i) => part !== message.parts?.[i]) ?? false;
    if (content === message.content && !partsChanged) return message;
    return { ...message, content, ...(parts ? { parts } : {}) };
  }
  if (message.role !== 'user') return message;
  const peer = peerDriverOf(message);
  const body = escapeOriginMarkup(message.content);
  const parts = message.parts ? escapeParts(message.parts) : undefined;
  if (!peer) {
    const partsChanged = parts?.some((part, i) => part !== message.parts?.[i]) ?? false;
    if (body === message.content && !partsChanged) return message;
    return { ...message, content: body, ...(parts ? { parts } : {}) };
  }
  const open = `<peer_message from="${printablePeerDriver(peer)}">`;
  const close = '</peer_message>';
  return {
    ...message,
    content: `${open}\n${body}\n${close}`,
    ...(parts
      ? {
          parts: [
            { type: 'text' as const, text: open },
            ...parts,
            { type: 'text' as const, text: close },
          ],
        }
      : {}),
  };
}

/** The request-side view of a conversation: peer messages wrapped, wrapper-shaped text escaped. */
export function presentMessageOrigins(messages: readonly TUniversalMessage[]): TUniversalMessage[] {
  return messages.map(presentOne);
}
