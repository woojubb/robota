/**
 * ARCH-012: re-export, not a second implementation.
 *
 * This file used to hold its own copy of the double. It was published and documented and had zero
 * consumers, because every transport package sits BELOW `agent-framework` and could not import it —
 * which is why 41 hand-rolled partials existed instead. The implementation now lives beside the
 * contract in `@robota-sdk/agent-interface-transport`, reachable by all of them.
 *
 * The re-export stays so existing importers keep working. Two doubles for one contract can disagree,
 * and a double that disagrees with the contract is the defect one level down.
 */
export { createTestInteractiveSession } from '@robota-sdk/agent-interface-transport';
