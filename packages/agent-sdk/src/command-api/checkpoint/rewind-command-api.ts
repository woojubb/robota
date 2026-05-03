import type { ICommand } from '../types.js';
import type { ICommandHostContext } from '../host-context.js';
import type {
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
} from '../../checkpoints/index.js';

export const REWIND_COMMAND_DESCRIPTION =
  'List edit checkpoints or restore code to a previous checkpoint.';
export const REWIND_COMMAND_ARGUMENT_HINT =
  'list | restore CHECKPOINT_ID | code CHECKPOINT_ID | rollback CHECKPOINT_ID';

export function buildRewindCommandSubcommands(source = 'rewind'): ICommand[] {
  return [
    { name: 'list', description: 'List edit checkpoints', source },
    { name: 'restore', description: 'Restore code to a checkpoint', source },
    { name: 'code', description: 'Restore code to a checkpoint', source },
    { name: 'rollback', description: 'Rollback code through a checkpoint', source },
  ];
}

export function listCommandEditCheckpoints(
  context: ICommandHostContext,
): readonly IEditCheckpointSummary[] {
  return context.listEditCheckpoints();
}

export function restoreCommandEditCheckpoint(
  context: ICommandHostContext,
  checkpointId: string,
): Promise<IEditCheckpointRestoreResult> {
  return context.restoreEditCheckpoint(checkpointId);
}

export function rollbackCommandEditCheckpoint(
  context: ICommandHostContext,
  checkpointId: string,
): Promise<IEditCheckpointRestoreResult> {
  return context.rollbackEditCheckpoint(checkpointId);
}
