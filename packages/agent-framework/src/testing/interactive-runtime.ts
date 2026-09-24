import { createInteractiveRuntimeWithSessionFactory } from '../interaction/createInteractiveRuntime.js';

import type { IInteractiveRuntime } from '../interaction/InteractiveRuntime.js';
import type { IInteractiveRuntimeTestOptions } from '../interaction/createInteractiveRuntime.js';
import type { IInteractiveSession } from '../interactive/i-interactive-session.js';

/** Create an interactive runtime around a test double without weakening production options. */
export function createInteractiveRuntimeForTesting(
  options: IInteractiveRuntimeTestOptions,
  session: IInteractiveSession,
): IInteractiveRuntime {
  return createInteractiveRuntimeWithSessionFactory(options, () => session);
}
