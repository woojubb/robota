import { createContext, useContext } from 'react';

import type { ITuiCliAdapter } from './tui-cli-adapter.js';

const TuiCliAdapterContext = createContext<ITuiCliAdapter | null>(null);

export const TuiCliAdapterProvider = TuiCliAdapterContext.Provider;

export function useTuiCliAdapter(): ITuiCliAdapter {
  const adapter = useContext(TuiCliAdapterContext);
  if (!adapter) throw new Error('TuiCliAdapterContext not provided');
  return adapter;
}

/** The command this terminal unlocks with, as the product registers it beside the key custody port. */
const UNLOCK_COMMAND = '/unlock';

/**
 * `/unlock` where this terminal holds keys it can unlock (the adapter carries the key custody port),
 * else `undefined`: a refusal names the command only where the person can run it. Reads the adapter
 * without requiring one, since surfaces that render no adapter have no `/unlock` either.
 */
export function useUnlockCommand(): string | undefined {
  return useContext(TuiCliAdapterContext)?.keyCustody === undefined ? undefined : UNLOCK_COMMAND;
}
