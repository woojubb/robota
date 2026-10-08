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
