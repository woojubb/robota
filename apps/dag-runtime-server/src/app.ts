import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { IDagBuildInput } from '@robota-sdk/dag-builder';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  buildValidationError,
  decodeOverwriteRunDraftNodeResultInput,
  decodeSaveRunDraftInput,
  type IDagDefinition,
  type IAssetStore,
  type IRunDraftOperationsPort,
  type TRunProgressEvent,
} from '@robota-sdk/dag-core';
import type { IDagError, TResult } from '@robota-sdk/dag-core';
import type {
  ICostMeta,
  ICostMetaFormulaPreviewInput,
  ICostMetaFormulaValidationInput,
  ICostMetaOperationsPort,
} from '@robota-sdk/dag-cost';
import type {
  IDagOrchestrationCreateRunInput,
  IDagOrchestrationHttpResponse,
  IDagOrchestrationPort,
  IDagOrchestrationPublishedWorkflowRunRequest,
  IDagOrchestrationUpdateDraftInput,
} from '@robota-sdk/dag-orchestration-client';
import { registerAssetRoutes } from './asset-routes.js';

function reply(c: Context, response: IDagOrchestrationHttpResponse): Response {
  return c.json(response.payload, response.status as ContentfulStatusCode);
}

function costReply<T>(
  c: Context,
  result: TResult<T, IDagError>,
  dataOf: (value: T) => object,
  successStatus = 200,
): Response {
  if (result.ok) {
    return c.json(
      { ok: true, status: successStatus, data: dataOf(result.value) },
      successStatus as ContentfulStatusCode,
    );
  }
  const status = costErrorStatus(result.error.code);
  const detail =
    status >= 500 && status !== 501 ? 'Cost metadata operation failed.' : result.error.message;
  return c.json(
    {
      ok: false,
      status,
      errors: [
        {
          type: `urn:robota:problems:dag:${result.error.code.toLowerCase()}`,
          title: 'Cost metadata operation failed',
          status,
          detail,
          instance: c.req.path,
          code: result.error.code,
          retryable: result.error.retryable,
        },
      ],
    },
    status as ContentfulStatusCode,
  );
}

function costErrorStatus(code: string): number {
  if (code === 'DAG_COST_META_UNSUPPORTED') return 501;
  if (code === 'DAG_COST_META_NOT_FOUND') return 404;
  if (code === 'DAG_COST_META_INVALID' || code.startsWith('CEL_')) return 400;
  return 500;
}

function runDraftReply<T>(
  c: Context,
  result: TResult<T, IDagError>,
  successStatus = 200,
): Response {
  if (result.ok) {
    return c.json(
      { ok: true, status: successStatus, data: { draft: result.value } },
      successStatus as ContentfulStatusCode,
    );
  }
  const status =
    result.error.code === 'DAG_RUN_DRAFT_NOT_FOUND'
      ? 404
      : result.error.code === 'DAG_RUN_DRAFT_INVALID_INPUT'
        ? 400
        : 500;
  return c.json(
    {
      ok: false,
      status,
      errors: [
        {
          type: `urn:robota:problems:dag:${result.error.code.toLowerCase()}`,
          title: 'Run draft operation failed',
          status,
          detail: status >= 500 ? 'Run draft operation failed.' : result.error.message,
          instance: c.req.path,
          code: result.error.code,
          retryable: result.error.retryable,
        },
      ],
    },
    status as ContentfulStatusCode,
  );
}

function invalidRunDraftJson(c: Context): Response {
  return runDraftReply(c, {
    ok: false,
    error: buildValidationError(
      'DAG_RUN_DRAFT_INVALID_INPUT',
      'root: expected JSON object; received invalid JSON.',
    ),
  });
}

function invalidCostInput(c: Context, detail: string): Response {
  return costReply(
    c,
    {
      ok: false,
      error: {
        code: 'DAG_COST_META_INVALID',
        category: 'validation',
        message: detail,
        retryable: false,
      },
    },
    () => ({}),
  );
}

async function readCostJson(c: Context): Promise<unknown> {
  try {
    return await c.req.json<unknown>();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isCostMeta(value: unknown): value is ICostMeta {
  if (!isRecord(value)) return false;
  const category = value['category'];
  return (
    isNonemptyString(value['nodeType']) &&
    isNonemptyString(value['displayName']) &&
    (category === 'ai-inference' ||
      category === 'transform' ||
      category === 'io' ||
      category === 'custom') &&
    isNonemptyString(value['estimateFormula']) &&
    (value['calculateFormula'] === undefined || isNonemptyString(value['calculateFormula'])) &&
    isRecord(value['variables']) &&
    typeof value['enabled'] === 'boolean' &&
    isNonemptyString(value['updatedAt'])
  );
}

function isValidationInput(value: unknown): value is ICostMetaFormulaValidationInput {
  return isRecord(value) && isNonemptyString(value['formula']);
}

function isPreviewInput(value: unknown): value is ICostMetaFormulaPreviewInput {
  return (
    isRecord(value) &&
    isValidationInput(value) &&
    (value['variables'] === undefined || isRecord(value['variables'])) &&
    (value['testContext'] === undefined || isRecord(value['testContext']))
  );
}

/** A run-progress source the SSE stream subscribes to (structurally the framework's progress bus). */
export interface IRunProgressSource {
  subscribe(listener: (event: TRunProgressEvent) => void): () => void;
}

/** A run progress event is terminal when the whole execution has finished (success or failure). */
function isTerminalProgressEvent(event: TRunProgressEvent): boolean {
  return event.eventType === 'execution.completed' || event.eventType === 'execution.failed';
}

/**
 * Native DAG runtime HTTP server (WORKFLOW-002). Maps the `/v1/dag/*` route surface onto an
 * `IDagOrchestrationPort` — typically `createDagFramework().client` (the in-process implementation).
 * No external-runtime API surface. Legacy orchestration handlers forward JSON responses;
 * cost, draft and asset routes map their separate capabilities at the HTTP boundary.
 *
 * When a `progressSource` is supplied, `GET /v1/dag/runs/:id/events` streams that run's progress as
 * Server-Sent Events; without one, that route answers 501.
 */
export function createDagRuntimeServer(
  port: IDagOrchestrationPort,
  costMeta: ICostMetaOperationsPort,
  runDrafts: IRunDraftOperationsPort,
  progressSource?: IRunProgressSource,
  assets?: IAssetStore,
): Hono {
  const app = new Hono();

  // --- Node catalog ---
  app.get('/v1/dag/nodes', async (c) => reply(c, await port.listNodes()));

  // --- Definitions ---
  app.get('/v1/dag/definitions', async (c) => {
    const dagId = c.req.query('dagId');
    return reply(c, await port.listDefinitions(dagId !== undefined ? { dagId } : undefined));
  });
  app.get('/v1/dag/definitions/:dagId', async (c) => {
    const version = c.req.query('version');
    return reply(
      c,
      await port.getDefinition(
        c.req.param('dagId'),
        version !== undefined ? Number(version) : undefined,
      ),
    );
  });
  app.post('/v1/dag/definitions', async (c) => {
    const body = await c.req.json<{ definition: IDagDefinition }>();
    return reply(c, await port.createDefinition(body.definition));
  });
  app.put('/v1/dag/definitions/:dagId/draft', async (c) => {
    const body = await c.req.json<Omit<IDagOrchestrationUpdateDraftInput, 'dagId'>>();
    return reply(c, await port.updateDraft({ dagId: c.req.param('dagId'), ...body }));
  });
  app.post('/v1/dag/definitions/:dagId/validate', async (c) => {
    const body = await c.req.json<{ version: number }>();
    return reply(c, await port.validateDefinition(c.req.param('dagId'), Number(body.version)));
  });
  app.post('/v1/dag/definitions/:dagId/publish', async (c) => {
    const body = await c.req.json<{ version?: number }>();
    return reply(
      c,
      await port.publishDefinition(
        c.req.param('dagId'),
        body.version !== undefined ? Number(body.version) : undefined,
      ),
    );
  });

  // --- Run lifecycle ---
  app.post('/v1/dag/runs', async (c) => {
    const body = await c.req.json<IDagOrchestrationCreateRunInput>();
    return reply(c, await port.createRun(body));
  });
  app.post('/v1/dag/runs/:id/start', async (c) => reply(c, await port.startRun(c.req.param('id'))));
  app.get('/v1/dag/runs/:id', async (c) => reply(c, await port.getRunStatus(c.req.param('id'))));
  app.get('/v1/dag/runs/:id/result', async (c) =>
    reply(c, await port.getRunResult(c.req.param('id'))),
  );

  // --- Run progress stream (SSE) ---
  app.get('/v1/dag/runs/:id/events', (c) => {
    const runId = c.req.param('id');
    if (!progressSource) {
      return c.json({ error: 'progress streaming is not available on this server' }, 501);
    }
    return streamSSE(c, async (stream) => {
      // Serialize writes so the terminal event flushes before the stream closes.
      let writeChain = stream.writeSSE({
        event: 'open',
        data: JSON.stringify({ dagRunId: runId }),
      });
      await new Promise<void>((resolve) => {
        // `unsubscribe` is assigned synchronously; the listener only runs on later events.
        const unsubscribe = progressSource.subscribe((event) => {
          if (event.dagRunId !== runId) return;
          writeChain = writeChain.then(() =>
            stream.writeSSE({ event: event.eventType, data: JSON.stringify(event) }),
          );
          if (isTerminalProgressEvent(event)) {
            unsubscribe();
            writeChain.then(resolve, resolve);
          }
        });
        stream.onAbort(() => {
          unsubscribe();
          resolve();
        });
      });
      await writeChain;
    });
  });

  // --- Published-workflow run (start a published definition directly) ---
  app.post('/v1/dag/definitions/:dagId/start', async (c) => {
    const version = c.req.query('version');
    const body = await c.req
      .json<IDagOrchestrationPublishedWorkflowRunRequest>()
      .catch(() => undefined);
    return reply(
      c,
      await port.startPublishedWorkflowRun(
        c.req.param('dagId'),
        body,
        version !== undefined ? Number(version) : undefined,
      ),
    );
  });

  // --- Build / validate (definition authoring) ---
  app.post('/v1/dag/build', async (c) => {
    const body = await c.req.json<IDagBuildInput>();
    return reply(c, await port.buildDag(body));
  });
  app.post('/v1/dag/validate', async (c) => {
    const body = await c.req.json<{ definition: IDagDefinition }>();
    return reply(c, await port.validateDag(body.definition));
  });

  // --- Assets ---
  registerAssetRoutes(app, assets);

  // --- Cost metadata ---
  app.get('/v1/dag/cost-meta', async (c) =>
    costReply(c, await costMeta.listCostMeta(), (items) => ({ items })),
  );
  app.post('/v1/dag/cost-meta/validate', async (c) => {
    const body = await readCostJson(c);
    if (!isValidationInput(body)) return invalidCostInput(c, 'Expected a nonempty formula.');
    return costReply(c, await costMeta.validateCostMetaFormula(body), (value) => value);
  });
  app.post('/v1/dag/cost-meta/preview', async (c) => {
    const body = await readCostJson(c);
    if (!isPreviewInput(body)) return invalidCostInput(c, 'Expected formula and object contexts.');
    return costReply(c, await costMeta.previewCostMetaFormula(body), (result) => ({ result }));
  });
  app.post('/v1/dag/cost-meta', async (c) => {
    const body = await readCostJson(c);
    if (!isCostMeta(body)) return invalidCostInput(c, 'Invalid cost metadata.');
    return costReply(c, await costMeta.createCostMeta(body), (meta) => ({ meta }), 201);
  });
  app.get('/v1/dag/cost-meta/:nodeType', async (c) =>
    costReply(c, await costMeta.getCostMeta(c.req.param('nodeType')), (meta) => ({ meta })),
  );
  app.put('/v1/dag/cost-meta/:nodeType', async (c) => {
    const body = await readCostJson(c);
    if (!isCostMeta(body) || body.nodeType !== c.req.param('nodeType')) {
      return invalidCostInput(c, 'Invalid cost metadata or node type mismatch.');
    }
    return costReply(c, await costMeta.updateCostMeta(c.req.param('nodeType'), body), (meta) => ({
      meta,
    }));
  });
  app.delete('/v1/dag/cost-meta/:nodeType', async (c) =>
    costReply(c, await costMeta.deleteCostMeta(c.req.param('nodeType')), (value) => value),
  );

  // --- Run drafts (partial-run editing) ---
  app.post('/v1/dag/run-drafts', async (c) => {
    const body = await c.req.json<unknown>().catch(() => undefined);
    if (body === undefined) return invalidRunDraftJson(c);
    const input = decodeSaveRunDraftInput(body);
    if (!input.ok) return runDraftReply(c, input);
    return runDraftReply(c, await runDrafts.createRunDraft(input.value), 201);
  });
  app.get('/v1/dag/run-drafts/:draftId', async (c) =>
    runDraftReply(c, await runDrafts.getRunDraft(c.req.param('draftId'))),
  );
  app.put('/v1/dag/run-drafts/:draftId', async (c) => {
    const body = await c.req.json<unknown>().catch(() => undefined);
    if (body === undefined) return invalidRunDraftJson(c);
    const input = decodeSaveRunDraftInput(body);
    if (!input.ok) return runDraftReply(c, input);
    return runDraftReply(c, await runDrafts.replaceRunDraft(c.req.param('draftId'), input.value));
  });
  app.post('/v1/dag/run-drafts/:draftId/nodes/:nodeId/reset', async (c) =>
    runDraftReply(
      c,
      await runDrafts.resetRunDraftNodeResult(c.req.param('draftId'), c.req.param('nodeId')),
    ),
  );
  app.put('/v1/dag/run-drafts/:draftId/nodes/:nodeId/result', async (c) => {
    const body = await c.req.json<unknown>().catch(() => undefined);
    if (body === undefined) return invalidRunDraftJson(c);
    const input = decodeOverwriteRunDraftNodeResultInput(body);
    if (!input.ok) return runDraftReply(c, input);
    return runDraftReply(
      c,
      await runDrafts.overwriteRunDraftNodeResult(
        c.req.param('draftId'),
        c.req.param('nodeId'),
        input.value,
      ),
    );
  });

  return app;
}
