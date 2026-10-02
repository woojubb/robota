import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assertStaleState, type IStateObservation } from './outcome-state.js';

const unchanged: IStateObservation = {
  value: 'off',
  revision: 'revision-0',
  effects: 0,
  calls: ['observe', 'observe'],
};

test('stale-operation safety passes only with independently unchanged state', () => {
  assert.doesNotThrow(() => assertStaleState(unchanged));
  for (const changed of [
    { ...unchanged, value: 'on' },
    { ...unchanged, revision: 'revision-1' },
    { ...unchanged, effects: 1 },
    { ...unchanged, effects: 2 },
    { ...unchanged, calls: ['observe'] },
    { ...unchanged, calls: ['observe', 'change', 'observe'] },
  ]) {
    assert.throws(() => assertStaleState(changed), /Stale operation/);
  }
});
