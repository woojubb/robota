import type { ICommandResult } from './system-command.js';
import type { InteractiveSession } from '../interactive/interactive-session.js';
import type { IEditCheckpointSummary } from '../checkpoints/edit-checkpoint-types.js';

const SUBCOMMAND_INDEX = 0;
const CHECKPOINT_ID_INDEX = 1;
const PROMPT_PREVIEW_LENGTH = 120;
const ELLIPSIS_LENGTH = 3;

function usage(): ICommandResult {
  return {
    message: 'Usage: rewind [list] | rewind restore <checkpoint-id> | rewind code <checkpoint-id>',
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

async function restore(session: InteractiveSession, checkpointId: string | undefined) {
  if (!checkpointId) return usage();
  try {
    const result = await session.restoreEditCheckpoint(checkpointId);
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
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      success: false,
    };
  }
}

export async function executeRewindCommand(
  session: InteractiveSession,
  rawArgs: string,
): Promise<ICommandResult> {
  const args = rawArgs.trim().split(/\s+/).filter(Boolean);
  const subcommand = args[SUBCOMMAND_INDEX] ?? 'list';

  if (subcommand === 'list') {
    return formatList(session.listEditCheckpoints());
  }

  if (subcommand === 'restore' || subcommand === 'code') {
    return restore(session, args[CHECKPOINT_ID_INDEX]);
  }

  return usage();
}
