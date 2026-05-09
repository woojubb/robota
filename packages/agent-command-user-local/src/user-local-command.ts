import type { ICommandHostContext, ICommandResult } from '@robota-sdk/agent-sdk';
import { inspectUserLocalStorage } from '@robota-sdk/agent-sdk';
import { executeMemoryCommand } from './user-local-memory-command.js';
import { USER_LOCAL_COMMAND_USAGE } from './user-local-command-constants.js';
export {
  USER_LOCAL_COMMAND_ARGUMENT_HINT,
  USER_LOCAL_COMMAND_DESCRIPTION,
  USER_LOCAL_COMMAND_USAGE,
} from './user-local-command-constants.js';

type TUserLocalOutputFormat = 'text' | 'json';

export interface IUserLocalDirectCommandOptions {
  readonly cwd: string;
  readonly argv: readonly string[];
  readonly format?: string;
  readonly summary?: string;
  readonly source?: string;
}

interface IParsedUserLocalCommand {
  readonly target?: string;
  readonly action?: string;
  readonly positional: readonly string[];
  readonly format: TUserLocalOutputFormat;
  readonly summary?: string;
  readonly source?: string;
}

interface IParsedUserLocalOption {
  readonly format?: string;
  readonly summary?: string;
  readonly source?: string;
  readonly nextIndex: number;
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

function parseUserLocalOption(
  arg: string,
  argv: readonly string[],
  index: number,
): IParsedUserLocalOption | null {
  if (arg === '--format') {
    return { format: argv[index + 1], nextIndex: index + 1 };
  }
  if (arg.startsWith('--format=')) {
    return { format: arg.slice('--format='.length), nextIndex: index };
  }
  if (arg === '--summary') {
    return { summary: argv[index + 1], nextIndex: index + 1 };
  }
  if (arg.startsWith('--summary=')) {
    return { summary: arg.slice('--summary='.length), nextIndex: index };
  }
  if (arg === '--source') {
    return { source: argv[index + 1], nextIndex: index + 1 };
  }
  if (arg.startsWith('--source=')) {
    return { source: arg.slice('--source='.length), nextIndex: index };
  }
  return null;
}

function parseUserLocalArgs(
  argv: readonly string[],
  directOptions: {
    readonly format?: string;
    readonly summary?: string;
    readonly source?: string;
  } = {},
): IParsedUserLocalCommand {
  let format = directOptions.format;
  let summary = directOptions.summary;
  let source = directOptions.source;
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const option = parseUserLocalOption(arg, argv, index);
    if (option !== null) {
      format = option.format ?? format;
      summary = option.summary ?? summary;
      source = option.source ?? source;
      index = option.nextIndex;
      continue;
    }
    positional.push(arg);
  }

  return {
    target: positional[0],
    action: positional[1],
    positional: positional.slice(2),
    format: parseOutputFormat(format),
    summary,
    source,
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

async function executeStorageCommand(
  cwd: string,
  parsed: IParsedUserLocalCommand,
): Promise<ICommandResult> {
  if ((parsed.action ?? 'list') !== 'list') {
    return {
      message: USER_LOCAL_COMMAND_USAGE,
      success: false,
    };
  }

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
}

async function executeParsedUserLocalCommand(
  cwd: string,
  parsed: IParsedUserLocalCommand,
): Promise<ICommandResult> {
  if (parsed.target === 'storage') {
    return executeStorageCommand(cwd, parsed);
  }
  if (parsed.target === 'memory') {
    return executeMemoryCommand(cwd, parsed);
  }
  return {
    message: USER_LOCAL_COMMAND_USAGE,
    success: false,
  };
}

function formatCommandErrorMessage(errorMessage: string): string {
  if (errorMessage.includes('ENOENT')) {
    return 'User-local memory item not found.';
  }
  return errorMessage;
}

export async function executeUserLocalDirectCommand(
  options: IUserLocalDirectCommandOptions,
): Promise<ICommandResult> {
  try {
    return await executeParsedUserLocalCommand(
      options.cwd,
      parseUserLocalArgs(options.argv, {
        format: options.format,
        summary: options.summary,
        source: options.source,
      }),
    );
  } catch (error) {
    return {
      message: formatCommandErrorMessage(error instanceof Error ? error.message : String(error)),
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
      message: formatCommandErrorMessage(error instanceof Error ? error.message : String(error)),
      success: false,
    };
  }
}
