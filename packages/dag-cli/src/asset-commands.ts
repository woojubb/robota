import type {
  IDagOrchestrationAssetUploadRequest,
  IDagOrchestrationHttpClient,
} from '@robota-sdk/dag-orchestration-client';
import { rejectUnexpectedArgs, takeStringOption } from './arguments.js';
import { createCliFailure, isJsonObject, parseJsonArgument } from './json.js';
import type {
  IDagCliCommandResult,
  IDagCliIo,
  TDagCliFetch,
  TDagCliOutputPayload,
  TDagCliValueResult,
  TJsonObject,
} from './types.js';
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from './types.js';

const JSON_OPTION = '--json';
const OUTPUT_OPTION = '--output';

export async function runAssetsCommand(
  command: string | undefined,
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
  fetchImpl: TDagCliFetch,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  if (command === 'upload') {
    return uploadAssetCommand(args, client, io);
  }
  if (command === 'get') {
    return oneAssetIdCommand(
      args,
      'assets get requires <assetId>.',
      client.getAssetMetadata.bind(client),
    );
  }
  if (command === 'download') {
    return downloadAssetCommand(args, client, fetchImpl, io);
  }
  return usageResult('Expected assets command: upload, get, or download.');
}

async function uploadAssetCommand(
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  const payload = await readRequiredJsonObject<IDagOrchestrationAssetUploadRequest>(
    args,
    'assets upload',
    io,
  );
  if (!payload.ok) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: payload.failure };
  return serverResult(await client.uploadAsset(payload.value));
}

async function downloadAssetCommand(
  args: readonly string[],
  client: IDagOrchestrationHttpClient,
  fetchImpl: TDagCliFetch,
  io: IDagCliIo,
): Promise<IDagCliCommandResult> {
  const [assetId, ...rest] = args;
  if (!assetId) return usageResult('assets download requires <assetId>.');

  const output = takeStringOption(rest, OUTPUT_OPTION);
  if (output.failure) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: output.failure };
  if (!output.value) return usageResult('assets download requires --output <path>.');

  const unexpected = rejectUnexpectedArgs(output.args, 'assets download');
  if (unexpected) return { exitCode: USAGE_ERROR_EXIT_CODE, payload: unexpected };

  const info = client.getAssetContentDownloadInfo(assetId);
  const response = await fetchImpl(info.url, { method: info.method });
  if (!response.ok) {
    return {
      exitCode: FAILURE_EXIT_CODE,
      payload: createCliFailure(
        'DAG_CLI_ASSET_DOWNLOAD_FAILED',
        `Asset content download failed with status ${response.status}.`,
      ),
    };
  }
  if (!response.body) {
    return {
      exitCode: FAILURE_EXIT_CODE,
      payload: createCliFailure(
        'DAG_CLI_ASSET_DOWNLOAD_FAILED',
        'Asset content response is empty.',
      ),
    };
  }

  await io.writeBinaryStream(output.value, response.body);
  return {
    exitCode: SUCCESS_EXIT_CODE,
    payload: {
      ok: true,
      status: response.status,
      data: {
        assetId: info.assetId,
        outputPath: output.value,
        contentType: response.headers.get(info.contentTypeHeader) ?? undefined,
        contentDisposition: response.headers.get(info.contentDispositionHeader) ?? undefined,
      },
    },
  };
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

async function oneAssetIdCommand(
  args: readonly string[],
  message: string,
  operation: (
    assetId: string,
  ) => Promise<{ readonly ok: boolean; readonly payload: TDagCliOutputPayload }>,
): Promise<IDagCliCommandResult> {
  const [assetId] = args;
  if (!assetId || args.length > 1) return usageResult(message);
  return serverResult(await operation(assetId));
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
