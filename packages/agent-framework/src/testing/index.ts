/**
 * @robota-sdk/agent-framework/testing — test-only fixtures.
 *
 * The framework-level functional session harness (drives a REAL InteractiveSession via the
 * deterministic scripted provider) and the lightweight stub session. Never import from runtime
 * code; exported via the `./testing` subpath so test fixtures stay out of the runtime bundle.
 *
 * The deterministic scripted provider lives in `@robota-sdk/agent-core/testing` — import it FROM
 * THERE directly. This package must not pass-through re-export another package's symbols (no pass-through
 * re-exports rule); the previous `createScriptedProvider`/`IScriptedProvider`/`TScriptedTurn` re-exports were
 * removed here.
 */

export {
  scriptedSession,
  ScriptedSessionHarness,
  type IScriptedSessionOptions,
} from './scripted-session-harness.js';

// `createTestInteractiveSession` moved to `@robota-sdk/agent-interface-session/testing`,
// beside the contract it doubles — the transports that need it all sit BELOW this package and could
// never import it from here. It is NOT re-exported: pass-through re-exports of another package's
// symbols are banned (project-structure.md), and this one had zero importers.

// The conformant, cast-free `ICommandHostContext` double. Lives beside the contract it
// doubles (this package owns it), so all three consumer packages reach it with no new dependency edge
// — the property that removes the need for casts.
export {
  createTestSessionRuntime,
  createTestCommandHost,
  type ICreateTestCommandHostOptions,
} from './command-host-double.js';

export { createTestAgentJobHost } from './agent-job-host-double.js';

export { createInteractiveRuntimeForTesting } from './interactive-runtime.js';

// The Node host with the real default tools, for the `host` every session, runtime and query takes.
export { createTestFrameworkHost } from './framework-host.js';
