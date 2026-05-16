import { z } from 'zod';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import type { IZodSchema } from '@robota-sdk/agent-tools';
import type { IBackgroundTaskManager, TBackgroundPrimitive } from '../background-tasks/index.js';

const DEFAULT_PROCESS_TIMEOUT_MS = 120_000;

function asZodSchema(schema: z.ZodType): IZodSchema {
  return schema as IZodSchema;
}

const BackgroundProcessSchema = z.object({
  command: z.string().describe('The shell command to start in the background'),
  timeout: z.number().optional().describe('Optional timeout in milliseconds. Default is 120000.'),
  workingDirectory: z
    .string()
    .optional()
    .describe('Working directory for the command. Defaults to the current project directory.'),
  stdin: z.string().optional().describe('Optional stdin to write after the process starts.'),
  outputLimitBytes: z
    .number()
    .optional()
    .describe('Maximum captured output bytes kept in the task result.'),
});

type TBackgroundProcessArgs = z.infer<typeof BackgroundProcessSchema>;

export interface IBackgroundProcessToolDeps {
  backgroundTaskManager: IBackgroundTaskManager;
  cwd?: string;
  parentSessionId?: string;
  metadata?: Record<string, TBackgroundPrimitive>;
}

function stringifyStarted(taskId: string, status: string, command: string): string {
  return JSON.stringify({
    success: true,
    background: true,
    output: '',
    taskId,
    status,
    command,
  });
}

function stringifyProcessError(message: string): string {
  return JSON.stringify({
    success: false,
    background: true,
    output: '',
    error: `Background process error: ${message}`,
  });
}

async function startBackgroundProcess(
  args: TBackgroundProcessArgs,
  deps: IBackgroundProcessToolDeps,
): Promise<string> {
  try {
    const state = await deps.backgroundTaskManager.spawn({
      kind: 'process',
      label: args.command,
      mode: 'background',
      parentSessionId: deps.parentSessionId ?? 'unknown-session',
      depth: 0,
      cwd: args.workingDirectory ?? deps.cwd ?? process.cwd(),
      command: args.command,
      stdin: args.stdin,
      timeoutMs: args.timeout ?? DEFAULT_PROCESS_TIMEOUT_MS,
      outputLimitBytes: args.outputLimitBytes,
      metadata: deps.metadata,
    });
    return stringifyStarted(state.id, state.status, args.command);
  } catch (error) {
    return stringifyProcessError(error instanceof Error ? error.message : String(error));
  }
}

export function createBackgroundProcessTool(
  deps: IBackgroundProcessToolDeps,
): ReturnType<typeof createZodFunctionTool> {
  return createZodFunctionTool(
    'BackgroundProcess',
    'Start a shell command as a managed background task. Use this for long-running commands that should not block the current conversation. Use /background list, /background read <taskId>, /background cancel <taskId>, or /background close <taskId> to inspect or control it.',
    asZodSchema(BackgroundProcessSchema),
    async (params) => startBackgroundProcess(params as TBackgroundProcessArgs, deps),
  );
}
