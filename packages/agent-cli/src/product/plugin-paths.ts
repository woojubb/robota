import { join } from 'node:path';
import type { ICliRuntimeContext } from './runtime-context.js';

export function productPluginDirectories(cwd: string, runtime: ICliRuntimeContext): { readonly project: string; readonly user: string } {
  return { project: join(cwd, runtime.layout.pluginRelativeDirectory), user: join(runtime.layout.userRoot, 'plugins') };
}
