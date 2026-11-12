// @robota-sdk/agent-interface/session/testing
//
// Doubles for the contracts this package owns; each lives in `testing/` beside the contract it
// exercises. `createSessionCapabilityHost` is here, not in the contract file, because it is a test
// double that builds a host at runtime, and a contract family holds type declarations, not runtime
// logic.
export {
  createSessionCapabilityHost,
  createSessionCapabilityHost as createTestSessionCapabilityHost,
} from './session-capability-host.js';
export { readSessionCapability } from './session-capability-host.js';

// The conformant `IInteractiveSession` double; this package owns the contract it doubles.
export { createTestInteractiveSession } from './interactive-session-double.js';

// Every store offers `claim`; a double whose test is not about claims answers it by its own
// hold read.
export { withHoldReadClaim } from './session-store-double.js';
