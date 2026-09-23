import { createUserSessionStore } from '@robota-sdk/agent-framework';
import { createOtlpUsageSnapshot } from '@robota-sdk/agent-session-analytics';

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
const EXPORT_TIMEOUT_MS = 5_000;

function invalid(message: string): IUsageExportResult {
  return { exitCode: 1, stdout: '', stderr: `${message}\n` };
}

function endpointFrom(argv: readonly string[]): URL | IUsageExportResult {
  if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) {
    return {
      exitCode: 0,
      stdout:
        'Usage: robota usage export --endpoint http://127.0.0.1:4318\nExports a non-additive, content-free OTLP/HTTP JSON metric snapshot to a loopback collector.\n',
      stderr: '',
    };
  }
  if (argv.length !== 2 || argv[0] !== '--endpoint' || !argv[1]) {
    return invalid('Usage: robota usage export --endpoint http://127.0.0.1:4318');
  }
  let url: URL;
  try {
    url = new URL(argv[1]);
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
  return url;
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

function rejectedByCollector(body: string): boolean {
  if (!body) return true;
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return true;
  const partial = (parsed as { partialSuccess?: unknown }).partialSuccess;
  if (partial === undefined) return false;
  if (typeof partial !== 'object' || partial === null || Array.isArray(partial)) return true;
  const { rejectedDataPoints, errorMessage } = partial as {
    rejectedDataPoints?: unknown;
    errorMessage?: unknown;
  };
  if (
    rejectedDataPoints !== undefined &&
    typeof rejectedDataPoints !== 'string' &&
    typeof rejectedDataPoints !== 'number'
  )
    return true;
  const rejected = rejectedDataPoints === undefined ? 0 : Number(rejectedDataPoints);
  return (
    !Number.isSafeInteger(rejected) ||
    rejected < 0 ||
    rejected > 0 ||
    (errorMessage !== undefined && typeof errorMessage !== 'string') ||
    (typeof errorMessage === 'string' && errorMessage.length > 0)
  );
}

export async function executeUsageExportCommand(
  argv: readonly string[],
  dependencies: IUsageExportDependencies,
): Promise<IUsageExportResult> {
  const endpoint = endpointFrom(argv);
  if ('exitCode' in endpoint) return endpoint;

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

  const payload = createOtlpUsageSnapshot(
    snapshot.records,
    dependencies.now ?? new Date(),
    dependencies.version ?? readVersion(),
  );
  try {
    const response = await (dependencies.fetcher ?? fetch)(new URL('/v1/metrics', endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
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
    const body = await readBoundedResponse(response);
    if (rejectedByCollector(body)) return invalid('OTLP collector rejected part of the snapshot.');
  } catch {
    return invalid('OTLP export failed; check the loopback collector and response format.');
  }
  return {
    exitCode: 0,
    stdout: 'Exported OTLP usage snapshot to loopback collector.\n',
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
