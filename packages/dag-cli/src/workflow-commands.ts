import type {
  IDagOrchestrationHttpClient,
  IDagOrchestrationPublishedWorkflowRunRequest,
} from '@robota-sdk/dag-orchestration-client';
import { rejectUnexpectedArgs, takeNumberOption, takeStringOption } from './arguments.js';
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

export async function runWorkflowsCommand(
  command: string | undefined,
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  if (command === 'start') {
    return startPublishedWorkflowCommand(args, client, io);
  }
  return usageResult('Expected workflows command: start.');
}

async function startPublishedWorkflowCommand(
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  const [dagId, ...rest] = args;
  if (!dagId) return usageResult('workflows start requires <dagId>.');

  const version = takeNumberOption(rest, '--version');
  if (version.failure) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: version.failure };

  const json = takeStringOption(version.args, JSON_OPTION);
  if (json.failure) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: json.failure };

  const unexpected = rejectUnexpectedArgs(json.args, 'workflows start');
  if (unexpected) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: unexpected };

  const request = await readOptionalJsonObject<IDagOrchestrationPublishedWorkflowRunRequest>(
    json.value,
    'workflows start',
    io,
  );
  if (!request.ok) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: request.failure };

  return serverResult(
    await client.startPublishedWorkflowRun(
      dagId,
      request.value,
      parseOptionalNumber(version.value),
    ),
  );
}

async function readOptionalJsonObject<TValue extends object>(
  json: string | undefined,
  commandName: string,
  io: IDagCliIo,
): Promise<TDagCliValueResult<TValue | undefined>> {
  if (!json) return { ok: true, value: undefined };

  const parsed = await parseJsonArgument(json, io);
  if (!parsed.ok) return parsed;
  if (!isJsonObject(parsed.value)) {
    return {
      ok: false,
      failure: createCliFailure('DAG_CLI_USAGE_ERROR', `${commandName} JSON must be an object.`),
    };
  }
  return { ok: true, value: parsed.value as TJsonObject as TValue };
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

function parseOptionalNumber(value: string | undefined): number | undefined {
  return typeof value === 'string' ? Number(value) : undefined;
}
