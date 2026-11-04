import { AsyncLocalStorage } from 'node:async_hooks';

import type { IMCPCallContext, IMCPCallTraceScope } from '../client/trace-propagation.js';

/**
 * The call context Node provides: the scope of a tool call follows every asynchronous step the call
 * starts, through `AsyncLocalStorage`. Each carrier has its own storage.
 */
export function createNodeCallContext(): IMCPCallContext {
  const active = new AsyncLocalStorage<IMCPCallTraceScope>();
  return {
    run: (scope, run) => active.run(scope, run),
    current: () => active.getStore(),
  };
}
