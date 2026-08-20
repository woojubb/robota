import { describe, expect, it } from 'vitest';

import { buildPresetSurfaceOptions } from '../preset-surface-options.js';

import type { IServeModePresetOptions } from '../../modes/serve-mode.js';
import type { IPrintModePresetOptions } from '../../modes/print-mode.js';
import type { IPresetSurfaceOptions } from '../preset-surface-options.js';
import type { IResolvedPresetOptions } from '@robota-sdk/agent-preset';

/**
 * ARCH-041 — the projection is declared ONCE.
 *
 * `IPresetSurfaceOptions` claimed that "adding a field here now reaches every surface at once, which
 * is the only property that makes this worth extracting". It did not hold: `print-mode.ts` and
 * `serve-mode.ts` each declared their own copy, and the three had already drifted — `model` was on
 * print mode's copy and on neither of the others. That is the shape ARCH-013 was filed about,
 * surviving the extraction meant to end it.
 *
 * WHERE THE ENFORCEMENT ACTUALLY IS, stated because the first draft of this file implied otherwise:
 * the single-declaration property is enforced by the TYPECHECK, not by this runner. Vitest does not
 * typecheck, so the assignment case below passes whether or not a mode re-declares its own copy —
 * measured, not assumed: re-declaring `IPrintModePresetOptions` produces 12 `tsgo` errors and 3
 * green vitest cases.
 *
 * `pnpm typecheck` is a stage of `harness:verify-like-ci`, so the gate is real; it is simply not this
 * file. The assignment case is kept because it FAILS THE BUILD at the point a copy reappears, and
 * because it names the property in the place someone editing these types will look — but it is
 * documentation of a compile-time contract, not a runtime assertion, and calling it the latter would
 * be the "case that cannot fail on the condition it names" defect this repository scans for.
 *
 * The two `model` cases below are ordinary runtime assertions and do fail on their condition:
 * dropping the projection turns the first red.
 */
describe('the preset surface projection is declared once (ARCH-041)', () => {
  it('both mode surfaces accept every field of the shared projection', () => {
    // If either mode re-declares its own shape, a field the shared type has and the copy lacks makes
    // these assignments stop compiling — which is the failure this case exists to cause.
    const everyField: Required<IPresetSurfaceOptions> = {
      model: 'some-model',
      agentName: 'acme-bot',
      activePresetId: 'acme',
      persona: 'be brief',
      permissionMode: 'default',
      enableParallelSubagents: true,
      selfVerification: true,
      effort: 'high',
    };

    const print: IPrintModePresetOptions = everyField;
    const serve: IServeModePresetOptions = everyField;

    expect(print.model).toBe('some-model');
    expect(serve.model).toBe('some-model');
  });

  it('projects `model` from the resolved preset (ARCH-040 / ARCH-041)', () => {
    // The field that measured the drift. It reaches the shared projection now, so it arrives at all
    // three surfaces rather than at the one someone remembered.
    const resolved = { model: 'preset-model', agentName: 'acme-bot' } as IResolvedPresetOptions;
    expect(buildPresetSurfaceOptions(resolved, 'acme', 'default').model).toBe('preset-model');
  });

  it('omits `model` entirely when the preset names none, so the shell’s fallback survives', () => {
    // The shell computes `resolvedPreset.model ?? providerSettings.model` and spreads this object
    // over its own key. An explicitly-undefined `model` would clobber that fallback; an ABSENT key
    // cannot. The two answers can never disagree, which is why the fallback stays where it is.
    const surface = buildPresetSurfaceOptions({} as IResolvedPresetOptions, 'acme', 'default');
    expect('model' in surface).toBe(false);
  });
});
