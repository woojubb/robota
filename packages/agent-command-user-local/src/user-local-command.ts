import type { ICommandHostContext, ICommandResult } from '@robota-sdk/agent-sdk';
import { inspectUserLocalStorage } from '@robota-sdk/agent-sdk';

export const USER_LOCAL_COMMAND_DESCRIPTION = 'Inspect Robota user-local storage and memory state.';
export const USER_LOCAL_COMMAND_ARGUMENT_HINT = 'storage list [--format json]';
export const USER_LOCAL_COMMAND_USAGE = 'Usage: user-local storage list [--format json]';

type TUserLocalOutputFormat = 'text' | 'json';

export interface IUserLocalDirectCommandOptions {
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly format?: string;
}

interface IParsedUserLocalCommand {
  readonly target?: string;
  readonly action?: string;
  readonly format: TUserLocalOutputFormat;
}

function parseOutputFormat(value: string | undefined): TUserLocalOutputFormat {
  if (value === undefined || value === 'text') {
    return 'text';
  }
  if (value === 'json') {
    return 'json';
  }
  throw new Error(`Unsupported user-local output format: ${value}`);
}

function parseUserLocalArgs(
  argv: readonly string[],
  directFormat?: string,
): IParsedUserLocalCommand {
  let format = directFormat;
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--format') {
      format = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith('--format=')) {
      format = arg.slice('--format='.length);
      continue;
    }
    positional.push(arg);
  }

  return {
    target: positional[0],
    action: positional[1],
    format: parseOutputFormat(format),
  };
}

function splitRawArgs(rawArgs: string): readonly string[] {
  return rawArgs.trim().split(/\s+/).filter(Boolean);
}

function formatStorageInspectionText(
  root: string,
  categories: readonly { category: string }[],
): string {
  const categoryLines = categories.map((item) => `- ${item.category}`);
  return [`User-local storage root: ${root}`, 'Categories:', ...categoryLines].join('\n');
}

async function executeParsedUserLocalCommand(
  cwd: string,
  parsed: IParsedUserLocalCommand,
): Promise<ICommandResult> {
  if (parsed.target !== 'storage' || (parsed.action ?? 'list') !== 'list') {
    return {
      message: USER_LOCAL_COMMAND_USAGE,
      success: false,
    };
  }

  try {
    const inspection = await inspectUserLocalStorage({ activeRepositoryRoot: cwd });
    return {
      message:
        parsed.format === 'json'
          ? JSON.stringify(inspection, null, 2)
          : formatStorageInspectionText(inspection.root, inspection.categories),
      success: true,
      data: {
        root: inspection.root,
        categories: inspection.categories,
        inspection,
      },
    };
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      success: false,
    };
  }
}

export async function executeUserLocalDirectCommand(
  options: IUserLocalDirectCommandOptions,
): Promise<ICommandResult> {
  try {
    return await executeParsedUserLocalCommand(
      options.cwd,
      parseUserLocalArgs(options.argv, options.format),
    );
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      success: false,
    };
  }
}

export async function executeUserLocalCommand(
  context: ICommandHostContext,
  rawArgs: string,
): Promise<ICommandResult> {
  try {
    return await executeParsedUserLocalCommand(
      context.getCwd(),
      parseUserLocalArgs(splitRawArgs(rawArgs)),
    );
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : String(error),
      success: false,
    };
  }
}
