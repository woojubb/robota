/**
 * #3679 3f PR 3a — the one table of what every product surface may be in secure mode, and the one gate
 * every listener opens through. Plain mode must not notice the gate: it opens exactly what it opened
 * before. Secure mode (still only reachable through the test seam) refuses a refused row before
 * anything binds, and opens the rows the design keeps.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cleanupTestProductRuntimes,
  createTestProductRuntime,
} from '../../__tests__/helpers/product-runtime.js';
import { overrideProductSecureMode } from '../../product/session-sealing.js';
import {
  LISTENER_SURFACES,
  PROCESS_SURFACES,
  SECURE_SURFACES,
  SecureSurfaceRefusedError,
  startListener,
} from '../secure-surfaces.js';

import type { TListenerSurface } from '../secure-surfaces.js';

afterEach(() => cleanupTestProductRuntimes());

/** The secure dispositions of the decided design (change 6), row by row. */
const KEPT: Partial<Record<TListenerSurface, string>> = {
  'control-socket': 'owner-link',
  'oauth-callback': 'oauth-callback',
};

describe('SECURE_SURFACES', () => {
  it('has exactly one row per surface, each naming its own surface', () => {
    const surfaces = [...PROCESS_SURFACES, ...LISTENER_SURFACES];
    expect(new Set(surfaces).size).toBe(surfaces.length);
    expect(Object.keys(SECURE_SURFACES).sort()).toEqual([...surfaces].sort());
    for (const surface of surfaces) expect(SECURE_SURFACES[surface].surface).toBe(surface);
  });

  it('gives every row a plain disposition and a secure one', () => {
    for (const row of Object.values(SECURE_SURFACES)) {
      expect(row.plain.trim().length, row.surface).toBeGreaterThan(0);
      expect(row.secure.admit, row.surface).toMatch(
        /^(own-process|owner-link|oauth-callback|none)$/,
      );
    }
  });

  it('keeps the control socket and OAuth callbacks, and refuses every other listener with a reason', () => {
    for (const surface of LISTENER_SURFACES) {
      const { secure } = SECURE_SURFACES[surface];
      expect(secure.admit, surface).toBe(KEPT[surface] ?? 'none');
      if (secure.admit === 'none') expect(secure.reason, surface).toMatch(/secure mode.*\.$/);
    }
  });

  it('lets only the terminal ask for a secret, and unlocks a supervised runtime only by a grant', () => {
    expect(SECURE_SURFACES.tui.secure).toEqual({ admit: 'own-process', unlock: 'terminal' });
    for (const surface of ['print', 'acp', 'mcp-stdio'] as const) {
      expect(SECURE_SURFACES[surface].secure, surface).toEqual({
        admit: 'own-process',
        unlock: 'never',
      });
    }
    expect(SECURE_SURFACES['supervised-runtime'].secure).toEqual({
      admit: 'owner-link',
      unlock: 'grant',
    });
  });
});

describe('startListener in plain mode', () => {
  it.each(LISTENER_SURFACES)(
    'opens %s once and hands back what opening returned',
    async (surface) => {
      const runtime = createTestProductRuntime();
      const listener = { port: 4242 };
      const open = vi.fn(() => Promise.resolve(listener));

      await expect(startListener(SECURE_SURFACES[surface], runtime, open)).resolves.toBe(listener);
      expect(open).toHaveBeenCalledTimes(1);
    },
  );

  it('returns the promise opening returned, so a failure to bind is the same failure', async () => {
    const runtime = createTestProductRuntime();
    const failure = Object.assign(new Error('listen EADDRINUSE'), { code: 'EADDRINUSE' });
    const opening = Promise.reject(failure);

    const started = startListener(SECURE_SURFACES['serve-http'], runtime, () => opening);

    expect(started).toBe(opening);
    await expect(started).rejects.toBe(failure);
  });
});

describe('startListener in secure mode', () => {
  const refused = LISTENER_SURFACES.filter(
    (surface) => SECURE_SURFACES[surface].secure.admit === 'none',
  );

  it.each(refused)('refuses %s with its reason before anything binds', async (surface) => {
    const runtime = createTestProductRuntime();
    overrideProductSecureMode(runtime, true);
    const open = vi.fn(() => Promise.resolve('bound'));
    const rule = SECURE_SURFACES[surface];

    // A rejected promise, never a throw: a caller that only attaches `.catch` still sees it.
    const started = startListener(rule, runtime, open);

    await expect(started).rejects.toBeInstanceOf(SecureSurfaceRefusedError);
    await expect(started).rejects.toMatchObject({
      surface,
      message: rule.secure.admit === 'none' ? rule.secure.reason : '',
    });
    expect(open).not.toHaveBeenCalled();
  });

  it.each(Object.keys(KEPT) as TListenerSurface[])(
    'opens %s, which secure mode keeps',
    async (surface) => {
      const runtime = createTestProductRuntime();
      overrideProductSecureMode(runtime, true);
      const open = vi.fn(() => Promise.resolve('bound'));

      await expect(startListener(SECURE_SURFACES[surface], runtime, open)).resolves.toBe('bound');
      expect(open).toHaveBeenCalledTimes(1);
    },
  );

  it('reads the mode of the runtime it is given, not of another one', async () => {
    const secure = createTestProductRuntime();
    overrideProductSecureMode(secure, true);
    const plain = createTestProductRuntime();
    const open = vi.fn(() => Promise.resolve('bound'));

    await expect(startListener(SECURE_SURFACES['serve-http'], plain, open)).resolves.toBe('bound');
    await expect(startListener(SECURE_SURFACES['serve-http'], secure, open)).rejects.toBeInstanceOf(
      SecureSurfaceRefusedError,
    );
    expect(open).toHaveBeenCalledTimes(1);
  });
});
