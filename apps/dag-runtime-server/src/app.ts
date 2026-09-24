import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';

import type { IDagBuildInput, IDagBuildPort } from '@robota-sdk/dag-builder';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import {
  toProblemDetails,
  type IDagRunLifecyclePort,
  type TPrepareRunError,
} from '@robota-sdk/dag-api';
import {
  buildValidationError,
  decodeOverwriteRunDraftNodeResultInput,
  decodeSaveRunDraftInput,
  type IDagDefinition,
  type IAssetStore,
  type IRunDraftOperationsPort,
  type IDagValidationPort,
  type IDagNodeCatalogPort,
  type IDagDefinitionReadPort,
  type IDagDefinitionMutationPort,
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
  IDagOrchestrationPublishedWorkflowRunRequest,
  IDagOrchestrationUpdateDraftInput,
} from '@robota-sdk/dag-orchestration-client';
import { registerAssetRoutes } from './asset-routes.js';

function runProblem(
  error: IDagError,
  instance: string,
  title = 'DAG operation failed',
  status = error.code.endsWith('_NOT_FOUND') ? 404 : 400,
) {
  return {
    type: `urn:robota:problems:dag:${error.category ?? 'validation'}`,
    title,
    status,
    detail: error.message,
    instance,
    code: error.code,
    retryable: error.retryable ?? false,
  };
}

function runFailure(c: Context, error: IDagError, instance: string): Response {
  const problem = runProblem(error, instance);
  return c.json(
    { ok: false, status: problem.status, errors: [problem] },
    problem.status as ContentfulStatusCode,
  );
}

function runCreateFailure(c: Context, failure: TPrepareRunError): Response {
  if (failure.phase === 'run_create') return runFailure(c, failure.error, '/v1/dag/runs');
  const title = failure.phase === 'definition_create' ? 'Validation failed' : 'Publish failed';
  const errors = failure.errors.map((error) => runProblem(error, '/v1/dag/runs', title, 400));
  return c.json({ ok: false, status: 400, errors }, 400);
}

function definitionMutationReply(
  c: Context,
  result: TResult<IDagDefinition, IDagError[]>,
  successStatus: 200 | 201,
  instance: string,
  dataOf: (definition: IDagDefinition) => object,
): Response {
  if (result.ok) {
    return c.json({ ok: true, status: successStatus, data: dataOf(result.value) }, successStatus);
  }
  return c.json(
    {
      ok: false,
      status: 400,
      errors: result.error.map((error) => toProblemDetails(error, instance)),
    },
    400,
  );
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
 * Native DAG runtime HTTP server (WORKFLOW-002). Maps in-process domain capabilities onto
 * `/v1/dag/*` HTTP responses. No external-runtime API surface.
 *
 * When a `progressSource` is supplied, `GET /v1/dag/runs/:id/events` streams that run's progress as
 * Server-Sent Events; without one, that route answers 501.
 */
export function createDagRuntimeServer(
  runs: IDagRunLifecyclePort,
  costMeta: ICostMetaOperationsPort,
  runDrafts: IRunDraftOperationsPort,
  build: IDagBuildPort,
  validation: IDagValidationPort,
  catalog: IDagNodeCatalogPort,
  definitionReads: IDagDefinitionReadPort,
  definitionMutations: IDagDefinitionMutationPort,
  progressSource?: IRunProgressSource,
  assets?: IAssetStore,
): Hono {
  const app = new Hono();

  // --- Node catalog ---
  app.get('/v1/dag/nodes', async (c) => {
    const manifests = await catalog.listNodes();
    return c.json(
      {
        ok: true,
        status: 200,
        data: {
          items: manifests.map((manifest) => ({
            nodeType: manifest.nodeType,
            displayName: manifest.displayName,
            category: manifest.category,
            inputs: manifest.inputs,
            outputs: manifest.outputs,
            ...(manifest.configSchema ? { configSchema: manifest.configSchema } : {}),
          })),
        },
      },
      200,
    );
  });

  // --- Definitions ---
  app.get('/v1/dag/definitions', async (c) => {
    const dagId = c.req.query('dagId');
    const items = await definitionReads.listDefinitions(dagId);
    return c.json({ ok: true, status: 200, data: { items } }, 200);
  });
  app.get('/v1/dag/definitions/:dagId', async (c) => {
    const dagId = c.req.param('dagId');
    const versionQuery = c.req.query('version');
    const version = versionQuery !== undefined ? Number(versionQuery) : undefined;
    const definition = await definitionReads.getDefinition(dagId, version);
    if (definition === undefined) {
      return c.json(
        {
          ok: false,
          status: 404,
          errors: [
            {
              type: 'urn:robota:problems:dag:validation',
              title: 'Validation failed',
              status: 400,
              detail: 'Definition does not exist',
              instance: `/v1/dag/definitions/${dagId}${typeof version === 'number' ? `?version=${version}` : ''}`,
              code: 'DAG_VALIDATION_DEFINITION_NOT_FOUND',
              retryable: false,
            },
          ],
        },
        404,
      );
    }
    return c.json({ ok: true, status: 200, data: { definition } }, 200);
  });
  app.post('/v1/dag/definitions', async (c) => {
    const body = await c.req.json<{ definition: IDagDefinition }>();
    const definition = body.definition;
    return definitionMutationReply(
      c,
      await definitionMutations.createDefinition(definition),
      201,
      `/v1/dag/definitions/${definition.dagId}/versions/${definition.version}`,
      (value) => ({ definitionId: `${value.dagId}:${value.version}`, definition: value }),
    );
  });
  app.put('/v1/dag/definitions/:dagId/draft', async (c) => {
    const body = await c.req.json<Omit<IDagOrchestrationUpdateDraftInput, 'dagId'>>();
    return definitionMutationReply(
      c,
      await definitionMutations.updateDraft(body.definition),
      200,
      `/v1/dag/definitions/${c.req.param('dagId')}/versions/${body.version}`,
      (definition) => ({ definition }),
    );
  });
  app.post('/v1/dag/definitions/:dagId/validate', async (c) => {
    const body = await c.req.json<{ version: number }>();
    const dagId = c.req.param('dagId');
    const version = Number(body.version);
    return definitionMutationReply(
      c,
      await definitionMutations.validateDefinition(dagId, version),
      200,
      `/v1/dag/definitions/${dagId}/versions/${version}/validate`,
      (definition) => ({ definition, valid: true }),
    );
  });
  app.post('/v1/dag/definitions/:dagId/publish', async (c) => {
    const body = await c.req.json<{ version?: number }>();
    const dagId = c.req.param('dagId');
    const version =
      body.version !== undefined
        ? Number(body.version)
        : (await definitionReads.getDefinition(dagId))?.version;
    if (version === undefined) {
      return c.json(
        {
          ok: false,
          status: 404,
          errors: [
            {
              type: 'urn:robota:problems:dag:not_found',
              title: 'Resource not found',
              status: 404,
              detail: 'DAG definition not found',
              instance: `/v1/dag/definitions/${dagId}/publish`,
              code: 'DAG_NOT_FOUND',
              retryable: false,
            },
          ],
        },
        404,
      );
    }
    return definitionMutationReply(
      c,
      await definitionMutations.publishDefinition(dagId, version),
      200,
      `/v1/dag/definitions/${dagId}/versions/${version}/publish`,
      (definition) => ({ definitionId: `${definition.dagId}:${definition.version}`, definition }),
    );
  });

  // --- Run lifecycle ---
  app.post('/v1/dag/runs', async (c) => {
    const body = await c.req.json<IDagOrchestrationCreateRunInput>();
    const result = await runs.createRun(body);
    if (!result.ok) return runCreateFailure(c, result.error);
    return c.json(
      {
        ok: true,
        status: 201,
        data: {
          dagRunId: result.value.dagRunId,
          preparationId: result.value.dagRunId,
          dagId: result.value.dagId,
          version: result.value.version,
          logicalDate: result.value.logicalDate,
          status: result.value.status,
        },
      },
      201,
    );
  });
  app.post('/v1/dag/runs/:id/start', async (c) => {
    const id = c.req.param('id');
    const result = await runs.startRun(id);
    return result.ok
      ? c.json({ ok: true, status: 200, data: result.value }, 200)
      : runFailure(c, result.error, `/v1/dag/runs/${id}/start`);
  });
  app.post('/v1/dag/runs/:id/cancel', async (c) => {
    const id = c.req.param('id');
    const result = await runs.cancelRun(id);
    return result.ok
      ? c.json({ ok: true, status: 200, data: result.value }, 200)
      : runFailure(c, result.error, `/v1/dag/runs/${id}/cancel`);
  });
  app.get('/v1/dag/runs/:id', async (c) => {
    const id = c.req.param('id');
    const result = await runs.getRun(id);
    return result.ok
      ? c.json(
          {
            ok: true,
            status: 200,
            data: { dagRun: result.value.dagRun, taskRuns: result.value.taskRuns },
          },
          200,
        )
      : runFailure(c, result.error, `/v1/dag/runs/${id}`);
  });
  app.get('/v1/dag/runs/:id/result', async (c) => {
    const id = c.req.param('id');
    const result = await runs.getRun(id);
    return result.ok
      ? c.json(
          {
            ok: true,
            status: 200,
            data: { dagRun: result.value.dagRun, taskRuns: result.value.taskRuns },
          },
          200,
        )
      : runFailure(c, result.error, `/v1/dag/runs/${id}/result`);
  });

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
    const dagId = c.req.param('dagId');
    const result = await runs.startPublishedWorkflowRun(
      dagId,
      body?.input,
      version !== undefined ? Number(version) : undefined,
    );
    if (!result.ok) return runFailure(c, result.error, `/v1/dag/workflows/${dagId}/runs`);
    return c.json(
      {
        ok: true,
        status: 201,
        data: {
          dagRunId: result.value.dagRunId,
          preparationId: result.value.dagRunId,
          dagId: result.value.dagId,
          version: result.value.version,
        },
      },
      201,
    );
  });

  // --- Build / validate (definition authoring) ---
  app.post('/v1/dag/build', async (c) => {
    const body = await c.req.json<IDagBuildInput>();
    const result = await build.buildDag(body);
    if (!result.ok) {
      return c.json(
        {
          ok: false,
          status: 400,
          errors: [
            {
              type: 'urn:robota:problems:dag:validation',
              title: 'DAG build failed',
              status: 400,
              detail: result.error.message,
              instance: 'inproc://dag-framework/build',
              code: result.error.code,
              retryable: false,
            },
          ],
        },
        400,
      );
    }
    return c.json(
      {
        ok: true,
        status: 200,
        data: {
          definition: result.definition,
          nodeCount: result.nodeCount,
          edgeCount: result.edgeCount,
          warnings: result.warnings,
        },
      },
      200,
    );
  });
  app.post('/v1/dag/validate', async (c) => {
    const body = await c.req.json<{ definition: IDagDefinition }>();
    const result = await validation.validateDag(body.definition);
    return c.json({ ok: true, status: 200, data: result }, 200);
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
