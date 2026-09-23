import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { pinGeneration } from '../generation.mjs';

const state = new Int32Array(workerData.barrier);
let held;
let first;

function snapshot() {
  const pinned = pinGeneration(workerData.root);
  const left = readFileSync(path.join(pinned.root, 'left.txt'), 'utf8');
  const right = readFileSync(path.join(pinned.root, 'right.txt'), 'utf8');
  assert.equal(left, right, `mixed generation ${pinned.id}`);
  return { id: pinned.id, token: left };
}

parentPort.on('message', ({ command, round }) => {
  try {
    if (command === 'hold') {
      held = pinGeneration(workerData.root);
      first = readFileSync(path.join(held.root, 'left.txt'), 'utf8');
      parentPort.postMessage({ event: 'held', round, id: held.id, token: first });
      return;
    }
    assert.equal(command, 'observe');
    // The writer has emitted only left.txt in its private staging directory at this barrier.
    const before = snapshot();
    assert.equal(before.id, held.id);
    let samples = 1;
    Atomics.store(state, 1, 1);
    Atomics.notify(state, 1);
    while (Atomics.load(state, 0) === 1) {
      snapshot();
      samples++;
    }
    // One reader operation spans the real switch: the first and second opens share one pin.
    const second = readFileSync(path.join(held.root, 'right.txt'), 'utf8');
    assert.equal(second, first, `held generation changed across switch ${held.id}`);
    const after = snapshot();
    parentPort.postMessage({
      event: 'observed',
      round,
      samples,
      heldId: held.id,
      heldToken: second,
      after,
    });
  } catch (error) {
    Atomics.store(state, 1, -1);
    Atomics.notify(state, 1);
    parentPort.postMessage({ event: 'failure', round, error: error.stack });
  }
});
