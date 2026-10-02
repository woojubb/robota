import type { ICliRuntimeContext } from './runtime-context.js';

export function productPermissionBaseline(runtime: ICliRuntimeContext) { return runtime.layout.baselinePermissionAllow; }
