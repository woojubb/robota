import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { collectNamedMechanismFindings } from '../scan-named-mechanism-resolves.mjs';

/**
 * ACCEPTANCE CRITERION (written before the scan).
 *
 * A rule saying "use X" where X is absent is worse than a rule with no mechanism at all. The
 * unmechanized rule is honestly prose and a reader treats it as judgement; the phantom one reads as
 * satisfiable, so a reader either believes the obligation was met or drops it silently, and nothing
 * afterwards distinguishes either from compliance.
 *
 * The scan FAILS when a rule or routing document names, by identity, a harness script, a hook, a
 * package script, or an MCP server that does not resolve in this repository or its declared
 * environment.
 */

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../..');

describe('scan-named-mechanism-resolves', () => {
  it('is registered in run-all-scans.mjs', () => {
    const runner = readFileSync(
      path.join(WORKSPACE_ROOT, 'scripts/harness/run-all-scans.mjs'),
      'utf8',
    );
    expect(runner).toContain('scan-named-mechanism-resolves.mjs');
  });

  it('passes on the live repository', () => {
    expect(collectNamedMechanismFindings()).toEqual([]);
  });

  it('asserts presence, never behaviour', () => {
    // Correctness of a named mechanism is owned by guards-pass-silently and
    // hooks-have-execution-coverage. This floor sits beneath them: those scans cannot judge a
    // file that is not there. Naming an existing-but-inert mechanism must therefore pass here.
    expect(collectNamedMechanismFindings()).toEqual([]);
  });
});
