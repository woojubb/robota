// @robota-sdk/agent-interface-session/testing
//
// Doubles for the contracts this package owns, per `contracts→agent-interface-*, doubles→owner
// /testing`. `createSessionCapabilityHost` moved here with ARCH-106 because it imports a VALUE
// (`SESSION_CAPABILITY_MEMBER_KEYS`) from the capability contracts — a cross-package value import
// that `interface-runtime` refuses, and a relative one it permits. The double belongs beside the
// contract it exercises.
export {
  createSessionCapabilityHost,
  createSessionCapabilityHost as createTestSessionCapabilityHost,
} from './session-capability-host.js';
export { readSessionCapability } from './session-capability-host.js';

// ARCH-108: the conformant `IInteractiveSession` double, moved here from
// `agent-interface-transport/testing`. `.agents/project-structure.md:314` states the convention —
// `contracts→agent-interface-*, doubles→owner /testing` — and this package owns the contract it
// doubles. Its previous home is also what held that package at layer 2.
export { createTestInteractiveSession } from './interactive-session-double.js';
