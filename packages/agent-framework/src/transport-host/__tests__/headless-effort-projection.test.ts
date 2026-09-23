import { describe, expect, it, vi } from 'vitest';

import type { IHeadlessInteractionChannelOptions } from '../headless/HeadlessInteractionChannel.js';

/**
 * ARCH-013 — the same field, at the surface that also had to remember it.
 *
 * A preset's resolved `effort` reached nothing at startup. Wiring it through the TUI alone would have
 * left print and serve mode dropping it, which is exactly the defect this item names: the projection
 * from resolved intent to session options is hand-written per surface, so a field is present wherever
 * someone remembered it and silently absent everywhere else.
 *
 * The projection is inline in `createSession()`, so `buildRuntimeSession` — the seam it builds
 * through — is stubbed and its argument inspected. That the check has to reach in this way is itself
 * a datum: nothing about this projection is separately addressable.
 */
const buildRuntimeSession = vi.fn((_options: unknown) => ({ dispose: () => undefined }));

vi.mock('../../runtime/runtime-host.js', async () => {
  const actual = await vi.importActual('../../runtime/runtime-host.js');
  return { ...actual, buildRuntimeSession: (options: unknown) => buildRuntimeSession(options) };
});

const { HeadlessInteractionChannel } = await import('../headless/HeadlessInteractionChannel.js');

function projectedOptions(
  effort?: IHeadlessInteractionChannelOptions['effort'],
): Record<string, unknown> {
  buildRuntimeSession.mockClear();
  const channel = new HeadlessInteractionChannel({
    cwd: '/tmp',
    ...(effort !== undefined ? { effort } : {}),
  } as IHeadlessInteractionChannelOptions);
  (channel as unknown as { createSession: () => unknown }).createSession();
  return buildRuntimeSession.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe('the headless projection carries effort (ARCH-013)', () => {
  it('forwards a resolved effort onto the session options', () => {
    expect(projectedOptions('medium')['effort']).toBe('medium');
  });

  it('omits the key when no effort was resolved', () => {
    // The framework→provider seam owns the default; a present-but-undefined key would claim a
    // decision nobody made.
    expect('effort' in projectedOptions()).toBe(false);
  });
});
