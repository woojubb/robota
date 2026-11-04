import { enableOwnChildSessions } from '@robota-sdk/agent-core/node';

import { productSecureMode } from './session-sealing.js';

import type { ICliRuntimeContext } from './runtime-context.js';

/** All spawn paths inherit this invocation's product inputs rather than a foreign ambient product. */
export function installProductProcessEnvironment(
  runtime: ICliRuntimeContext,
  target: NodeJS.ProcessEnv = process.env,
): void {
  const prefix = runtime.config.identity.envPrefix;
  const owns = (key: string): boolean =>
    /^(?:PRODUCT|PROJECT|SERVICE|SECURITY|DEPLOY)_/u.test(key) || key.startsWith(prefix);
  for (const key of Object.keys(target)) if (owns(key)) delete target[key];
  for (const [key, value] of Object.entries(runtime.environment)) {
    if (owns(key) && value !== undefined) target[key] = value;
  }
}

/**
 * Children in their own session exactly when secure mode is on for this invocation's state root, so
 * none of them shares the terminal a secret is typed at. Called by every entry beside
 * {@link installProductProcessEnvironment}, before the entry starts any process; plain mode leaves
 * spawning as it was.
 */
export function installProductChildSessions(runtime: ICliRuntimeContext): void {
  if (productSecureMode(runtime)) enableOwnChildSessions();
}
