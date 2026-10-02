import type { ICliRuntimeContext } from './runtime-context.js';

export function productProjectStateDirectories(runtime: ICliRuntimeContext) { return runtime.layout.projectStateDirectories; }
