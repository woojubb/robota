import { describe, expect, it } from 'vitest';

import { restoreProjectedSandbox } from '../worker-composition.js';

/**
 * ARCH-033 — projecting a live owner-bound capability across the subagent process boundary.
 *
 * The parent may hold a sandbox client: an open session against a remote machine. A child-process
 * subagent is rebuilt from a RECIPE, and a recipe carries only what is a pure function of (execution
 * root, serialized payload, durable state) — so the live handle cannot cross.
 *
 * What CAN cross is the pair (which client type, which snapshot). `ISandboxClient.snapshot()` returns
 * a provider-owned reference and `restore(id)` hydrates a fresh client from it, and a reference is a
 * string. The composition root registers the constructor by type name, exactly as it registers
 * provider definitions; the recipe carries `{ type, snapshotId }`.
 *
 * The cases below are ordered by what they protect. The two that matter most are the failure ones:
 * an unregistered type must STOP the job rather than silently produce an unsandboxed child, and a
 * factory must receive the snapshot reference rather than being able to hand back an empty sandbox.
 */
describe('ARCH-033 — a sandbox projects by (type, snapshot), not by handle', () => {
  it('restores through the factory the composition root registered', async () => {
    const restored: string[] = [];
    const client = await restoreProjectedSandbox(
      { type: 'e2b', snapshotId: 'snap-42' },
      {
        e2b: async (snapshotId) => {
          restored.push(snapshotId);
          return { kind: 'e2b', from: snapshotId };
        },
      },
    );

    expect(client).toEqual({ kind: 'e2b', from: 'snap-42' });
    expect(restored, 'the factory was not given the snapshot reference').toEqual(['snap-42']);
  });

  it('THROWS on a type the composition did not register, rather than running unsandboxed', async () => {
    // The load-bearing case. A child told it is sandboxed, that quietly is not, is ARCH-010's shape —
    // the measured breach there was a subagent reading outside its root. Degrading to host tools here
    // would be the silent-success failure `enforcement-architecture.md` refuses.
    await expect(
      restoreProjectedSandbox(
        { type: 'e2b', snapshotId: 'snap-42' },
        { inMemory: async () => ({}) },
      ),
    ).rejects.toThrow(/sandbox type "e2b" is not registered/);
  });

  it('THROWS when the composition registered nothing at all', async () => {
    await expect(
      restoreProjectedSandbox({ type: 'e2b', snapshotId: 'snap-42' }, undefined),
    ).rejects.toThrow(/not registered/);
  });

  it('names the seam to register in, so the error is actionable', async () => {
    await expect(
      restoreProjectedSandbox({ type: 'e2b', snapshotId: 'snap-1' }, {}),
    ).rejects.toThrow(/sandboxFactories/);
  });

  it('is absent-safe: no projection means no sandbox, not an error', async () => {
    // A child with no projection is not a failure — it runs host tools at its own confined root,
    // which is the unsandboxed product's normal behaviour.
    await expect(restoreProjectedSandbox(undefined, {})).resolves.toBeUndefined();
    await expect(restoreProjectedSandbox(undefined, undefined)).resolves.toBeUndefined();
  });
});
