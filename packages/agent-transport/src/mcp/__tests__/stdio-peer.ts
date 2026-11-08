import { ReadBuffer, serializeMessage } from '@modelcontextprotocol/client';

import type { Transport } from '@modelcontextprotocol/client';
import type { Readable, Writable } from 'node:stream';

/** The peer's side of the stdio carrier: a v2 client transport over the same two in-process streams. */
export function createPeerTransport(serverOutput: Readable, serverInput: Writable): Transport {
  const buffer = new ReadBuffer();
  const transport: Transport = {
    async start() {
      serverOutput.on('data', (chunk: Buffer) => {
        buffer.append(chunk);
        for (;;) {
          const message = buffer.readMessage();
          if (message === null) return;
          transport.onmessage?.(message);
        }
      });
      serverOutput.once('end', () => transport.onclose?.());
    },
    async send(message) {
      serverInput.write(serializeMessage(message));
    },
    async close() {
      serverInput.end();
      transport.onclose?.();
    },
  };
  return transport;
}
