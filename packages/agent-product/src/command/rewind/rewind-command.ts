import {
  EditCheckpointUnreadableError,
  EditCheckpointsLockedError,
  EditCheckpointsUnavailableError,
  editCheckpointsLockedMessage,
  inspectCommandEditCheckpoint,
  readCommandEditCheckpointListing,
  restoreCommandEditCheckpoint,
  rollbackCommandEditCheckpoint,
  forkCommandEditCheckpoint,
  switchCommandEditCheckpointBranch,
  listCommandEditCheckpointBranches,
} from '@robota-sdk/agent-framework';

import type {
  ICommandHostCheckpoints,
  IEditCheckpointInspection,
  IEditCheckpointInspectionPlan,
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
  IEditCheckpointUnreadableCounts,
} from '@robota-sdk/agent-framework';
import { registeredUnlockCommand } from '../key-custody/registered-unlock-command.js';

import type { ICommandHostCatalog, ICommandProductVocabulary } from '@robota-sdk/agent-framework';
import type { ICommandResult } from '@robota-sdk/agent-interface/command';

type TRewindCommandContext = ICommandHostCheckpoints &
  Partial<Pick<ICommandHostCatalog, 'listCommands'>> & {
    getCommandProductVocabulary?(): ICommandProductVocabulary | undefined;
  };

const SUBCOMMAND_INDEX = 0;
const CHECKPOINT_ID_INDEX = 1;
const PROMPT_PREVIEW_LENGTH = 120;
const ELLIPSIS_LENGTH = 3;

function usage(): ICommandResult {
  return {
    message:
      'Usage: rewind [list] | rewind inspect <checkpoint-id> | rewind restore <checkpoint-id> | rewind code <checkpoint-id> | rewind rollback <checkpoint-id>',
    success: false,
  };
}

function formatPrompt(prompt: string): string {
  const compact = prompt.replace(/\s+/g, ' ').trim();
  if (compact.length <= PROMPT_PREVIEW_LENGTH) return compact;
  return `${compact.slice(0, PROMPT_PREVIEW_LENGTH - ELLIPSIS_LENGTH)}...`;
}

/** The line saying how many checkpoints do not open, and why; none when every one opens. */
function formatUnreadable(counts: IEditCheckpointUnreadableCounts): string[] {
  const total = counts.damaged + counts.newer;
  if (total === 0) return [];
  const reasons = [
    ...(counts.damaged > 0 ? [`${counts.damaged} damaged`] : []),
    ...(counts.newer > 0 ? [`${counts.newer} written by a newer build`] : []),
  ];
  const subject =
    total === 1 ? '1 checkpoint does not open and is' : `${total} checkpoints do not open and are`;
  return [`${subject} not listed: ${reasons.join(', ')}.`];
}

function formatList(
  checkpoints: readonly IEditCheckpointSummary[],
  unreadable: IEditCheckpointUnreadableCounts | undefined,
): ICommandResult {
  const lines =
    checkpoints.length > 0
      ? checkpoints.map(
          (checkpoint) =>
            `- ${checkpoint.id} files=${checkpoint.fileCount} ${checkpoint.createdAt} ${formatPrompt(
              checkpoint.prompt,
            )}`,
        )
      : ['(no edit checkpoints)'];
  const unreadableLines = unreadable === undefined ? [] : formatUnreadable(unreadable);

  return {
    message: ['Edit checkpoints:', ...lines, ...unreadableLines].join('\n'),
    success: true,
    data: {
      count: checkpoints.length,
      checkpoints: [...checkpoints],
      ...(unreadableLines.length > 0 && unreadable !== undefined
        ? { unreadable: { damaged: unreadable.damaged, newer: unreadable.newer } }
        : {}),
    },
  };
}

function formatCheckpointIds(ids: readonly string[]): string {
  return ids.length > 0 ? ids.join(', ') : '(none)';
}

/** Why a plan would be refused, when a checkpoint in its range does not open. */
function formatRefusal(plan: IEditCheckpointInspectionPlan): string {
  if (plan.blockedBy === undefined) return '';
  const why = plan.blockedBy.reason === 'newer' ? 'was written by a newer build' : 'is damaged';
  return ` (refused: ${plan.blockedBy.checkpointId} ${why})`;
}

function formatInspection(inspection: IEditCheckpointInspection): ICommandResult {
  const fileLines =
    inspection.capturedFiles.length > 0
      ? inspection.capturedFiles.map((file) => {
          const recorded = file.snapshotSizeSource === 'recorded' ? ' (recorded)' : '';
          const size =
            file.snapshotSizeBytes === undefined
              ? ''
              : ` size=${file.snapshotSizeBytes}B${recorded}`;
          return `- ${file.relativePath} action=${file.restoreAction} snapshot=${String(
            file.snapshotAvailable,
          )}${size}`;
        })
      : ['(no files captured)'];

  return {
    message: [
      `Checkpoint ${inspection.target.id}`,
      `Prompt: ${formatPrompt(inspection.target.prompt)}`,
      'Captured files:',
      ...fileLines,
      `Restore later checkpoints: files=${inspection.restoreToCheckpoint.fileCount} checkpoints=${formatCheckpointIds(
        inspection.restoreToCheckpoint.checkpointIds,
      )}${formatRefusal(inspection.restoreToCheckpoint)}`,
      `Rollback through checkpoint: files=${inspection.rollbackThroughCheckpoint.fileCount} checkpoints=${formatCheckpointIds(
        inspection.rollbackThroughCheckpoint.checkpointIds,
      )}${formatRefusal(inspection.rollbackThroughCheckpoint)}`,
    ].join('\n'),
    success: true,
    data: { inspection },
  };
}

function formatRestoreResult(result: IEditCheckpointRestoreResult): ICommandResult {
  return {
    message: [
      `Restored code to ${result.target.id}.`,
      `Restored files: ${result.restoredFileCount}`,
      `Rolled back checkpoints: ${result.restoredCheckpointCount}`,
    ].join('\n'),
    success: true,
    data: {
      target: result.target,
      restoredCheckpointCount: result.restoredCheckpointCount,
      restoredFileCount: result.restoredFileCount,
      removedCheckpointCount: result.removedCheckpointCount,
    },
  };
}

function formatRollbackResult(result: IEditCheckpointRestoreResult): ICommandResult {
  return {
    message: [
      `Rolled back code through ${result.target.id}.`,
      `Restored files: ${result.restoredFileCount}`,
      `Removed checkpoints: ${result.removedCheckpointCount}`,
    ].join('\n'),
    success: true,
    data: {
      target: result.target,
      restoredCheckpointCount: result.restoredCheckpointCount,
      restoredFileCount: result.restoredFileCount,
      removedCheckpointCount: result.removedCheckpointCount,
    },
  };
}

/** A restricted workspace is the one case the user fixes with a command; the rest say why. */
function unavailableMessage(error: EditCheckpointsUnavailableError, cliName?: string): string {
  if (error.reason !== 'restricted-workspace') return error.message;
  return cliName === undefined
    ? 'Edit checkpoints need a trusted workspace. Trust it from a terminal, then restart the session.'
    : `Edit checkpoints need a trusted workspace: run ${cliName} trust --yes, then restart ${cliName}.`;
}

/** A pre-image a stopped migration left plain is repaired by running it again, which this names. */
function unfinishedMigrationMessage(
  error: EditCheckpointUnreadableError,
  cliName?: string,
): string {
  if (!error.unfinishedMigration || cliName === undefined) return error.message;
  return (
    `A pre-image of edit checkpoint ${error.checkpointId} is still plain under its sealed manifest: ` +
    `a migration stopped part-way; run ${cliName} secure migrate again to finish it. Nothing was restored; ` +
    'restoring to a checkpoint after it still works.'
  );
}

/** How a refused rewind reads, in this host's words: its CLI name, and `/unlock` where it exists. */
function formatError(error: Error | string, context: TRewindCommandContext): ICommandResult {
  const cliName = context.getCommandProductVocabulary?.()?.cliName;
  return {
    message:
      error instanceof EditCheckpointsLockedError
        ? editCheckpointsLockedMessage(error.reason, registeredUnlockCommand(context))
        : error instanceof EditCheckpointsUnavailableError
          ? unavailableMessage(error, cliName)
          : error instanceof EditCheckpointUnreadableError
            ? unfinishedMigrationMessage(error, cliName)
            : error instanceof Error
              ? error.message
              : String(error),
    success: false,
  };
}

function list(context: TRewindCommandContext): ICommandResult {
  try {
    const listing = readCommandEditCheckpointListing(context);
    return formatList(listing.checkpoints, listing.unreadable);
  } catch (error) {
    return formatError(error instanceof Error ? error : String(error), context);
  }
}

function inspect(context: TRewindCommandContext, checkpointId: string | undefined): ICommandResult {
  if (!checkpointId) return usage();
  try {
    return formatInspection(inspectCommandEditCheckpoint(context, checkpointId));
  } catch (error) {
    return formatError(error instanceof Error ? error : String(error), context);
  }
}

async function restore(
  context: TRewindCommandContext,
  checkpointId: string | undefined,
): Promise<ICommandResult> {
  if (!checkpointId) return usage();
  try {
    return formatRestoreResult(await restoreCommandEditCheckpoint(context, checkpointId));
  } catch (error) {
    return formatError(error instanceof Error ? error : String(error), context);
  }
}

async function rollback(
  context: TRewindCommandContext,
  checkpointId: string | undefined,
): Promise<ICommandResult> {
  if (!checkpointId) return usage();
  try {
    return formatRollbackResult(await rollbackCommandEditCheckpoint(context, checkpointId));
  } catch (error) {
    return formatError(error instanceof Error ? error : String(error), context);
  }
}

// Branching time-travel handlers.
async function fork(
  context: TRewindCommandContext,
  checkpointId: string | undefined,
): Promise<ICommandResult> {
  if (!checkpointId) return usage();
  try {
    const result = await forkCommandEditCheckpoint(context, checkpointId);
    return {
      message: [
        `Forked a new branch from ${result.target.id} (the previous future is preserved).`,
        `Restored files: ${result.restoredFileCount}`,
      ].join('\n'),
      success: true,
      data: { target: result.target, restoredFileCount: result.restoredFileCount },
    };
  } catch (error) {
    return formatError(error instanceof Error ? error : String(error), context);
  }
}

function switchBranch(
  context: TRewindCommandContext,
  checkpointId: string | undefined,
): ICommandResult {
  if (!checkpointId) return usage();
  try {
    switchCommandEditCheckpointBranch(context, checkpointId);
    return { message: `Switched to checkpoint branch ${checkpointId}.`, success: true };
  } catch (error) {
    return formatError(error instanceof Error ? error : String(error), context);
  }
}

function branches(context: TRewindCommandContext): ICommandResult {
  try {
    const tips = listCommandEditCheckpointBranches(context);
    return {
      message:
        tips.length === 0
          ? 'No checkpoint branches yet.'
          : `Branch tips:\n${tips.map((id) => `- ${id}`).join('\n')}`,
      success: true,
      data: { branches: tips },
    };
  } catch (error) {
    return formatError(error instanceof Error ? error : String(error), context);
  }
}

export async function executeRewindCommand(
  context: TRewindCommandContext,
  rawArgs: string,
): Promise<ICommandResult> {
  const args = rawArgs.trim().split(/\s+/).filter(Boolean);
  const subcommand = args[SUBCOMMAND_INDEX] ?? 'list';

  if (subcommand === 'list') {
    return list(context);
  }

  if (subcommand === 'inspect') {
    return inspect(context, args[CHECKPOINT_ID_INDEX]);
  }

  if (subcommand === 'restore' || subcommand === 'code') {
    return restore(context, args[CHECKPOINT_ID_INDEX]);
  }

  if (subcommand === 'rollback') {
    return rollback(context, args[CHECKPOINT_ID_INDEX]);
  }

  // Branching time-travel subcommands.
  if (subcommand === 'fork') {
    return fork(context, args[CHECKPOINT_ID_INDEX]);
  }
  if (subcommand === 'switch') {
    return switchBranch(context, args[CHECKPOINT_ID_INDEX]);
  }
  if (subcommand === 'branches') {
    return branches(context);
  }

  return usage();
}
