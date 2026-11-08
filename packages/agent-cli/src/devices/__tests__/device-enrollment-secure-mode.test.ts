/**
 * Linking a device opens WebRTC peers outside the mesh host, so both sides of an
 * enrollment open under the `device-mesh` row. Under the secure-mode test seam the existing device
 * shows no code and never waits on the relay, and the joining device never dials.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  cleanupTestProductRuntimes,
  createTestProductRuntime,
} from '../../__tests__/helpers/product-runtime.js';
import { overrideProductSecureMode } from '../../product/session-sealing.js';
import { SecureSurfaceRefusedError } from '../../secure/secure-surfaces.js';
import { joinEnrollment, offerEnrollment } from '../device-enrollment.js';

import type { IMeshRelay } from '@robota-sdk/agent-transport-webrtc';

afterEach(() => cleanupTestProductRuntimes());

function secureEnvironment() {
  const productRuntime = createTestProductRuntime();
  overrideProductSecureMode(productRuntime, true);
  const relay = {
    declarePresence: vi.fn(),
    send: vi.fn(),
    onMessage: vi.fn(() => () => undefined),
    onAbsent: vi.fn(() => () => undefined),
    close: vi.fn(),
  };
  return {
    relay,
    environment: {
      productRuntime,
      directory: '/nonexistent/devices',
      store: {} as never,
      relay: relay as unknown as IMeshRelay,
      now: () => 0,
      operator: {} as never,
      cancelled: new AbortController().signal,
    },
  };
}

describe('device enrollment in secure mode', () => {
  it('shows no code and never waits for a device on the existing device', async () => {
    const { relay, environment } = secureEnvironment();
    const showCode = vi.fn();

    await expect(
      offerEnrollment({
        ...environment,
        before: {} as never,
        signingKey: {} as never,
        showCode,
      }),
    ).rejects.toBeInstanceOf(SecureSurfaceRefusedError);
    expect(showCode).not.toHaveBeenCalled();
    expect(relay.onMessage).not.toHaveBeenCalled();
  });

  it('never dials from the joining device', async () => {
    const { relay, environment } = secureEnvironment();

    const outcome = await joinEnrollment({
      ...environment,
      material: {} as never,
      name: 'laptop',
    });

    expect(outcome).toEqual({ ok: false, reason: 'enrollment-failed' });
    expect(relay.onMessage).not.toHaveBeenCalled();
  });
});
