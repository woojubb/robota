import { z } from 'zod';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import type { IZodSchema } from '@robota-sdk/agent-tools';
import type { ICommandResult } from '../commands/index.js';

interface ICommandExecutionArgs {
  command: string;
  args?: string;
}

export interface ICommandExecutionToolDeps {
  isModelInvocable: (command: string) => boolean;
  execute: (command: string, args: string) => Promise<ICommandResult | null>;
  commandNames?: readonly string[];
}

function asZodSchema(schema: z.ZodType): IZodSchema {
  return schema as IZodSchema;
}

function toNonEmptyCommandNames(
  commandNames?: readonly string[],
): [string, ...string[]] | undefined {
  if (!commandNames || commandNames.length === 0) return undefined;
  const [first, ...rest] = commandNames;
  if (first === undefined) return undefined;
  return [first, ...rest];
}

function createCommandExecutionSchema(
  commandNames?: readonly string[],
): z.ZodType<ICommandExecutionArgs> {
  const validCommandNames = toNonEmptyCommandNames(commandNames);
  const commandSchema =
    validCommandNames !== undefined
      ? z.enum(validCommandNames).describe('Registered model-invocable command name to execute')
      : z.string().describe('Command name to execute, with or without a leading slash');

  return z.object({
    command: commandSchema,
    args: z.string().optional().describe('Arguments to pass to the command'),
  });
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
  const commandExecutionSchema = createCommandExecutionSchema(deps.commandNames);
  return createZodFunctionTool(
    'ExecuteCommand',
    'Executes a registered model-invocable Robota command through the command registry. Accepted command names and argument grammar come from registered command descriptors.',
    asZodSchema(commandExecutionSchema),
    async (params) => {
      const args: ICommandExecutionArgs = commandExecutionSchema.parse(params);
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
