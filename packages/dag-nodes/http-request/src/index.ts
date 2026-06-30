import { AbstractNodeDefinition, NodeIoAccessor } from '@robota-sdk/dag-node';
import {
  buildTaskExecutionError,
  buildValidationError,
  type ICostEstimate,
  type IDagError,
  type IDagNodeDefinition,
  type INodeExecutionContext,
  type TPortPayload,
  type TResult,
} from '@robota-sdk/dag-core';
import { z } from 'zod';

const DEFAULT_TIMEOUT_MS = 10_000;

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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // allow-fallback: network/fetch errors are caught and converted to structured Result
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body !== undefined ? body : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const responseBody = await response.text();
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
      clearTimeout(timeoutId);

      const isTimeout =
        error instanceof Error &&
        (error.name === 'AbortError' || error.message.toLowerCase().includes('abort'));

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
    }
  }
}
