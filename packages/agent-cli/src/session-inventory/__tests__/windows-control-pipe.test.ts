import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
  connectWindowsControlPipe,
  WindowsControlPipeServer,
  windowsControlPipePath,
  type IControlChannel,
} from '../windows-control-pipe.js';
import { readWindowsProcessStartTime } from '../windows-security.js';

describe('Windows supervised pipe endpoint', () => {
  it('uses the local Windows pipe namespace with a bounded unique name', () => {
    const path = windowsControlPipePath('C:\\Users\\person\\.test-product\\supervised', 'daemon-id');
    expect(path).toMatch(/^\\\\\.\\pipe\\agent-supervised-[0-9a-f]{32}$/);
    expect(windowsControlPipePath('C:\\Users\\other\\.test-product\\supervised', 'daemon-id')).not.toBe(
      path,
    );
    expect(windowsControlPipePath('C:\\Users\\person\\.test-product\\supervised', 'other-id')).not.toBe(
      path,
    );
  });

  it.runIf(process.platform === 'win32')(
    'carries large duplex data, rejects stale identities and drains canceled I/O',
    async () => {
      const path = windowsControlPipePath('native-test', randomUUID());
      const channels = new Set<IControlChannel>();
      const server = new WindowsControlPipeServer((channel) => {
        channels.add(channel);
        channel.on('error', () => undefined);
        channel.pipe(channel);
      });
      const errors: unknown[] = [];
      server.on('error', (error) => errors.push(error));
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(path, resolve);
      });
      try {
        const expected = { pid: process.pid, startedAt: readWindowsProcessStartTime(process.pid)! };
        await expect(
          connectWindowsControlPipe(path, { ...expected, startedAt: '0' }),
        ).rejects.toThrow(/registered process/);
        // Idle peers must not occupy the finite native worker pool or starve later I/O.
        for (let index = 0; index < 6; index++) {
          const idle = await connectWindowsControlPipe(path, expected);
          channels.add(idle);
          idle.on('error', () => undefined);
        }
        expect(await readFile(new URL(import.meta.url), 'utf8')).toContain('Windows supervised');
        const client = await connectWindowsControlPipe(path, expected);
        channels.add(client);
        client.on('error', () => undefined);
        const payload = Buffer.alloc(2 * 1024 * 1024, 0x61);
        const received = createHash('sha256');
        let length = 0;
        const echoed = new Promise<string>((resolve, reject) => {
          client.on('data', (data: Buffer) => {
            received.update(data);
            length += data.length;
            if (length > payload.length) reject(new Error('Unexpected extra pipe bytes.'));
            else if (length === payload.length) resolve(received.digest('hex'));
          });
          client.once('error', reject);
        });
        client.write(payload);
        expect(await echoed).toBe(createHash('sha256').update(payload).digest('hex'));
        expect(length).toBe(payload.length);
        // Destroy with a read pending: native cancellation must complete before freeing its buffers.
        const closed = once(client, 'close');
        client.destroy();
        await closed;
        expect(errors).toEqual([]);
      } finally {
        const closed = [...channels]
          .filter((channel) => !channel.closed)
          .map(
            (channel) =>
              new Promise<void>((resolve) => {
                channel.once('close', resolve);
                channel.destroy();
              }),
          );
        await Promise.all(closed);
        await new Promise<void>((resolve) => server.close(resolve));
      }
    },
    15000,
  );

  it.runIf(process.platform === 'win32')(
    'refuses a second first-instance owner and cancels an idle accept',
    async () => {
      const path = windowsControlPipePath('namespace-test', randomUUID());
      const first = new WindowsControlPipeServer((channel) => channel.destroy());
      await new Promise<void>((resolve, reject) => {
        first.once('error', reject);
        first.listen(path, resolve);
      });
      const second = new WindowsControlPipeServer((channel) => channel.destroy());
      const refused = once(second, 'error');
      second.listen(path, () => undefined);
      expect((await refused)[0]).toBeInstanceOf(Error);
      await Promise.all(
        [first, second].map((server) => new Promise<void>((resolve) => server.close(resolve))),
      );
    },
    5000,
  );
});
