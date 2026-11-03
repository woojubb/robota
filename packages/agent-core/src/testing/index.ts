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

// An in-memory IArtifactSealer for the tests of packages that write sealed artifacts, so they need no keyring.
export { createTestArtifactSealer, openTestWriteGrant } from './artifact-sealer-double.js';
export type {
  IArtifactSealerDouble,
  IArtifactSealerDoubleOptions,
} from './artifact-sealer-double.js';

// Process-scoped directories as another run left them, owner record included, for host sweep tests.
export {
  goneProcessOwner,
  leaveProcessScopedDirectory,
} from './process-scoped-directory-fixture.js';
