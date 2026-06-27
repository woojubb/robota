/**
 * Test-only fixtures. Exported via the `./testing` subpath; never import from runtime code.
 *
 * The deterministic scripted provider SSOT now lives in `@robota-sdk/agent-core/testing`
 * (TEST-003) so framework-level functional tests can reach it without a reverse dependency on
 * `agent-transport`. This subpath re-exports it for existing transport/CLI E2E consumers.
 */

export { createScriptedProvider } from '@robota-sdk/agent-core/testing';
export type { IScriptedProvider, TScriptedTurn } from '@robota-sdk/agent-core/testing';
