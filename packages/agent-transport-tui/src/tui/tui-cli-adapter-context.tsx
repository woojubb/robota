import { createContext, useContext } from 'react';
import type { ITuiCliAdapter } from './tui-cli-adapter.js';

const TuiCliAdapterContext = createContext<ITuiCliAdapter | null>(null);

export const TuiCliAdapterProvider = TuiCliAdapterContext.Provider;

export function useTuiCliAdapter(): ITuiCliAdapter {
  const adapter = useContext(TuiCliAdapterContext);
  if (!adapter) throw new Error('TuiCliAdapterContext not provided');
  return adapter;
}
