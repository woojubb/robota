import type {
  ICommandHostContext,
  ICommandResult,
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
} from '@robota-sdk/agent-sdk';
import {
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
      'Usage: rewind [list] | rewind restore <checkpoint-id> | rewind code <checkpoint-id> | rewind rollback <checkpoint-id>',
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

  if (subcommand === 'restore' || subcommand === 'code') {
    return restore(context, args[CHECKPOINT_ID_INDEX]);
  }

  if (subcommand === 'rollback') {
    return rollback(context, args[CHECKPOINT_ID_INDEX]);
  }

  return usage();
}
