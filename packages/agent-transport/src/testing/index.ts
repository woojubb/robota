/**
 * Test-only fixtures (CLI-074). Exported via the `./testing` subpath; never import
 * from runtime code.
 */

export { createScriptedProvider } from './scripted-provider.js';
export type { IScriptedProvider, TScriptedTurn } from './scripted-provider.js';
