import type { IDagDefinition, IPartialRunRequest, TPortPayload } from '@robota-sdk/dag-core';
import type { IDagOrchestrationHttpClient } from '@robota-sdk/dag-orchestration-client';
import type {
  IDagCliCommandResult,
  IDagCliIo,
  TDagCliFetch,
  TDagCliOutputPayload,
  TDagCliValueResult,
} from './types.js';
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from './types.js';
import { rejectUnexpectedArgs, takeNumberOption, takeStringOption } from './arguments.js';
import { createCliFailure, isJsonObject, parseJsonArgument, parseJsonFile } from './json.js';
import { runAssetsCommand } from './asset-commands.js';
import { runRunDraftsCommand } from './run-draft-commands.js';
import { runWorkflowsCommand } from './workflow-commands.js';

const COMMAND_GROUP_ASSETS = 'assets';
const COMMAND_GROUP_DEFINITIONS = 'definitions';
const COMMAND_GROUP_NODES = 'nodes';
const COMMAND_GROUP_RUNS = 'runs';
const COMMAND_GROUP_RUN_DRAFTS = 'run-drafts';
const COMMAND_GROUP_WORKFLOWS = 'workflows';

export async function dispatchDagCliCommand(
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
  fetchImpl: TDagCliFetch,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  const [group, command, ...rest] = args;
  if (group === COMMAND_GROUP_ASSETS) {
    return runAssetsCommand(command, rest, client, fetchImpl, io);
  }
  if (group === COMMAND_GROUP_DEFINITIONS) {
    return runDefinitionsCommand(command, rest, client, io);
  }
  if (group === COMMAND_GROUP_NODES) {
    return runNodesCommand(command, client);
  }
  if (group === COMMAND_GROUP_RUNS) {
    return runRunsCommand(command, rest, client, io);
  }
  if (group === COMMAND_GROUP_RUN_DRAFTS) {
    return runRunDraftsCommand(command, rest, client, io);
  }
  if (group === COMMAND_GROUP_WORKFLOWS) {
    return runWorkflowsCommand(command, rest, client, io);
  }
  return usageResult(
    'Expected command group: assets, definitions, nodes, runs, run-drafts, or workflows.',
  );
}

async function runDefinitionsCommand(
  command: string | undefined,
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  if (command === 'list') {
    return serverResult(await client.listDefinitions());
  }
  if (command === 'get') {
    return getDefinitionCommand(args, client);
  }
  if (command === 'create') {
    return createDefinitionCommand(args, client, io);
  }
  if (command === 'publish') {
    return publishDefinitionCommand(args, client);
  }
  return usageResult('Expected definitions command: list, get, create, or publish.');
}

async function getDefinitionCommand(
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
): Promise<IDagCliCommandResult> {
  const [dagId] = args;
  if (!dagId) return usageResult('definitions get requires <dagId>.');
  const version = takeNumberOption(args.slice(1), '--version');
  if (version.failure) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: version.failure };
  const unexpected = rejectUnexpectedArgs(version.args, 'definitions get');
  if (unexpected) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: unexpected };
  return serverResult(await client.getDefinition(dagId, parseOptionalNumber(version.value)));
}

async function createDefinitionCommand(
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  const file = takeStringOption(args, '--file');
  if (file.failure) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: file.failure };
  if (!file.value) return usageResult('definitions create requires --file <definition.json>.');
  const unexpected = rejectUnexpectedArgs(file.args, 'definitions create');
  if (unexpected) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: unexpected };
  const definition = await readDefinitionFile(file.value, io);
  if (!definition.ok) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: definition.failure };
  return serverResult(await client.createDefinition(definition.value));
}

async function publishDefinitionCommand(
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
): Promise<IDagCliCommandResult> {
  const [dagId] = args;
  if (!dagId) return usageResult('definitions publish requires <dagId>.');
  const version = takeNumberOption(args.slice(1), '--version');
  if (version.failure) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: version.failure };
  const unexpected = rejectUnexpectedArgs(version.args, 'definitions publish');
  if (unexpected) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: unexpected };
  return serverResult(await client.publishDefinition(dagId, parseOptionalNumber(version.value)));
}

async function runNodesCommand(
  command: string | undefined,
  client: IDagOrchestrationHttpClient,
): Promise<IDagCliCommandResult> {
  if (command === 'list') {
    return serverResult(await client.listNodes());
  }
  return usageResult('Expected nodes command: list.');
}

async function runRunsCommand(
  command: string | undefined,
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  if (command === 'create') {
    return createRunCommand(args, client, io);
  }
  if (command === 'start') {
    return oneArgumentRun(
      args,
      'runs start requires <preparationId>.',
      client.startRun.bind(client),
    );
  }
  if (command === 'status') {
    return oneArgumentRun(
      args,
      'runs status requires <dagRunId>.',
      client.getRunStatus.bind(client),
    );
  }
  if (command === 'result') {
    return oneArgumentRun(
      args,
      'runs result requires <dagRunId>.',
      client.getRunResult.bind(client),
    );
  }
  return usageResult('Expected runs command: create, start, status, or result.');
}

async function createRunCommand(
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  const parsed = parseRunCreateOptions(args);
  if (!parsed.ok) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: parsed.failure };
  const definition = await readDefinitionFile(parsed.filePath, io);
  if (!definition.ok) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: definition.failure };
  const input = await readInputPayload(parsed.input, io);
  if (!input.ok) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: input.failure };
  return serverResult(
    await client.createRun({
      definition: definition.value,
      input: input.value,
      partialRun: parsed.partialRun,
    }),
  );
}

type TRunCreateOptions =
  | {
      readonly ok: false;
      readonly failure: ReturnType<typeof createCliFailure>;
    }
  | {
      readonly ok: true;
      readonly filePath: string;
      readonly input?: string;
      readonly partialRun?: IPartialRunRequest;
    };

function parseRunCreateOptions(args: readonly string[]): TRunCreateOptions {
  const file = takeStringOption(args, '--file');
  if (file.failure) return { ok: false, failure: file.failure };
  if (!file.value) {
    return {
      ok: false,
      failure: createCliFailure(
        'DAG_CLI_USAGE_ERROR',
        'runs create requires --file <definition.json>.',
      ),
    };
  }
  const input = takeStringOption(file.args, '--input');
  if (input.failure) return { ok: false, failure: input.failure };
  const partialStart = takeStringOption(input.args, '--partial-start');
  if (partialStart.failure) return { ok: false, failure: partialStart.failure };
  const unexpected = rejectUnexpectedArgs(partialStart.args, 'runs create');
  if (unexpected) return { ok: false, failure: unexpected };
  return {
    ok: true,
    filePath: file.value,
    input: input.value,
    partialRun: partialStart.value ? { startNodeId: partialStart.value } : undefined,
  };
}

async function readDefinitionFile(
  filePath: string,
  io: IDagCliIo,
): Promise<TDagCliValueResult<IDagDefinition>> {
  const parsed = await parseJsonFile(filePath, io);
  if (!parsed.ok) return parsed;
  if (!isJsonObject(parsed.value)) {
    return {
      ok: false,
      failure: createCliFailure('DAG_CLI_USAGE_ERROR', 'definition JSON must be an object.'),
    };
  }
  const definitionObject: object = parsed.value;
  return { ok: true, value: definitionObject as IDagDefinition };
}

async function readInputPayload(
  input: string | undefined,
  io: IDagCliIo,
): Promise<TDagCliValueResult<TPortPayload | undefined>> {
  if (!input) return { ok: true, value: undefined };
  const parsed = await parseJsonArgument(input, io);
  if (!parsed.ok) return parsed;
  if (!isJsonObject(parsed.value)) {
    return {
      ok: false,
      failure: createCliFailure('DAG_CLI_USAGE_ERROR', 'run input JSON must be an object.'),
    };
  }
  const inputObject: object = parsed.value;
  return { ok: true, value: inputObject as TPortPayload };
}

async function oneArgumentRun(
  args: readonly string[],
  message: string,
  operation: (
    id: string,
  ) => Promise<{ readonly ok: boolean; readonly payload: TDagCliOutputPayload }>,
): Promise<IDagCliCommandResult> {
  const [id] = args;
  if (!id) return usageResult(message);
  if (args.length > 1) return usageResult(message);
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

function parseOptionalNumber(value: string | undefined): number | undefined {
  return typeof value === 'string' ? Number(value) : undefined;
}
