import { randomBytes } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';

import { isLinkRequest } from '@robota-sdk/agent-transport/link';

import type {
  IRuntimeAdmissionContext,
  TRuntimeAdmissionFactory,
} from '../../runtime-admission.js';

export interface ILinkEndpoint {
  readonly socketPath: string;
  close(): Promise<void>;
}

/**
 * The part of a runtime's control endpoint that its custody meets: it reads the request line of a
 * connection and hands a link request's socket, paused, with the bytes that arrived behind that
 * line, to the admission. Nothing else an endpoint answers is here, so a test of the custody needs
 * no product; the product's own endpoint is tested with a real custody where it lives.
 */
export async function startLinkEndpoint(options: {
  readonly directory: string;
  readonly runtimeId: string;
  readonly admission: TRuntimeAdmissionFactory;
  readonly control: IRuntimeAdmissionContext['control'];
}): Promise<ILinkEndpoint> {
  const socketPath = join(options.directory, 'link.sock');
  const admission = options.admission({
    binding: { runtimeId: options.runtimeId, generation: randomBytes(16).toString('base64url') },
    control: options.control,
  });
  const clients = new Set<Socket>();
  const server = createServer((socket) => {
    clients.add(socket);
    socket.on('error', () => socket.destroy());
    socket.once('close', () => clients.delete(socket));
    let received = Buffer.alloc(0);
    const onData = (chunk: Buffer): void => {
      received = Buffer.concat([received, chunk]);
      const end = received.indexOf(0x0a);
      if (end === -1) return;
      socket.off('data', onData);
      socket.pause();
      let request: unknown;
      try {
        request = JSON.parse(received.subarray(0, end).toString('utf8'));
      } catch {
        socket.destroy();
        return;
      }
      if (isLinkRequest(request))
        admission.serveLink(socket, Buffer.from(received.subarray(end + 1)));
      else socket.destroy();
    };
    socket.on('data', onData);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, resolve);
  });
  return {
    socketPath,
    close: async () => {
      for (const socket of clients) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
