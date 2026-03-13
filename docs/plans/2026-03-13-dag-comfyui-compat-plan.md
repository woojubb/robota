# DAG Prompt API + Orchestration Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor DAG API to use ComfyUI-compatible prompt format with a separate orchestration layer for extended features (cost, retry, auth).

**Architecture:** Three independent programs communicating over HTTP.
```
[dag-designer (UI)]
    ↓ HTTP
[Orchestrator API Server]  apps/dag-orchestrator/
    |  gateway + extension pack (auth, cost, retry, timeout)
    |  contains HTTP client for Prompt API
    ↓ HTTP
[Prompt API Server]  apps/dag-server/
    |  standalone execution engine
    |  packages: dag-api (controllers), dag-server-core (routes, bootstrap)
    ↓
[Backend Port]  IPromptBackendPort (in dag-core)
    ↓
[Robota DAG Adapter]  packages/dag-server-core/ (implements port)
[External Proxy Adapter]  (future — proxies to external backend)
```

**Naming convention:** No external product names in code. Use generic domain names.

**Separation principle:** Prompt API Server and Orchestrator API Server are independent programs.
- Prompt API Server: fully functional standalone. No knowledge of Orchestrator.
- Orchestrator API Server: connects to Prompt API Server via HTTP. Optional extension.
- dag-designer connects only to Orchestrator API Server.

**Tech Stack:** TypeScript, Express, Zod, Vitest, OpenAPI 3.0.3

**SSOT principle:** The OpenAPI spec (`PROMPT_API_OPENAPI_DOCUMENT`) is the single source of truth for all API contracts. TypeScript types, controller signatures, route handlers, and client ports must conform to the OpenAPI spec. When in doubt, the OpenAPI spec wins.

**Task execution order:**
```
Task 1 (OpenAPI spec) → Task 2 (types from spec) → Task 3 (backend port) → Task 4 (controller) → Task 5 (routes) → Task 6 (orchestrator setup) → Task 7 (orchestrator service)
```

**Key references:**
- Design doc: `docs/plans/2026-03-13-dag-json-spec-design.md`
- Current types: `packages/dag-core/src/types/domain.ts`
- Current ports: `packages/dag-core/src/interfaces/ports.ts`
- Current API: `packages/dag-api/src/controllers/`
- Current OpenAPI: `packages/dag-server-core/src/docs/openapi-dag.ts`
- Current routes: `packages/dag-server-core/src/routes/`

---

## Task 1: OpenAPI Spec for Prompt API Endpoints (SSOT)

Define the complete OpenAPI 3.0.3 spec. This is the **single source of truth** for all Prompt API contracts — endpoints, request/response schemas, error formats. All subsequent tasks derive from this spec.

**Files:**
- Create: `packages/dag-server-core/src/docs/openapi-prompt-api.ts`
- Test: `packages/dag-server-core/src/__tests__/openapi-prompt-api.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/dag-server-core/src/__tests__/openapi-prompt-api.test.ts
import { describe, it, expect } from 'vitest';
import { PROMPT_API_OPENAPI_DOCUMENT } from '../docs/openapi-prompt-api.js';

describe('Prompt API OpenAPI spec', () => {
  it('should have correct openapi version', () => {
    expect(PROMPT_API_OPENAPI_DOCUMENT.openapi).toBe('3.0.3');
  });

  it('should define all prompt API endpoints', () => {
    const paths = Object.keys(PROMPT_API_OPENAPI_DOCUMENT.paths);
    expect(paths).toContain('/prompt');
    expect(paths).toContain('/queue');
    expect(paths).toContain('/history');
    expect(paths).toContain('/history/{prompt_id}');
    expect(paths).toContain('/object_info');
    expect(paths).toContain('/object_info/{node_type}');
    expect(paths).toContain('/system_stats');
  });

  it('should define POST /prompt with correct request body', () => {
    const post = PROMPT_API_OPENAPI_DOCUMENT.paths['/prompt'].post;
    expect(post).toBeDefined();
    expect(post.operationId).toBe('submitPrompt');

    const requestBody = post.requestBody.content['application/json'].schema;
    expect(requestBody.properties.prompt).toBeDefined();
    expect(requestBody.properties.client_id).toBeDefined();
    expect(requestBody.properties.extra_data).toBeDefined();
    expect(requestBody.required).toContain('prompt');
  });

  it('should define POST /prompt response with prompt_id', () => {
    const response = PROMPT_API_OPENAPI_DOCUMENT.paths['/prompt'].post.responses['200'];
    const schema = response.content['application/json'].schema;
    expect(schema.properties.prompt_id.type).toBe('string');
    expect(schema.properties.number.type).toBe('integer');
    expect(schema.properties.node_errors).toBeDefined();
  });

  it('should define GET /queue response', () => {
    const response = PROMPT_API_OPENAPI_DOCUMENT.paths['/queue'].get.responses['200'];
    const schema = response.content['application/json'].schema;
    expect(schema.properties.queue_running).toBeDefined();
    expect(schema.properties.queue_pending).toBeDefined();
  });

  it('should define POST /queue for queue management', () => {
    const post = PROMPT_API_OPENAPI_DOCUMENT.paths['/queue'].post;
    expect(post).toBeDefined();
    expect(post.operationId).toBe('manageQueue');
  });

  it('should define GET /object_info response', () => {
    const response = PROMPT_API_OPENAPI_DOCUMENT.paths['/object_info'].get.responses['200'];
    expect(response).toBeDefined();
  });

  it('should define GET /object_info/{node_type}', () => {
    const get = PROMPT_API_OPENAPI_DOCUMENT.paths['/object_info/{node_type}'].get;
    expect(get).toBeDefined();
    expect(get.parameters[0].name).toBe('node_type');
    expect(get.parameters[0].in).toBe('path');
  });

  it('should define GET /system_stats', () => {
    const get = PROMPT_API_OPENAPI_DOCUMENT.paths['/system_stats'].get;
    expect(get).toBeDefined();
    expect(get.operationId).toBe('getSystemStats');
  });

  it('should define GET /history and /history/{prompt_id}', () => {
    expect(PROMPT_API_OPENAPI_DOCUMENT.paths['/history'].get).toBeDefined();
    const byId = PROMPT_API_OPENAPI_DOCUMENT.paths['/history/{prompt_id}'].get;
    expect(byId).toBeDefined();
    expect(byId.parameters[0].name).toBe('prompt_id');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @robota-sdk/dag-server-core test -- --run src/__tests__/openapi-prompt-api.test.ts`
Expected: FAIL — module not found

**Step 3: Write the OpenAPI spec**

The full spec defines all schemas (PromptNodeDef, Prompt, NodeError, NodeObjectInfo, etc.), all endpoints, request/response formats, and error responses. This is the authoritative document — all TypeScript types in subsequent tasks must match these schemas exactly.

```typescript
// packages/dag-server-core/src/docs/openapi-prompt-api.ts

const PromptNodeDef = {
  type: 'object' as const,
  required: ['class_type', 'inputs'],
  properties: {
    class_type: { type: 'string' as const, description: 'Node type identifier' },
    inputs: {
      type: 'object' as const,
      additionalProperties: true,
      description: 'Config values (scalars) and link references ([nodeId, slotIndex]) mixed',
    },
    _meta: {
      type: 'object' as const,
      properties: { title: { type: 'string' as const } },
    },
  },
};

const Prompt = {
  type: 'object' as const,
  additionalProperties: PromptNodeDef,
  description: 'DAG prompt: nodeId → node definition',
};

const NodeError = {
  type: 'object' as const,
  properties: {
    type: { type: 'string' as const },
    message: { type: 'string' as const },
    details: { type: 'string' as const },
    extra_info: { type: 'object' as const, additionalProperties: true },
  },
};

const NodeObjectInfo = {
  type: 'object' as const,
  required: ['display_name', 'category', 'input', 'output', 'output_is_list', 'output_name', 'output_node', 'description'],
  properties: {
    display_name: { type: 'string' as const },
    category: { type: 'string' as const },
    input: {
      type: 'object' as const,
      properties: {
        required: { type: 'object' as const, additionalProperties: true },
        optional: { type: 'object' as const, additionalProperties: true },
        hidden: { type: 'object' as const, additionalProperties: { type: 'string' as const } },
      },
    },
    output: { type: 'array' as const, items: { type: 'string' as const } },
    output_is_list: { type: 'array' as const, items: { type: 'boolean' as const } },
    output_name: { type: 'array' as const, items: { type: 'string' as const } },
    output_node: { type: 'boolean' as const },
    description: { type: 'string' as const },
  },
};

export const PROMPT_API_OPENAPI_DOCUMENT = {
  openapi: '3.0.3',
  info: {
    title: 'Robota DAG Prompt API',
    version: '1.0.0',
    description: 'Prompt-based DAG execution API with interchangeable backend',
  },
  paths: {
    '/prompt': {
      post: {
        operationId: 'submitPrompt',
        summary: 'Submit a prompt for execution',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object' as const,
                required: ['prompt'],
                properties: {
                  prompt: Prompt,
                  client_id: { type: 'string' as const, format: 'uuid' },
                  prompt_id: { type: 'string' as const, format: 'uuid' },
                  extra_data: {
                    type: 'object' as const,
                    properties: {
                      extra_pnginfo: {
                        type: 'object' as const,
                        properties: {
                          workflow: { type: 'object' as const, additionalProperties: true },
                        },
                      },
                    },
                  },
                  front: { type: 'boolean' as const, default: false },
                  number: { type: 'integer' as const },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Prompt queued successfully',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  required: ['prompt_id', 'number', 'node_errors'],
                  properties: {
                    prompt_id: { type: 'string' as const, format: 'uuid' },
                    number: { type: 'integer' as const },
                    node_errors: { type: 'object' as const, additionalProperties: NodeError },
                  },
                },
              },
            },
          },
          '400': {
            description: 'Validation error',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  properties: {
                    error: NodeError,
                    node_errors: { type: 'object' as const, additionalProperties: NodeError },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/queue': {
      get: {
        operationId: 'getQueue',
        summary: 'Get current queue status',
        responses: {
          '200': {
            description: 'Queue status',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  required: ['queue_running', 'queue_pending'],
                  properties: {
                    queue_running: { type: 'array' as const, items: { type: 'array' as const } },
                    queue_pending: { type: 'array' as const, items: { type: 'array' as const } },
                  },
                },
              },
            },
          },
        },
      },
      post: {
        operationId: 'manageQueue',
        summary: 'Manage queue (clear or delete items)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object' as const,
                properties: {
                  clear: { type: 'boolean' as const },
                  delete: { type: 'array' as const, items: { type: 'string' as const } },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Queue updated' },
        },
      },
    },
    '/history': {
      get: {
        operationId: 'getHistory',
        summary: 'Get execution history',
        responses: {
          '200': {
            description: 'All history entries',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  additionalProperties: {
                    type: 'object' as const,
                    properties: {
                      prompt: Prompt,
                      outputs: { type: 'object' as const, additionalProperties: true },
                      status: {
                        type: 'object' as const,
                        properties: {
                          status_str: { type: 'string' as const, enum: ['success', 'error'] },
                          completed: { type: 'boolean' as const },
                          messages: { type: 'array' as const, items: {} },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/history/{prompt_id}': {
      get: {
        operationId: 'getHistoryById',
        summary: 'Get execution history for a specific prompt',
        parameters: [
          { name: 'prompt_id', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: {
          '200': {
            description: 'History entry',
            content: {
              'application/json': {
                schema: { type: 'object' as const, additionalProperties: true },
              },
            },
          },
        },
      },
    },
    '/object_info': {
      get: {
        operationId: 'getObjectInfo',
        summary: 'Get all registered node types',
        responses: {
          '200': {
            description: 'All node type definitions',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  additionalProperties: NodeObjectInfo,
                },
              },
            },
          },
        },
      },
    },
    '/object_info/{node_type}': {
      get: {
        operationId: 'getObjectInfoByType',
        summary: 'Get a specific node type definition',
        parameters: [
          { name: 'node_type', in: 'path' as const, required: true, schema: { type: 'string' as const } },
        ],
        responses: {
          '200': {
            description: 'Node type definition',
            content: {
              'application/json': {
                schema: NodeObjectInfo,
              },
            },
          },
          '404': { description: 'Node type not found' },
        },
      },
    },
    '/system_stats': {
      get: {
        operationId: 'getSystemStats',
        summary: 'Get system statistics',
        responses: {
          '200': {
            description: 'System stats',
            content: {
              'application/json': {
                schema: {
                  type: 'object' as const,
                  properties: {
                    system: {
                      type: 'object' as const,
                      properties: {
                        os: { type: 'string' as const },
                        runtime_version: { type: 'string' as const },
                        embedded_python: { type: 'boolean' as const },
                      },
                    },
                    devices: {
                      type: 'array' as const,
                      items: {
                        type: 'object' as const,
                        properties: {
                          name: { type: 'string' as const },
                          type: { type: 'string' as const },
                          vram_total: { type: 'integer' as const },
                          vram_free: { type: 'integer' as const },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
} as const;
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @robota-sdk/dag-server-core test -- --run src/__tests__/openapi-prompt-api.test.ts`
Expected: PASS

**Step 5: Build and verify**

Run: `pnpm --filter @robota-sdk/dag-server-core build`
Expected: Success

**Step 6: Commit**

```bash
git add packages/dag-server-core/src/docs/openapi-prompt-api.ts \
  packages/dag-server-core/src/__tests__/openapi-prompt-api.test.ts
git commit -m "feat(dag-server-core): add prompt API OpenAPI spec (SSOT)"
```

---

## Task 2: Prompt Types in dag-core (derived from OpenAPI spec)

Define TypeScript type contracts that mirror the OpenAPI spec schemas. These types are the TypeScript projection of the OpenAPI SSOT — field names, structures, and constraints must match exactly.

**Derive from:** `PROMPT_API_OPENAPI_DOCUMENT` schemas (Task 1)

**Files:**
- Create: `packages/dag-core/src/types/prompt-types.ts`
- Modify: `packages/dag-core/src/index.ts` (re-export new types)
- Test: `packages/dag-core/src/__tests__/prompt-types.test.ts`

**Step 1: Write the failing test**

Tests verify that TypeScript types can represent the same structures defined in the OpenAPI spec.

```typescript
// packages/dag-core/src/__tests__/prompt-types.test.ts
import { describe, it, expect } from 'vitest';
import type {
  IPrompt,
  TPromptInputValue,
  TPromptLink,
  IPromptRequest,
  IPromptResponse,
  IQueueStatus,
  IHistoryEntry,
  INodeObjectInfo,
  ISystemStats,
} from '../types/prompt-types.js';

describe('Prompt types (derived from OpenAPI spec)', () => {
  it('should represent a valid prompt matching OpenAPI Prompt schema', () => {
    const prompt: IPrompt = {
      '4': {
        class_type: 'CheckpointLoaderSimple',
        inputs: { ckpt_name: 'v1-5-pruned-emaonly.safetensors' },
      },
      '3': {
        class_type: 'KSampler',
        inputs: { seed: 8566257, model: ['4', 0] },
        _meta: { title: 'KSampler' },
      },
    };

    expect(prompt['3'].class_type).toBe('KSampler');
    expect(prompt['3'].inputs.model).toEqual(['4', 0]);
  });

  it('should represent request/response matching OpenAPI /prompt schemas', () => {
    const request: IPromptRequest = {
      prompt: { '1': { class_type: 'InputNode', inputs: { text: 'hello' } } },
      client_id: 'test-client-uuid',
    };
    const response: IPromptResponse = {
      prompt_id: 'abc-123',
      number: 1,
      node_errors: {},
    };

    expect(request.client_id).toBe('test-client-uuid');
    expect(response.prompt_id).toBe('abc-123');
  });

  it('should represent queue status matching OpenAPI /queue schema', () => {
    const queue: IQueueStatus = { queue_running: [], queue_pending: [] };
    expect(queue.queue_running).toEqual([]);
  });

  it('should represent history entry matching OpenAPI /history schema', () => {
    const entry: IHistoryEntry = {
      prompt: { '1': { class_type: 'InputNode', inputs: { text: 'hello' } } },
      outputs: {},
      status: { status_str: 'success', completed: true, messages: [] },
    };
    expect(entry.status.status_str).toBe('success');
  });

  it('should represent system stats matching OpenAPI /system_stats schema', () => {
    const stats: ISystemStats = {
      system: { os: 'darwin', runtime_version: '', embedded_python: false },
      devices: [],
    };
    expect(stats.system.os).toBe('darwin');
  });

  it('should distinguish links from config values via Array.isArray', () => {
    const link: TPromptLink = ['4', 0];
    const configValue: TPromptInputValue = 'euler';
    expect(Array.isArray(link)).toBe(true);
    expect(Array.isArray(configValue)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @robota-sdk/dag-core test -- --run src/__tests__/prompt-types.test.ts`
Expected: FAIL — module not found

**Step 3: Write types matching OpenAPI schemas**

Each type corresponds to an OpenAPI schema component. See `PROMPT_API_OPENAPI_DOCUMENT` for the authoritative field definitions.

```typescript
// packages/dag-core/src/types/prompt-types.ts

// --- Prompt format types (OpenAPI: Prompt, PromptNodeDef) ---

/** Link reference: [sourceNodeId, outputSlotIndex] */
export type TPromptLink = [string, number];

/** A single input value: scalar or link */
export type TPromptInputValue = string | number | boolean | TPromptLink;

/** OpenAPI: PromptNodeDef schema */
export interface IPromptNodeDef {
  class_type: string;
  inputs: Record<string, TPromptInputValue>;
  _meta?: { title?: string };
}

/** OpenAPI: Prompt schema — nodeId → node definition */
export type IPrompt = Record<string, IPromptNodeDef>;

// --- API request/response types (OpenAPI: POST /prompt) ---

export interface IWorkflowJson {
  nodes: unknown[];
  links: unknown[];
  version: number;
}

export interface IPromptRequest {
  prompt: IPrompt;
  client_id?: string;
  prompt_id?: string;
  extra_data?: {
    extra_pnginfo?: {
      workflow: IWorkflowJson;
    };
  };
  front?: boolean;
  number?: number;
}

/** OpenAPI: NodeError schema */
export interface INodeError {
  type: string;
  message: string;
  details: string;
  extra_info: Record<string, unknown>;
}

/** OpenAPI: POST /prompt 200 response */
export interface IPromptResponse {
  prompt_id: string;
  number: number;
  node_errors: Record<string, INodeError>;
}

// --- Queue types (OpenAPI: /queue) ---

export interface IQueueStatus {
  queue_running: unknown[];
  queue_pending: unknown[];
}

export interface IQueueAction {
  clear?: boolean;
  delete?: string[];
}

// --- History types (OpenAPI: /history) ---

export interface IOutputAsset {
  filename: string;
  subfolder: string;
  type: string;
}

export interface IHistoryEntry {
  prompt: IPrompt;
  outputs: Record<string, { images?: IOutputAsset[] }>;
  status: {
    status_str: 'success' | 'error';
    completed: boolean;
    messages: unknown[];
  };
}

export type THistory = Record<string, IHistoryEntry>;

// --- Object info types (OpenAPI: /object_info) ---

export type TInputTypeSpec =
  | [string]
  | [string, Record<string, unknown>];

/** OpenAPI: NodeObjectInfo schema */
export interface INodeObjectInfo {
  display_name: string;
  category: string;
  input: {
    required: Record<string, TInputTypeSpec | string[]>;
    optional?: Record<string, TInputTypeSpec | string[]>;
    hidden?: Record<string, string>;
  };
  output: string[];
  output_is_list: boolean[];
  output_name: string[];
  output_node: boolean;
  description: string;
}

export type IObjectInfo = Record<string, INodeObjectInfo>;

// --- System stats types (OpenAPI: /system_stats) ---

export interface ISystemStats {
  system: {
    os: string;
    runtime_version: string;
    embedded_python: boolean;
  };
  devices: {
    name: string;
    type: string;
    vram_total: number;
    vram_free: number;
  }[];
}

// --- Utility ---

export function isPromptLink(value: TPromptInputValue): value is TPromptLink {
  return Array.isArray(value)
    && value.length === 2
    && typeof value[0] === 'string'
    && typeof value[1] === 'number';
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @robota-sdk/dag-core test -- --run src/__tests__/prompt-types.test.ts`
Expected: PASS

**Step 5: Export from dag-core index**

Add to `packages/dag-core/src/index.ts`:
```typescript
export type {
  IPrompt, IPromptNodeDef, TPromptInputValue, TPromptLink,
  IPromptRequest, IPromptResponse,
  IQueueStatus, IQueueAction,
  IHistoryEntry, THistory, IOutputAsset,
  INodeObjectInfo, IObjectInfo, TInputTypeSpec,
  ISystemStats, IWorkflowJson, INodeError,
} from './types/prompt-types.js';
export { isPromptLink } from './types/prompt-types.js';
```

**Step 6: Build and verify**

Run: `pnpm --filter @robota-sdk/dag-core build`
Expected: Success

**Step 7: Commit**

```bash
git add packages/dag-core/src/types/prompt-types.ts \
  packages/dag-core/src/__tests__/prompt-types.test.ts \
  packages/dag-core/src/index.ts
git commit -m "feat(dag-core): add prompt types derived from OpenAPI spec"
```

---

## Task 3: Backend Port in dag-core

Define the port interface that backends (Robota DAG runtime or external proxy) implement. Method signatures match the OpenAPI spec operations.

**Derive from:** OpenAPI spec operation signatures (Task 1)

**Files:**
- Create: `packages/dag-core/src/interfaces/prompt-backend-port.ts`
- Modify: `packages/dag-core/src/index.ts` (re-export)
- Test: `packages/dag-core/src/__tests__/prompt-backend-port.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/dag-core/src/__tests__/prompt-backend-port.test.ts
import { describe, it, expect } from 'vitest';
import type { IPromptBackendPort } from '../interfaces/prompt-backend-port.js';

describe('IPromptBackendPort', () => {
  it('should be implementable as an in-memory stub', async () => {
    const stub: IPromptBackendPort = {
      submitPrompt: async () => ({
        ok: true as const,
        value: { prompt_id: 'test-id', number: 1, node_errors: {} },
      }),
      getQueue: async () => ({
        ok: true as const,
        value: { queue_running: [], queue_pending: [] },
      }),
      manageQueue: async () => ({ ok: true as const, value: undefined }),
      getHistory: async () => ({ ok: true as const, value: {} }),
      getObjectInfo: async () => ({ ok: true as const, value: {} }),
      getSystemStats: async () => ({
        ok: true as const,
        value: {
          system: { os: 'darwin', runtime_version: '', embedded_python: false },
          devices: [],
        },
      }),
    };

    const result = await stub.submitPrompt({
      prompt: { '1': { class_type: 'Test', inputs: {} } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.prompt_id).toBe('test-id');
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @robota-sdk/dag-core test -- --run src/__tests__/prompt-backend-port.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Method signatures mirror the OpenAPI spec operations. See `PROMPT_API_OPENAPI_DOCUMENT` for the authoritative request/response contracts.

```typescript
// packages/dag-core/src/interfaces/prompt-backend-port.ts
import type { TResult, IDagError } from '../types/index.js';
import type {
  IPromptRequest, IPromptResponse,
  IQueueStatus, IQueueAction,
  THistory, IObjectInfo, ISystemStats,
} from '../types/prompt-types.js';

/**
 * Port interface for prompt-compatible backends.
 * Method signatures derived from OpenAPI spec operations.
 * Implemented by Robota DAG runtime adapter or external HTTP proxy.
 */
export interface IPromptBackendPort {
  submitPrompt(request: IPromptRequest): Promise<TResult<IPromptResponse, IDagError>>;
  getQueue(): Promise<TResult<IQueueStatus, IDagError>>;
  manageQueue(action: IQueueAction): Promise<TResult<void, IDagError>>;
  getHistory(promptId?: string): Promise<TResult<THistory, IDagError>>;
  getObjectInfo(nodeType?: string): Promise<TResult<IObjectInfo, IDagError>>;
  getSystemStats(): Promise<TResult<ISystemStats, IDagError>>;
}
```

**Step 4: Run test, export, build, commit**

Run: `pnpm --filter @robota-sdk/dag-core test -- --run src/__tests__/prompt-backend-port.test.ts`
Expected: PASS

Add to `packages/dag-core/src/index.ts`:
```typescript
export type { IPromptBackendPort } from './interfaces/prompt-backend-port.js';
```

Run: `pnpm --filter @robota-sdk/dag-core build`
Expected: Success

```bash
git add packages/dag-core/src/interfaces/prompt-backend-port.ts \
  packages/dag-core/src/__tests__/prompt-backend-port.test.ts \
  packages/dag-core/src/index.ts
git commit -m "feat(dag-core): add IPromptBackendPort derived from OpenAPI spec"
```

---

**Implementation note:** Tasks 4, 5, and 7 all use a similar stub backend/client. During implementation, extract a shared `createStubPromptBackend()` factory into `packages/dag-core/src/testing/` and import it in each test file to avoid duplication.

---

## Task 4: Prompt API Controller

Implement the controller that handles all prompt API endpoints. Method signatures and validation rules conform to the OpenAPI spec.

**Derive from:** OpenAPI spec operations and error responses (Task 1)

**Files:**
- Create: `packages/dag-api/src/controllers/prompt-api-controller.ts`
- Test: `packages/dag-api/src/__tests__/prompt-api-controller.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/dag-api/src/__tests__/prompt-api-controller.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PromptApiController } from '../controllers/prompt-api-controller.js';
import type { IPromptBackendPort } from '@robota-sdk/dag-core';

function createStubBackend(): IPromptBackendPort {
  return {
    submitPrompt: async () => ({
      ok: true as const,
      value: { prompt_id: 'stub-id', number: 1, node_errors: {} },
    }),
    getQueue: async () => ({
      ok: true as const,
      value: { queue_running: [], queue_pending: [] },
    }),
    manageQueue: async () => ({ ok: true as const, value: undefined }),
    getHistory: async () => ({ ok: true as const, value: {} }),
    getObjectInfo: async () => ({ ok: true as const, value: {} }),
    getSystemStats: async () => ({
      ok: true as const,
      value: {
        system: { os: 'darwin', runtime_version: '', embedded_python: false },
        devices: [],
      },
    }),
  };
}

describe('PromptApiController', () => {
  let controller: PromptApiController;

  beforeEach(() => {
    controller = new PromptApiController(createStubBackend());
  });

  describe('submitPrompt', () => {
    it('should return prompt_id on valid prompt', async () => {
      const result = await controller.submitPrompt({
        prompt: { '1': { class_type: 'Test', inputs: { value: 'hello' } } },
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.prompt_id).toBe('stub-id');
    });

    it('should reject empty prompt', async () => {
      const result = await controller.submitPrompt({ prompt: {} });
      expect(result.ok).toBe(false);
    });
  });

  describe('delegated operations', () => {
    it('getQueue should return queue status', async () => {
      expect((await controller.getQueue()).ok).toBe(true);
    });
    it('manageQueue should accept clear action', async () => {
      expect((await controller.manageQueue({ clear: true })).ok).toBe(true);
    });
    it('getHistory should return history', async () => {
      expect((await controller.getHistory()).ok).toBe(true);
    });
    it('getObjectInfo should return node types', async () => {
      expect((await controller.getObjectInfo()).ok).toBe(true);
    });
    it('getSystemStats should return stats', async () => {
      expect((await controller.getSystemStats()).ok).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @robota-sdk/dag-api test -- --run src/__tests__/prompt-api-controller.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Validation rules (e.g., empty prompt rejection) match the OpenAPI spec 400 error response. Error format uses the `NodeError` schema from the spec.

```typescript
// packages/dag-api/src/controllers/prompt-api-controller.ts
import type {
  IPromptBackendPort, IPromptRequest, IPromptResponse,
  IQueueStatus, IQueueAction, THistory, IObjectInfo, ISystemStats,
  TResult, IDagError,
} from '@robota-sdk/dag-core';

export class PromptApiController {
  constructor(private readonly backend: IPromptBackendPort) {}

  async submitPrompt(request: IPromptRequest): Promise<TResult<IPromptResponse, IDagError>> {
    const nodeIds = Object.keys(request.prompt);
    if (nodeIds.length === 0) {
      return {
        ok: false,
        error: { code: 'PROMPT_NO_OUTPUTS', category: 'validation', message: 'Prompt has no nodes', retryable: false },
      };
    }
    for (const nodeId of nodeIds) {
      if (!request.prompt[nodeId].class_type) {
        return {
          ok: false,
          error: { code: 'INVALID_NODE', category: 'validation', message: `Node ${nodeId} missing class_type`, retryable: false },
        };
      }
    }
    return this.backend.submitPrompt(request);
  }

  async getQueue(): Promise<TResult<IQueueStatus, IDagError>> { return this.backend.getQueue(); }
  async manageQueue(action: IQueueAction): Promise<TResult<void, IDagError>> { return this.backend.manageQueue(action); }
  async getHistory(promptId?: string): Promise<TResult<THistory, IDagError>> { return this.backend.getHistory(promptId); }
  async getObjectInfo(nodeType?: string): Promise<TResult<IObjectInfo, IDagError>> { return this.backend.getObjectInfo(nodeType); }
  async getSystemStats(): Promise<TResult<ISystemStats, IDagError>> { return this.backend.getSystemStats(); }
}
```

**Step 4: Run test, build, commit**

Run: `pnpm --filter @robota-sdk/dag-api test -- --run src/__tests__/prompt-api-controller.test.ts`
Expected: PASS

Run: `pnpm --filter @robota-sdk/dag-api build`
Expected: Success

```bash
git add packages/dag-api/src/controllers/prompt-api-controller.ts \
  packages/dag-api/src/__tests__/prompt-api-controller.test.ts
git commit -m "feat(dag-api): add PromptApiController"
```

---

## Task 5: Express Routes for Prompt API Endpoints

Wire the PromptApiController to Express routes. Route paths and HTTP methods match the OpenAPI spec exactly. Error responses use the `sendError` helper to produce the OpenAPI-defined error format.

**Derive from:** OpenAPI spec paths and methods (Task 1)

**Files:**
- Create: `packages/dag-server-core/src/routes/prompt-routes.ts`
- Test: `packages/dag-server-core/src/__tests__/prompt-routes.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/dag-server-core/src/__tests__/prompt-routes.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { mountPromptRoutes } from '../routes/prompt-routes.js';
import { PromptApiController } from '@robota-sdk/dag-api';
import type { IPromptBackendPort } from '@robota-sdk/dag-core';

function createStubBackend(): IPromptBackendPort {
  return {
    submitPrompt: async () => ({
      ok: true as const,
      value: { prompt_id: 'test-prompt-id', number: 1, node_errors: {} },
    }),
    getQueue: async () => ({
      ok: true as const,
      value: { queue_running: [], queue_pending: [] },
    }),
    manageQueue: async () => ({ ok: true as const, value: undefined }),
    getHistory: async () => ({ ok: true as const, value: {} }),
    getObjectInfo: async () => ({
      ok: true as const,
      value: {
        TestNode: {
          display_name: 'Test Node', category: 'test',
          input: { required: {}, optional: {} },
          output: ['STRING'], output_is_list: [false],
          output_name: ['output'], output_node: false, description: '',
        },
      },
    }),
    getSystemStats: async () => ({
      ok: true as const,
      value: {
        system: { os: 'darwin', runtime_version: '', embedded_python: false },
        devices: [],
      },
    }),
  };
}

describe('Prompt API routes (matches OpenAPI spec paths)', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    mountPromptRoutes(app, new PromptApiController(createStubBackend()));
  });

  it('POST /prompt → 200 with prompt_id', async () => {
    const res = await request(app)
      .post('/prompt')
      .send({ prompt: { '1': { class_type: 'TestNode', inputs: {} } } });
    expect(res.status).toBe(200);
    expect(res.body.prompt_id).toBe('test-prompt-id');
  });

  it('POST /prompt → 400 on empty prompt', async () => {
    const res = await request(app).post('/prompt').send({ prompt: {} });
    expect(res.status).toBe(400);
  });

  it('GET /queue → 200', async () => {
    const res = await request(app).get('/queue');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('queue_running');
  });

  it('POST /queue → 200', async () => {
    const res = await request(app).post('/queue').send({ clear: true });
    expect(res.status).toBe(200);
  });

  it('GET /history → 200', async () => {
    expect((await request(app).get('/history')).status).toBe(200);
  });

  it('GET /history/:prompt_id → 200', async () => {
    expect((await request(app).get('/history/some-id')).status).toBe(200);
  });

  it('GET /object_info → 200', async () => {
    const res = await request(app).get('/object_info');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('TestNode');
  });

  it('GET /object_info/:node_type → 200', async () => {
    expect((await request(app).get('/object_info/TestNode')).status).toBe(200);
  });

  it('GET /system_stats → 200', async () => {
    const res = await request(app).get('/system_stats');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('system');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @robota-sdk/dag-server-core test -- --run src/__tests__/prompt-routes.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Error response format matches the OpenAPI 400 schema (`{ error: NodeError, node_errors: {} }`).

```typescript
// packages/dag-server-core/src/routes/prompt-routes.ts
import type { Express, Request, Response } from 'express';
import type { PromptApiController } from '@robota-sdk/dag-api';
import type { IDagError } from '@robota-sdk/dag-core';

function sendError(res: Response, error: IDagError, status = 500): void {
  res.status(status).json({
    error: { type: error.code, message: error.message, details: '', extra_info: {} },
    node_errors: {},
  });
}

export function mountPromptRoutes(app: Express, controller: PromptApiController): void {
  app.post('/prompt', async (req: Request, res: Response) => {
    const result = await controller.submitPrompt(req.body);
    result.ok ? res.status(200).json(result.value) : sendError(res, result.error, 400);
  });

  app.get('/queue', async (_req: Request, res: Response) => {
    const result = await controller.getQueue();
    result.ok ? res.status(200).json(result.value) : sendError(res, result.error);
  });

  app.post('/queue', async (req: Request, res: Response) => {
    const result = await controller.manageQueue(req.body);
    result.ok ? res.status(200).json({}) : sendError(res, result.error);
  });

  app.get('/history', async (_req: Request, res: Response) => {
    const result = await controller.getHistory();
    result.ok ? res.status(200).json(result.value) : sendError(res, result.error);
  });

  app.get('/history/:prompt_id', async (req: Request, res: Response) => {
    const result = await controller.getHistory(req.params.prompt_id);
    result.ok ? res.status(200).json(result.value) : sendError(res, result.error);
  });

  app.get('/object_info', async (_req: Request, res: Response) => {
    const result = await controller.getObjectInfo();
    result.ok ? res.status(200).json(result.value) : sendError(res, result.error);
  });

  app.get('/object_info/:node_type', async (req: Request, res: Response) => {
    const result = await controller.getObjectInfo(req.params.node_type);
    result.ok ? res.status(200).json(result.value) : sendError(res, result.error);
  });

  app.get('/system_stats', async (_req: Request, res: Response) => {
    const result = await controller.getSystemStats();
    result.ok ? res.status(200).json(result.value) : sendError(res, result.error);
  });
}
```

**Step 4: Run test, build, commit**

Run: `pnpm --filter @robota-sdk/dag-server-core test -- --run src/__tests__/prompt-routes.test.ts`
Expected: PASS

Run: `pnpm --filter @robota-sdk/dag-server-core build`
Expected: Success

```bash
git add packages/dag-server-core/src/routes/prompt-routes.ts \
  packages/dag-server-core/src/__tests__/prompt-routes.test.ts
git commit -m "feat(dag-server-core): add prompt API Express routes"
```

---

## Task 6: Orchestration Layer — Package Setup, Types, and HTTP Client Port

Create the `dag-orchestrator` package as an **independent program**. It communicates with Prompt API Server over HTTP — no in-process dependency on `IPromptBackendPort` or the API layer.

`IPromptApiClientPort` mirrors the OpenAPI spec operations but is owned by the orchestrator. It is the orchestrator's abstraction for calling Prompt API Server over HTTP.

**Files:**
- Create: `packages/dag-orchestrator/package.json`
- Create: `packages/dag-orchestrator/tsconfig.json`
- Create: `packages/dag-orchestrator/vitest.config.ts`
- Create: `packages/dag-orchestrator/src/index.ts`
- Create: `packages/dag-orchestrator/src/types/orchestrator-types.ts`
- Create: `packages/dag-orchestrator/src/interfaces/prompt-api-client-port.ts`
- Create: `packages/dag-orchestrator/src/interfaces/orchestrator-policy-port.ts`
- Test: `packages/dag-orchestrator/src/__tests__/prompt-api-client-port.test.ts`

**Step 1: Scaffold package**

```json
// packages/dag-orchestrator/package.json
{
  "name": "@robota-sdk/dag-orchestrator",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": { "build": "tsc", "test": "vitest" },
  "dependencies": { "@robota-sdk/dag-core": "workspace:*" },
  "devDependencies": { "typescript": "^5.4.0", "vitest": "^3.0.0" }
}
```

Copy `tsconfig.json` and `vitest.config.ts` patterns from another dag-* package.

**Step 2: Define orchestrator-specific types**

These types are owned by the orchestrator layer — not in the OpenAPI spec.

```typescript
// packages/dag-orchestrator/src/types/orchestrator-types.ts
import type { IPromptRequest, IPromptResponse } from '@robota-sdk/dag-core';

export interface ICostEstimate {
  totalEstimatedCostUsd: number;
  perNode: Record<string, { nodeType: string; estimatedCostUsd: number }>;
}

export interface ICostPolicy { maxCostPerPromptUsd: number; }
export interface IRetryPolicy { maxRetries: number; backoffMs: number; retryableErrors: string[]; }
export interface ITimeoutPolicy { promptTimeoutMs: number; }

export interface IOrchestratorConfig {
  costPolicy?: ICostPolicy;
  retryPolicy?: IRetryPolicy;
  timeoutPolicy?: ITimeoutPolicy;
}

export interface IOrchestratedPromptRequest {
  promptRequest: IPromptRequest;
  config?: IOrchestratorConfig;
}

export interface IOrchestratedPromptResponse {
  promptResponse: IPromptResponse;
  costEstimate?: ICostEstimate;
}
```

**Step 3: Define the HTTP client port**

Method signatures mirror the OpenAPI spec operations. The concrete adapter (future task) calls Prompt API Server endpoints over HTTP.

```typescript
// packages/dag-orchestrator/src/interfaces/prompt-api-client-port.ts
import type {
  IPromptRequest, IPromptResponse, IQueueStatus, IQueueAction,
  THistory, IObjectInfo, ISystemStats, TResult, IDagError,
} from '@robota-sdk/dag-core';

/**
 * Port for communicating with a Prompt API Server over HTTP.
 * Method signatures derived from OpenAPI spec operations.
 *
 * NOT the same as IPromptBackendPort:
 * - IPromptBackendPort: used inside Prompt API Server to talk to backend runtime
 * - IPromptApiClientPort: used by Orchestrator to call Prompt API Server over HTTP
 */
export interface IPromptApiClientPort {
  submitPrompt(request: IPromptRequest): Promise<TResult<IPromptResponse, IDagError>>;
  getQueue(): Promise<TResult<IQueueStatus, IDagError>>;
  manageQueue(action: IQueueAction): Promise<TResult<void, IDagError>>;
  getHistory(promptId?: string): Promise<TResult<THistory, IDagError>>;
  getObjectInfo(nodeType?: string): Promise<TResult<IObjectInfo, IDagError>>;
  getSystemStats(): Promise<TResult<ISystemStats, IDagError>>;
}
```

**Step 4: Define policy ports**

```typescript
// packages/dag-orchestrator/src/interfaces/orchestrator-policy-port.ts
import type { TResult, IDagError, IObjectInfo } from '@robota-sdk/dag-core';
import type { ICostEstimate, ICostPolicy } from '../types/orchestrator-types.js';

export interface ICostEstimatorPort {
  estimateCost(nodeTypes: string[], objectInfo: IObjectInfo): Promise<TResult<ICostEstimate, IDagError>>;
}

export interface ICostPolicyEvaluatorPort {
  evaluate(estimate: ICostEstimate, policy: ICostPolicy): TResult<void, IDagError>;
}
```

**Step 5: Write test, create index, install, build, commit**

Test, index, build steps same as before (see previous version). Commit:

```bash
git add packages/dag-orchestrator/
git commit -m "feat(dag-orchestrator): scaffold orchestration layer with HTTP client port"
```

---

## Task 7: Orchestration Layer — Service Implementation

Implement the orchestrator service. Uses `IPromptApiClientPort` (HTTP client to Prompt API Server), **not** `IPromptBackendPort`.

**Files:**
- Create: `packages/dag-orchestrator/src/services/prompt-orchestrator-service.ts`
- Test: `packages/dag-orchestrator/src/__tests__/prompt-orchestrator-service.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/dag-orchestrator/src/__tests__/prompt-orchestrator-service.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { PromptOrchestratorService } from '../services/prompt-orchestrator-service.js';
import type { IPromptApiClientPort } from '../interfaces/prompt-api-client-port.js';
import type { ICostEstimatorPort, ICostPolicyEvaluatorPort } from '../interfaces/orchestrator-policy-port.js';

function createStubApiClient(): IPromptApiClientPort {
  return {
    submitPrompt: async () => ({
      ok: true as const,
      value: { prompt_id: 'test-id', number: 1, node_errors: {} },
    }),
    getQueue: async () => ({
      ok: true as const,
      value: { queue_running: [], queue_pending: [] },
    }),
    manageQueue: async () => ({ ok: true as const, value: undefined }),
    getHistory: async () => ({ ok: true as const, value: {} }),
    getObjectInfo: async () => ({
      ok: true as const,
      value: {
        TestNode: {
          display_name: 'Test', category: 'test',
          input: { required: {} }, output: ['STRING'],
          output_is_list: [false], output_name: ['output'],
          output_node: false, description: '',
        },
      },
    }),
    getSystemStats: async () => ({
      ok: true as const,
      value: {
        system: { os: 'darwin', runtime_version: '', embedded_python: false },
        devices: [],
      },
    }),
  };
}

function createStubCostEstimator(): ICostEstimatorPort {
  return {
    estimateCost: async () => ({
      ok: true as const,
      value: { totalEstimatedCostUsd: 0.05, perNode: { '1': { nodeType: 'TestNode', estimatedCostUsd: 0.05 } } },
    }),
  };
}

function createStubPolicyEvaluator(): ICostPolicyEvaluatorPort {
  return { evaluate: () => ({ ok: true as const, value: undefined }) };
}

describe('PromptOrchestratorService', () => {
  let service: PromptOrchestratorService;
  let apiClient: IPromptApiClientPort;

  beforeEach(() => {
    apiClient = createStubApiClient();
    service = new PromptOrchestratorService(apiClient, createStubCostEstimator(), createStubPolicyEvaluator());
  });

  it('should submit prompt without cost policy', async () => {
    const result = await service.submitPrompt({
      promptRequest: { prompt: { '1': { class_type: 'TestNode', inputs: {} } } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.promptResponse.prompt_id).toBe('test-id');
  });

  it('should estimate cost and enforce policy when configured', async () => {
    const result = await service.submitPrompt({
      promptRequest: { prompt: { '1': { class_type: 'TestNode', inputs: {} } } },
      config: { costPolicy: { maxCostPerPromptUsd: 1.0 } },
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.costEstimate?.totalEstimatedCostUsd).toBe(0.05);
  });

  it('should reject prompt when cost exceeds policy', async () => {
    const rejectingEvaluator: ICostPolicyEvaluatorPort = {
      evaluate: () => ({
        ok: false as const,
        error: { code: 'COST_LIMIT_EXCEEDED', category: 'validation' as const, message: 'Exceeds limit', retryable: false },
      }),
    };
    service = new PromptOrchestratorService(apiClient, createStubCostEstimator(), rejectingEvaluator);

    const result = await service.submitPrompt({
      promptRequest: { prompt: { '1': { class_type: 'TestNode', inputs: {} } } },
      config: { costPolicy: { maxCostPerPromptUsd: 0.01 } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('COST_LIMIT_EXCEEDED');
  });

  it('should delegate getQueue to API client', async () => {
    expect((await service.getQueue()).ok).toBe(true);
  });

  it('should delegate getHistory to API client', async () => {
    expect((await service.getHistory()).ok).toBe(true);
  });

  it('should delegate getSystemStats to API client', async () => {
    expect((await service.getSystemStats()).ok).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @robota-sdk/dag-orchestrator test -- --run src/__tests__/prompt-orchestrator-service.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// packages/dag-orchestrator/src/services/prompt-orchestrator-service.ts
import type {
  TResult, IDagError, IQueueStatus, IQueueAction,
  THistory, IObjectInfo, ISystemStats,
} from '@robota-sdk/dag-core';
import type { IPromptApiClientPort } from '../interfaces/prompt-api-client-port.js';
import type { IOrchestratedPromptRequest, IOrchestratedPromptResponse } from '../types/orchestrator-types.js';
import type { ICostEstimatorPort, ICostPolicyEvaluatorPort } from '../interfaces/orchestrator-policy-port.js';

/**
 * Orchestrator service — gateway to Prompt API Server.
 * Communicates via IPromptApiClientPort (HTTP), not IPromptBackendPort.
 */
export class PromptOrchestratorService {
  constructor(
    private readonly apiClient: IPromptApiClientPort,
    private readonly costEstimator: ICostEstimatorPort,
    private readonly costPolicyEvaluator: ICostPolicyEvaluatorPort,
  ) {}

  async submitPrompt(request: IOrchestratedPromptRequest): Promise<TResult<IOrchestratedPromptResponse, IDagError>> {
    const { promptRequest, config } = request;

    if (config?.costPolicy) {
      const objectInfoResult = await this.apiClient.getObjectInfo();
      if (!objectInfoResult.ok) return objectInfoResult;

      const nodeTypes = Object.values(promptRequest.prompt).map((n) => n.class_type);
      const estimateResult = await this.costEstimator.estimateCost(nodeTypes, objectInfoResult.value);
      if (!estimateResult.ok) return estimateResult;

      const policyResult = this.costPolicyEvaluator.evaluate(estimateResult.value, config.costPolicy);
      if (!policyResult.ok) return policyResult;

      const submitResult = await this.apiClient.submitPrompt(promptRequest);
      if (!submitResult.ok) return submitResult;

      return { ok: true, value: { promptResponse: submitResult.value, costEstimate: estimateResult.value } };
    }

    const submitResult = await this.apiClient.submitPrompt(promptRequest);
    if (!submitResult.ok) return submitResult;
    return { ok: true, value: { promptResponse: submitResult.value } };
  }

  async getQueue(): Promise<TResult<IQueueStatus, IDagError>> { return this.apiClient.getQueue(); }
  async manageQueue(action: IQueueAction): Promise<TResult<void, IDagError>> { return this.apiClient.manageQueue(action); }
  async getHistory(promptId?: string): Promise<TResult<THistory, IDagError>> { return this.apiClient.getHistory(promptId); }
  async getObjectInfo(nodeType?: string): Promise<TResult<IObjectInfo, IDagError>> { return this.apiClient.getObjectInfo(nodeType); }
  async getSystemStats(): Promise<TResult<ISystemStats, IDagError>> { return this.apiClient.getSystemStats(); }
}
```

**Step 4: Export, build, commit**

Add to `packages/dag-orchestrator/src/index.ts`:
```typescript
export { PromptOrchestratorService } from './services/prompt-orchestrator-service.js';
```

Run: `pnpm --filter @robota-sdk/dag-orchestrator build`
Expected: Success

```bash
git add packages/dag-orchestrator/src/services/prompt-orchestrator-service.ts \
  packages/dag-orchestrator/src/__tests__/prompt-orchestrator-service.test.ts \
  packages/dag-orchestrator/src/index.ts
git commit -m "feat(dag-orchestrator): add PromptOrchestratorService with cost policy"
```

---

## Task Summary

| Task | Package | What | SSOT reference |
|------|---------|------|----------------|
| 1 | dag-server-core | **OpenAPI spec (SSOT)** | — (is the SSOT) |
| 2 | dag-core | TypeScript types | Derived from OpenAPI schemas |
| 3 | dag-core | `IPromptBackendPort` | Derived from OpenAPI operations |
| 4 | dag-api | `PromptApiController` | Validates per OpenAPI spec |
| 5 | dag-server-core | Express routes | Paths/methods match OpenAPI spec |
| 6 | dag-orchestrator | Package + `IPromptApiClientPort` | Mirrors OpenAPI operations |
| 7 | dag-orchestrator | `PromptOrchestratorService` | Uses client port (HTTP) |

**Dependency graph:**
```
OpenAPI Spec (SSOT)
    ↓ derives
dag-core (types + ports)
    ↑                ↑
dag-api          dag-orchestrator
    ↑                (uses IPromptApiClientPort → HTTP → Prompt API Server)
dag-server-core
```

API and Orchestrator never depend on each other. Both depend only on dag-core for shared types.

**Key distinction:**
- `IPromptBackendPort` (dag-core): used **inside** Prompt API Server to call backend runtime
- `IPromptApiClientPort` (dag-orchestrator): used by Orchestrator to call Prompt API Server over HTTP

## Not In Scope (future tasks)

- **Orchestrator HTTP server**: Express app for `apps/dag-orchestrator/`
- **Prompt API HTTP client adapter**: Concrete `IPromptApiClientPort` implementation using `fetch`/`undici`
- **Prompt API Server entry point**: `apps/dag-server/` Express bootstrap
- Robota DAG runtime adapter implementing `IPromptBackendPort`
- External proxy adapter implementing `IPromptBackendPort`
- WebSocket progress events
- dag-designer React Flow ↔ prompt format converter
- Retry and timeout policies in orchestrator
- Auth layer in orchestrator
