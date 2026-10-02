/**
 * What a participant tells the host about the session it is about to open or restore.
 *
 * Shared by every participant this package offers — `runtimeParticipant` (root entry) and
 * `sessionParticipant` (`/session` subpath) alike — so it lives in its own module rather than
 * either participant's: neither entry point should have to import the other's file just for this
 * type.
 */
export interface OpenContext {
  conversationId: string;
  participantId: string;
  /** True when opening from a saved checkpoint (a settled turn boundary, or a parked wait). */
  restoring: boolean;
}
