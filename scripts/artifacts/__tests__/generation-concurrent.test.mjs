import { writeFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { expect, it } from 'vitest';
import { makeTemp } from '../../harness/__tests__/make-temp.mjs';
import { assembleGeneration, pinGeneration } from '../generation.mjs';
import { createManifest } from '../manifest.mjs';

const SWITCH_COUNT = 16;
const BARRIER_TIMEOUT_MS = 5000;

function response(worker, event, round) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      worker.off('message', message);
      worker.off('error', failure);
      worker.off('exit', exited);
    };
    const failure = (error) => {
      cleanup();
      reject(error);
    };
    const exited = (code) => failure(new Error(`reader exited before ${event}: ${code}`));
    const message = (value) => {
      if (value.event === 'failure') {
        failure(new Error(value.error));
        return;
      }
      if (value.event === event && value.round === round) {
        cleanup();
        resolve(value);
      }
    };
    const timer = setTimeout(
      () => failure(new Error(`reader barrier missing: ${event} round ${round}`)),
      BARRIER_TIMEOUT_MS,
    );
    worker.on('message', message);
    worker.once('error', failure);
    worker.once('exit', exited);
  });
}

it.skipIf(process.platform === 'win32')(
  'keeps pinned pairs coherent and the current link complete during repeated real POSIX switches',
  async () => {
    const root = realpathSync(makeTemp('robota-generation-concurrent-'));
    const barrier = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 2);
    const state = new Int32Array(barrier);
    let previous = await assembleGeneration(root, async ({ outputRoot }) => {
      const records = ['left.txt', 'right.txt'].map((file) => ({
        path: file,
        contents: 'generation-0',
      }));
      for (const record of records)
        writeFileSync(path.join(outputRoot, record.path), record.contents);
      return createManifest(records);
    });
    const worker = new Worker(new URL('./generation-concurrent-reader.mjs', import.meta.url), {
      workerData: { root, barrier },
    });
    try {
      for (let round = 1; round <= SWITCH_COUNT; round++) {
        const heldPromise = response(worker, 'held', round);
        worker.postMessage({ command: 'hold', round });
        expect(await heldPromise).toMatchObject({
          id: previous.id,
          token: `generation-${round - 1}`,
        });
        Atomics.store(state, 0, 1);
        Atomics.store(state, 1, 0);
        const observedPromise = response(worker, 'observed', round);
        // Attach rejection handling immediately while the main thread enters the synchronous barrier.
        observedPromise.catch(() => {});
        const current = await assembleGeneration(root, async ({ outputRoot }) => {
          const token = `generation-${round}`;
          writeFileSync(path.join(outputRoot, 'left.txt'), token);
          worker.postMessage({ command: 'observe', round });
          const wait = Atomics.wait(state, 1, 0, BARRIER_TIMEOUT_MS);
          expect(wait).not.toBe('timed-out');
          expect(Atomics.load(state, 1)).toBe(1);
          writeFileSync(path.join(outputRoot, 'right.txt'), token);
          return createManifest(
            ['left.txt', 'right.txt'].map((file) => ({ path: file, contents: token })),
          );
        });
        Atomics.store(state, 0, 0);
        const observed = await observedPromise;
        expect(observed.samples).toBeGreaterThanOrEqual(1);
        expect(observed).toMatchObject({
          heldId: previous.id,
          heldToken: `generation-${round - 1}`,
          after: { id: current.id, token: `generation-${round}` },
        });
        expect(pinGeneration(root).id).toBe(current.id);
        previous = current;
      }
    } finally {
      Atomics.store(state, 0, 0);
      await worker.terminate();
    }
  },
  20000,
);
