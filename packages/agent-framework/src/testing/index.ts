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

// ARCH-012: `createTestInteractiveSession` moved to `@robota-sdk/agent-interface-transport/testing`,
// beside the contract it doubles — the transports that need it all sit BELOW this package and could
// never import it from here. It is NOT re-exported: pass-through re-exports of another package's
// symbols are banned (STRUCT-07, project-structure.md), and this one had zero importers.

// ARCH-029: the conformant, cast-free `ICommandHostContext` double. Lives beside the contract it
// doubles (this package owns it), so all three consumer packages reach it with no new dependency edge
// — the property ARCH-012 identified as the thing that actually killed its 37 casts.
export {
  createTestAgentJobHost,
  createTestCommandHost,
  type ICreateTestCommandHostOptions,
} from './command-host-double.js';
