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

**Execution order:** API spec first, then types and implementation.
```
Task 3 (OpenAPI spec) → Task 1 (types) → Task 2 (port) → Task 4 → Task 5 → Task 6 → Task 7
```
The OpenAPI spec is the contract — types and implementations must conform to it.

**Key references:**
- Design doc: `docs/plans/2026-03-13-dag-json-spec-design.md`
- Current types: `packages/dag-core/src/types/domain.ts`
- Current ports: `packages/dag-core/src/interfaces/ports.ts`
- Current API: `packages/dag-api/src/controllers/`
- Current OpenAPI: `packages/dag-server-core/src/docs/openapi-dag.ts`
- Current routes: `packages/dag-server-core/src/routes/`

---

## Task 1: Prompt Types in dag-core

Define the prompt format type contracts in dag-core as the SSOT.

**Files:**
- Create: `packages/dag-core/src/types/prompt-types.ts`
- Modify: `packages/dag-core/src/index.ts` (re-export new types)
- Test: `packages/dag-core/src/__tests__/prompt-types.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/dag-core/src/__tests__/prompt-types.test.ts
import { describe, it, expect } from 'vitest';
import type {
  IPrompt,
  IPromptNodeDef,
  TPromptInputValue,
  TPromptLink,
  IPromptRequest,
  IPromptResponse,
  IQueueStatus,
  IHistoryEntry,
  IObjectInfo,
  INodeObjectInfo,
  ISystemStats,
} from '../types/prompt-types.js';

describe('Prompt types', () => {
  it('should represent a valid prompt with nodes and links', () => {
    const prompt: IPrompt = {
      '4': {
        class_type: 'CheckpointLoaderSimple',
        inputs: {
          ckpt_name: 'v1-5-pruned-emaonly.safetensors',
        },
      },
      '3': {
        class_type: 'KSampler',
        inputs: {
          seed: 8566257,
          steps: 20,
          cfg: 8.0,
          sampler_name: 'euler',
          model: ['4', 0],
        },
        _meta: { title: 'KSampler' },
      },
    };

    expect(prompt['3'].class_type).toBe('KSampler');
    expect(prompt['3'].inputs.model).toEqual(['4', 0]);
    expect(prompt['3'].inputs.seed).toBe(8566257);
    expect(prompt['3']._meta?.title).toBe('KSampler');
  });

  it('should represent a prompt request with client_id and extra_data', () => {
    const request: IPromptRequest = {
      prompt: {
        '1': { class_type: 'InputNode', inputs: { text: 'hello' } },
      },
      client_id: 'test-client-uuid',
      extra_data: {
        extra_pnginfo: {
          workflow: { nodes: [], links: [], version: 0.4 },
        },
      },
    };

    expect(request.client_id).toBe('test-client-uuid');
    expect(request.extra_data?.extra_pnginfo?.workflow.version).toBe(0.4);
  });

  it('should represent a prompt response with prompt_id', () => {
    const response: IPromptResponse = {
      prompt_id: 'abc-123',
      number: 1,
      node_errors: {},
    };

    expect(response.prompt_id).toBe('abc-123');
  });

  it('should represent queue status', () => {
    const queue: IQueueStatus = {
      queue_running: [],
      queue_pending: [],
    };

    expect(queue.queue_running).toEqual([]);
  });

  it('should represent history entry', () => {
    const entry: IHistoryEntry = {
      prompt: {
        '1': { class_type: 'InputNode', inputs: { text: 'hello' } },
      },
      outputs: {
        '2': { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] },
      },
      status: {
        status_str: 'success',
        completed: true,
        messages: [],
      },
    };

    expect(entry.status.status_str).toBe('success');
  });

  it('should represent object_info for a node type', () => {
    const info: INodeObjectInfo = {
      display_name: 'KSampler',
      category: 'sampling',
      input: {
        required: {
          model: ['MODEL'],
          seed: ['INT', { default: 0, min: 0, max: 18446744073709551615 }],
        },
        optional: {},
      },
      output: ['LATENT'],
      output_is_list: [false],
      output_name: ['LATENT'],
      output_node: false,
      description: '',
    };

    expect(info.category).toBe('sampling');
    expect(info.output).toEqual(['LATENT']);
  });

  it('should represent system stats', () => {
    const stats: ISystemStats = {
      system: {
        os: 'darwin',
        runtime_version: '',
        embedded_python: false,
      },
      devices: [],
    };

    expect(stats.system.os).toBe('darwin');
  });

  it('should distinguish links from config values', () => {
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

**Step 3: Write minimal implementation**

```typescript
// packages/dag-core/src/types/prompt-types.ts

// --- Prompt format types ---

/** Link reference: [sourceNodeId, outputSlotIndex] */
export type TPromptLink = [string, number];

/** A single input value: scalar or link */
export type TPromptInputValue = string | number | boolean | TPromptLink;

/** A single node in the prompt */
export interface IPromptNodeDef {
  class_type: string;
  inputs: Record<string, TPromptInputValue>;
  _meta?: { title?: string };
}

/** The full prompt: nodeId → node definition */
export type IPrompt = Record<string, IPromptNodeDef>;

// --- API request/response types ---

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

export interface INodeError {
  type: string;
  message: string;
  details: string;
  extra_info: Record<string, unknown>;
}

export interface IPromptResponse {
  prompt_id: string;
  number: number;
  node_errors: Record<string, INodeError>;
}

// --- Queue types ---

export interface IQueueStatus {
  queue_running: unknown[];
  queue_pending: unknown[];
}

export interface IQueueAction {
  clear?: boolean;
  delete?: string[];
}

// --- History types ---

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

// --- Object info types ---

export type TInputTypeSpec =
  | [string]                                      // type only: ["MODEL"]
  | [string, Record<string, unknown>];            // type + constraints: ["INT", {default: 0}]

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

// --- System stats types ---

/**
 * System statistics. Field names match the external protocol for compatibility.
 * When Robota DAG runtime is used as backend, `runtime_version` replaces `python_version`
 * and `embedded_python` is always false.
 */
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
git commit -m "feat(dag-core): add prompt format types"
```

---

## Task 2: Backend Port in dag-core

Define the port interface that both external proxy and Robota DAG runtime will implement.

**Files:**
- Create: `packages/dag-core/src/interfaces/prompt-backend-port.ts`
- Modify: `packages/dag-core/src/index.ts` (re-export)
- Test: `packages/dag-core/src/__tests__/prompt-backend-port.test.ts`

**Step 1: Write the failing test**

```typescript
// packages/dag-core/src/__tests__/prompt-backend-port.test.ts
import { describe, it, expect } from 'vitest';
import type { IPromptBackendPort } from '../interfaces/prompt-backend-port.js';
import type {
  IPromptRequest,
  IPromptResponse,
  IQueueStatus,
  IQueueAction,
  THistory,
  IObjectInfo,
  ISystemStats,
} from '../types/prompt-types.js';
import type { TResult, IDagError } from '../types/index.js';

describe('IPromptBackendPort', () => {
  it('should be implementable as an in-memory stub', async () => {
    const stub: IPromptBackendPort = {
      submitPrompt: async (_request: IPromptRequest): Promise<TResult<IPromptResponse, IDagError>> => ({
        ok: true,
        value: { prompt_id: 'test-id', number: 1, node_errors: {} },
      }),
      getQueue: async (): Promise<TResult<IQueueStatus, IDagError>> => ({
        ok: true,
        value: { queue_running: [], queue_pending: [] },
      }),
      manageQueue: async (_action: IQueueAction): Promise<TResult<void, IDagError>> => ({
        ok: true, value: undefined,
      }),
      getHistory: async (_promptId?: string): Promise<TResult<THistory, IDagError>> => ({
        ok: true, value: {},
      }),
      getObjectInfo: async (_nodeType?: string): Promise<TResult<IObjectInfo, IDagError>> => ({
        ok: true, value: {},
      }),
      getSystemStats: async (): Promise<TResult<ISystemStats, IDagError>> => ({
        ok: true,
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

```typescript
// packages/dag-core/src/interfaces/prompt-backend-port.ts
import type { TResult, IDagError } from '../types/index.js';
import type {
  IPromptRequest,
  IPromptResponse,
  IQueueStatus,
  IQueueAction,
  THistory,
  IObjectInfo,
  ISystemStats,
} from '../types/prompt-types.js';

/**
 * Port interface for prompt-compatible backends.
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

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @robota-sdk/dag-core test -- --run src/__tests__/prompt-backend-port.test.ts`
Expected: PASS

**Step 5: Export from dag-core index**

Add to `packages/dag-core/src/index.ts`:
```typescript
export type { IPromptBackendPort } from './interfaces/prompt-backend-port.js';
```

**Step 6: Build and verify**

Run: `pnpm --filter @robota-sdk/dag-core build`
Expected: Success

**Step 7: Commit**

```bash
git add packages/dag-core/src/interfaces/prompt-backend-port.ts \
  packages/dag-core/src/__tests__/prompt-backend-port.test.ts \
  packages/dag-core/src/index.ts
git commit -m "feat(dag-core): add IPromptBackendPort interface"
```

---

**Implementation note:** Tasks 4, 5, and 7 all use a similar `createStubBackend()` helper. During implementation, extract a shared `createStubPromptBackend()` factory into `packages/dag-core/src/testing/` and import it in each test file to avoid duplication.

---

## Task 3: OpenAPI Spec for Prompt API Endpoints

Define the complete OpenAPI 3.0.3 spec matching the prompt API format.

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
git commit -m "feat(dag-server-core): add prompt API OpenAPI spec"
```

---

## Task 4: Prompt API Controller

Implement the controller that handles all prompt API endpoints, delegating to `IPromptBackendPort`.

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
  let backend: IPromptBackendPort;

  beforeEach(() => {
    backend = createStubBackend();
    controller = new PromptApiController(backend);
  });

  describe('submitPrompt', () => {
    it('should return prompt_id on valid prompt', async () => {
      const result = await controller.submitPrompt({
        prompt: { '1': { class_type: 'Test', inputs: { value: 'hello' } } },
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.prompt_id).toBe('stub-id');
      }
    });

    it('should reject empty prompt', async () => {
      const result = await controller.submitPrompt({ prompt: {} });
      expect(result.ok).toBe(false);
    });
  });

  describe('getQueue', () => {
    it('should return queue status', async () => {
      const result = await controller.getQueue();
      expect(result.ok).toBe(true);
    });
  });

  describe('manageQueue', () => {
    it('should accept clear action', async () => {
      const result = await controller.manageQueue({ clear: true });
      expect(result.ok).toBe(true);
    });
  });

  describe('getHistory', () => {
    it('should return all history', async () => {
      const result = await controller.getHistory();
      expect(result.ok).toBe(true);
    });

    it('should return history for specific prompt_id', async () => {
      const result = await controller.getHistory('some-id');
      expect(result.ok).toBe(true);
    });
  });

  describe('getObjectInfo', () => {
    it('should return all node types', async () => {
      const result = await controller.getObjectInfo();
      expect(result.ok).toBe(true);
    });

    it('should return specific node type', async () => {
      const result = await controller.getObjectInfo('KSampler');
      expect(result.ok).toBe(true);
    });
  });

  describe('getSystemStats', () => {
    it('should return system stats', async () => {
      const result = await controller.getSystemStats();
      expect(result.ok).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @robota-sdk/dag-api test -- --run src/__tests__/prompt-api-controller.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

```typescript
// packages/dag-api/src/controllers/prompt-api-controller.ts
import type {
  IPromptBackendPort,
  IPromptRequest,
  IPromptResponse,
  IQueueStatus,
  IQueueAction,
  THistory,
  IObjectInfo,
  ISystemStats,
  TResult,
  IDagError,
} from '@robota-sdk/dag-core';

export class PromptApiController {
  private readonly backend: IPromptBackendPort;

  constructor(backend: IPromptBackendPort) {
    this.backend = backend;
  }

  async submitPrompt(
    request: IPromptRequest,
  ): Promise<TResult<IPromptResponse, IDagError>> {
    const nodeIds = Object.keys(request.prompt);
    if (nodeIds.length === 0) {
      return {
        ok: false,
        error: {
          code: 'PROMPT_NO_OUTPUTS',
          category: 'validation',
          message: 'Prompt has no nodes',
          retryable: false,
        },
      };
    }

    for (const nodeId of nodeIds) {
      const node = request.prompt[nodeId];
      if (!node.class_type) {
        return {
          ok: false,
          error: {
            code: 'INVALID_NODE',
            category: 'validation',
            message: `Node ${nodeId} missing class_type`,
            retryable: false,
          },
        };
      }
    }

    return this.backend.submitPrompt(request);
  }

  async getQueue(): Promise<TResult<IQueueStatus, IDagError>> {
    return this.backend.getQueue();
  }

  async manageQueue(action: IQueueAction): Promise<TResult<void, IDagError>> {
    return this.backend.manageQueue(action);
  }

  async getHistory(promptId?: string): Promise<TResult<THistory, IDagError>> {
    return this.backend.getHistory(promptId);
  }

  async getObjectInfo(nodeType?: string): Promise<TResult<IObjectInfo, IDagError>> {
    return this.backend.getObjectInfo(nodeType);
  }

  async getSystemStats(): Promise<TResult<ISystemStats, IDagError>> {
    return this.backend.getSystemStats();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @robota-sdk/dag-api test -- --run src/__tests__/prompt-api-controller.test.ts`
Expected: PASS

**Step 5: Build and verify**

Run: `pnpm --filter @robota-sdk/dag-api build`
Expected: Success

**Step 6: Commit**

```bash
git add packages/dag-api/src/controllers/prompt-api-controller.ts \
  packages/dag-api/src/__tests__/prompt-api-controller.test.ts
git commit -m "feat(dag-api): add PromptApiController"
```

---

## Task 5: Express Routes for Prompt API Endpoints

Wire the PromptApiController to Express routes.

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

describe('Prompt API routes', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    const backend = createStubBackend();
    const controller = new PromptApiController(backend);
    mountPromptRoutes(app, controller);
  });

  it('POST /prompt should return prompt_id', async () => {
    const res = await request(app)
      .post('/prompt')
      .send({ prompt: { '1': { class_type: 'TestNode', inputs: {} } } });

    expect(res.status).toBe(200);
    expect(res.body.prompt_id).toBe('test-prompt-id');
  });

  it('POST /prompt should reject empty prompt', async () => {
    const res = await request(app)
      .post('/prompt')
      .send({ prompt: {} });

    expect(res.status).toBe(400);
  });

  it('GET /queue should return queue status', async () => {
    const res = await request(app).get('/queue');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('queue_running');
    expect(res.body).toHaveProperty('queue_pending');
  });

  it('POST /queue should accept clear action', async () => {
    const res = await request(app).post('/queue').send({ clear: true });
    expect(res.status).toBe(200);
  });

  it('GET /history should return history', async () => {
    const res = await request(app).get('/history');
    expect(res.status).toBe(200);
  });

  it('GET /history/:prompt_id should return specific history', async () => {
    const res = await request(app).get('/history/some-id');
    expect(res.status).toBe(200);
  });

  it('GET /object_info should return all node types', async () => {
    const res = await request(app).get('/object_info');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('TestNode');
  });

  it('GET /object_info/:node_type should return specific type', async () => {
    const res = await request(app).get('/object_info/TestNode');
    expect(res.status).toBe(200);
  });

  it('GET /system_stats should return stats', async () => {
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

```typescript
// packages/dag-server-core/src/routes/prompt-routes.ts
import type { Express, Request, Response } from 'express';
import type { PromptApiController } from '@robota-sdk/dag-api';
import type { IDagError } from '@robota-sdk/dag-core';

function sendError(res: Response, error: IDagError, status = 500): void {
  res.status(status).json({
    error: {
      type: error.code,
      message: error.message,
      details: '',
      extra_info: {},
    },
    node_errors: {},
  });
}

export function mountPromptRoutes(
  app: Express,
  controller: PromptApiController,
): void {
  app.post('/prompt', async (req: Request, res: Response) => {
    const result = await controller.submitPrompt(req.body);
    if (result.ok) {
      res.status(200).json(result.value);
    } else {
      sendError(res, result.error, 400);
    }
  });

  app.get('/queue', async (_req: Request, res: Response) => {
    const result = await controller.getQueue();
    if (result.ok) {
      res.status(200).json(result.value);
    } else {
      sendError(res, result.error);
    }
  });

  app.post('/queue', async (req: Request, res: Response) => {
    const result = await controller.manageQueue(req.body);
    if (result.ok) {
      res.status(200).json({});
    } else {
      sendError(res, result.error);
    }
  });

  app.get('/history', async (_req: Request, res: Response) => {
    const result = await controller.getHistory();
    if (result.ok) {
      res.status(200).json(result.value);
    } else {
      sendError(res, result.error);
    }
  });

  app.get('/history/:prompt_id', async (req: Request, res: Response) => {
    const result = await controller.getHistory(req.params.prompt_id);
    if (result.ok) {
      res.status(200).json(result.value);
    } else {
      sendError(res, result.error);
    }
  });

  app.get('/object_info', async (_req: Request, res: Response) => {
    const result = await controller.getObjectInfo();
    if (result.ok) {
      res.status(200).json(result.value);
    } else {
      sendError(res, result.error);
    }
  });

  app.get('/object_info/:node_type', async (req: Request, res: Response) => {
    const result = await controller.getObjectInfo(req.params.node_type);
    if (result.ok) {
      res.status(200).json(result.value);
    } else {
      sendError(res, result.error);
    }
  });

  app.get('/system_stats', async (_req: Request, res: Response) => {
    const result = await controller.getSystemStats();
    if (result.ok) {
      res.status(200).json(result.value);
    } else {
      sendError(res, result.error);
    }
  });
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @robota-sdk/dag-server-core test -- --run src/__tests__/prompt-routes.test.ts`
Expected: PASS

**Step 5: Build and verify**

Run: `pnpm --filter @robota-sdk/dag-server-core build`
Expected: Success

**Step 6: Commit**

```bash
git add packages/dag-server-core/src/routes/prompt-routes.ts \
  packages/dag-server-core/src/__tests__/prompt-routes.test.ts
git commit -m "feat(dag-server-core): add prompt API Express routes"
```

---

## Task 6: Orchestration Layer — Package Setup, Types, and HTTP Client Port

Create the `dag-orchestrator` package as an **independent program**. It communicates with Prompt API Server over HTTP — no in-process dependency on `IPromptBackendPort` or the API layer.

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
  "scripts": {
    "build": "tsc",
    "test": "vitest"
  },
  "dependencies": {
    "@robota-sdk/dag-core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^3.0.0"
  }
}
```

Copy `tsconfig.json` and `vitest.config.ts` patterns from another dag-* package (e.g., `dag-runtime`).

**Step 2: Define orchestrator types**

```typescript
// packages/dag-orchestrator/src/types/orchestrator-types.ts
import type { IPromptRequest, IPromptResponse } from '@robota-sdk/dag-core';

export interface ICostEstimate {
  totalEstimatedCostUsd: number;
  perNode: Record<string, { nodeType: string; estimatedCostUsd: number }>;
}

export interface ICostPolicy {
  maxCostPerPromptUsd: number;
}

export interface IRetryPolicy {
  maxRetries: number;
  backoffMs: number;
  retryableErrors: string[];
}

export interface ITimeoutPolicy {
  promptTimeoutMs: number;
}

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

This port abstracts Prompt API Server communication. The Orchestrator depends on this port, not on `IPromptBackendPort`. A concrete HTTP adapter (future task) implements this port by calling Prompt API Server endpoints over HTTP.

```typescript
// packages/dag-orchestrator/src/interfaces/prompt-api-client-port.ts
import type {
  IPromptRequest,
  IPromptResponse,
  IQueueStatus,
  IQueueAction,
  THistory,
  IObjectInfo,
  ISystemStats,
  TResult,
  IDagError,
} from '@robota-sdk/dag-core';

/**
 * Port for communicating with a Prompt API Server over HTTP.
 * Mirrors the Prompt API endpoints. Implemented by an HTTP client adapter.
 *
 * This is NOT the same as IPromptBackendPort:
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
  estimateCost(
    nodeTypes: string[],
    objectInfo: IObjectInfo,
  ): Promise<TResult<ICostEstimate, IDagError>>;
}

export interface ICostPolicyEvaluatorPort {
  evaluate(
    estimate: ICostEstimate,
    policy: ICostPolicy,
  ): TResult<void, IDagError>;
}
```

**Step 5: Write the failing test for IPromptApiClientPort**

```typescript
// packages/dag-orchestrator/src/__tests__/prompt-api-client-port.test.ts
import { describe, it, expect } from 'vitest';
import type { IPromptApiClientPort } from '../interfaces/prompt-api-client-port.js';

describe('IPromptApiClientPort', () => {
  it('should be implementable as an in-memory stub', async () => {
    const stub: IPromptApiClientPort = {
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

**Step 6: Run test to verify it passes**

Run: `pnpm --filter @robota-sdk/dag-orchestrator test -- --run src/__tests__/prompt-api-client-port.test.ts`
Expected: PASS

**Step 7: Create index.ts with exports**

```typescript
// packages/dag-orchestrator/src/index.ts
export type {
  ICostEstimate, ICostPolicy, IRetryPolicy, ITimeoutPolicy,
  IOrchestratorConfig, IOrchestratedPromptRequest, IOrchestratedPromptResponse,
} from './types/orchestrator-types.js';
export type {
  IPromptApiClientPort,
} from './interfaces/prompt-api-client-port.js';
export type {
  ICostEstimatorPort, ICostPolicyEvaluatorPort,
} from './interfaces/orchestrator-policy-port.js';
```

**Step 8: Install deps, build, verify**

Run:
```bash
pnpm install
pnpm --filter @robota-sdk/dag-orchestrator build
```
Expected: Success

**Step 9: Commit**

```bash
git add packages/dag-orchestrator/
git commit -m "feat(dag-orchestrator): scaffold orchestration layer with HTTP client port"
```

---

## Task 7: Orchestration Layer — Service Implementation

Implement the orchestrator service. Uses `IPromptApiClientPort` (HTTP client to Prompt API Server), **not** `IPromptBackendPort`. The Orchestrator is an independent program that calls Prompt API over HTTP.

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
      value: {
        totalEstimatedCostUsd: 0.05,
        perNode: { '1': { nodeType: 'TestNode', estimatedCostUsd: 0.05 } },
      },
    }),
  };
}

function createStubPolicyEvaluator(): ICostPolicyEvaluatorPort {
  return {
    evaluate: () => ({ ok: true as const, value: undefined }),
  };
}

describe('PromptOrchestratorService', () => {
  let service: PromptOrchestratorService;
  let apiClient: IPromptApiClientPort;

  beforeEach(() => {
    apiClient = createStubApiClient();
    service = new PromptOrchestratorService(
      apiClient,
      createStubCostEstimator(),
      createStubPolicyEvaluator(),
    );
  });

  it('should submit prompt when no cost policy is set', async () => {
    const result = await service.submitPrompt({
      promptRequest: {
        prompt: { '1': { class_type: 'TestNode', inputs: {} } },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.promptResponse.prompt_id).toBe('test-id');
    }
  });

  it('should estimate cost and enforce policy when configured', async () => {
    const result = await service.submitPrompt({
      promptRequest: {
        prompt: { '1': { class_type: 'TestNode', inputs: {} } },
      },
      config: {
        costPolicy: { maxCostPerPromptUsd: 1.0 },
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.costEstimate).toBeDefined();
      expect(result.value.costEstimate?.totalEstimatedCostUsd).toBe(0.05);
    }
  });

  it('should reject prompt when cost exceeds policy', async () => {
    const rejectingEvaluator: ICostPolicyEvaluatorPort = {
      evaluate: () => ({
        ok: false as const,
        error: {
          code: 'COST_LIMIT_EXCEEDED',
          category: 'validation' as const,
          message: 'Estimated cost $0.05 exceeds limit $0.01',
          retryable: false,
        },
      }),
    };

    service = new PromptOrchestratorService(
      apiClient,
      createStubCostEstimator(),
      rejectingEvaluator,
    );

    const result = await service.submitPrompt({
      promptRequest: {
        prompt: { '1': { class_type: 'TestNode', inputs: {} } },
      },
      config: {
        costPolicy: { maxCostPerPromptUsd: 0.01 },
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('COST_LIMIT_EXCEEDED');
    }
  });

  it('should delegate getQueue to API client', async () => {
    const result = await service.getQueue();
    expect(result.ok).toBe(true);
  });

  it('should delegate getHistory to API client', async () => {
    const result = await service.getHistory();
    expect(result.ok).toBe(true);
  });

  it('should delegate getSystemStats to API client', async () => {
    const result = await service.getSystemStats();
    expect(result.ok).toBe(true);
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
  TResult,
  IDagError,
  IQueueStatus,
  IQueueAction,
  THistory,
  IObjectInfo,
  ISystemStats,
} from '@robota-sdk/dag-core';
import type { IPromptApiClientPort } from '../interfaces/prompt-api-client-port.js';
import type {
  IOrchestratedPromptRequest,
  IOrchestratedPromptResponse,
} from '../types/orchestrator-types.js';
import type {
  ICostEstimatorPort,
  ICostPolicyEvaluatorPort,
} from '../interfaces/orchestrator-policy-port.js';

/**
 * Orchestrator service that acts as a gateway to Prompt API Server.
 * Adds cost estimation, policy enforcement, and other extended features
 * on top of the standard Prompt API.
 *
 * Communicates with Prompt API Server via IPromptApiClientPort (HTTP).
 */
export class PromptOrchestratorService {
  constructor(
    private readonly apiClient: IPromptApiClientPort,
    private readonly costEstimator: ICostEstimatorPort,
    private readonly costPolicyEvaluator: ICostPolicyEvaluatorPort,
  ) {}

  async submitPrompt(
    request: IOrchestratedPromptRequest,
  ): Promise<TResult<IOrchestratedPromptResponse, IDagError>> {
    const { promptRequest, config } = request;

    if (config?.costPolicy) {
      const objectInfoResult = await this.apiClient.getObjectInfo();
      if (!objectInfoResult.ok) {
        return objectInfoResult;
      }

      const nodeTypes = Object.values(promptRequest.prompt).map(
        (node) => node.class_type,
      );

      const estimateResult = await this.costEstimator.estimateCost(
        nodeTypes,
        objectInfoResult.value,
      );
      if (!estimateResult.ok) {
        return estimateResult;
      }

      const policyResult = this.costPolicyEvaluator.evaluate(
        estimateResult.value,
        config.costPolicy,
      );
      if (!policyResult.ok) {
        return policyResult;
      }

      const submitResult = await this.apiClient.submitPrompt(promptRequest);
      if (!submitResult.ok) {
        return submitResult;
      }

      return {
        ok: true,
        value: {
          promptResponse: submitResult.value,
          costEstimate: estimateResult.value,
        },
      };
    }

    const submitResult = await this.apiClient.submitPrompt(promptRequest);
    if (!submitResult.ok) {
      return submitResult;
    }

    return {
      ok: true,
      value: { promptResponse: submitResult.value },
    };
  }

  async getQueue(): Promise<TResult<IQueueStatus, IDagError>> {
    return this.apiClient.getQueue();
  }

  async manageQueue(action: IQueueAction): Promise<TResult<void, IDagError>> {
    return this.apiClient.manageQueue(action);
  }

  async getHistory(promptId?: string): Promise<TResult<THistory, IDagError>> {
    return this.apiClient.getHistory(promptId);
  }

  async getObjectInfo(nodeType?: string): Promise<TResult<IObjectInfo, IDagError>> {
    return this.apiClient.getObjectInfo(nodeType);
  }

  async getSystemStats(): Promise<TResult<ISystemStats, IDagError>> {
    return this.apiClient.getSystemStats();
  }
}
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @robota-sdk/dag-orchestrator test -- --run src/__tests__/prompt-orchestrator-service.test.ts`
Expected: PASS

**Step 5: Export from index and build**

Add to `packages/dag-orchestrator/src/index.ts`:
```typescript
export { PromptOrchestratorService } from './services/prompt-orchestrator-service.js';
```

Run: `pnpm --filter @robota-sdk/dag-orchestrator build`
Expected: Success

**Step 6: Commit**

```bash
git add packages/dag-orchestrator/src/services/prompt-orchestrator-service.ts \
  packages/dag-orchestrator/src/__tests__/prompt-orchestrator-service.test.ts \
  packages/dag-orchestrator/src/index.ts
git commit -m "feat(dag-orchestrator): add PromptOrchestratorService with cost policy"
```

---

## Task Summary

| Task | Package | What | Depends on API? | Depends on Orchestrator? |
|------|---------|------|-----------------|--------------------------|
| 1 | dag-core | Prompt types (SSOT) | No | No |
| 2 | dag-core | `IPromptBackendPort` | No | No |
| 3 | dag-server-core | OpenAPI spec | No | No |
| 4 | dag-api | `PromptApiController` | — (is the API) | No |
| 5 | dag-server-core | Express routes | Yes | No |
| 6 | dag-orchestrator | Package scaffold + types + `IPromptApiClientPort` + policy ports | No | — (is the orchestrator) |
| 7 | dag-orchestrator | `PromptOrchestratorService` (uses HTTP client port) | No | — (is the orchestrator) |

**Dependency graph:**
```
dag-core (types + ports)
    ↑                ↑
dag-api          dag-orchestrator
    ↑                (uses IPromptApiClientPort → HTTP → Prompt API Server)
dag-server-core
```

API and Orchestrator never depend on each other. Both depend only on dag-core for shared types.
Orchestrator communicates with Prompt API Server over HTTP via `IPromptApiClientPort`.

**Key distinction:**
- `IPromptBackendPort` (dag-core): used **inside** Prompt API Server to call backend runtime
- `IPromptApiClientPort` (dag-orchestrator): used by Orchestrator to call Prompt API Server over HTTP

## Not In Scope (future tasks)

- **Orchestrator HTTP server**: Express app for `apps/dag-orchestrator/` that exposes orchestrator endpoints to dag-designer
- **Prompt API HTTP client adapter**: Concrete implementation of `IPromptApiClientPort` using `fetch`/`undici` to call Prompt API Server
- **Prompt API Server entry point**: `apps/dag-server/` Express bootstrap wiring `PromptApiController` + `mountPromptRoutes` + backend adapter
- Robota DAG runtime adapter implementing `IPromptBackendPort` (wraps existing dag-runtime/dag-worker)
- External proxy adapter implementing `IPromptBackendPort`
- WebSocket progress events
- dag-designer React Flow ↔ prompt format converter
- Retry and timeout policies in orchestrator
- Auth layer in orchestrator
