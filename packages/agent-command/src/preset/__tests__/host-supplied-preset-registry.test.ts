import { describe, expect, it, vi } from 'vitest';

import { executePresetCommand } from '../preset-command.js';

/**
 * ARCH-009 — `/preset` discovers through the registry the HOST resolved with.
 *
 * ARCH-008 moved startup preset resolution onto a per-call instance registry, but `/preset` kept
 * reading `agent-preset`'s module-global one, because a command runs with only an
 * `ICommandHostContext` and had no path to the instance the shell built. That left the last mutable
 * process-global on this axis load-bearing, and it made ARCH-008's R8 property — two products in one
 * process, each with its own presets — only half-true: both would have shared one registry.
 *
 * The registry arrives in the host-ADAPTER bag, the path `/permission-mode` and `/plugin` already take
 * to their host capabilities. A capability the composition root supplies is what that bag is for, and
 * reusing it means this seam has no shape of its own to get wrong.
 *
 * The decisive case is the last one. Everything else is a property of a single host; only "two hosts,
 * one process" is impossible to satisfy with a global, which is why it is the one that proves the
 * seam rather than merely exercising it.
 */
function presetSummary(id: string) {
  return { id, title: `${id} title`, description: `${id} description` };
}

/** A host whose registry contains exactly the ids it was built with. */
function hostWithPresets(ids: string[]) {
  const applied: string[] = [];
  return {
    applied,
    context: {
      getCommandHostAdapters: () => ({
        presetRegistry: {
          listPresets: () => ids.map(presetSummary),
          getPreset: (id: string) => (ids.includes(id) ? presetSummary(id) : undefined),
          resolvePreset: (id: string) => ({ id }),
        },
      }),
      getSession: () => ({ getActivePresetId: () => 'default' }),
      getUserInteraction: () => undefined,
      applyPersona: vi.fn(),
      applySelfVerification: vi.fn(),
      applyCommandModuleSelection: () => [],
    } as never,
  };
}

describe('ARCH-009 — /preset reads the host-supplied registry', () => {
  it('lists the host registry, not the built-ins', async () => {
    const { context } = hostWithPresets(['acme-reviewer']);

    const result = await executePresetCommand(context, 'list');

    expect(result.message).toContain('acme-reviewer');
    // `careful-reviewer` is a shipped built-in and is what the no-registry fallback would list. Its
    // absence here is what shows the fallback was not taken.
    expect(result.message).not.toContain('careful-reviewer');
  });

  it('rejects an id the HOST does not have, even though a built-in would resolve it', async () => {
    const { context } = hostWithPresets(['acme-reviewer']);

    const result = await executePresetCommand(context, 'careful-reviewer');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Unknown preset');
  });

  it('falls back to the built-ins when the host supplies no registry', async () => {
    // Deliberate, not transitional: a host that never loads external presets has nothing to hand
    // over, and `/preset` should still list the built-ins rather than reporting an empty catalog.
    const context = {
      getSession: () => ({ getActivePresetId: () => 'default' }),
      getUserInteraction: () => undefined,
      applyPersona: vi.fn(),
      applySelfVerification: vi.fn(),
      applyCommandModuleSelection: () => [],
    } as never;

    const result = await executePresetCommand(context, 'list');

    expect(result.success).toBe(true);
    expect(result.message).toContain('Available presets:');
  });

  it('gives two hosts in ONE process their own presets — the property a global makes impossible', async () => {
    const first = hostWithPresets(['acme-reviewer']);
    const second = hostWithPresets(['globex-auditor']);

    const firstList = await executePresetCommand(first.context, 'list');
    const secondList = await executePresetCommand(second.context, 'list');

    expect(firstList.message).toContain('acme-reviewer');
    expect(firstList.message).not.toContain('globex-auditor');
    expect(secondList.message).toContain('globex-auditor');
    expect(secondList.message).not.toContain('acme-reviewer');
  });
});
