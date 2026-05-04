import type {
  IDagDefinition,
  IStoragePort,
  TNodeConfigRecord,
  TNodeConfigValue,
  TPortPayload,
} from '@robota-sdk/dag-core';
import { HTTP_BAD_REQUEST, HTTP_CONFLICT, HTTP_NOT_FOUND } from './route-utils.js';

export type TWorkflowRequestValue =
  | string
  | number
  | boolean
  | null
  | IWorkflowRequestObject
  | TWorkflowRequestValue[];

export interface IWorkflowRequestObject {
  [key: string]: TWorkflowRequestValue | undefined;
}

export interface IWorkflowOverrideMap {
  [nodeId: string]: TNodeConfigRecord;
}

export interface IWorkflowRunRequestBody {
  input?: TPortPayload;
  overrides?: IWorkflowOverrideMap;
}

export interface IWorkflowValidationError {
  code: string;
  detail: string;
  retryable: false;
}

export type TDefinitionLookupResult =
  | { ok: true; definition: IDagDefinition }
  | { ok: false; status: number; error: IWorkflowValidationError };

export type TOverrideResult =
  | { ok: true; definition: IDagDefinition }
  | { ok: false; error: IWorkflowValidationError };

function isRecord(value: TWorkflowRequestValue | undefined): value is IWorkflowRequestObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNodeConfigValue(value: TWorkflowRequestValue | undefined): value is TNodeConfigValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isNodeConfigValue(item));
  }
  if (isRecord(value)) {
    return Object.values(value).every((item) => isNodeConfigValue(item));
  }
  return false;
}

function isNodeConfigRecord(value: TWorkflowRequestValue | undefined): value is TNodeConfigRecord {
  return isRecord(value) && Object.values(value).every((item) => isNodeConfigValue(item));
}

export function toWorkflowProblemDetails(
  error: IWorkflowValidationError,
  status: number,
  instance: string,
): {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  retryable: boolean;
} {
  const title =
    status === HTTP_NOT_FOUND
      ? 'Published workflow not found'
      : status === HTTP_CONFLICT
        ? 'Published workflow unavailable'
        : 'DAG validation failed';
  const problemType =
    status === HTTP_BAD_REQUEST
      ? 'urn:robota:problems:dag:validation'
      : 'urn:robota:problems:dag:published-workflow';
  return {
    type: problemType,
    title,
    status,
    detail: error.detail,
    instance,
    code: error.code,
    retryable: error.retryable,
  };
}

export function readWorkflowRunRequestBody(
  rawBody: TWorkflowRequestValue | undefined,
): IWorkflowRunRequestBody | IWorkflowValidationError {
  if (typeof rawBody === 'undefined') {
    return {};
  }
  if (!isRecord(rawBody)) {
    return {
      code: 'DAG_VALIDATION_WORKFLOW_REQUEST_INVALID',
      detail: 'request body must be an object when provided',
      retryable: false,
    };
  }

  const input = rawBody.input;
  if (typeof input !== 'undefined' && !isRecord(input)) {
    return {
      code: 'DAG_VALIDATION_WORKFLOW_INPUT_INVALID',
      detail: 'input must be an object when provided',
      retryable: false,
    };
  }

  const overrides = rawBody.overrides;
  if (typeof overrides === 'undefined') {
    return { input: (input ?? {}) as TPortPayload };
  }
  if (!isRecord(overrides)) {
    return {
      code: 'DAG_VALIDATION_WORKFLOW_OVERRIDES_INVALID',
      detail: 'overrides must be an object keyed by nodeId when provided',
      retryable: false,
    };
  }

  const parsedOverrides: IWorkflowOverrideMap = {};
  for (const [nodeId, override] of Object.entries(overrides)) {
    if (!isNodeConfigRecord(override)) {
      return {
        code: 'DAG_VALIDATION_WORKFLOW_OVERRIDES_INVALID',
        detail: `overrides.${nodeId} must be a node config object`,
        retryable: false,
      };
    }
    parsedOverrides[nodeId] = override;
  }

  return {
    input: (input ?? {}) as TPortPayload,
    overrides: parsedOverrides,
  };
}

export async function resolvePublishedDefinition(
  storage: IStoragePort,
  dagId: string,
  version: number | undefined,
): Promise<TDefinitionLookupResult> {
  if (typeof version === 'number') {
    const exactDefinition = await storage.getDefinition(dagId, version);
    if (!exactDefinition) {
      return {
        ok: false,
        status: HTTP_NOT_FOUND,
        error: {
          code: 'DAG_PUBLISHED_DEFINITION_NOT_FOUND',
          detail: `Published definition not found for dagId ${dagId} version ${version}`,
          retryable: false,
        },
      };
    }
    if (exactDefinition.status !== 'published') {
      return {
        ok: false,
        status: HTTP_CONFLICT,
        error: {
          code: 'DAG_PUBLISHED_DEFINITION_STATUS_INVALID',
          detail: `Definition ${dagId} version ${version} is not published`,
          retryable: false,
        },
      };
    }
    return { ok: true, definition: exactDefinition };
  }

  const latestDefinition = await storage.getLatestPublishedDefinition(dagId);
  if (!latestDefinition) {
    return {
      ok: false,
      status: HTTP_NOT_FOUND,
      error: {
        code: 'DAG_PUBLISHED_DEFINITION_NOT_FOUND',
        detail: `Published definition not found for dagId ${dagId}`,
        retryable: false,
      },
    };
  }
  return { ok: true, definition: latestDefinition };
}

export function applyWorkflowOverrides(
  definition: IDagDefinition,
  overrides: IWorkflowOverrideMap | undefined,
): TOverrideResult {
  if (typeof overrides === 'undefined' || Object.keys(overrides).length === 0) {
    return { ok: true, definition };
  }

  const nodeIds = new Set(definition.nodes.map((node) => node.nodeId));
  for (const nodeId of Object.keys(overrides)) {
    if (!nodeIds.has(nodeId)) {
      return {
        ok: false,
        error: {
          code: 'DAG_VALIDATION_WORKFLOW_OVERRIDE_NODE_NOT_FOUND',
          detail: `Override references unknown nodeId: ${nodeId}`,
          retryable: false,
        },
      };
    }
  }

  return {
    ok: true,
    definition: {
      ...definition,
      nodes: definition.nodes.map((node) => {
        const override = overrides[node.nodeId];
        if (typeof override === 'undefined') {
          return node;
        }
        return {
          ...node,
          config: {
            ...node.config,
            ...override,
          },
        };
      }),
    },
  };
}
