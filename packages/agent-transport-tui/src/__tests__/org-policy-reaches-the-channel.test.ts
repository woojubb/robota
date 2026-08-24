/**
 * CLI-083 (issue #2287) — the org policy survives the TUI projection.
 *
 * `toChannelOptions` builds the channel's options field by field. `orgPolicy` was not among them, so
 * a policy forwarded from the shell arrived here and was dropped, and `blockedCommands` enforcement
 * stayed dead on the plain `robota` path — the most common one — after two rounds of wiring it.
 *
 * The reason it was silent is worth keeping: the shell forwards with
 * `...(orgPolicy === null ? {} : { orgPolicy })`, and a SPREAD BYPASSES TypeScript's excess-property
 * check. Written as `orgPolicy,` it would not have compiled against an `IRenderOptions` that lacks
 * the field. The idiom chosen to be safe about optionality disabled the check that would have caught
 * the missing declaration.
 */

import { describe, expect, it } from 'vitest';

import { toChannelOptions } from '../render.js';

import type { IRenderOptions } from '../render.js';

const POLICY = { blockedCommands: ['clear'], adminContact: 'ops@x' };

function renderOptions(extra: Partial<IRenderOptions> = {}): IRenderOptions {
  return { cwd: '/work', provider: {} as never, ...extra } as IRenderOptions;
}

describe('CLI-083: the TUI projection carries the org policy', () => {
  it('copies a supplied policy into the channel options', () => {
    const channel = toChannelOptions(renderOptions({ orgPolicy: POLICY as never }));

    expect((channel as { orgPolicy?: unknown }).orgPolicy).toEqual(POLICY);
  });

  it('carries none when none was supplied, so absence stays distinguishable', () => {
    const channel = toChannelOptions(renderOptions());

    expect((channel as { orgPolicy?: unknown }).orgPolicy).toBeUndefined();
  });
});
