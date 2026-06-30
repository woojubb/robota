import { Hono } from 'hono';

import type { IDagBuildInput } from '@robota-sdk/dag-builder';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import type {
  IDagOrchestrationAssetUploadRequest,
  IDagOrchestrationCostMetaPreviewRequest,
  IDagOrchestrationCostMetaValidateRequest,
  IDagOrchestrationCreateRunInput,
  IDagOrchestrationHttpResponse,
  IDagOrchestrationOverwriteRunDraftNodeResultRequest,
  IDagOrchestrationPort,
  IDagOrchestrationPublishedWorkflowRunRequest,
  IDagOrchestrationUpdateDraftInput,
  TDagOrchestrationCostMetaRequest,
  TDagOrchestrationCreateRunDraftRequest,
  TDagOrchestrationReplaceRunDraftRequest,
} from '@robota-sdk/dag-orchestration-client';

function reply(c: Context, response: IDagOrchestrationHttpResponse): Response {
  return c.json(response.payload, response.status as ContentfulStatusCode);
}

/**
 * Native DAG runtime HTTP server (WORKFLOW-002). Maps the `/v1/dag/*` route surface onto an
 * `IDagOrchestrationPort` — typically `createDagFramework().client` (the in-process implementation).
 * No external-runtime API surface; every handler is a uniform route → port-method → JSON-response mapping.
 */
export function createDagRuntimeServer(port: IDagOrchestrationPort): Hono {
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
  app.post('/v1/dag/assets', async (c) => {
    const body = await c.req.json<IDagOrchestrationAssetUploadRequest>();
    return reply(c, await port.uploadAsset(body));
  });
  app.get('/v1/dag/assets/:assetId', async (c) =>
    reply(c, await port.getAssetMetadata(c.req.param('assetId'))),
  );
  // Synchronous download-info (not an HttpResponse): forward the descriptor as JSON.
  app.get('/v1/dag/assets/:assetId/content', (c) =>
    c.json(port.getAssetContentDownloadInfo(c.req.param('assetId'))),
  );

  // --- Cost metadata ---
  app.get('/v1/dag/cost-meta', async (c) => reply(c, await port.listCostMeta()));
  app.post('/v1/dag/cost-meta/validate', async (c) => {
    const body = await c.req.json<IDagOrchestrationCostMetaValidateRequest>();
    return reply(c, await port.validateCostMetaFormula(body));
  });
  app.post('/v1/dag/cost-meta/preview', async (c) => {
    const body = await c.req.json<IDagOrchestrationCostMetaPreviewRequest>();
    return reply(c, await port.previewCostMetaFormula(body));
  });
  app.post('/v1/dag/cost-meta', async (c) => {
    const body = await c.req.json<TDagOrchestrationCostMetaRequest>();
    return reply(c, await port.createCostMeta(body));
  });
  app.get('/v1/dag/cost-meta/:nodeType', async (c) =>
    reply(c, await port.getCostMeta(c.req.param('nodeType'))),
  );
  app.put('/v1/dag/cost-meta/:nodeType', async (c) => {
    const body = await c.req.json<TDagOrchestrationCostMetaRequest>();
    return reply(c, await port.updateCostMeta(c.req.param('nodeType'), body));
  });
  app.delete('/v1/dag/cost-meta/:nodeType', async (c) =>
    reply(c, await port.deleteCostMeta(c.req.param('nodeType'))),
  );

  // --- Run drafts (partial-run editing) ---
  app.post('/v1/dag/run-drafts', async (c) => {
    const body = await c.req.json<TDagOrchestrationCreateRunDraftRequest>();
    return reply(c, await port.createRunDraft(body));
  });
  app.get('/v1/dag/run-drafts/:draftId', async (c) =>
    reply(c, await port.getRunDraft(c.req.param('draftId'))),
  );
  app.put('/v1/dag/run-drafts/:draftId', async (c) => {
    const body = await c.req.json<TDagOrchestrationReplaceRunDraftRequest>();
    return reply(c, await port.replaceRunDraft(c.req.param('draftId'), body));
  });
  app.post('/v1/dag/run-drafts/:draftId/nodes/:nodeId/reset', async (c) =>
    reply(c, await port.resetRunDraftNodeResult(c.req.param('draftId'), c.req.param('nodeId'))),
  );
  app.put('/v1/dag/run-drafts/:draftId/nodes/:nodeId/result', async (c) => {
    const body = await c.req.json<IDagOrchestrationOverwriteRunDraftNodeResultRequest>();
    return reply(
      c,
      await port.overwriteRunDraftNodeResult(c.req.param('draftId'), c.req.param('nodeId'), body),
    );
  });

  return app;
}
