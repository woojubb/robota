import { createUserSessionStore } from '@robota-sdk/agent-framework';
import {
  createOtlpPromptRootTraces,
  createOtlpUsageSnapshot,
} from '@robota-sdk/agent-session-analytics';

import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';
import { userPaths } from '../product/user-paths.js';
import { readVersion } from '../startup/version.js';
import { enumerateUsageSnapshot } from './usage-command.js';

interface IUsageExportDependencies {
  readonly userSessionStore: IInteractiveSessionStore;
  readonly projectSessionStore?: IInteractiveSessionStore;
  readonly fetcher?: typeof fetch;
  readonly now?: Date;
  readonly version?: string;
}

interface IUsageExportResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_TRACE_REQUEST_BYTES = 8 * 1024 * 1024;
const EXPORT_TIMEOUT_MS = 5_000;
const PROTOJSON_INTEGER_STRING = /^-?(\d+)(?:\.(\d+))?(?:[eE][+-]?\d+)?$/;
type TExportSignal = 'metrics' | 'traces';

function invalid(message: string): IUsageExportResult {
  return { exitCode: 1, stdout: '', stderr: `${message}\n` };
}

function endpointFrom(
  argv: readonly string[],
): { readonly endpoint: URL; readonly signal: TExportSignal } | IUsageExportResult {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    return {
      exitCode: 0,
      stdout:
        'Usage: robota usage export [--signal traces] --endpoint http://127.0.0.1:4318\nExports a content-free OTLP/HTTP JSON metric snapshot or prompt root traces to a loopback collector.\n',
      stderr: '',
    };
  }
  let endpointValue: string | undefined;
  let signal: TExportSignal = 'metrics';
  let signalSpecified = false;
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!value)
      return invalid(
        'Usage: robota usage export [--signal traces] --endpoint http://127.0.0.1:4318',
      );
    if (flag === '--endpoint' && endpointValue === undefined) endpointValue = value;
    else if (
      flag === '--signal' &&
      !signalSpecified &&
      (value === 'metrics' || value === 'traces')
    ) {
      signal = value;
      signalSpecified = true;
    } else {
      return invalid(
        'Usage: robota usage export [--signal traces] --endpoint http://127.0.0.1:4318',
      );
    }
  }
  if (!endpointValue)
    return invalid('Usage: robota usage export [--signal traces] --endpoint http://127.0.0.1:4318');
  let url: URL;
  try {
    url = new URL(endpointValue);
  } catch {
    return invalid('Invalid OTLP endpoint URL.');
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    (url.hostname !== '127.0.0.1' && url.hostname !== '[::1]') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    return invalid(
      'OTLP endpoint must be a loopback HTTP(S) origin without credentials or a path.',
    );
  }
  return { endpoint: url, signal };
}

async function readBoundedResponse(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('OTLP response exceeded the size limit.');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}

function rejectedByCollector(body: string, signal: TExportSignal): boolean {
  if (!body) return true;
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return true;
  const partial = (parsed as { partialSuccess?: unknown }).partialSuccess;
  if (partial === undefined) return false;
  if (typeof partial !== 'object' || partial === null || Array.isArray(partial)) return true;
  const { rejectedDataPoints, rejectedSpans, errorMessage } = partial as {
    rejectedDataPoints?: unknown;
    rejectedSpans?: unknown;
    errorMessage?: unknown;
  };
  const rejectedCount = signal === 'traces' ? rejectedSpans : rejectedDataPoints;
  if (
    rejectedCount !== undefined &&
    typeof rejectedCount !== 'string' &&
    typeof rejectedCount !== 'number'
  )
    return true;
  let rejected = false;
  if (typeof rejectedCount === 'number') {
    if (!Number.isSafeInteger(rejectedCount) || rejectedCount < 0) return true;
    rejected = rejectedCount > 0;
  } else if (typeof rejectedCount === 'string') {
    const match = PROTOJSON_INTEGER_STRING.exec(rejectedCount);
    if (!match) return true;
    // A nonzero mantissa must never underflow to an apparently accepted zero via Number().
    rejected = /[1-9]/.test(`${match[1]}${match[2] ?? ''}`);
  }
  return (
    rejected ||
    (errorMessage !== undefined && typeof errorMessage !== 'string') ||
    (typeof errorMessage === 'string' && errorMessage.length > 0)
  );
}

export async function executeUsageExportCommand(
  argv: readonly string[],
  dependencies: IUsageExportDependencies,
): Promise<IUsageExportResult> {
  const args = endpointFrom(argv);
  if ('exitCode' in args) return args;
  const { endpoint, signal } = args;

  let snapshot: ReturnType<typeof enumerateUsageSnapshot>;
  try {
    snapshot = enumerateUsageSnapshot(dependencies);
  } catch {
    return invalid('Unable to read configured session stores.');
  }
  if (snapshot.corruptSessionIds.length > 0 || snapshot.unsupportedSessionIds.length > 0) {
    return invalid(
      'Stored sessions include unreadable or unsupported records; no incomplete snapshot was sent.',
    );
  }
  if (snapshot.records.length === 0) return invalid('No readable sessions to export.');

  const version = dependencies.version ?? readVersion();
  const traces =
    signal === 'traces' ? createOtlpPromptRootTraces(snapshot.records, version) : undefined;
  if (traces && traces.coverage.exported === 0) {
    return invalid(
      `No valid prompt root traces to export (missing ${traces.coverage.missing}, invalid ${traces.coverage.invalid}, duplicate ${traces.coverage.duplicate}).`,
    );
  }
  const payload =
    traces?.payload ??
    createOtlpUsageSnapshot(snapshot.records, dependencies.now ?? new Date(), version);
  const body = JSON.stringify(payload);
  if (traces && Buffer.byteLength(body, 'utf8') > MAX_TRACE_REQUEST_BYTES) {
    return invalid('OTLP trace request exceeded the size limit; nothing was sent.');
  }
  try {
    const response = await (dependencies.fetcher ?? fetch)(new URL(`/v1/${signal}`, endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      redirect: 'error',
      signal: AbortSignal.timeout(EXPORT_TIMEOUT_MS),
    });
    if (response.status !== 200) return invalid(`OTLP collector returned HTTP ${response.status}.`);
    if (
      response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !==
      'application/json'
    ) {
      return invalid('OTLP collector returned a non-JSON response.');
    }
    const responseBody = await readBoundedResponse(response);
    if (rejectedByCollector(responseBody, signal))
      return invalid('OTLP collector rejected part of the export.');
  } catch {
    return invalid('OTLP export failed; check the loopback collector and response format.');
  }
  return {
    exitCode: 0,
    stdout: traces
      ? `Exported ${traces.coverage.exported} prompt root trace(s) to loopback collector (missing ${traces.coverage.missing}, invalid ${traces.coverage.invalid}, duplicate ${traces.coverage.duplicate}).\n`
      : 'Exported OTLP usage snapshot to loopback collector.\n',
    stderr: '',
  };
}

export async function runUsageExportCommand(
  argv: readonly string[],
  projectSessionStore?: IInteractiveSessionStore,
): Promise<number> {
  const result = await executeUsageExportCommand(argv, {
    userSessionStore: createUserSessionStore(userPaths().sessions),
    ...(projectSessionStore ? { projectSessionStore } : {}),
    version: readVersion(),
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result.exitCode;
}
