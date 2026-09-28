export { RobotaParticipantError, SelectorDecisionError } from './errors';

export { renderSharedIncrement } from './render';
export type { TurnRenderer } from './render';

export type { OpenContext } from './open-context';

// `sessionParticipant` and its Session-specific types/codec live at the `/session` subpath, not
// here: importing it pulls in `@robota-sdk/agent-session` (and, through it, the native
// `agent-file-authority`/koffi binary), a cost this root entry must not impose on a consumer who
// only wants `robotaParticipant`/`robotaSelector`. See `entry-isolation.test.ts`.
export { robotaParticipant } from './robota-participant';
export type { RobotaParticipantOptions } from './robota-participant';

export { robotaSelector, robotaSelectorRegistration } from './robota-selector';
export type { RobotaSelectorOptions } from './robota-selector';

export { ROBOTA_AGENT_CHECKPOINT_VERSION } from './checkpoint-codec';

export { meterJournal } from './metering-journal';
