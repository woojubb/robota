import type { Request, Response, Router } from 'express';
import { toProblemDetails, type IProblemDetails } from '@robota-sdk/dag-api';
import type { IDagDefinition, IAssetStore, IStoragePort, TPortPayload } from '@robota-sdk/dag-core';
import type { OrchestratorRunService } from '@robota-sdk/dag-orchestrator';
import {
  HTTP_ACCEPTED,
  HTTP_BAD_REQUEST,
  HTTP_NOT_FOUND,
  parseOptionalPositiveIntegerQuery,
  toRunProblemDetails,
  toRuntimeAssetProblemDetails,
  validateAssetReferences,
} from './route-utils.js';
import { resolvePromptAssetsForRuntime } from './runtime-asset-upload.js';
import {
  applyWorkflowOverrides,
  readWorkflowRunRequestBody,
  resolvePublishedDefinition,
  toWorkflowProblemDetails,
  type TWorkflowRequestValue,
} from './published-workflow-route-utils.js';

interface IPublishedWorkflowRouteDependencies {
  storage: IStoragePort;
  runService: OrchestratorRunService;
  assetStore: IAssetStore;
  backendUrl: string;
}

interface IWorkflowRunRouteContext {
  dagId: string;
  instance: string;
  versionQuery: string | undefined;
  body: TWorkflowRequestValue | undefined;
}

interface IWorkflowRouteSuccess {
  ok: true;
  status: number;
  data: {
    dagRunId: string;
    preparationId: string;
    dagId: string;
    version: number;
  };
}

interface IWorkflowRouteFailure {
  ok: false;
  status: number;
  errors: IProblemDetails[];
}

type TWorkflowRouteResult = IWorkflowRouteSuccess | IWorkflowRouteFailure;
type TPreparedWorkflowRunDefinition =
  | { ok: true; definition: IDagDefinition; input: TPortPayload }
  | IWorkflowRouteFailure;
type TPreparedRunResult = { ok: true; preparationId: string } | IWorkflowRouteFailure;
type TStartedRunResult =
  | { ok: true; dagRunId: string; preparationId: string }
  | IWorkflowRouteFailure;

function toFailure(status: number, errors: IProblemDetails[]): IWorkflowRouteFailure {
  return { ok: false, status, errors };
}

async function validateDefinitionAssets(
  definition: IDagDefinition,
  deps: IPublishedWorkflowRouteDependencies,
  instance: string,
): Promise<IWorkflowRouteFailure | undefined> {
  const assetErrors = await validateAssetReferences(definition, deps.assetStore);
  if (assetErrors.length === 0) {
    return undefined;
  }
  return toFailure(
    HTTP_BAD_REQUEST,
    assetErrors.map((error) => toRunProblemDetails(error, instance)),
  );
}

async function createPreparedRun(
  definition: IDagDefinition,
  input: TPortPayload,
  deps: IPublishedWorkflowRouteDependencies,
  instance: string,
): Promise<TPreparedRunResult> {
  const createResult = await deps.runService.createRun(definition, input);
  if (!createResult.ok) {
    return toFailure(HTTP_BAD_REQUEST, [toProblemDetails(createResult.error, instance)]);
  }
  return { ok: true, preparationId: createResult.value.preparationId };
}

async function syncRuntimeAssets(
  preparationId: string,
  deps: IPublishedWorkflowRouteDependencies,
  instance: string,
): Promise<IWorkflowRouteFailure | undefined> {
  const promptRequest = deps.runService.getPendingPromptRequest(preparationId);
  if (!promptRequest) {
    return undefined;
  }
  const assetResolution = await resolvePromptAssetsForRuntime(
    promptRequest,
    deps.assetStore,
    deps.backendUrl,
  );
  if (assetResolution.ok) {
    return undefined;
  }
  return toFailure(assetResolution.status, [
    toRuntimeAssetProblemDetails(assetResolution, instance),
  ]);
}

async function startPreparedRun(
  preparationId: string,
  deps: IPublishedWorkflowRouteDependencies,
  instance: string,
): Promise<TStartedRunResult> {
  const startResult = await deps.runService.startRun(preparationId);
  if (!startResult.ok) {
    const statusCode =
      startResult.error.code === 'ORCHESTRATOR_RUN_NOT_FOUND' ? HTTP_NOT_FOUND : HTTP_BAD_REQUEST;
    return toFailure(statusCode, [toProblemDetails(startResult.error, instance)]);
  }
  return {
    ok: true,
    dagRunId: startResult.value.dagRunId,
    preparationId: startResult.value.preparationId,
  };
}

async function prepareWorkflowRunDefinition(
  context: IWorkflowRunRouteContext,
  deps: IPublishedWorkflowRouteDependencies,
): Promise<TPreparedWorkflowRunDefinition> {
  const parsedVersion = parseOptionalPositiveIntegerQuery(context.versionQuery);
  if (!parsedVersion.ok) {
    return toFailure(HTTP_BAD_REQUEST, [
      toRunProblemDetails(parsedVersion.error, context.instance),
    ]);
  }

  const requestBody = readWorkflowRunRequestBody(context.body);
  if ('code' in requestBody) {
    return toFailure(HTTP_BAD_REQUEST, [
      toWorkflowProblemDetails(requestBody, HTTP_BAD_REQUEST, context.instance),
    ]);
  }

  const lookupResult = await resolvePublishedDefinition(
    deps.storage,
    context.dagId,
    parsedVersion.value,
  );
  if (!lookupResult.ok) {
    return toFailure(lookupResult.status, [
      toWorkflowProblemDetails(lookupResult.error, lookupResult.status, context.instance),
    ]);
  }

  const overrideResult = applyWorkflowOverrides(lookupResult.definition, requestBody.overrides);
  if (!overrideResult.ok) {
    return toFailure(HTTP_BAD_REQUEST, [
      toWorkflowProblemDetails(overrideResult.error, HTTP_BAD_REQUEST, context.instance),
    ]);
  }

  const assetFailure = await validateDefinitionAssets(
    overrideResult.definition,
    deps,
    context.instance,
  );
  if (assetFailure) {
    return assetFailure;
  }

  return {
    ok: true,
    definition: overrideResult.definition,
    input: requestBody.input ?? {},
  };
}

async function startWorkflowRun(
  preparedDefinition: { definition: IDagDefinition; input: TPortPayload },
  context: IWorkflowRunRouteContext,
  deps: IPublishedWorkflowRouteDependencies,
): Promise<TWorkflowRouteResult> {
  const preparedRun = await createPreparedRun(
    preparedDefinition.definition,
    preparedDefinition.input,
    deps,
    context.instance,
  );
  if (!preparedRun.ok) {
    return preparedRun;
  }

  const assetSyncFailure = await syncRuntimeAssets(
    preparedRun.preparationId,
    deps,
    context.instance,
  );
  if (assetSyncFailure) {
    return assetSyncFailure;
  }

  const startedRun = await startPreparedRun(preparedRun.preparationId, deps, context.instance);
  if (!startedRun.ok) {
    return startedRun;
  }

  return {
    ok: true,
    status: HTTP_ACCEPTED,
    data: {
      dagRunId: startedRun.dagRunId,
      preparationId: startedRun.preparationId,
      dagId: preparedDefinition.definition.dagId,
      version: preparedDefinition.definition.version,
    },
  };
}

async function runPublishedWorkflow(
  context: IWorkflowRunRouteContext,
  deps: IPublishedWorkflowRouteDependencies,
): Promise<TWorkflowRouteResult> {
  const preparedDefinition = await prepareWorkflowRunDefinition(context, deps);
  if (!preparedDefinition.ok) {
    return preparedDefinition;
  }
  return startWorkflowRun(preparedDefinition, context, deps);
}

function createPublishedWorkflowRunHandler(deps: IPublishedWorkflowRouteDependencies) {
  return async (req: Request<{ dagId: string }>, res: Response): Promise<void> => {
    const result = await runPublishedWorkflow(
      {
        dagId: req.params.dagId,
        instance: `/v1/dag/workflows/${req.params.dagId}/runs`,
        versionQuery: req.query.version as string | undefined,
        body: req.body as TWorkflowRequestValue | undefined,
      },
      deps,
    );
    res.status(result.status).json(result);
  };
}

export function registerPublishedWorkflowRoutes(
  router: Router,
  storage: IStoragePort,
  runService: OrchestratorRunService,
  assetStore: IAssetStore,
  backendUrl: string,
): void {
  router.post(
    '/v1/dag/workflows/:dagId/runs',
    createPublishedWorkflowRunHandler({ storage, runService, assetStore, backendUrl }),
  );
}
