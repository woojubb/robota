import type {
  IInteractiveSessionInjectedOptions,
  IInteractiveSessionStandardOptions,
} from '../interactive-session-options.js';
import { expect, it } from 'vitest';
import type { IAIProvider } from '@robota-sdk/agent-core';
import type { Session } from '@robota-sdk/agent-session';

const provider = null as unknown as IAIProvider;
const session = null as unknown as Session;

const standardPermission: IInteractiveSessionStandardOptions = {
  cwd: '/tmp/arch-017',
  provider,
  // @ts-expect-error ARCH-017: session-level permission callbacks are obsolete.
  permissionHandler: async () => true,
};

const standardAsk: IInteractiveSessionStandardOptions = {
  cwd: '/tmp/arch-017',
  provider,
  // @ts-expect-error ARCH-017: session-level ask callbacks are obsolete.
  askHandler: async () => ({ type: 'cancelled' }),
};

const injectedPermission: IInteractiveSessionInjectedOptions = {
  session,
  // @ts-expect-error ARCH-017: injected sessions do not accept a dead permission callback.
  permissionHandler: async () => true,
};

const injectedAsk: IInteractiveSessionInjectedOptions = {
  session,
  // @ts-expect-error ARCH-017: injected sessions do not accept a dead ask callback.
  askHandler: async () => ({ type: 'cancelled' }),
};

void [standardPermission, standardAsk, injectedPermission, injectedAsk];

it('keeps obsolete prompt options rejected by the public type contract', () => {
  expect(true).toBe(true);
});
