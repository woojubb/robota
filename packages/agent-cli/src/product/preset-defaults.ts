import type { ICliRuntimeContext } from './runtime-context.js';

export function productDefaultAgentName(runtime: ICliRuntimeContext): string { return runtime.config.identity.displayName; }
