import type {
  IEditCheckpointInspection,
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
} from '../../checkpoints/index.js';
import type { ICommandHostContext } from '../host-context.js';
import type { ICommand } from '../types.js';

export const REWIND_COMMAND_DESCRIPTION =
  'List, inspect, restore, rollback, fork, or switch edit checkpoint branches.';
export const REWIND_COMMAND_ARGUMENT_HINT =
  'list | inspect CHECKPOINT_ID | restore CHECKPOINT_ID | code CHECKPOINT_ID | rollback CHECKPOINT_ID | fork CHECKPOINT_ID | switch CHECKPOINT_ID | branches';

export function buildRewindCommandSubcommands(source = 'rewind'): ICommand[] {
  return [
    { name: 'list', description: 'List edit checkpoints', source },
    { name: 'inspect', description: 'Inspect captured files and restore plans', source },
    { name: 'restore', description: 'Restore code to a checkpoint', source },
    { name: 'code', description: 'Restore code to a checkpoint', source },
    { name: 'rollback', description: 'Rollback code through a checkpoint', source },
    // SELFHOST-007: branching time-travel
    {
      name: 'fork',
      description: 'Fork a new branch from a past checkpoint (non-destructive)',
      source,
    },
    { name: 'switch', description: 'Switch the active branch to a checkpoint/branch tip', source },
    { name: 'branches', description: 'List checkpoint branch tips', source },
  ];
}

export function listCommandEditCheckpoints(
  context: ICommandHostContext,
): readonly IEditCheckpointSummary[] {
  return context.listEditCheckpoints();
}

export function inspectCommandEditCheckpoint(
  context: ICommandHostContext,
  checkpointId: string,
): IEditCheckpointInspection {
  if (!context.inspectEditCheckpoint) {
    throw new Error('Checkpoint inspection is not available in this command host.');
  }
  return context.inspectEditCheckpoint(checkpointId);
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

// SELFHOST-007: branching time-travel command surface (delegates to the neutral tree via the host).

export function forkCommandEditCheckpoint(
  context: ICommandHostContext,
  checkpointId: string,
): Promise<IEditCheckpointRestoreResult> {
  if (!context.forkCheckpointBranch) {
    throw new Error('Checkpoint branching is not available in this command host.');
  }
  return context.forkCheckpointBranch(checkpointId);
}

export function switchCommandEditCheckpointBranch(
  context: ICommandHostContext,
  checkpointId: string,
): void {
  if (!context.switchCheckpointBranch) {
    throw new Error('Checkpoint branching is not available in this command host.');
  }
  context.switchCheckpointBranch(checkpointId);
}

export function listCommandEditCheckpointBranches(context: ICommandHostContext): string[] {
  if (!context.listCheckpointBranches) {
    throw new Error('Checkpoint branching is not available in this command host.');
  }
  return context.listCheckpointBranches();
}
