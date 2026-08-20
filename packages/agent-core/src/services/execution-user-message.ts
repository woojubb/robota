/**
 * Metadata for the stored user message.
 *
 * PEER-007 (issue #1915): the driver id rides on the MESSAGE, not just the turn, because the
 * transcript is what a reader has once the turn ends — without it a peer session's message is
 * indistinguishable from the operator's own. Display attribution only, never an authorization input
 * (issue #1809). Absent when the turn has no attributed driver, which every surface reads as the
 * operator's own.
 */
export function userMessageMetadata(
  executionId: string,
  driverId?: string,
): { executionId: string; driverId?: string } {
  return { executionId, ...(driverId !== undefined ? { driverId } : {}) };
}
