import { Hono } from 'hono';

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { IDagDefinition } from '@robota-sdk/dag-core';
import type {
  IDagOrchestrationCreateRunInput,
  IDagOrchestrationHttpResponse,
  IDagOrchestrationPort,
  IDagOrchestrationUpdateDraftInput,
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

  return app;
}
