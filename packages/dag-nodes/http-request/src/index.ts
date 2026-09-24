import { AbstractNodeDefinition, NodeIoAccessor } from '@robota-sdk/dag-node';
import {
  buildTaskExecutionError,
  buildTaskCancellationError,
  buildValidationError,
  resolveDagExecutionByteLimits,
  type ICostEstimate,
  type IDagError,
  type IDagNodeDefinition,
  type INodeExecutionContext,
  type TPortPayload,
  type TResult,
} from '@robota-sdk/dag-core';
import { z } from 'zod';

const DEFAULT_TIMEOUT_MS = 10_000;

class BodyByteLimitError extends Error {}

/** Read only admitted bytes; a stalled stream must also observe the request's abort signal. */
async function readBody(response: Response, maxBytes: number, signal: AbortSignal): Promise<string> {
  const declared = response.headers.get('content-length');
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    throw new BodyByteLimitError('HTTP response body exceeds its UTF-8 byte limit');
  }
  if (response.body === null) return '';

  const reader = response.body.getReader();
  const bytes = new Uint8Array(maxBytes);
  let length = 0;
  let complete = false;
  try {
    for (;;) {
      if (signal.aborted) throw new DOMException('HTTP request aborted', 'AbortError');
      let onAbort: (() => void) | undefined;
      const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(new DOMException('HTTP request aborted', 'AbortError'));
        signal.addEventListener('abort', onAbort, { once: true });
      });
      let part: ReadableStreamReadResult<Uint8Array>;
      try {
        part = await Promise.race([reader.read(), aborted]);
      } finally {
        if (onAbort) signal.removeEventListener('abort', onAbort);
      }
      if (part.done) {
        complete = true;
        break;
      }
      if (part.value.byteLength > maxBytes - length) {
        throw new BodyByteLimitError('HTTP response body exceeds its UTF-8 byte limit');
      }
      bytes.set(part.value, length);
      length += part.value.byteLength;
    }
  } finally {
    if (!complete) void reader.cancel().catch(() => undefined);
  }

  const decoder = new TextDecoder();
  const pieces: string[] = [];
  let outputBytes = 0;
  for (let offset = 0; offset < length; offset += 64 * 1024) {
    const piece = decoder.decode(bytes.subarray(offset, Math.min(offset + 64 * 1024, length)), { stream: true });
    outputBytes += Buffer.byteLength(piece, 'utf8');
    if (outputBytes > maxBytes) throw new BodyByteLimitError('HTTP response body exceeds its UTF-8 byte limit');
    pieces.push(piece);
  }
  const tail = decoder.decode();
  outputBytes += Buffer.byteLength(tail, 'utf8');
  if (outputBytes > maxBytes) throw new BodyByteLimitError('HTTP response body exceeds its UTF-8 byte limit');
  pieces.push(tail);
  return pieces.join('');
}

const HttpRequestConfigSchema = z.object({
  method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
  url: z.string().default(''),
  headers: z.record(z.string()).default({}),
  body: z.string().optional(),
  timeoutMs: z.number().int().positive().default(DEFAULT_TIMEOUT_MS),
});

export class HttpRequestNodeDefinition extends AbstractNodeDefinition<
  typeof HttpRequestConfigSchema
> {
  public readonly nodeType = 'http-request';
  public readonly displayName = 'HTTP Request';
  public readonly category = 'Network';
  public readonly inputs: IDagNodeDefinition['inputs'] = [
    { key: 'url', label: 'URL', order: 0, type: 'string', required: false },
    { key: 'body', label: 'Body', order: 1, type: 'string', required: false },
    { key: 'headers', label: 'Headers', order: 2, type: 'object', required: false },
  ];
  public readonly outputs: IDagNodeDefinition['outputs'] = [
    { key: 'statusCode', label: 'Status Code', order: 0, type: 'number', required: true },
    { key: 'body', label: 'Body', order: 1, type: 'string', required: true },
    { key: 'ok', label: 'OK', order: 2, type: 'boolean', required: true },
    { key: 'headers', label: 'Headers', order: 3, type: 'object', required: true },
  ];
  public readonly configSchemaDefinition = HttpRequestConfigSchema;

  public override async estimateCostWithConfig(): Promise<TResult<ICostEstimate, IDagError>> {
    return { ok: true, value: { estimatedCredits: 0 } };
  }

  protected override async executeWithConfig(
    input: TPortPayload,
    context: INodeExecutionContext,
    config: z.output<typeof HttpRequestConfigSchema>,
  ): Promise<TResult<TPortPayload, IDagError>> {
    const io = new NodeIoAccessor(input, context.nodeDefinition.nodeId);

    // Resolve URL: input port overrides config
    const urlFromInput = input['url'];
    const url =
      typeof urlFromInput === 'string' && urlFromInput.trim().length > 0
        ? urlFromInput.trim()
        : config.url;

    if (!url || url.trim().length === 0) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_HTTP_REQUEST_URL_REQUIRED',
          'url is required — set it via node config or the url input port',
          { nodeId: context.nodeDefinition.nodeId },
        ),
      };
    }

    const method = config.method;

    // Merge headers: config base, then input port override
    const headersFromInput = input['headers'];
    const inputHeaders: Record<string, string> =
      typeof headersFromInput === 'object' &&
      headersFromInput !== null &&
      !Array.isArray(headersFromInput)
        ? (headersFromInput as Record<string, string>) // allow-any: runtime object validated as string record
        : {};
    const headers: Record<string, string> = { ...config.headers, ...inputHeaders };

    // Resolve body: input port overrides config
    const bodyFromInput = input['body'];
    const body: string | undefined =
      typeof bodyFromInput === 'string' ? bodyFromInput : config.body;

    const { timeoutMs } = config;
    const maxBytes = resolveDagExecutionByteLimits(context.byteLimits).maxHttpResponseBodyBytes;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const onCancel = () => controller.abort();
    context.signal?.addEventListener('abort', onCancel, { once: true });
    if (context.signal?.aborted) controller.abort();

    // allow-fallback: network/fetch errors are caught and converted to structured Result
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? body : undefined,
        signal: controller.signal,
      });

      const responseBody = await readBody(response, maxBytes, controller.signal);
      if (controller.signal.aborted) throw new DOMException('HTTP request aborted', 'AbortError');
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });

      io.setOutput('statusCode', response.status);
      io.setOutput('body', responseBody);
      io.setOutput('ok', response.ok);
      io.setOutput('headers', responseHeaders);
      return { ok: true, value: io.toOutput() };
    } catch (error) {
      // allow-fallback: network errors converted to structured Result
      if (context.signal?.aborted) {
        return { ok: false, error: buildTaskCancellationError(context.taskRunId) };
      }
      if (error instanceof BodyByteLimitError) {
        controller.abort();
        return {
          ok: false,
          error: buildTaskExecutionError(
            'DAG_TASK_EXECUTION_BYTE_LIMIT_EXCEEDED', error.message, false,
            { maxBytes, nodeType: 'http-request' },
          ),
        };
      }

      // CORE-027: classified from the node's OWN timeout signal and the platform's abort name,
      // never from the error's prose. The substring test that stood here read any failure whose
      // message contained "abort" — a 5xx body quoting the word, a proxy's phrasing — as this
      // node's timeout, and mislabelled a retryable network error with the timeout's code.
      const isTimeout =
        controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');

      return {
        ok: false,
        error: buildTaskExecutionError(
          'DAG_TASK_EXECUTION_HTTP_REQUEST_FAILED',
          error instanceof Error ? error.message : 'HTTP request failed',
          !isTimeout,
          {
            url,
            method,
            errorCode: isTimeout ? 'TIMEOUT' : 'NETWORK_ERROR',
          },
        ),
      };
    } finally {
      clearTimeout(timeoutId);
      context.signal?.removeEventListener('abort', onCancel);
    }
  }
}
