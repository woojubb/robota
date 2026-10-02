import type { ICliRuntimeContext } from './runtime-context.js';

/** Every path belongs to the caller's resolved product instance. */
export function userPaths(runtime: ICliRuntimeContext): ICliRuntimeContext['layout']['userPaths'] {
  return runtime.layout.userPaths;
}

export function userLocalStorageRoot(runtime: ICliRuntimeContext): string {
  return runtime.layout.userRoot;
}
