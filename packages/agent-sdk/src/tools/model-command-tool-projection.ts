import { createHash } from 'node:crypto';
import { z } from 'zod';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import type { IZodSchema } from '@robota-sdk/agent-tools';
import type { ICommandResult } from '../commands/index.js';
import type { ICapabilityDescriptor } from '../capabilities/types.js';

export const MODEL_COMMAND_TOOL_PREFIX = 'robota_command_' as const;
export const PROVIDER_SAFE_TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const MAX_PROVIDER_TOOL_NAME_LENGTH = 64;
const HASH_LENGTH = 8;
const HASH_SEPARATOR_LENGTH = 1;

type TModelCommandDescriptor = Pick<ICapabilityDescriptor, 'name' | 'description' | 'argumentHint'>;

interface IProjectedCommandArgs {
  args?: string;
}

export interface IProjectedModelCommandTool {
  readonly commandName: string;
  readonly toolName: string;
  readonly description: string;
  readonly descriptor: TModelCommandDescriptor;
}

export interface IModelCommandToolProjection {
  readonly commandTools: readonly IProjectedModelCommandTool[];
  readonly toolNameToCommandName: ReadonlyMap<string, string>;
  readonly commandNameToToolName: ReadonlyMap<string, string>;
}

export interface IProjectedCommandExecutionToolsDeps {
  isModelInvocable: (command: string) => boolean;
  execute: (command: string, args: string) => Promise<ICommandResult | null>;
  commandDescriptors: readonly TModelCommandDescriptor[];
}

function asZodSchema(schema: z.ZodType): IZodSchema {
  return schema as IZodSchema;
}

export function normalizeModelCommandName(command: string): string {
  return command.trim().replace(/^\/+/, '').split(/\s+/)[0] ?? '';
}

export function createProviderSafeModelCommandToolName(commandName: string): string {
  const normalizedCommandName = normalizeModelCommandName(commandName);
  if (!normalizedCommandName) {
    throw new Error('Model command descriptor name must not be empty.');
  }

  const safeBody = normalizedCommandName
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!safeBody) {
    throw new Error(`Model command descriptor name cannot be projected safely: ${commandName}`);
  }

  const rawToolName = `${MODEL_COMMAND_TOOL_PREFIX}${safeBody}`;
  if (PROVIDER_SAFE_TOOL_NAME_PATTERN.test(rawToolName)) {
    return rawToolName;
  }

  const hash = createHash('sha256')
    .update(normalizedCommandName)
    .digest('hex')
    .slice(0, HASH_LENGTH);
  const maxBodyLength =
    MAX_PROVIDER_TOOL_NAME_LENGTH -
    MODEL_COMMAND_TOOL_PREFIX.length -
    HASH_SEPARATOR_LENGTH -
    HASH_LENGTH;
  if (maxBodyLength < 1) {
    throw new Error('Model command tool prefix leaves no room for command names.');
  }

  const truncatedBody = safeBody.slice(0, maxBodyLength).replace(/[_-]+$/g, '') || 'command';
  const toolName = `${MODEL_COMMAND_TOOL_PREFIX}${truncatedBody}_${hash}`;
  if (!PROVIDER_SAFE_TOOL_NAME_PATTERN.test(toolName)) {
    throw new Error(`Projected model command tool name is not provider-safe: ${toolName}`);
  }
  return toolName;
}

export function createModelCommandToolProjection(
  commandDescriptors: readonly TModelCommandDescriptor[],
): IModelCommandToolProjection {
  const commandNames = new Set<string>();
  const toolNameToCommandName = new Map<string, string>();
  const commandNameToToolName = new Map<string, string>();
  const commandTools: IProjectedModelCommandTool[] = [];

  for (const descriptor of commandDescriptors) {
    const commandName = normalizeModelCommandName(descriptor.name);
    if (!commandName) {
      throw new Error('Model command descriptor name must not be empty.');
    }
    if (commandNames.has(commandName)) {
      throw new Error(`Duplicate model command descriptor: ${commandName}`);
    }
    commandNames.add(commandName);

    const toolName = createProviderSafeModelCommandToolName(commandName);
    const existingCommandName = toolNameToCommandName.get(toolName);
    if (existingCommandName !== undefined) {
      throw new Error(
        `Model command projection collision: ${existingCommandName} and ${commandName} both map to ${toolName}`,
      );
    }

    toolNameToCommandName.set(toolName, commandName);
    commandNameToToolName.set(commandName, toolName);
    commandTools.push({
      commandName,
      toolName,
      description: formatProjectedModelCommandToolDescription(commandName, descriptor),
      descriptor,
    });
  }

  return {
    commandTools,
    toolNameToCommandName,
    commandNameToToolName,
  };
}

export function formatProjectedModelCommandToolPromptDescription(
  projection: IProjectedModelCommandTool,
): string {
  return `${projection.toolName} — ${projection.descriptor.description}`;
}

export function stringifyModelCommandResult(
  command: string,
  result: ICommandResult | null,
): string {
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

export function createProjectedCommandExecutionTools(
  deps: IProjectedCommandExecutionToolsDeps,
): Array<ReturnType<typeof createZodFunctionTool>> {
  const projection = createModelCommandToolProjection(deps.commandDescriptors);
  return projection.commandTools.map((projectedTool) => {
    const schema = createProjectedCommandArgsSchema(projectedTool.descriptor);
    return createZodFunctionTool(
      projectedTool.toolName,
      projectedTool.description,
      asZodSchema(schema),
      async (params) => {
        const parsedParams: IProjectedCommandArgs = schema.parse(params);
        if (!deps.isModelInvocable(projectedTool.commandName)) {
          return JSON.stringify({
            success: false,
            command: projectedTool.commandName,
            error: `Command is not model-invocable: ${projectedTool.commandName}`,
          });
        }
        return stringifyModelCommandResult(
          projectedTool.commandName,
          await deps.execute(projectedTool.commandName, parsedParams.args ?? ''),
        );
      },
    );
  });
}

function createProjectedCommandArgsSchema(
  descriptor: TModelCommandDescriptor,
): z.ZodType<IProjectedCommandArgs> {
  const argsDescription = descriptor.argumentHint
    ? `Arguments for the command. Expected grammar: ${descriptor.argumentHint}`
    : 'Arguments for the command as a single string.';

  return z.object({
    args: z.string().optional().describe(argsDescription),
  });
}

function formatProjectedModelCommandToolDescription(
  commandName: string,
  descriptor: TModelCommandDescriptor,
): string {
  const lines = [descriptor.description.trim(), `Robota command id: ${commandName}.`];
  if (descriptor.argumentHint) {
    lines.push(`Argument grammar: ${descriptor.argumentHint}`);
  }
  return lines.filter((line) => line.length > 0).join('\n\n');
}
