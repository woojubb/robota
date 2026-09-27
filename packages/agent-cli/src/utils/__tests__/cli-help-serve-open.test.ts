import { describe, expect, it } from 'vitest';

import { printHelp } from '../cli-help.js';

/** #3289 §3 — `--serve --open`'s help line called the GUI a "web monitor". */
describe('printHelp — --serve --open', () => {
  it('describes the flag as serving Robota, not a "web monitor"', () => {
    const help = printHelp();
    expect(help).toContain('--serve --open             Serve Robota over localhost');
    expect(help.toLowerCase()).not.toContain('web monitor');
  });
});
