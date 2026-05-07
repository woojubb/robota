import type {
  ICommandHostContext,
  ICommandResult,
  IEditCheckpointInspection,
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
} from '@robota-sdk/agent-sdk';
import {
  inspectCommandEditCheckpoint,
  listCommandEditCheckpoints,
  restoreCommandEditCheckpoint,
  rollbackCommandEditCheckpoint,
} from '@robota-sdk/agent-sdk';

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

function formatList(checkpoints: readonly IEditCheckpointSummary[]): ICommandResult {
  const lines =
    checkpoints.length > 0
      ? checkpoints.map(
          (checkpoint) =>
            `- ${checkpoint.id} files=${checkpoint.fileCount} ${checkpoint.createdAt} ${formatPrompt(
              checkpoint.prompt,
            )}`,
        )
      : ['(no edit checkpoints)'];

  return {
    message: ['Edit checkpoints:', ...lines].join('\n'),
    success: true,
    data: { count: checkpoints.length, checkpoints: [...checkpoints] },
  };
}

function formatCheckpointIds(ids: readonly string[]): string {
  return ids.length > 0 ? ids.join(', ') : '(none)';
}

function formatInspection(inspection: IEditCheckpointInspection): ICommandResult {
  const fileLines =
    inspection.capturedFiles.length > 0
      ? inspection.capturedFiles.map((file) => {
          const size =
            file.snapshotSizeBytes === undefined ? '' : ` size=${file.snapshotSizeBytes}B`;
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
      )}`,
      `Rollback through checkpoint: files=${inspection.rollbackThroughCheckpoint.fileCount} checkpoints=${formatCheckpointIds(
        inspection.rollbackThroughCheckpoint.checkpointIds,
      )}`,
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

function formatError(error: Error | string): ICommandResult {
  return {
    message: error instanceof Error ? error.message : String(error),
    success: false,
  };
}

function inspect(context: ICommandHostContext, checkpointId: string | undefined): ICommandResult {
  if (!checkpointId) return usage();
  try {
    return formatInspection(inspectCommandEditCheckpoint(context, checkpointId));
  } catch (error) {
    return formatError(error instanceof Error ? error : String(error));
  }
}

async function restore(
  context: ICommandHostContext,
  checkpointId: string | undefined,
): Promise<ICommandResult> {
  if (!checkpointId) return usage();
  try {
    return formatRestoreResult(await restoreCommandEditCheckpoint(context, checkpointId));
  } catch (error) {
    return formatError(error instanceof Error ? error : String(error));
  }
}

async function rollback(
  context: ICommandHostContext,
  checkpointId: string | undefined,
): Promise<ICommandResult> {
  if (!checkpointId) return usage();
  try {
    return formatRollbackResult(await rollbackCommandEditCheckpoint(context, checkpointId));
  } catch (error) {
    return formatError(error instanceof Error ? error : String(error));
  }
}

export async function executeRewindCommand(
  context: ICommandHostContext,
  rawArgs: string,
): Promise<ICommandResult> {
  const args = rawArgs.trim().split(/\s+/).filter(Boolean);
  const subcommand = args[SUBCOMMAND_INDEX] ?? 'list';

  if (subcommand === 'list') {
    return formatList(listCommandEditCheckpoints(context));
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

  return usage();
}
