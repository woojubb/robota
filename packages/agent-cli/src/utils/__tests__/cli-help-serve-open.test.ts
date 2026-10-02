import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { describe, expect, it } from 'vitest';

import { printHelp } from '../cli-help.js';

/** #3289 §3 — `--serve --open`'s help line called the GUI a "web monitor". */
describe('printHelp — --serve --open', () => {
  it('describes the flag as serving test-product Agent, not a "web monitor"', () => {
    const help = printHelp(createTestProductRuntime());
    expect(help).toContain('--serve --open             Serve test-product Agent over localhost');
    expect(help.toLowerCase()).not.toContain('web monitor');
  });
});
