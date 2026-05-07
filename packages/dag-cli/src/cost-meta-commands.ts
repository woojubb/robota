import type {
  IDagOrchestrationCostMetaPreviewRequest,
  IDagOrchestrationCostMetaValidateRequest,
  IDagOrchestrationHttpClient,
  TDagOrchestrationCostMetaRequest,
} from '@robota-sdk/dag-orchestration-client';
import { rejectUnexpectedArgs, takeStringOption } from './arguments.js';
import { createCliFailure, isJsonObject, parseJsonArgument } from './json.js';
import type {
  IDagCliCommandResult,
  IDagCliIo,
  TDagCliOutputPayload,
  TDagCliValueResult,
  TJsonObject,
} from './types.js';
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from './types.js';

const JSON_OPTION = '--json';

export async function runCostMetaCommand(
  command: string | undefined,
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  if (command === 'list') {
    const unexpected = rejectUnexpectedArgs(args, 'cost-meta list');
    if (unexpected) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: unexpected };
    return serverResult(await client.listCostMeta());
  }
  if (command === 'get') {
    return oneNodeTypeCommand(
      args,
      'cost-meta get requires <nodeType>.',
      client.getCostMeta.bind(client),
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
  client: IDagOrchestrationHttpClient,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  const payload = await readRequiredJsonObject<TDagOrchestrationCostMetaRequest>(
    args,
    'cost-meta create',
    io,
  );
  if (!payload.ok) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: payload.failure };
  return serverResult(await client.createCostMeta(payload.value));
}

async function updateCostMetaCommand(
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  const [nodeType, ...rest] = args;
  if (!nodeType) return usageResult('cost-meta update requires <nodeType>.');
  const payload = await readRequiredJsonObject<TDagOrchestrationCostMetaRequest>(
    rest,
    'cost-meta update',
    io,
  );
  if (!payload.ok) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: payload.failure };
  return serverResult(await client.updateCostMeta(nodeType, payload.value));
}

async function validateCostMetaFormulaCommand(
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  const payload = await readRequiredJsonObject<IDagOrchestrationCostMetaValidateRequest>(
    args,
    'cost-meta validate',
    io,
  );
  if (!payload.ok) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: payload.failure };
  return serverResult(await client.validateCostMetaFormula(payload.value));
}

async function previewCostMetaFormulaCommand(
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  const payload = await readRequiredJsonObject<IDagOrchestrationCostMetaPreviewRequest>(
    args,
    'cost-meta preview',
    io,
  );
  if (!payload.ok) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: payload.failure };
  return serverResult(await client.previewCostMetaFormula(payload.value));
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

async function oneNodeTypeCommand(
  args: readonly string[],
  message: string,
  operation: (
    nodeType: string,
  ) => Promise<{ readonly ok: boolean; readonly payload: TDagCliOutputPayload }>,
): Promise<IDagCliCommandResult> {
  const [nodeType] = args;
  if (!nodeType || args.length > 1) return usageResult(message);
  return serverResult(await operation(nodeType));
}

function usageResult(detail: string): IDagCliCommandResult {
  return {
    exitCode: USAGE_ERROR_EXIT_CODE,
    payload: createCliFailure('DAG_CLI_USAGE_ERROR', detail),
  };
}

function serverResult(response: {
  readonly ok: boolean;
  readonly payload: TDagCliOutputPayload;
}): IDagCliCommandResult {
  return {
    exitCode: response.ok ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE,
    payload: response.payload,
  };
}
