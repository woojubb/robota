/**
 * agent-transport in a web-only realm, through both neutral entries: the admission decision and
 * credential check, the wire decoders, the channel frame codec and handoff chunking. None of it has
 * a socket, a file or a hash from `node:crypto` to lean on.
 */
import {
  HandoffChunkAssembler,
  bearerCredential,
  chunkHandoffPayload,
  credentialMatches,
  decodeChannelFrame,
  decodeClientMessage,
  decodeFrame,
  encodeChannelEventFrame,
  mintTransportToken,
  resolveAdmission,
} from '@robota-sdk/agent-transport';
import { decodeClientMessage as decodeClientMessageFromClient } from '@robota-sdk/agent-transport/client';

export default async function agentTransport(t) {
  // Admission: a credential from the platform's randomness, compared as text.
  const token = mintTransportToken();
  t.match('a minted credential is 256 bits of hex', token, /^[0-9a-f]{64}$/);
  t.equal('an omitted decision mints a credential', resolveAdmission({}).token?.length, 64);
  t.equal('a given token is the decision', resolveAdmission({ token: 'secret' }), {
    token: 'secret',
  });
  t.equal(
    'open takes a stated reason',
    resolveAdmission({ open: true, openReason: 'a local demo' }),
    { token: null, openReason: 'a local demo' },
  );
  t.ok(
    'open without a reason is refused',
    (() => {
      try {
        resolveAdmission({ open: true });
        return false;
      } catch (error) {
        return /openReason/.test(error.message);
      }
    })(),
  );
  t.equal(
    'a bearer header yields its credential',
    [bearerCredential('Bearer abc'), bearerCredential('Bearerness abc')],
    ['abc', undefined],
  );
  t.equal(
    'a credential matches only itself',
    [
      credentialMatches(token, token),
      credentialMatches(token, `${token}0`),
      credentialMatches(token, undefined),
    ],
    [true, false, false],
  );

  // The wire: a JSON frame through the decoder, the same one from the client entry.
  t.equal(
    'a submit frame decodes',
    decodeFrame('{"type":"submit","prompt":"hello"}', decodeClientMessage),
    {
      ok: true,
      message: { type: 'submit', prompt: 'hello' },
    },
  );
  t.equal(
    'an empty prompt is refused with its reason',
    decodeFrame('{"type":"submit","prompt":""}', decodeClientMessage).ok,
    false,
  );
  t.ok(
    'the client entry has the same decoder',
    decodeClientMessageFromClient === decodeClientMessage,
  );

  // The channel frame codec: bytes in, bytes out, no Buffer.
  const frame = encodeChannelEventFrame({
    channel: 'proof',
    seq: 7,
    event: 'ping',
    payload: { n: 1 },
  });
  t.equal(
    'an event frame starts with the channel magic',
    Array.from(frame.subarray(0, 3)),
    [0x52, 0x42, 0x46],
  );
  t.equal('an event frame decodes to what was encoded', decodeChannelFrame(frame), {
    ok: true,
    frame: { kind: 'event', channel: 'proof', seq: 7, event: 'ping', payload: { n: 1 } },
  });

  // Handoff chunking: cut on bytes, base64 by `btoa`, reassembled out of order.
  const payload = JSON.stringify({ text: 'héllo wörld € 𝔘', filler: 'x'.repeat(100) });
  const chunks = chunkHandoffPayload('handoff-1', payload, 32);
  t.ok('a payload is cut into several chunks', chunks.length > 2);
  const assembler = new HandoffChunkAssembler('handoff-1');
  const outcomes = [...chunks].reverse().map((chunk) => assembler.accept(chunk));
  t.equal('the last chunk to arrive completes the transfer', outcomes.at(-1)?.outcome, 'complete');
  t.equal('the reassembled payload is the original', outcomes.at(-1)?.serialized, payload);
}
