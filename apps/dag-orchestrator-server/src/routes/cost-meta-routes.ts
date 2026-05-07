import type { Request, Response, Router } from 'express';
import { CelCostEvaluator, type ICostMetaStoragePort } from '@robota-sdk/dag-cost';
import type {
  IDagOrchestrationCostMetaDeleteSuccessPayload,
  IDagOrchestrationCostMetaListSuccessPayload,
  IDagOrchestrationCostMetaPreviewSuccessPayload,
  IDagOrchestrationCostMetaSuccessPayload,
  IDagOrchestrationCostMetaValidationSuccessPayload,
} from '@robota-sdk/dag-orchestration-client';
import { HTTP_CREATED, HTTP_OK } from './route-utils.js';
import {
  parseCostMeta,
  parseFormulaRequest,
  parsePreviewRequest,
  toCostMetaBadRequest,
  toCostMetaNotFound,
  validateCostMetaFormulas,
  type ICostMetaRouteFailure,
  type TCostMetaRouteValue,
} from './cost-meta-route-utils.js';

type TCostMetaRouteResult =
  | IDagOrchestrationCostMetaDeleteSuccessPayload
  | IDagOrchestrationCostMetaListSuccessPayload
  | IDagOrchestrationCostMetaPreviewSuccessPayload
  | IDagOrchestrationCostMetaSuccessPayload
  | IDagOrchestrationCostMetaValidationSuccessPayload
  | ICostMetaRouteFailure;

export function registerCostMetaRoutes(
  router: Router,
  storage: ICostMetaStoragePort,
  evaluator: CelCostEvaluator,
): void {
  router.get('/v1/cost-meta', createListCostMetaHandler(storage));
  router.post('/v1/cost-meta/validate', createValidateCostMetaFormulaHandler(evaluator));
  router.post('/v1/cost-meta/preview', createPreviewCostMetaFormulaHandler(evaluator));
  router.post('/v1/cost-meta', createCreateCostMetaHandler(storage, evaluator));
  router.get('/v1/cost-meta/:nodeType', createGetCostMetaHandler(storage));
  router.put('/v1/cost-meta/:nodeType', createUpdateCostMetaHandler(storage, evaluator));
  router.delete('/v1/cost-meta/:nodeType', createDeleteCostMetaHandler(storage));
}

function createListCostMetaHandler(storage: ICostMetaStoragePort) {
  return async (_req: Request, res: Response): Promise<void> => {
    const items = await storage.getAll();
    sendResult(res, { ok: true, status: HTTP_OK, data: { items } });
  };
}

function createValidateCostMetaFormulaHandler(evaluator: CelCostEvaluator) {
  return (req: Request, res: Response): void => {
    const parsed = parseFormulaRequest(req.body as TCostMetaRouteValue, '/v1/cost-meta/validate');
    if (!parsed.ok) {
      sendResult(res, parsed);
      return;
    }
    const validation = evaluator.validate(parsed.formula);
    sendResult(res, {
      ok: true,
      status: HTTP_OK,
      data: {
        valid: validation.ok,
        errors: validation.ok ? [] : [validation.error.message],
      },
    });
  };
}

function createPreviewCostMetaFormulaHandler(evaluator: CelCostEvaluator) {
  return (req: Request, res: Response): void => {
    const instance = '/v1/cost-meta/preview';
    const parsed = parsePreviewRequest(req.body as TCostMetaRouteValue, instance);
    if (!parsed.ok) {
      sendResult(res, parsed);
      return;
    }
    const result = evaluator.evaluate(parsed.formula, {
      ...parsed.variables,
      ...parsed.testContext,
    });
    if (!result.ok) {
      sendResult(res, toCostMetaBadRequest(result.error.code, result.error.message, instance));
      return;
    }
    sendResult(res, { ok: true, status: HTTP_OK, data: { result: result.value } });
  };
}

function createCreateCostMetaHandler(storage: ICostMetaStoragePort, evaluator: CelCostEvaluator) {
  return async (req: Request, res: Response): Promise<void> => {
    const instance = '/v1/cost-meta';
    const parsed = parseCostMeta(req.body as TCostMetaRouteValue, undefined, instance);
    if (!parsed.ok) {
      sendResult(res, parsed);
      return;
    }
    const formulaFailure = validateCostMetaFormulas(evaluator, parsed.meta, instance);
    if (formulaFailure) {
      sendResult(res, formulaFailure);
      return;
    }
    await storage.save(parsed.meta);
    sendResult(res, { ok: true, status: HTTP_CREATED, data: { meta: parsed.meta } });
  };
}

function createGetCostMetaHandler(storage: ICostMetaStoragePort) {
  return async (req: Request<{ nodeType: string }>, res: Response): Promise<void> => {
    const meta = await storage.get(req.params.nodeType);
    if (!meta) {
      sendResult(res, toCostMetaNotFound(req.params.nodeType));
      return;
    }
    sendResult(res, { ok: true, status: HTTP_OK, data: { meta } });
  };
}

function createUpdateCostMetaHandler(storage: ICostMetaStoragePort, evaluator: CelCostEvaluator) {
  return async (req: Request<{ nodeType: string }>, res: Response): Promise<void> => {
    const instance = `/v1/cost-meta/${req.params.nodeType}`;
    const parsed = parseCostMeta(req.body as TCostMetaRouteValue, req.params.nodeType, instance);
    if (!parsed.ok) {
      sendResult(res, parsed);
      return;
    }
    const formulaFailure = validateCostMetaFormulas(evaluator, parsed.meta, instance);
    if (formulaFailure) {
      sendResult(res, formulaFailure);
      return;
    }
    await storage.save(parsed.meta);
    sendResult(res, { ok: true, status: HTTP_OK, data: { meta: parsed.meta } });
  };
}

function createDeleteCostMetaHandler(storage: ICostMetaStoragePort) {
  return async (req: Request<{ nodeType: string }>, res: Response): Promise<void> => {
    await storage.delete(req.params.nodeType);
    sendResult(res, { ok: true, status: HTTP_OK, data: { nodeType: req.params.nodeType } });
  };
}

function sendResult(res: Response, result: TCostMetaRouteResult): void {
  res.status(result.status).json(result);
}
