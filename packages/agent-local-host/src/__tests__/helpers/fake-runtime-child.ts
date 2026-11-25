import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';

import { expect, vi } from 'vitest';

/** What a launcher drives of a spawned child: its channels, its signals and its exit. */
export class FakeRuntimeChild extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  connected = true;
  readonly stderr = new PassThrough();
  /** What the child receives on its descriptor 4. */
  readonly received: string[] = [];
  readonly tokenPipe = new Writable({
    write: (chunk: Buffer, _encoding, done) => {
      this.received.push(chunk.toString('utf8'));
      done();
    },
  });
  stdio: unknown[] = [null, null, this.stderr, null, this.tokenPipe];
  send: (message: unknown, done?: (error: Error | null) => void) => boolean = vi.fn((_message: unknown, done?: (error: Error | null) => void) => {
    done?.(null);
    return true;
  });
  disconnect: () => void = vi.fn(() => {
    this.connected = false;
  });
  unref: () => void = vi.fn();
  kill: (signal?: NodeJS.Signals) => boolean = vi.fn(() => {
    this.signalCode = 'SIGTERM';
    queueMicrotask(() => this.emit('exit'));
    return true;
  });
}

/** The arguments and options a stubbed `spawn` was called with. */
export interface ISpawnCall {
  readonly args: string[];
  readonly options: { stdio: unknown[]; env: NodeJS.ProcessEnv; detached: boolean };
}

/** The one spawn a launch made. */
export function onlySpawnCall(spawn: ReturnType<typeof vi.fn>): ISpawnCall {
  expect(spawn).toHaveBeenCalledTimes(1);
  const [, args, options] = spawn.mock.calls[0] as [string, string[], ISpawnCall['options']];
  return { args, options };
}
