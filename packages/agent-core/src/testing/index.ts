/**
 * @robota-sdk/agent-core/testing — test-only fixtures (TEST-003).
 *
 * The deterministic scripted provider SSOT. Never import this from runtime code; it is consumed by
 * functional tests and re-exported by higher-layer `./testing` subpaths.
 */

export { createScriptedProvider } from './scripted-provider.js';
export type { IScriptedProvider, TScriptedTurn } from './scripted-provider.js';
