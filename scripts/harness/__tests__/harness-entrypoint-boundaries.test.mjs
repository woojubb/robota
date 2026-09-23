import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import * as prePushFacade from '../pre-push.mjs';
import * as prePushRuntime from '../pre-push-runtime.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const lines = (name) => readFileSync(path.join(ROOT, name), 'utf8').split('\n').length;

describe('harness entrypoint boundaries', () => {
  it('keeps the public pre-push CLI facade comfortably below 300 lines', () => {
    expect(lines('pre-push.mjs')).toBeLessThan(300);
  });

  it('preserves pre-push public exports through the facade', () => {
    expect(Object.keys(prePushFacade)).toEqual(
      expect.arrayContaining([
        'createPrePushSteps',
        'prerequisitesFor',
        'runPostVerdictGuard',
        'runPrePushGate',
      ]),
    );
    expect(prePushFacade.createPrePushSteps).toBe(prePushRuntime.createPrePushSteps);
  });
});
