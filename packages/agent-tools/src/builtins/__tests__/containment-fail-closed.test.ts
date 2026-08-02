import { describe, expect, it } from 'vitest';

import { createReadTool } from '../read-tool.js';
import { checkPathWithinCwd, isWithinCwd } from '../path-guard.js';

/**
 * ARCH-010 — the containment guard used to be FAIL-OPEN: with no root configured it answered
 * "allowed" and every builtin let the path through.
 *
 * That default is why the strongest multi-sighting in the architecture audit exists. `pack-coding`
 * documented the consequence in its own source — "file tools constructed with no options carry a
 * DISARMED working-directory guard: their `Read` will happily return `/etc/hostname`" — and the
 * child-process subagent worker called `createDefaultTools()` with no argument, so that is exactly
 * what a subagent got.
 *
 * A guard whose default is "allow" is not a guard; it is a guard that has to be remembered. The
 * root is now required by the contract, and the predicate refuses when it is absent, so forgetting
 * it fails loudly at the type level and closed at runtime rather than silently returning content.
 */
const OUTSIDE = '/etc/hostname';

describe('containment is fail-closed without a root (ARCH-010)', () => {
  it('isWithinCwd REFUSES when no containment root is configured', () => {
    // Was `true`. Nothing about "I do not know where the boundary is" means "inside it".
    expect(isWithinCwd(OUTSIDE, undefined)).toBe(false);
  });

  it('isWithinCwd still answers normally when a root IS configured', () => {
    // The inversion must not turn the guard into a blanket refusal — it still has to say yes.
    expect(isWithinCwd(`${process.cwd()}/package.json`, process.cwd())).toBe(true);
    expect(isWithinCwd(OUTSIDE, process.cwd())).toBe(false);
  });

  it('checkPathWithinCwd returns a refusal, not undefined, when no root is configured', () => {
    const error = checkPathWithinCwd(OUTSIDE, undefined);
    // `undefined` here means "no objection" and is what let the read proceed.
    expect(error).toBeDefined();
    const parsed = JSON.parse(error ?? '{}') as { success: boolean; error?: string };
    expect(parsed.success).toBe(false);
    // The message has to say WHICH failure this is: an unconfigured guard is an assembly bug, and a
    // caller told only "outside the working directory" would go looking for the wrong thing.
    expect(parsed.error).toMatch(/no containment root/i);
  });

  it('a Read built with no containment root REFUSES an absolute path instead of returning it', async () => {
    // The end-to-end shape of the defect, stated as `pack-coding`'s doc comment states it. This is
    // the tool a subagent got from the bare `createDefaultTools()` call.
    // Reaching past the type on purpose: `cwd` is REQUIRED now, so a TypeScript caller cannot build
    // this. A JavaScript consumer can, which is why the guard refuses at runtime rather than trusting
    // the type to be the boundary.
    const read = createReadTool({} as never);
    const result = (await read.execute({ filePath: OUTSIDE })) as { data: string };
    const parsed = JSON.parse(result.data) as { success: boolean; error?: string; output?: string };

    expect(parsed.success).toBe(false);
    expect(parsed.error).toMatch(/no containment root/i);
    // The measured failure before the fix was not an assertion about a flag — it was the file. This
    // returned `[File: /etc/hostname (1 lines)]\n1\tserver`.
    expect(parsed.output ?? '').not.toMatch(/etc\/hostname/);
  });
});
