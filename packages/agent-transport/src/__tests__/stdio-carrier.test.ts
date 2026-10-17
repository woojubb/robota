/**
 * The stdio carrier bridge: what a protocol carrier hands its SDK in place of the process input, and
 * how it learns that either end went away. Two carriers share it, so the cases here are the contract
 * both rely on rather than either carrier's own behavior.
 */

import { PassThrough } from 'node:stream';

import { describe, expect, it, vi } from 'vitest';

import { attachStdioCarrier } from '../node/stdio-carrier.js';

function handlers() {
  return { onInputClose: vi.fn(), onOutputClose: vi.fn(), onOutputError: vi.fn() };
}

describe('attachStdioCarrier', () => {
  it('forwards input to the bridge and keeps bytes written before anyone reads', async () => {
    const input = new PassThrough();
    const carrier = attachStdioCarrier(input, new PassThrough(), handlers());
    input.write('early\n');
    const chunks: string[] = [];
    carrier.bridge.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
    await new Promise((resolve) => setImmediate(resolve));
    expect(chunks.join('')).toBe('early\n');
    carrier.release();
  });

  it('reports the input ending, and the bridge ends with it', async () => {
    const input = new PassThrough();
    const h = handlers();
    const carrier = attachStdioCarrier(input, new PassThrough(), h);
    const ended = new Promise<void>((resolve) => carrier.bridge.once('end', resolve));
    carrier.bridge.resume();
    input.end();
    await ended;
    expect(h.onInputClose).toHaveBeenCalled();
    carrier.release();
  });

  it('reports the input closing without an end', () => {
    const input = new PassThrough();
    const h = handlers();
    const carrier = attachStdioCarrier(input, new PassThrough(), h);
    input.emit('close');
    expect(h.onInputClose).toHaveBeenCalledTimes(1);
    carrier.release();
  });

  it('reports the output closing and failing', () => {
    const output = new PassThrough();
    const h = handlers();
    const carrier = attachStdioCarrier(new PassThrough(), output, h);
    const failure = new Error('EPIPE');
    output.emit('error', failure);
    output.emit('close');
    expect(h.onOutputError).toHaveBeenCalledWith(failure);
    expect(h.onOutputClose).toHaveBeenCalledTimes(1);
    carrier.release();
  });

  it('destroys the bridge on release but leaves the real input alone', () => {
    const input = new PassThrough();
    const carrier = attachStdioCarrier(input, new PassThrough(), handlers());
    carrier.release();
    expect(carrier.bridge.destroyed).toBe(true);
    expect(input.destroyed).toBe(false);
    expect(input.listenerCount('end')).toBe(0);
    expect(input.listenerCount('close')).toBe(0);
  });

  it('stops reporting after release, and release is idempotent', () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const h = handlers();
    const carrier = attachStdioCarrier(input, output, h);
    carrier.release();
    carrier.release();
    input.emit('close');
    output.emit('close');
    expect(h.onInputClose).not.toHaveBeenCalled();
    expect(h.onOutputClose).not.toHaveBeenCalled();
    expect(h.onOutputError).not.toHaveBeenCalled();
  });
});
