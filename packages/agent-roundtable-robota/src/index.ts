export {
  RuntimeParticipantError,
  RuntimeParticipantError as RobotaParticipantError,
  SelectorDecisionError,
} from './errors';

export { renderSharedIncrement } from './render';
export type { TurnRenderer } from './render';

export type { OpenContext } from './open-context';

// `sessionParticipant` and its Session-specific types/codec live at the `/session` subpath, not
// here: importing it pulls in `@robota-sdk/agent-session` (and, through it, the native
// `agent-file-authority`/koffi binary), a cost this root entry must not impose on a consumer who
// only wants `runtimeParticipant`/`runtimeSelector`. See `entry-isolation.test.ts`.
export { runtimeParticipant, runtimeParticipant as robotaParticipant } from './runtime-participant';
export type {
  RuntimeParticipantOptions,
  RuntimeParticipantOptions as RobotaParticipantOptions,
} from './runtime-participant';

export {
  runtimeSelector,
  runtimeSelector as robotaSelector,
  runtimeSelectorRegistration,
  runtimeSelectorRegistration as robotaSelectorRegistration,
} from './runtime-selector';
export type {
  RuntimeSelectorOptions,
  RuntimeSelectorOptions as RobotaSelectorOptions,
} from './runtime-selector';

export {
  RUNTIME_AGENT_CHECKPOINT_VERSION,
  RUNTIME_AGENT_CHECKPOINT_VERSION as ROBOTA_AGENT_CHECKPOINT_VERSION,
} from './checkpoint-codec';

export { meterJournal } from './metering-journal';
