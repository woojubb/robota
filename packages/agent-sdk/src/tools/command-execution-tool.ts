import { z } from 'zod';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import type { IZodSchema } from '@robota-sdk/agent-tools';
import type { ICommandResult } from '../commands/index.js';
import type { ICapabilityDescriptor } from '../capabilities/types.js';
import {
  normalizeModelCommandName,
  stringifyModelCommandResult,
} from './model-command-tool-projection.js';

interface ICommandExecutionArgs {
  command: string;
  args?: string;
}

type TModelCommandDescriptor = Pick<ICapabilityDescriptor, 'name' | 'description' | 'argumentHint'>;

export interface ICommandExecutionToolDeps {
  isModelInvocable: (command: string) => boolean;
  execute: (command: string, args: string) => Promise<ICommandResult | null>;
  commandNames?: readonly string[];
  commandDescriptors?: readonly TModelCommandDescriptor[];
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
      : z.string().describe('Registered model-invocable command name to execute');

  return z.object({
    command: commandSchema,
    args: z.string().optional().describe('Arguments to pass to the command'),
  });
}

function getCommandNames(deps: ICommandExecutionToolDeps): readonly string[] | undefined {
  if (deps.commandNames !== undefined) return deps.commandNames;
  if (deps.commandDescriptors === undefined) return undefined;
  return deps.commandDescriptors.map((descriptor) => normalizeModelCommandName(descriptor.name));
}

function formatCommandDescriptor(descriptor: TModelCommandDescriptor): string {
  const commandName = normalizeModelCommandName(descriptor.name);
  const argumentHint = descriptor.argumentHint ? ` ${descriptor.argumentHint}` : '';
  return `- ${commandName}${argumentHint}: ${descriptor.description}`;
}

function createToolDescription(commandDescriptors?: readonly TModelCommandDescriptor[]): string {
  const base =
    'Executes a registered model-invocable Robota command through the command registry. Accepted command names and argument grammar come from registered command descriptors.';
  if (commandDescriptors === undefined || commandDescriptors.length === 0) return base;
  return [
    base,
    'Use the registered command descriptors below as the authority for when to call this tool.',
    '',
    'Registered model-invocable commands:',
    ...commandDescriptors.map(formatCommandDescriptor),
  ].join('\n');
}

export function createCommandExecutionTool(
  deps: ICommandExecutionToolDeps,
): ReturnType<typeof createZodFunctionTool> {
  const commandExecutionSchema = createCommandExecutionSchema(getCommandNames(deps));
  return createZodFunctionTool(
    'ExecuteCommand',
    createToolDescription(deps.commandDescriptors),
    asZodSchema(commandExecutionSchema),
    async (params) => {
      const args: ICommandExecutionArgs = commandExecutionSchema.parse(params);
      const command = normalizeModelCommandName(args.command);
      if (!deps.isModelInvocable(command)) {
        return JSON.stringify({
          success: false,
          command,
          error: `Command is not model-invocable: ${command}`,
        });
      }
      return stringifyModelCommandResult(command, await deps.execute(command, args.args ?? ''));
    },
  );
}
