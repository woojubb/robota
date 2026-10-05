import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { exitAfterFlush } from '../print-mode.js';

function stream(queued: number) {
  const emitter = new EventEmitter() as EventEmitter & {
    writableLength: number;
    write: (chunk: string, cb: () => void) => boolean;
    flush?: () => void;
  };
  emitter.writableLength = queued;
  emitter.write = (_chunk, cb) => {
    emitter.flush = cb;
    return false;
  };
  return emitter;
}

afterEach(() => vi.restoreAllMocks());

describe('print mode exit', () => {
  it('exits only after queued output is handed to the OS, with the run code', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const out = stream(9000);
    const done = exitAfterFlush(3, [out as never]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(exit).not.toHaveBeenCalled();
    out.flush!();
    await done;
    expect(exit).toHaveBeenCalledWith(3);
  });

  it('keeps the run code when the reader closed early', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    const out = stream(9000);
    const done = exitAfterFlush(3, [out as never]);
    out.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    await done;
    expect(exit).toHaveBeenCalledWith(3);
  });

  it('exits at once when nothing is queued', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    await exitAfterFlush(0, [stream(0) as never]);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
