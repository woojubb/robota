import type { ICliRuntimeContext } from './runtime-context.js';

export function productTaskContext(runtime: ICliRuntimeContext) { return runtime.layout.taskContext; }
