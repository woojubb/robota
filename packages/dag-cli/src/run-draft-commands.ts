import type {
  IDagOrchestrationHttpClient,
  IDagOrchestrationOverwriteRunDraftNodeResultRequest,
  TDagOrchestrationCreateRunDraftRequest,
  TDagOrchestrationReplaceRunDraftRequest,
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

export async function runRunDraftsCommand(
  command: string | undefined,
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  if (command === 'create') {
    return createRunDraftCommand(args, client, io);
  }
  if (command === 'get') {
    return oneArgumentCommand(
      args,
      'run-drafts get requires <draftId>.',
      client.getRunDraft.bind(client),
    );
  }
  if (command === 'replace') {
    return replaceRunDraftCommand(args, client, io);
  }
  if (command === 'reset') {
    return resetRunDraftCommand(args, client);
  }
  if (command === 'overwrite') {
    return overwriteRunDraftCommand(args, client, io);
  }
  return usageResult('Expected run-drafts command: create, get, replace, reset, or overwrite.');
}

async function createRunDraftCommand(
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  const payload = await readRequiredJsonObject<TDagOrchestrationCreateRunDraftRequest>(
    args,
    'run-drafts create',
    io,
  );
  if (!payload.ok) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: payload.failure };
  return serverResult(await client.createRunDraft(payload.value));
}

async function replaceRunDraftCommand(
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  const [draftId, ...rest] = args;
  if (!draftId) return usageResult('run-drafts replace requires <draftId>.');
  const payload = await readRequiredJsonObject<TDagOrchestrationReplaceRunDraftRequest>(
    rest,
    'run-drafts replace',
    io,
  );
  if (!payload.ok) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: payload.failure };
  return serverResult(await client.replaceRunDraft(draftId, payload.value));
}

async function resetRunDraftCommand(
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
): Promise<IDagCliCommandResult> {
  const ids = parseDraftAndNodeId(args, 'run-drafts reset');
  if (!ids.ok) return ids.result;
  return serverResult(await client.resetRunDraftNodeResult(ids.draftId, ids.nodeId));
}

async function overwriteRunDraftCommand(
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  const ids = parseDraftAndNodeId(args, 'run-drafts overwrite');
  if (!ids.ok) return ids.result;
  const payload = await readRequiredJsonObject<IDagOrchestrationOverwriteRunDraftNodeResultRequest>(
    ids.rest,
    'run-drafts overwrite',
    io,
  );
  if (!payload.ok) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: payload.failure };
  return serverResult(
    await client.overwriteRunDraftNodeResult(ids.draftId, ids.nodeId, payload.value),
  );
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

function parseDraftAndNodeId(
  args: readonly string[],
  commandName: string,
):
  | {
      readonly ok: true;
      readonly draftId: string;
      readonly nodeId: string;
      readonly rest: readonly string[];
    }
  | { readonly ok: false; readonly result: IDagCliCommandResult } {
  const [draftId, nodeId, ...rest] = args;
  if (!draftId || !nodeId) {
    return { ok: false, result: usageResult(`${commandName} requires <draftId> <nodeId>.`) };
  }
  return { ok: true, draftId, nodeId, rest };
}

async function oneArgumentCommand(
  args: readonly string[],
  message: string,
  operation: (
    id: string,
  ) => Promise<{ readonly ok: boolean; readonly payload: TDagCliOutputPayload }>,
): Promise<IDagCliCommandResult> {
  const [id] = args;
  if (!id || args.length > 1) return usageResult(message);
  return serverResult(await operation(id));
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
