import { PassThrough } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createSupervisedAttachConnection, MAX_EARLY_FRAMES } from '../supervised-attach-client.js';

describe('attach client framing', () => {
  it('hands frames that arrived before the first subscriber to it, in order', () => {
    const socket = new PassThrough();
    socket.setEncoding('utf8');
    const connection = createSupervisedAttachConnection(
      socket as never, 'attach:1', '{"type":"executing","executing":true}\n',
    );
    socket.write('{"type":"pending","pending":null}\n');
    const seen: string[] = [];
    connection.subscribe((message) => seen.push(message.type));
    expect(seen).toEqual(['executing', 'pending']);
    connection.detach();
  });

  it('closes a connection that floods frames before anyone reads them', () => {
    const socket = new PassThrough();
    socket.setEncoding('utf8');
    createSupervisedAttachConnection(socket as never, 'attach:1', '');
    socket.write('{"type":"executing","executing":true}\n'.repeat(MAX_EARLY_FRAMES + 1));
    expect(socket.destroyed).toBe(true);
  });
});
