/** Real daemon and WebSocket client over simulated E2B command transport; no cloud claim. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { WebSocket } from 'ws';
import { expect, it } from 'vitest';
import { hostedWorkerCliFixture } from './helpers/hosted-worker-cli.js';
import { scriptedHostedBroker } from './helpers/hosted-scripted-broker.js';

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

it('connects an authenticated runtime client to the stock worker daemon and closes it on stop', async () => {
  const fixture = await hostedWorkerCliFixture();
  const abort = new AbortController();
  let running: ReturnType<typeof fixture.run> | undefined;
  let socket: WebSocket | undefined;
  try {
    const port = await freePort();
    const workerPort = await freePort();
    const token = 'synthetic-owner-client-token-123456789';
    const config = JSON.parse(readFileSync(fixture.execution, 'utf8')) as Record<string, unknown>;
    writeFileSync(fixture.execution, JSON.stringify({ ...config, serve: { port, workerPort, token } }));
    const calls = scriptedHostedBroker(fixture.f, () => ({ content: 'HOSTED_DAEMON_RESPONSE' }));
    const messages: { type: string; text?: string }[] = [];
    running = fixture.run(['--serve', '--no-session-persistence'], abort.signal);
    const premature = running.then((result) => { throw new Error(`daemon exited before connection: ${result.stderr}`); });
    const connect = async (): Promise<WebSocket> => {
      for (let attempt = 0; attempt < 200; attempt++) {
        if (abort.signal.aborted) throw new Error('fixture stopped');
        const ws = new WebSocket(`ws://127.0.0.1:${port}/?token=${token}`);
        ws.on('message', (data) => messages.push(JSON.parse(data.toString()) as { type: string; text?: string }));
        const opened = await new Promise<boolean>((resolve) => {
          ws.once('open', () => resolve(true));
          ws.once('error', () => resolve(false));
        });
        if (opened) return ws;
        ws.terminate();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error('runtime daemon ingress did not become reachable');
    };
    socket = await Promise.race([connect(), premature]);
    const rejected = new WebSocket(`ws://127.0.0.1:${port}/?token=wrong`);
    const rejection = await new Promise<string>((resolve) => rejected.once('error', (error) => resolve(error.message)));
    rejected.terminate();
    expect(rejection).toContain('401');
    socket.send(JSON.stringify({ type: 'submit', prompt: 'Hello from the runtime client' }));
    await expect.poll(() => JSON.stringify(messages), { timeout: 15_000 }).toContain('HOSTED_DAEMON_RESPONSE');
    expect(messages[0]?.type).toBe('messages');
    expect(calls.length).toBeGreaterThan(0);
    const closed = new Promise<void>((resolve) => socket!.once('close', () => resolve()));
    abort.abort();
    await closed;
    const result = await running;
    expect(result.stdout + result.stderr).not.toContain(token);
    expect(result.stdout + result.stderr).not.toContain('runtime-management-canary');
    const receipts = readFileSync(fixture.receipts, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as { kind?: string; command?: string; envs?: Record<string, string> });
    expect(receipts.filter((receipt) => receipt.kind === 'delete')).toHaveLength(1);
    const workerLaunch = receipts.find((receipt) => receipt.command?.includes('worker-cli.mjs'));
    expect(JSON.stringify(workerLaunch)).not.toContain(token);
    expect(JSON.stringify(workerLaunch)).toContain('PRODUCT_WS_TOKEN');
    expect(JSON.stringify(workerLaunch)).toContain(`PRODUCT_WS_PORT='${workerPort}'`);
  } finally {
    abort.abort();
    socket?.terminate();
    await running?.catch(() => undefined);
    await fixture.close();
  }
}, 60_000);
