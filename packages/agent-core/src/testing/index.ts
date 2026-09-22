/**
 * @robota-sdk/agent-core/testing — test-only fixtures (TEST-003).
 *
 * The deterministic scripted provider SSOT. Never import this from runtime code; it is consumed by
 * functional tests and re-exported by higher-layer `./testing` subpaths.
 */

export { createScriptedProvider } from './scripted-provider.js';
export type { IScriptedProvider, TScriptedTurn } from './scripted-provider.js';

export { createRecordingProvider, createReplayProvider } from './cassette-provider.js';
export type {
  ICassette,
  ICassetteInteraction,
  IRecordingProviderOptions,
  IReplayProviderOptions,
} from './cassette-provider.js';

// MCP-005: the shared tool-schema-projection fixture set, so every provider's conformance test (S2)
// exercises the same shapes agent-core's own projector tests do.
export { loadToolSchemaProjectionFixtures } from './tool-schema-projection-fixtures.js';
export type { IToolSchemaProjectionFixtures } from './tool-schema-projection-fixtures.js';
