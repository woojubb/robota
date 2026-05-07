import { randomUUID } from 'node:crypto';
import type { Request, Response, Router } from 'express';
import type { IDagOrchestrationRunDraftSuccessPayload } from '@robota-sdk/dag-orchestration-client';
import {
  createDefaultDagNodeState,
  overwriteDagNodeExecutionTrace,
  overwriteRunResultNodeTrace,
  reconcileDagNodeStateMap,
  resetDagNodeExecutionStateFromNode,
  resetRunResultFromNode,
  type IDagDefinition,
  type IDagNode,
  type IRunDraft,
  type IRunDraftStore,
  type IRunNodeTrace,
  type TNodeStateMap,
  type TPortPayload,
} from '@robota-sdk/dag-core';
import { HTTP_BAD_REQUEST, HTTP_CREATED, HTTP_NOT_FOUND, HTTP_OK } from './route-utils.js';
import {
  createProblem,
  parseOverwritePayload,
  parseSaveRunDraftBody,
  type IProblemDetails,
} from './run-draft-route-utils.js';

export function registerRunDraftRoutes(router: Router, store: IRunDraftStore): void {
  router.post('/v1/dag/run-drafts', createRunDraftHandler(store));
  router.get('/v1/dag/run-drafts/:draftId', getRunDraftHandler(store));
  router.put('/v1/dag/run-drafts/:draftId', replaceRunDraftHandler(store));
  router.put('/v1/dag/run-drafts/:draftId/nodes/:nodeId/reset', resetNodeResultHandler(store));
  router.put('/v1/dag/run-drafts/:draftId/nodes/:nodeId/result', overwriteNodeResultHandler(store));
}

function createRunDraftHandler(store: IRunDraftStore) {
  return async (req: Request, res: Response): Promise<void> => {
    const instance = '/v1/dag/run-drafts';
    const parsed = parseSaveRunDraftBody(req.body, instance);
    if (!parsed.ok) {
      sendProblem(res, HTTP_BAD_REQUEST, parsed.error);
      return;
    }
    const now = new Date().toISOString();
    const draft = buildDraft(parsed.value, parsed.value.draftId ?? randomUUID(), now, now);
    await store.saveRunDraft(draft);
    sendDraft(res, HTTP_CREATED, draft);
  };
}

function getRunDraftHandler(store: IRunDraftStore) {
  return async (req: Request<{ draftId: string }>, res: Response): Promise<void> => {
    const instance = `/v1/dag/run-drafts/${req.params.draftId}`;
    const draft = await getExistingDraft(store, req.params.draftId, instance, res);
    if (!draft) return;
    sendDraft(res, HTTP_OK, draft);
  };
}

function replaceRunDraftHandler(store: IRunDraftStore) {
  return async (req: Request<{ draftId: string }>, res: Response): Promise<void> => {
    const instance = `/v1/dag/run-drafts/${req.params.draftId}`;
    const existing = await store.getRunDraft(req.params.draftId);
    const parsed = parseSaveRunDraftBody(req.body, instance);
    if (!parsed.ok) {
      sendProblem(res, HTTP_BAD_REQUEST, parsed.error);
      return;
    }
    const now = new Date().toISOString();
    const draft = buildDraft(parsed.value, req.params.draftId, existing?.createdAt ?? now, now);
    await store.saveRunDraft(draft);
    sendDraft(res, HTTP_OK, draft);
  };
}

function resetNodeResultHandler(store: IRunDraftStore) {
  return async (
    req: Request<{ draftId: string; nodeId: string }>,
    res: Response,
  ): Promise<void> => {
    const instance = `/v1/dag/run-drafts/${req.params.draftId}/nodes/${req.params.nodeId}/reset`;
    const draft = await getExistingDraft(store, req.params.draftId, instance, res);
    if (!draft || !ensureDraftNode(draft, req.params.nodeId, instance, res)) return;
    const updatedDraft = resetDraftNodeResult(draft, req.params.nodeId);
    await store.saveRunDraft(updatedDraft);
    sendDraft(res, HTTP_OK, updatedDraft);
  };
}

function overwriteNodeResultHandler(store: IRunDraftStore) {
  return async (
    req: Request<{ draftId: string; nodeId: string }>,
    res: Response,
  ): Promise<void> => {
    const instance = `/v1/dag/run-drafts/${req.params.draftId}/nodes/${req.params.nodeId}/result`;
    const draft = await getExistingDraft(store, req.params.draftId, instance, res);
    if (!draft) return;
    const node = ensureDraftNode(draft, req.params.nodeId, instance, res);
    const payload = parseOverwritePayload(req.body, instance);
    if (!node || !payload.ok) {
      if (!payload.ok) sendProblem(res, HTTP_BAD_REQUEST, payload.error);
      return;
    }
    const trace = createManualTrace(node, payload.value.input, payload.value.output);
    const updatedDraft = overwriteDraftNodeResult(draft, trace);
    await store.saveRunDraft(updatedDraft);
    sendDraft(res, HTTP_OK, updatedDraft);
  };
}

function buildDraft(
  input: Partial<IRunDraft> & { definition: IDagDefinition },
  draftId: string,
  createdAt: string,
  updatedAt: string,
): IRunDraft {
  return {
    draftId,
    definition: input.definition,
    input: input.input ?? {},
    nodeStateMap: input.nodeStateMap ?? createInitialNodeStateMap(input.definition),
    runResult: input.runResult,
    createdAt,
    updatedAt,
  };
}

function createInitialNodeStateMap(definition: IDagDefinition): TNodeStateMap {
  return reconcileDagNodeStateMap(
    definition,
    {},
    {
      createState: () => createDefaultDagNodeState(),
    },
  );
}

function overwriteDraftNodeResult(draft: IRunDraft, trace: IRunNodeTrace): IRunDraft {
  const existingRunResult = draft.runResult ?? {
    dagRunId: draft.draftId,
    status: 'success' as const,
    traces: [],
    nodeErrors: [],
    totalCredits: 0,
  };
  return {
    ...draft,
    nodeStateMap: overwriteDagNodeExecutionTrace(draft.nodeStateMap, {
      nodeId: trace.nodeId,
      input: trace.input,
      output: trace.output,
    }),
    runResult: overwriteRunResultNodeTrace(existingRunResult, trace),
    updatedAt: new Date().toISOString(),
  };
}

function resetDraftNodeResult(draft: IRunDraft, nodeId: string): IRunDraft {
  return {
    ...draft,
    nodeStateMap: resetDagNodeExecutionStateFromNode(draft.definition, draft.nodeStateMap, nodeId),
    runResult: draft.runResult
      ? resetRunResultFromNode(draft.definition, draft.runResult, nodeId)
      : undefined,
    updatedAt: new Date().toISOString(),
  };
}

function createManualTrace(
  node: IDagNode,
  input: TPortPayload | undefined,
  output: TPortPayload,
): IRunNodeTrace {
  return {
    nodeId: node.nodeId,
    nodeType: node.nodeType,
    input: input ?? {},
    output,
    estimatedCredits: 0,
    totalCredits: 0,
  };
}

async function getExistingDraft(
  store: IRunDraftStore,
  draftId: string,
  instance: string,
  res: Response,
): Promise<IRunDraft | undefined> {
  const draft = await store.getRunDraft(draftId);
  if (!draft) {
    sendProblem(
      res,
      HTTP_NOT_FOUND,
      createProblem(HTTP_NOT_FOUND, 'DAG_RUN_DRAFT_NOT_FOUND', 'Run draft was not found', instance),
    );
    return undefined;
  }
  return draft;
}

function findNode(definition: IDagDefinition, nodeId: string): IDagNode | undefined {
  return definition.nodes.find((node) => node.nodeId === nodeId);
}

function ensureDraftNode(
  draft: IRunDraft,
  nodeId: string,
  instance: string,
  res: Response,
): IDagNode | undefined {
  const node = findNode(draft.definition, nodeId);
  if (!node) {
    sendProblem(
      res,
      HTTP_BAD_REQUEST,
      createProblem(
        HTTP_BAD_REQUEST,
        'DAG_VALIDATION_RUN_DRAFT_INVALID',
        'Run draft node was not found',
        instance,
      ),
    );
  }
  return node;
}

function sendProblem(res: Response, status: number, problem: IProblemDetails): void {
  res.status(status).json({
    ok: false,
    status,
    errors: [problem],
  });
}

function sendDraft(res: Response, status: number, draft: IRunDraft): void {
  const envelope: IDagOrchestrationRunDraftSuccessPayload = {
    ok: true,
    status,
    data: { draft },
  };
  res.status(status).json(envelope);
}
