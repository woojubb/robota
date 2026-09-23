import type {
  ICostMeta,
  ICostMetaFormulaPreviewInput,
  ICostMetaFormulaValidationInput,
  ICostMetaOperationsPort,
} from '@robota-sdk/dag-cost';
import type { IDagError, TResult } from '@robota-sdk/dag-core';
import { rejectUnexpectedArgs, takeStringOption } from './arguments.js';
import { createCliFailure, isJsonObject, parseJsonArgument } from './json.js';
import type { IDagCliCommandResult, IDagCliIo, TDagCliValueResult, TJsonObject } from './types.js';
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from './types.js';

const JSON_OPTION = '--json';

export async function runCostMetaCommand(
  command: string | undefined,
  args: readonly string[],
  client: ICostMetaOperationsPort,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  if (command === 'list') {
    const unexpected = rejectUnexpectedArgs(args, 'cost-meta list');
    if (unexpected) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: unexpected };
    return costResult(await client.listCostMeta(), (items) => ({ items }));
  }
  if (command === 'get') {
    return oneNodeTypeCommand(
      args,
      'cost-meta get requires <nodeType>.',
      client.getCostMeta.bind(client),
      (meta) => ({ meta }),
    );
  }
  if (command === 'create') {
    return createCostMetaCommand(args, client, io);
  }
  if (command === 'update') {
    return updateCostMetaCommand(args, client, io);
  }
  if (command === 'delete') {
    return oneNodeTypeCommand(
      args,
      'cost-meta delete requires <nodeType>.',
      client.deleteCostMeta.bind(client),
      (value) => value,
    );
  }
  if (command === 'validate') {
    return validateCostMetaFormulaCommand(args, client, io);
  }
  if (command === 'preview') {
    return previewCostMetaFormulaCommand(args, client, io);
  }
  return usageResult(
    'Expected cost-meta command: list, get, create, update, delete, validate, or preview.',
  );
}

async function createCostMetaCommand(
  args: readonly string[],
  client: ICostMetaOperationsPort,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  const payload = await readRequiredJsonObject<ICostMeta>(args, 'cost-meta create', io);
  if (!payload.ok) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: payload.failure };
  return costResult(await client.createCostMeta(payload.value), (meta) => ({ meta }), 201);
}

async function updateCostMetaCommand(
  args: readonly string[],
  client: ICostMetaOperationsPort,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  const [nodeType, ...rest] = args;
  if (!nodeType) return usageResult('cost-meta update requires <nodeType>.');
  const payload = await readRequiredJsonObject<ICostMeta>(rest, 'cost-meta update', io);
  if (!payload.ok) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: payload.failure };
  return costResult(await client.updateCostMeta(nodeType, payload.value), (meta) => ({ meta }));
}

async function validateCostMetaFormulaCommand(
  args: readonly string[],
  client: ICostMetaOperationsPort,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  const payload = await readRequiredJsonObject<ICostMetaFormulaValidationInput>(
    args,
    'cost-meta validate',
    io,
  );
  if (!payload.ok) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: payload.failure };
  return costResult(await client.validateCostMetaFormula(payload.value), (value) => value);
}

async function previewCostMetaFormulaCommand(
  args: readonly string[],
  client: ICostMetaOperationsPort,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  const payload = await readRequiredJsonObject<ICostMetaFormulaPreviewInput>(
    args,
    'cost-meta preview',
    io,
  );
  if (!payload.ok) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: payload.failure };
  return costResult(await client.previewCostMetaFormula(payload.value), (result) => ({ result }));
}

async function readRequiredJsonObject<TValue extends object>(
  args: readonly string[],
  commandName: string,
  io: IDagCliIo,
): Promise<TDagCliValueResult<TValue>> {
  const json = takeStringOption(args, JSON_OPTION);
  if (json.failure) return { ok: false, failure: json.failure };
  if (!json.value) {
    return {
      ok: false,
      failure: createCliFailure(
        'DAG_CLI_USAGE_ERROR',
        `${commandName} requires --json <json|@file>.`,
      ),
    };
  }
  const unexpected = rejectUnexpectedArgs(json.args, commandName);
  if (unexpected) return { ok: false, failure: unexpected };
  const parsed = await parseJsonArgument(json.value, io);
  if (!parsed.ok) return parsed;
  if (!isJsonObject(parsed.value)) {
    return {
      ok: false,
      failure: createCliFailure('DAG_CLI_USAGE_ERROR', `${commandName} JSON must be an object.`),
    };
  }
  return { ok: true, value: parsed.value as TJsonObject as TValue };
}

async function oneNodeTypeCommand<TValue>(
  args: readonly string[],
  message: string,
  operation: (nodeType: string) => Promise<TResult<TValue, IDagError>>,
  dataOf: (value: TValue) => object,
): Promise<IDagCliCommandResult> {
  const [nodeType] = args;
  if (!nodeType || args.length > 1) return usageResult(message);
  return costResult(await operation(nodeType), dataOf);
}

function usageResult(detail: string): IDagCliCommandResult {
  return {
    exitCode: USAGE_ERROR_EXIT_CODE,
    payload: createCliFailure('DAG_CLI_USAGE_ERROR', detail),
  };
}

function costResult<TValue>(
  result: TResult<TValue, IDagError>,
  dataOf: (value: TValue) => object,
  successStatus = 200,
): IDagCliCommandResult {
  if (result.ok) {
    return {
      exitCode: SUCCESS_EXIT_CODE,
      payload: { ok: true, status: successStatus, data: dataOf(result.value) },
    };
  }
  const status = costErrorStatus(result.error.code);
  return {
    exitCode: FAILURE_EXIT_CODE,
    payload: {
      ok: false,
      status,
      errors: [
        {
          type: `urn:robota:problems:dag-cli:${result.error.code.toLowerCase()}`,
          title: 'Cost metadata operation failed',
          status,
          detail: result.error.message,
          instance: 'robota-dag',
          code: result.error.code,
          retryable: result.error.retryable,
        },
      ],
    },
  };
}

function costErrorStatus(code: string): number {
  if (code === 'DAG_COST_META_UNSUPPORTED') return 501;
  if (code === 'DAG_COST_META_NOT_FOUND') return 404;
  if (code === 'DAG_COST_META_INVALID' || code.startsWith('CEL_')) return 400;
  return 502;
}
