/**
 * Issue #3282 §3 — first run in the GUI. When `the product --serve` (or a daemon-launched child, which is
 * the same serve path) finds no usable provider configuration, it no longer exits: it starts in setup
 * mode with this placeholder standing in for `IAIProvider`, so the runtime session, transport and GUI
 * all come up normally. The placeholder never reaches a model — every call path throws a plain `Error`
 * that the session surfaces as a normal turn failure (never a crash), and `InteractiveSession.submit`
 * (agent-framework) refuses a turn outright while `setupRequired` is set, so in practice these methods
 * are a backstop for a client that submits before the GUI's setup screen has cleared the flag.
 *
 * The TUI and print mode are unaffected: they keep exiting on a missing provider, exactly as before.
 */

import type { IAIProvider, IProviderRequest, IRawProviderResponse } from '@robota-sdk/agent-core';

/** The model name a placeholder session reports until a real provider is configured. */
export const SETUP_PLACEHOLDER_MODEL = 'setup-required';

function setupRequiredError(): Error {
  return new Error('Connect a model provider to start.');
}

/** An `IAIProvider` that never calls a model — see the module doc comment. */
export function createSetupPlaceholderProvider(): IAIProvider {
  return {
    name: 'setup-placeholder',
    version: '0',
    chat(): Promise<never> {
      return Promise.reject(setupRequiredError());
    },
    generateResponse(_payload: IProviderRequest): Promise<IRawProviderResponse> {
      return Promise.reject(setupRequiredError());
    },
    supportsTools(): boolean {
      return false;
    },
    validateConfig(): boolean {
      return false;
    },
  };
}
