import { z } from 'zod';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import type { IZodSchema } from '@robota-sdk/agent-tools';
import type { ICommandResult } from '../commands/index.js';

const CommandExecutionSchema = z.object({
  command: z.string().describe('Command name to execute, with or without a leading slash'),
  args: z.string().optional().describe('Arguments to pass to the command'),
});

interface ICommandExecutionArgs {
  command: string;
  args?: string;
}

export interface ICommandExecutionToolDeps {
  isModelInvocable: (command: string) => boolean;
  execute: (command: string, args: string) => Promise<ICommandResult | null>;
}

function asZodSchema(schema: z.ZodType): IZodSchema {
  return schema as IZodSchema;
}

function normalizeCommand(command: string): string {
  return command.trim().replace(/^\/+/, '').split(/\s+/)[0] ?? '';
}

function stringifyCommandResult(command: string, result: ICommandResult | null): string {
  if (!result) {
    return JSON.stringify({
      success: false,
      command,
      error: `Unknown command: ${command}`,
    });
  }
  return JSON.stringify({
    success: result.success,
    command,
    message: result.message,
    data: result.data,
  });
}

export function createCommandExecutionTool(
  deps: ICommandExecutionToolDeps,
): ReturnType<typeof createZodFunctionTool> {
  return createZodFunctionTool(
    'ExecuteCommand',
    'Execute a registered Robota command that has been marked model-invocable by its command module.',
    asZodSchema(CommandExecutionSchema),
    async (params) => {
      const args = params as unknown as ICommandExecutionArgs;
      const command = normalizeCommand(args.command);
      if (!deps.isModelInvocable(command)) {
        return JSON.stringify({
          success: false,
          command,
          error: `Command is not model-invocable: ${command}`,
        });
      }
      return stringifyCommandResult(command, await deps.execute(command, args.args ?? ''));
    },
  );
}
