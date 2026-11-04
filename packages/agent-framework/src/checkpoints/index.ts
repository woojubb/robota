// The platform-neutral edit checkpoint surface: the store's contract, its errors and the tool
// wrapper. The store that keeps checkpoints in a project's files, its state storage and its
// migration touch a Node file system and are exported from `../node.ts`.
export { EditCheckpointsUnavailableError } from './edit-checkpoints-unavailable-error.js';
export type { TEditCheckpointsUnavailableReason } from './edit-checkpoints-unavailable-error.js';
export {
  EditCheckpointNumberingExhaustedError,
  EditCheckpointUnreadableError,
  EditCheckpointsLockedError,
  editCheckpointsLockedMessage,
} from './edit-checkpoint-errors.js';
export type { TEditCheckpointUnreadableReason } from './edit-checkpoint-errors.js';
export { wrapEditCheckpointTools } from './edit-checkpoint-tools.js';
export type {
  IEditCheckpointFileInspection,
  IEditCheckpointFileRecord,
  IEditCheckpointInspection,
  IEditCheckpointInspectionPlan,
  IEditCheckpointListing,
  IEditCheckpointManifest,
  IEditCheckpointRecorder,
  IEditCheckpointRestoreResult,
  IEditCheckpointStore,
  IEditCheckpointSummary,
  IEditCheckpointTurnInput,
  IEditCheckpointUnreadableCounts,
  TEditCheckpointFileRestoreAction,
} from './edit-checkpoint-types.js';
