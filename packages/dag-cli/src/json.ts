import type {
  IDagCliFailure,
  IDagCliIo,
  TDagCliOutputPayload,
  TDagCliValueResult,
  TJsonValue,
} from './types.js';
import { USAGE_ERROR_EXIT_CODE } from './types.js';

const JSON_INDENT_SPACES = 2;
const FILE_REFERENCE_PREFIX = '@';

export function formatJsonOutput(value: TDagCliOutputPayload): string {
  return `${JSON.stringify(value, null, JSON_INDENT_SPACES)}\n`;
}

export function createCliFailure(code: string, detail: string): IDagCliFailure {
  return {
    ok: false,
    status: USAGE_ERROR_EXIT_CODE,
    errors: [
      {
        type: `urn:robota:problems:dag-cli:${code.toLowerCase()}`,
        title: 'DAG CLI error',
        status: USAGE_ERROR_EXIT_CODE,
        detail,
        instance: 'robota-dag',
        code,
        retryable: false,
      },
    ],
  };
}

export function parseJsonText(text: string, source: string): TDagCliValueResult<TJsonValue> {
  try {
    return { ok: true, value: JSON.parse(text) as TJsonValue };
  } catch (error) {
    return {
      ok: false,
      failure: createCliFailure(
        'DAG_CLI_JSON_PARSE_ERROR',
        `Failed to parse JSON from ${source}: ${resolveErrorMessage(error)}`,
      ),
    };
  }
}

export async function parseJsonArgument(
  value: string,
  io: IDagCliIo,
): Promise<TDagCliValueResult<TJsonValue>> {
  if (!value.startsWith(FILE_REFERENCE_PREFIX)) {
    return parseJsonText(value, 'argument');
  }

  const filePath = value.slice(FILE_REFERENCE_PREFIX.length);
  return parseJsonFile(filePath, io);
}

export async function parseJsonFile(
  filePath: string,
  io: IDagCliIo,
): Promise<TDagCliValueResult<TJsonValue>> {
  try {
    const content = await io.readTextFile(filePath);
    return parseJsonText(content, filePath);
  } catch (error) {
    return {
      ok: false,
      failure: createCliFailure(
        'DAG_CLI_JSON_PARSE_ERROR',
        `Failed to read JSON file ${filePath}: ${resolveErrorMessage(error)}`,
      ),
    };
  }
}

export function isJsonObject(value: TJsonValue): value is { readonly [key: string]: TJsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resolveErrorMessage<TError>(error: TError): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
