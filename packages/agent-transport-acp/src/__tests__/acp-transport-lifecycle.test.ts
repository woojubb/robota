import { PassThrough } from 'node:stream';

import { runTransportLifecycleConformance } from '@robota-sdk/agent-interface-transport/testing';
import { describe, expect, it } from 'vitest';

import { createAcpTransport } from '../acp-transport.js';

import { createFakeSession, createTransportOptions } from './acp-test-harness.js';

import type { IAcpTransport } from '../acp-types.js';

function streams() {
  const input = new PassThrough();
  const output = new PassThrough();
  return { input, output, transport: createAcpTransport(createTransportOptions(input, output)) };
}

const INITIALIZE = `${JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: 1 },
})}\n`;

/** Writes a request and reads the reply line, or resolves undefined if nothing answers. */
async function ask(input: PassThrough, output: PassThrough): Promise<string | undefined> {
  const reply = new Promise<string>((resolve) =>
    output.once('data', (c: Buffer) => resolve(c.toString())),
  );
  input.write(INITIALIZE);
  return Promise.race([
    reply,
    new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 150)),
  ]);
}

describe('createAcpTransport lifecycle', () => {
  it('is a service named acp with a frozen lifecycle', () => {
    const { transport } = streams();
    expect(transport.name).toBe('acp');
    expect(transport.lifecycle).toEqual({ kind: 'service' });
    expect(Object.isFrozen(transport.lifecycle)).toBe(true);
    expect('waitForCompletion' in transport).toBe(false);
  });

  it('passes the shared transport lifecycle conformance suite', async () => {
    const wired = new WeakMap<IAcpTransport, { input: PassThrough; output: PassThrough }>();
    await runTransportLifecycleConformance({
      subjectId: '@robota-sdk/agent-transport-acp#createAcpTransport',
      kind: 'service',
      createAdapter: () => {
        const { input, output, transport } = streams();
        wired.set(transport, { input, output });
        return transport;
      },
      createSession: () => createFakeSession().session,
      assertReady: async (transport) => {
        const { input, output } = wired.get(transport)!;
        const reply = await ask(input, output);
        if (!reply?.includes('"protocolVersion":1')) throw new Error('ACP agent is not serving');
      },
      assertStopped: async (transport) => {
        const { input, output } = wired.get(transport)!;
        await transport.waitForClose();
        if ((await ask(input, output)) !== undefined) throw new Error('ACP agent still serving');
      },
    });
  });

  it('leaves the process input open when it stops', async () => {
    const { input, output, transport } = streams();
    transport.attach(createFakeSession().session);
    await transport.start();
    await transport.stop();
    expect(input.destroyed).toBe(false);
    expect(output.destroyed).toBe(false);
    expect(input.listenerCount('end')).toBe(0);
    expect(output.listenerCount('error')).toBe(0);
  });

  it('rejects attaching a session while serving', async () => {
    const { transport } = streams();
    transport.attach(createFakeSession().session);
    await transport.start();
    expect(() => transport.attach(createFakeSession().session)).toThrow('already-started');
    await transport.stop();
  });

  it('requires attaching again after a stop', async () => {
    const { transport } = streams();
    transport.attach(createFakeSession().session);
    await transport.start();
    await transport.stop();
    await expect(transport.start()).rejects.toMatchObject({ code: 'not-attached' });
  });

  it('can retry start after a failed start without an intervening stop', async () => {
    const output = new PassThrough();
    const transport = createAcpTransport(
      createTransportOptions(undefined as unknown as PassThrough, output),
    );
    transport.attach(createFakeSession().session);
    // An input that cannot be read fails the start; that start serves nothing.
    await expect(transport.start()).rejects.toThrow(TypeError);
    await expect(transport.start()).rejects.toThrow(TypeError);
    expect(output.listenerCount('error')).toBe(0);
    await transport.stop();
  });

  it('settles waitForClose when the editor closes its input', async () => {
    const { input, transport } = streams();
    transport.attach(createFakeSession().session);
    await transport.start();
    input.end();
    await expect(transport.waitForClose()).resolves.toBeUndefined();
    await transport.stop();
  });

  it('rejects waitForClose when the output fails', async () => {
    const { output, transport } = streams();
    transport.attach(createFakeSession().session);
    await transport.start();
    output.emit('error', new Error('EPIPE'));
    await expect(transport.waitForClose()).rejects.toThrow('EPIPE');
    await transport.stop();
  });

  it('writes nothing but protocol frames to its output', async () => {
    const { input, output, transport } = streams();
    transport.attach(createFakeSession().session);
    await transport.start();
    const chunks: string[] = [];
    output.on('data', (chunk: Buffer) => chunks.push(chunk.toString()));
    input.write('not json\n');
    input.write(INITIALIZE);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const lines = chunks.join('').split('\n').filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) expect(JSON.parse(line)).toMatchObject({ jsonrpc: '2.0' });
    await transport.stop();
  });
});
