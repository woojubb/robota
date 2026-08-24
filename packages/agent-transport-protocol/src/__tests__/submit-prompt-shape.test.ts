/**
 * TRANS-008 (issue #2045) — a `submit` prompt that is not a string must not reach the session.
 *
 * `parseClientMessage` does `JSON.parse(data) as TClientMessage`, and the only guard in the submit
 * handler is `if (!msg.prompt)`. That is a FALSY check, not a type check: `{}`, `[]` and `42` are
 * truthy, so they pass it and reach `session.submit(input: string)`.
 *
 * Why this one field and not the other thirteen with payloads: the value does not stop at the
 * session. `interactive-session-execution-controller.ts:249` does
 * `emit('user_message', displayInput ?? input)`, `ws-session-events.ts` classifies `user_message` as
 * `'forwarded'` and delivers `{ type: 'user_message', content, … }` — declared `content: string` —
 * to EVERY attached client, not only the sender. Both client cast sites (`ws-session-client.ts:66`,
 * `rtc-responder-gate.ts:118`) accept it with `as TServerMessage`, so nothing on the receiving side
 * rejects it either.
 *
 * So one unguarded field lets a client put a shape-invalid value into a typed frame delivered to its
 * peers. The permission and resume paths were measured too and do NOT cross that way: `interpretApproval`
 * compares by strict equality against a closed set and defaults to deny, and a malformed `ack`/`resume`
 * seq degrades only the sender's own attachment.
 */

import { describe, expect, it, vi } from 'vitest';
import { createTestInteractiveSession } from '@robota-sdk/agent-interface-session/testing';

import { createOutboundDelivery } from '../outbound-delivery.js';
import { createWsHandler } from '../ws-handler.js';

import type { TServerMessage } from '../ws-protocol.js';

function setup() {
  const submit = vi.fn().mockResolvedValue({ turnId: 't1', completed: Promise.resolve() });
  // The published conformant double, not a cast: a hand-rolled object asserted to be an
  // `IInteractiveSession` is a partial re-implementation nothing checks against the real contract.
  const session = Object.assign(createTestInteractiveSession(), { submit });
  const sent: TServerMessage[] = [];
  const { onMessage } = createWsHandler({
    session,
    deliver: createOutboundDelivery((msg) => sent.push(msg), vi.fn()),
  });
  return { submit, sent, onMessage };
}

describe('TRANS-008: a non-string submit prompt is refused at the ingress', () => {
  it.each([
    ['an object', {}],
    ['an array', []],
    ['a number', 42],
    ['a boolean', true],
  ])('refuses %s — it is truthy, so the falsy guard passes it', (_label, prompt) => {
    const { submit, sent, onMessage } = setup();

    onMessage(JSON.stringify({ type: 'submit', prompt }));

    // The session must never see it: once it does, the value is re-emitted as `user_message` to
    // every attached client inside a frame whose `content` is declared `string`.
    expect(submit).not.toHaveBeenCalled();
    expect(sent.some((msg) => msg.type === 'protocol_error')).toBe(true);
  });

  it('still refuses an EMPTY prompt, which the falsy guard already caught', () => {
    // The control for the guard that exists. A type check that replaced it would otherwise let
    // `''` through — a regression hidden by the new assertions above.
    const { submit, sent, onMessage } = setup();

    onMessage(JSON.stringify({ type: 'submit', prompt: '' }));

    expect(submit).not.toHaveBeenCalled();
    expect(sent.some((msg) => msg.type === 'protocol_error')).toBe(true);
  });

  it('still accepts a real string prompt, so the refusal is about shape and not about submitting', () => {
    const { submit, onMessage } = setup();

    onMessage(JSON.stringify({ type: 'submit', prompt: 'hello' }));

    expect(submit).toHaveBeenCalledTimes(1);
  });
});
