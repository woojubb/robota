/**
 * @robota-sdk/agent-framework/testing — test-only fixtures (TEST-003).
 *
 * The framework-level functional session harness (drives a REAL InteractiveSession via the
 * deterministic scripted provider) and the lightweight stub session. Never import from runtime
 * code; exported via the `./testing` subpath so test fixtures stay out of the runtime bundle.
 *
 * The deterministic scripted provider itself lives in `@robota-sdk/agent-core/testing`; re-exported
 * here for convenience so a functional test imports turns + harness from one place.
 */

export {
  scriptedSession,
  ScriptedSessionHarness,
  type IScriptedSessionOptions,
} from './scripted-session-harness.js';

export { createTestInteractiveSession } from './create-test-interactive-session.js';

export { createScriptedProvider } from '@robota-sdk/agent-core/testing';
export type { IScriptedProvider, TScriptedTurn } from '@robota-sdk/agent-core/testing';
