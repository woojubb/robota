import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { IDagDefinition, TPortPayload } from '@robota-sdk/dag-core';
import { DagOrchestrationHttpClient } from '@robota-sdk/dag-orchestration-client';
import { parseGlobalConfig } from './arguments.js';
import { dispatchDagCliCommand } from './runner-dispatch.js';
import { formatJsonOutput } from './json.js';
import type { IDagCliIo, IDagCliRunOptions, TDagCliFetch } from './types.js';
import { FAILURE_EXIT_CODE, SUCCESS_EXIT_CODE, USAGE_ERROR_EXIT_CODE } from './types.js';

const UTF8_ENCODING = 'utf8';

const defaultIo: IDagCliIo = {
  write: (text: string) => {
    process.stdout.write(text);
  },
  readTextFile: async (filePath: string) => readFile(filePath, UTF8_ENCODING),
  writeBinaryStream: async (filePath, stream) => {
    await pipeline(
      Readable.fromWeb(stream as NodeReadableStream<Uint8Array>),
      createWriteStream(filePath),
    );
  },
};

const defaultFetch: TDagCliFetch = async (url: string, init?: RequestInit) => fetch(url, init);

export async function runDagCli(
  args: readonly string[],
  options: IDagCliRunOptions = {},
): Promise<number> {
  const io = options.io ?? defaultIo;
  const fetchImpl = options.fetch ?? defaultFetch;
  const config = parseGlobalConfig(args, options.env?.ROBOTA_DAG_SERVER_URL);

  if (config.failure) {
    io.write(formatJsonOutput(config.failure));
    return USAGE_ERROR_EXIT_CODE;
  }

  const client = new DagOrchestrationHttpClient({
    baseUrl: config.serverUrl,
    fetch: fetchImpl,
  });
  const result = await dispatchDagCliCommand(config.args, client, fetchImpl, io);
  io.write(formatJsonOutput(result.payload));
  return result.exitCode;
}

export function toServerExitCode(ok: boolean): number {
  return ok ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE;
}

export type { IDagCliRunOptions, IDagCliIo, TDagCliFetch };
export type TDagCliDefinition = IDagDefinition;
export type TDagCliInputPayload = TPortPayload;
