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
