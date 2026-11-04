import { resolve } from 'node:path';

import type { ICliRuntimeContext } from './runtime-context.js';

/** Every path belongs to the caller's resolved product instance. */
export function userPaths(runtime: ICliRuntimeContext): ICliRuntimeContext['layout']['userPaths'] {
  return runtime.layout.userPaths;
}

/**
 * The user-local storage root, complete for this platform. The framework's user-local storage takes
 * only a root it can place without the process directory, so this Node root resolves it first: a
 * spelling that is absolute to `node:path` yet takes its drive from the process (a Windows
 * `\state`, which the product configuration accepts) arrives with its drive.
 */
export function userLocalStorageRoot(runtime: ICliRuntimeContext): string {
  return resolve(runtime.layout.userRoot);
}
