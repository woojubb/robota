/**
 * Why the relay could not listen decides what the user changes, so a failed bind says its cause.
 * The causes a test machine cannot reliably produce are injected here.
 */
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

const bindErrors: NodeJS.ErrnoException[] = [];

vi.mock('node:dgram', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:dgram')>();
  return {
    ...actual,
    createSocket: (type: 'udp4') => {
      const failure = bindErrors.shift();
      if (failure === undefined) return actual.createSocket(type);
      const fake = new EventEmitter() as EventEmitter & {
        bind: (port: number, host: string, done: () => void) => void;
        close: () => void;
      };
      fake.bind = () => {
        setImmediate(() => fake.emit('error', failure));
      };
      fake.close = () => undefined;
      return fake;
    },
  };
});

const { TurnServer } = await import('../turn-server.js');

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`bind ${code}`), { code, syscall: 'bind' });
}

afterEach(() => {
  bindErrors.length = 0;
});

describe('a relay that cannot listen', () => {
  const authorize = (): Promise<undefined> => Promise.resolve(undefined);

  it('says a privileged port needs privileges, keeping the error as its cause', async () => {
    const failure = errno('EACCES');
    bindErrors.push(failure);
    const started = TurnServer.start({ host: '127.0.0.1', port: 80, authorize });
    await expect(started).rejects.toThrow(/UDP 127\.0\.0\.1:80: .*privilege/);
    await expect(started).rejects.toHaveProperty('cause', failure);
  });

  it('passes on a cause it has no words for', async () => {
    const failure = errno('EPERM');
    bindErrors.push(failure);
    const started = TurnServer.start({ host: '127.0.0.1', port: 3478, authorize });
    await expect(started).rejects.toThrow(/UDP 127\.0\.0\.1:3478: bind EPERM/);
    await expect(started).rejects.toHaveProperty('cause', failure);
  });
});
