/**
 * The `@robota-sdk/agent-roundtable-robota/session` subpath: `sessionParticipant` and everything
 * specific to it.
 *
 * Split out of the root entry because `sessionParticipant` imports `@robota-sdk/agent-session`,
 * which pulls in `@robota-sdk/agent-file-authority`'s native binary (koffi) — a cost only a
 * consumer that actually wants a `Session`-backed participant should pay. A consumer that only
 * needs `robotaParticipant`/`robotaSelector` imports the package root and never resolves either.
 */
export { sessionParticipant } from './session-participant';
export type { SessionHostOptions, SessionParticipantOptions } from './session-participant';

// Re-exported here too (it is not Session-specific — the root entry exports it as well) so a
// consumer of this subpath alone, e.g. for `createSessionOptions(ctx: OpenContext)`, never has to
// reach back into the root entry just for this one type.
export type { OpenContext } from './open-context';

export { ROBOTA_SESSION_CHECKPOINT_VERSION } from './checkpoint-codec';
export type { SessionCheckpointState } from './checkpoint-codec';

// The recoverable counterpart to the root entry's `meterJournal`, for a host building its own
// checkpoint-resumable, Session-like participant (`sessionParticipant`'s own metering wrapper).
export { meterRecoverableJournal } from './metering-journal';
