import { Worker } from 'node:worker_threads';

import type { TWorkspaceRootBrokerRequest, TWorkspaceRootBrokerResponse } from './workspace-root-broker.js';

const RESPONSE_BYTES = 8 * 1_024 * 1_024;
const WAIT_MS = 12_000;

// The worker is deliberately self-contained: source runs under tsx, and bundled Node/Bun entry
// points use the same code without relying on a separately copied worker asset.
const WORKER_SOURCE = String.raw`
  const { parentPort } = require('node:worker_threads');
  const { createConnection } = require('node:net');
  const { lstatSync } = require('node:fs');
  const { dirname } = require('node:path');
  parentPort.on('message', ({ endpoint, request, shared }) => {
    const state = new Int32Array(shared, 0, 2);
    const output = new Uint8Array(shared, 8);
    let settled = false;
    let chunks = [];
    let length = 0;
    let socket;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket?.destroy();
      const encoded = Buffer.from(JSON.stringify(value), 'utf8');
      if (encoded.length > output.length) {
        Atomics.store(state, 0, -1);
      } else {
        output.set(encoded);
        Atomics.store(state, 1, encoded.length);
        Atomics.store(state, 0, 1);
      }
      Atomics.notify(state, 0);
    };
    try {
      if (process.platform === 'win32') {
        if (!/^\\\\\.\\pipe\\robota-root-[0-9a-f]{24}$/.test(endpoint)) {
          throw new Error('The broker pipe name is invalid.');
        }
      } else {
        const parent = lstatSync(dirname(endpoint));
        const entry = lstatSync(endpoint);
        if (!parent.isDirectory() || parent.isSymbolicLink() ||
            parent.uid !== process.getuid?.() || (parent.mode & 0o077) !== 0 ||
            !entry.isSocket() || entry.uid !== process.getuid?.()) {
          throw new Error('The broker endpoint is not owner-private.');
        }
      }
      socket = createConnection(endpoint);
      socket.setTimeout(10000, () => finish({ status: 'refused', reason: 'timeout' }));
      socket.once('error', () => finish({ status: 'refused', reason: 'connection' }));
      socket.once('connect', () => socket.write(JSON.stringify({ version: 1, ...request }) + '\n'));
      socket.on('data', (chunk) => {
        length += chunk.length;
        if (length > output.length) return finish({ status: 'refused', reason: 'frame-size' });
        chunks.push(chunk);
        const newline = chunk.indexOf(10);
        if (newline < 0) return;
        const frame = Buffer.concat(chunks, length);
        const end = frame.indexOf(10);
        if (end !== frame.length - 1) return finish({ status: 'refused', reason: 'malformed' });
        try { finish(JSON.parse(frame.subarray(0, end).toString('utf8'))); }
        catch { finish({ status: 'refused', reason: 'malformed' }); }
      });
      socket.once('end', () => finish({ status: 'refused', reason: 'closed' }));
    } catch {
      finish({ status: 'refused', reason: 'connection' });
    }
  });
`;

/** A bounded synchronous bridge for framework project operations that cannot become promises. */
export class SyncWorkspaceRootBrokerClient {
  readonly #endpoint: string;
  #worker: Worker | undefined;
  #dead = false;

  constructor(endpoint: string) {
    this.#endpoint = endpoint;
  }

  request(request: TWorkspaceRootBrokerRequest): TWorkspaceRootBrokerResponse {
    if (this.#dead) throw new Error('The workspace root broker client is unavailable.');
    const worker = this.#worker ?? new Worker(WORKER_SOURCE, { eval: true });
    if (this.#worker === undefined) {
      this.#worker = worker;
      worker.unref();
      worker.once('error', () => { this.#dead = true; });
      worker.once('exit', () => { this.#dead = true; });
    }
    const shared = new SharedArrayBuffer(RESPONSE_BYTES + 8);
    const state = new Int32Array(shared, 0, 2);
    worker.postMessage({ endpoint: this.#endpoint, request, shared });
    Atomics.wait(state, 0, 0, WAIT_MS);
    if (Atomics.load(state, 0) !== 1) {
      this.#dead = true;
      void worker.terminate();
      throw new Error('The workspace root broker response is unconfirmed.');
    }
    const size = Atomics.load(state, 1);
    if (size < 1 || size > RESPONSE_BYTES) {
      this.#dead = true;
      void worker.terminate();
      throw new Error('The workspace root broker response is malformed.');
    }
    const value: unknown = JSON.parse(new TextDecoder().decode(new Uint8Array(shared, 8, size)));
    if (typeof value !== 'object' || value === null || !('status' in value) ||
        typeof value.status !== 'string') {
      throw new Error('The workspace root broker response is malformed.');
    }
    return value as TWorkspaceRootBrokerResponse;
  }

  close(): void {
    this.#dead = true;
    if (this.#worker !== undefined) void this.#worker.terminate();
  }
}
