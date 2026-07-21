/**
 * @robota-sdk/agent-framework/testing — test-only fixtures (TEST-003).
 *
 * The framework-level functional session harness (drives a REAL InteractiveSession via the
 * deterministic scripted provider) and the lightweight stub session. Never import from runtime
 * code; exported via the `./testing` subpath so test fixtures stay out of the runtime bundle.
 *
 * STRUCT-07: the deterministic scripted provider lives in `@robota-sdk/agent-core/testing` — import it FROM
 * THERE directly. This package must not pass-through re-export another package's symbols (no pass-through
 * re-exports rule); the previous `createScriptedProvider`/`IScriptedProvider`/`TScriptedTurn` re-exports were
 * removed here.
 */

export {
  scriptedSession,
  ScriptedSessionHarness,
  type IScriptedSessionOptions,
} from './scripted-session-harness.js';

export { createTestInteractiveSession } from './create-test-interactive-session.js';
