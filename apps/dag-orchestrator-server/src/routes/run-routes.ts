import type { Router, Request, Response } from 'express';
import { toProblemDetails } from '@robota-sdk/dag-api';
import type {
  IDagDefinition,
  IPartialRunRequest,
  TPortPayload,
  IAssetStore,
} from '@robota-sdk/dag-core';
import type { OrchestratorRunService } from '@robota-sdk/dag-orchestrator';
import {
  toRunProblemDetails,
  validateAssetReferences,
  HTTP_BAD_REQUEST,
  HTTP_NOT_FOUND,
  HTTP_CREATED,
  HTTP_ACCEPTED,
  HTTP_OK,
  HTTP_CONFLICT,
  toRuntimeAssetProblemDetails,
} from './route-utils.js';
import { resolvePromptAssetsForRuntime } from './runtime-asset-upload.js';

export function registerRunRoutes(
  router: Router,
  runService: OrchestratorRunService,
  assetStore: IAssetStore,
  backendUrl: string,
): void {
  router.post('/v1/dag/runs', async (req: Request, res: Response) => {
    const runInstance = '/v1/dag/runs';
    const definition = req.body?.definition as IDagDefinition | undefined;
    if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
      res.status(HTTP_BAD_REQUEST).json({
        ok: false,
        status: HTTP_BAD_REQUEST,
        errors: [
          toRunProblemDetails(
            {
              code: 'DAG_VALIDATION_RUN_DEFINITION_REQUIRED',
              detail: 'definition is required',
              retryable: false,
            },
            runInstance,
          ),
        ],
      });
      return;
    }
    const input = req.body?.input;
    if (
      typeof input !== 'undefined' &&
      (typeof input !== 'object' || input === null || Array.isArray(input))
    ) {
      res.status(HTTP_BAD_REQUEST).json({
        ok: false,
        status: HTTP_BAD_REQUEST,
        errors: [
          toRunProblemDetails(
            {
              code: 'DAG_VALIDATION_RUN_INPUT_INVALID',
              detail: 'input must be an object when provided',
              retryable: false,
            },
            runInstance,
          ),
        ],
      });
      return;
    }
    const partialRunResult = parsePartialRun(req.body?.partialRun, runInstance);
    if (!partialRunResult.ok) {
      res.status(HTTP_BAD_REQUEST).json({
        ok: false,
        status: HTTP_BAD_REQUEST,
        errors: [partialRunResult.error],
      });
      return;
    }
    const assetErrors = await validateAssetReferences(definition, assetStore);
    if (assetErrors.length > 0) {
      res.status(HTTP_BAD_REQUEST).json({
        ok: false,
        status: HTTP_BAD_REQUEST,
        errors: assetErrors.map((error) => toRunProblemDetails(error, runInstance)),
      });
      return;
    }
    const result = await runService.createRun(
      definition,
      (input ?? {}) as TPortPayload,
      typeof partialRunResult.value === 'undefined'
        ? undefined
        : { partialRun: partialRunResult.value },
    );
    if (!result.ok) {
      res.status(HTTP_BAD_REQUEST).json({
        ok: false,
        status: HTTP_BAD_REQUEST,
        errors: [toProblemDetails(result.error, runInstance)],
      });
      return;
    }
    res.status(HTTP_CREATED).json({
      ok: true,
      status: HTTP_CREATED,
      data: { preparationId: result.value.preparationId },
    });
  });

  router.post('/v1/dag/runs/:id/start', async (req: Request<{ id: string }>, res: Response) => {
    const instance = `/v1/dag/runs/${req.params.id}/start`;
    const preparationId = req.params.id;

    const promptRequest = runService.getPendingPromptRequest(preparationId);
    if (promptRequest) {
      const assetResolution = await resolvePromptAssetsForRuntime(
        promptRequest,
        assetStore,
        backendUrl,
      );
      if (!assetResolution.ok) {
        res.status(assetResolution.status).json({
          ok: false,
          status: assetResolution.status,
          errors: [toRuntimeAssetProblemDetails(assetResolution, instance)],
        });
        return;
      }
    }

    const result = await runService.startRun(preparationId);
    if (!result.ok) {
      const statusCode =
        result.error.code === 'ORCHESTRATOR_RUN_NOT_FOUND' ? HTTP_NOT_FOUND : HTTP_BAD_REQUEST;
      res.status(statusCode).json({
        ok: false,
        status: statusCode,
        errors: [toProblemDetails(result.error, instance)],
      });
      return;
    }
    res.status(HTTP_ACCEPTED).json({
      ok: true,
      status: HTTP_ACCEPTED,
      data: { dagRunId: result.value.dagRunId, preparationId: result.value.preparationId },
    });
  });

  router.get(
    '/v1/dag/runs/:dagRunId/result',
    async (req: Request<{ dagRunId: string }>, res: Response) => {
      const instance = `/v1/dag/runs/${req.params.dagRunId}/result`;
      const result = await runService.getRunResult(req.params.dagRunId);
      if (!result.ok) {
        const statusCode =
          result.error.code === 'ORCHESTRATOR_RUN_NOT_FOUND'
            ? HTTP_NOT_FOUND
            : result.error.code === 'ORCHESTRATOR_RUN_NOT_COMPLETED'
              ? HTTP_CONFLICT
              : HTTP_BAD_REQUEST;
        res.status(statusCode).json({
          ok: false,
          status: statusCode,
          errors: [toProblemDetails(result.error, instance)],
        });
        return;
      }
      res.status(HTTP_OK).json({
        ok: true,
        status: HTTP_OK,
        data: { run: result.value },
      });
    },
  );

  router.get(
    '/v1/dag/runs/:dagRunId',
    async (req: Request<{ dagRunId: string }>, res: Response) => {
      const instance = `/v1/dag/runs/${req.params.dagRunId}`;
      const result = await runService.getRunStatus(req.params.dagRunId);
      if (!result.ok) {
        res.status(HTTP_NOT_FOUND).json({
          ok: false,
          status: HTTP_NOT_FOUND,
          errors: [toProblemDetails(result.error, instance)],
        });
        return;
      }
      res.status(HTTP_OK).json({
        ok: true,
        status: HTTP_OK,
        data: { dagRunId: req.params.dagRunId, status: result.value.status },
      });
    },
  );
}

type TPartialRunParseResult =
  | { ok: true; value: IPartialRunRequest | undefined }
  | {
      ok: false;
      error: {
        type: string;
        title: string;
        status: number;
        detail: string;
        instance: string;
        code: string;
        retryable: boolean;
      };
    };

type TPartialRunBodyValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly TPartialRunBodyValue[]
  | { readonly [key: string]: TPartialRunBodyValue };

interface IPartialRunBodyObject {
  readonly startNodeId?: TPartialRunBodyValue;
}

function parsePartialRun(value: TPartialRunBodyValue, instance: string): TPartialRunParseResult {
  if (typeof value === 'undefined') {
    return { ok: true, value: undefined };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return {
      ok: false,
      error: toRunProblemDetails(
        {
          code: 'DAG_VALIDATION_RUN_PARTIAL_INVALID',
          detail: 'partialRun must be an object when provided',
          retryable: false,
        },
        instance,
      ),
    };
  }
  const startNodeId = (value as IPartialRunBodyObject).startNodeId;
  if (typeof startNodeId !== 'string' || startNodeId.trim().length === 0) {
    return {
      ok: false,
      error: toRunProblemDetails(
        {
          code: 'DAG_VALIDATION_RUN_PARTIAL_INVALID',
          detail: 'partialRun.startNodeId must be a non-empty string',
          retryable: false,
        },
        instance,
      ),
    };
  }
  return { ok: true, value: { startNodeId: startNodeId.trim() } };
}
