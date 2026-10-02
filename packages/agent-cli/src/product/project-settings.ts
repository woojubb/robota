import type { ICliRuntimeContext } from './runtime-context.js';

export function productProjectSettings(runtime: ICliRuntimeContext) { return runtime.layout.projectSettingsPaths; }
