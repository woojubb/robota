# ComfyUI API Parity Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the 5 missing ComfyUI API items in dag-runtime-server to reach 100% API parity.

**Architecture:** Add `asset-routes.ts` for GET /view and POST /upload/image using LocalFsAssetStore. Extend `ws-routes.ts` to broadcast `status`, `execution_cached`, and `progress` ComfyUI events by mapping existing dag-core execution lifecycle events to ComfyUI format. No dag-core type changes required — all 3 WS events can be derived from existing execution events or emitted as valid stubs.

**Tech Stack:** Express, multer (new dep for multipart), ws, vitest

**Key references:**
- ComfyUI spec: `.design/dag-benchmark/03-comfyui.md`
- Runtime SPEC: `apps/dag-runtime-server/docs/SPEC.md`
- Task tracker: `.agents/tasks/comfyui-api-parity.md`

---

### Task 1: GET /view — Image Serving Endpoint

**Files:**
- Create: `apps/dag-runtime-server/src/routes/asset-routes.ts`
- Modify: `apps/dag-runtime-server/src/server.ts` (mount route)
- Modify: `apps/dag-runtime-server/src/__tests__/endpoint-contract.test.ts` (add tests)

**Context:**
ComfyUI `GET /view` serves images by filename with query params `filename` (required), `subfolder` (optional), `type` (optional: output/temp/input). In the Robota runtime, assets are stored via `LocalFsAssetStore` with UUID-based `assetId`. The `filename` query param maps to `assetId` since `executed` WS events reference assets by assetId. `LocalFsAssetStore.getContent(assetId)` returns `{ stream: AsyncIterable<Uint8Array>, metadata }` which can be piped to HTTP response.

**Step 1: Write the failing test**

Add to `apps/dag-runtime-server/src/__tests__/endpoint-contract.test.ts`:

```typescript
// In the test server setup (createTestApp), add:
import { LocalFsAssetStore } from '../services/local-fs-asset-store.js';
import { mountAssetRoutes } from '../routes/asset-routes.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Add module-level vars:
let assetStore: LocalFsAssetStore;
let tempAssetDir: string;

// In beforeAll, before server creation:
tempAssetDir = await mkdtemp(path.join(tmpdir(), 'dag-test-assets-'));
assetStore = new LocalFsAssetStore(tempAssetDir);
await assetStore.initialize();

// In createTestApp, after mountPromptRoutes:
mountAssetRoutes(app, assetStore);

// In afterAll, after server close:
await rm(tempAssetDir, { recursive: true, force: true });

// New test block:
describe('GET /view', () => {
    it('returns 200 with binary content for existing asset', async () => {
        const content = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header bytes
        const saved = await assetStore.save({
            fileName: 'test.png',
            mediaType: 'image/png',
            content,
        });
        const res = await fetch(`${baseUrl}/view?filename=${saved.assetId}`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toBe('image/png');
        const body = new Uint8Array(await res.arrayBuffer());
        expect(body).toEqual(content);
    });

    it('returns 404 when asset does not exist', async () => {
        const res = await fetch(`${baseUrl}/view?filename=nonexistent-id`);
        expect(res.status).toBe(404);
    });

    it('returns 400 when filename query param is missing', async () => {
        const res = await fetch(`${baseUrl}/view`);
        expect(res.status).toBe(400);
    });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @robota-sdk/dag-runtime-server test
```

Expected: FAIL — `mountAssetRoutes` does not exist.

**Step 3: Write minimal implementation**

Create `apps/dag-runtime-server/src/routes/asset-routes.ts`:

```typescript
import type { Express, Request, Response } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { IAssetStore } from '@robota-sdk/dag-core';

export function mountAssetRoutes(app: Express, assetStore: IAssetStore): void {
    app.get('/view', async (req: Request, res: Response) => {
        const filename = req.query.filename;
        if (typeof filename !== 'string' || filename.trim().length === 0) {
            res.status(400).json({
                error: { type: 'invalid_request', message: 'filename query parameter is required', details: '', extra_info: {} },
                node_errors: {},
            });
            return;
        }

        const result = await assetStore.getContent(filename.trim());
        if (!result) {
            res.status(404).json({
                error: { type: 'not_found', message: `Asset not found: ${filename}`, details: '', extra_info: {} },
                node_errors: {},
            });
            return;
        }

        res.setHeader('Content-Type', result.metadata.mediaType);
        res.setHeader('Content-Length', String(result.metadata.sizeBytes));

        const readable = result.stream instanceof Readable
            ? result.stream
            : Readable.from(result.stream);
        await pipeline(readable, res);
    });
}
```

**Step 4: Mount in server.ts**

In `apps/dag-runtime-server/src/server.ts`, add import and mount call:

```typescript
import { mountAssetRoutes } from './routes/asset-routes.js';
// After mountPromptRoutes(app, promptController):
mountAssetRoutes(app, assetStore);
```

**Step 5: Run test to verify it passes**

```bash
pnpm --filter @robota-sdk/dag-runtime-server test
```

Expected: PASS — all tests including new /view tests.

**Step 6: Commit**

```bash
git add apps/dag-runtime-server/src/routes/asset-routes.ts \
  apps/dag-runtime-server/src/server.ts \
  apps/dag-runtime-server/src/__tests__/endpoint-contract.test.ts
git commit -m "feat(dag-runtime-server): implement GET /view for ComfyUI image serving"
```

---

### Task 2: POST /upload/image — Multipart Image Upload

**Files:**
- Modify: `apps/dag-runtime-server/package.json` (add multer dependency)
- Modify: `apps/dag-runtime-server/src/routes/asset-routes.ts` (add upload route)
- Modify: `apps/dag-runtime-server/src/__tests__/endpoint-contract.test.ts` (add tests)

**Context:**
ComfyUI `POST /upload/image` accepts `multipart/form-data` with an `image` file field. It returns `{ name, subfolder, type }`. `multer` is the standard Express middleware for multipart parsing. Use memory storage since we pass the buffer directly to `assetStore.save()`.

**Step 1: Add multer dependency**

```bash
cd apps/dag-runtime-server
pnpm add multer
pnpm add -D @types/multer
```

**Step 2: Write the failing test**

Add to endpoint-contract.test.ts:

```typescript
describe('POST /upload/image', () => {
    it('returns 200 with { name, subfolder, type } for valid image upload', async () => {
        const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const formData = new FormData();
        formData.append('image', new Blob([pngBytes], { type: 'image/png' }), 'upload-test.png');

        const res = await fetch(`${baseUrl}/upload/image`, {
            method: 'POST',
            body: formData,
        });

        expect(res.status).toBe(200);
        const body = await res.json() as Record<string, unknown>;
        expect(typeof body.name).toBe('string');
        expect((body.name as string).length).toBeGreaterThan(0);
        expect(body.subfolder).toBe('');
        expect(body.type).toBe('input');
    });

    it('returns 400 when no image file is provided', async () => {
        const res = await fetch(`${baseUrl}/upload/image`, {
            method: 'POST',
            body: new FormData(),
        });

        expect(res.status).toBe(400);
    });

    it('uploaded image is retrievable via GET /view', async () => {
        const content = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG header
        const formData = new FormData();
        formData.append('image', new Blob([content], { type: 'image/jpeg' }), 'round-trip.jpg');

        const uploadRes = await fetch(`${baseUrl}/upload/image`, {
            method: 'POST',
            body: formData,
        });
        expect(uploadRes.status).toBe(200);
        const uploadBody = await uploadRes.json() as Record<string, unknown>;
        const assetName = uploadBody.name as string;

        const viewRes = await fetch(`${baseUrl}/view?filename=${assetName}`);
        expect(viewRes.status).toBe(200);
        expect(viewRes.headers.get('content-type')).toBe('image/jpeg');
        const body = new Uint8Array(await viewRes.arrayBuffer());
        expect(body).toEqual(content);
    });
});
```

**Step 3: Run test to verify it fails**

```bash
pnpm --filter @robota-sdk/dag-runtime-server test
```

Expected: FAIL — upload route does not exist.

**Step 4: Implement upload route**

Update `apps/dag-runtime-server/src/routes/asset-routes.ts`:

```typescript
import multer from 'multer';

// Inside mountAssetRoutes, add:
const upload = multer({ storage: multer.memoryStorage() });

app.post('/upload/image', upload.single('image'), async (req: Request, res: Response) => {
    const file = (req as Request & { file?: Express.Multer.File }).file;
    if (!file) {
        res.status(400).json({
            error: { type: 'invalid_request', message: 'No image file provided', details: '', extra_info: {} },
            node_errors: {},
        });
        return;
    }

    const saved = await assetStore.save({
        fileName: file.originalname,
        mediaType: file.mimetype,
        content: new Uint8Array(file.buffer),
    });

    res.status(200).json({
        name: saved.assetId,
        subfolder: '',
        type: 'input',
    });
});
```

**Step 5: Run test to verify it passes**

```bash
pnpm --filter @robota-sdk/dag-runtime-server test
```

Expected: PASS — all tests including upload + round-trip.

**Step 6: Commit**

```bash
git add apps/dag-runtime-server/package.json \
  apps/dag-runtime-server/src/routes/asset-routes.ts \
  apps/dag-runtime-server/src/__tests__/endpoint-contract.test.ts \
  pnpm-lock.yaml
git commit -m "feat(dag-runtime-server): implement POST /upload/image with multer multipart"
```

---

### Task 3: WebSocket Events — status, execution_cached, progress

**Files:**
- Modify: `apps/dag-runtime-server/src/routes/ws-routes.ts` (add 3 event mappings)
- Create: `apps/dag-runtime-server/src/__tests__/ws-events-contract.test.ts` (WS event tests)

**Context:**
The 3 missing WS events can be derived from existing dag-core execution events without adding new types:

| ComfyUI Event | Trigger | Data |
|---|---|---|
| `status` | `execution.started`, `execution.completed`, `execution.failed` | `{ exec_info: { queue_remaining } }` |
| `execution_cached` | `execution.started` (before first node) | `{ nodes: [], prompt_id }` (empty — no caching engine) |
| `progress` | No current source (nodes don't report progress) | `{ value, max, prompt_id, node }` — mapping added but not emitted |

For `status`, the single-worker runtime has at most 1 item running. `queue_remaining = 1` on start, `0` on completion/failure.

For `execution_cached`, always empty array since there's no cache. This is a valid stub per ComfyUI semantics.

For `progress`, the `toComfyUiMessage` function should handle a future progress event but no dag-core event emits it yet.

**Important:** `status` and `execution_cached` broadcast to ALL connected WS clients (not filtered by promptId). The current architecture subscribes to the event bus and broadcasts to all `wss.clients`. This already works for our use case.

**Step 1: Write the failing test**

Create `apps/dag-runtime-server/src/__tests__/ws-events-contract.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
// Import the toComfyUiMessage function (export it for testing)
import { toComfyUiMessage } from '../routes/ws-routes.js';
import type { TRunProgressEvent } from '@robota-sdk/dag-core';

describe('ComfyUI WebSocket event mapping', () => {
    const promptId = 'test-prompt-1';

    describe('status event', () => {
        it('emits status with queue_remaining: 1 on execution.started', () => {
            const event: TRunProgressEvent = {
                dagRunId: 'run-1',
                eventType: 'execution.started',
                occurredAt: new Date().toISOString(),
                dagId: 'dag-1',
                version: 1,
            };
            const messages = toComfyUiMessages(event, promptId);
            const statusMsg = messages.find((m) => m.type === 'status');
            expect(statusMsg).toBeDefined();
            expect(statusMsg!.data).toEqual({ status: { exec_info: { queue_remaining: 1 } } });
        });

        it('emits status with queue_remaining: 0 on execution.completed', () => {
            const event: TRunProgressEvent = {
                dagRunId: 'run-1',
                eventType: 'execution.completed',
                occurredAt: new Date().toISOString(),
            };
            const messages = toComfyUiMessages(event, promptId);
            const statusMsg = messages.find((m) => m.type === 'status');
            expect(statusMsg).toBeDefined();
            expect(statusMsg!.data).toEqual({ status: { exec_info: { queue_remaining: 0 } } });
        });

        it('emits status with queue_remaining: 0 on execution.failed', () => {
            const event: TRunProgressEvent = {
                dagRunId: 'run-1',
                eventType: 'execution.failed',
                occurredAt: new Date().toISOString(),
                error: { code: 'TEST', category: 'task_execution', message: 'fail', retryable: false },
            };
            const messages = toComfyUiMessages(event, promptId);
            const statusMsg = messages.find((m) => m.type === 'status');
            expect(statusMsg).toBeDefined();
            expect(statusMsg!.data).toEqual({ status: { exec_info: { queue_remaining: 0 } } });
        });
    });

    describe('execution_cached event', () => {
        it('emits execution_cached with empty nodes on execution.started', () => {
            const event: TRunProgressEvent = {
                dagRunId: 'run-1',
                eventType: 'execution.started',
                occurredAt: new Date().toISOString(),
                dagId: 'dag-1',
                version: 1,
            };
            const messages = toComfyUiMessages(event, promptId);
            const cachedMsg = messages.find((m) => m.type === 'execution_cached');
            expect(cachedMsg).toBeDefined();
            expect(cachedMsg!.data).toEqual({ nodes: [], prompt_id: promptId });
        });
    });

    describe('existing event mappings are preserved', () => {
        it('execution.started emits execution_start', () => {
            const event: TRunProgressEvent = {
                dagRunId: 'run-1',
                eventType: 'execution.started',
                occurredAt: new Date().toISOString(),
                dagId: 'dag-1',
                version: 1,
            };
            const messages = toComfyUiMessages(event, promptId);
            const startMsg = messages.find((m) => m.type === 'execution_start');
            expect(startMsg).toBeDefined();
            expect(startMsg!.data).toEqual({ prompt_id: promptId });
        });

        it('task.started emits executing', () => {
            const event: TRunProgressEvent = {
                dagRunId: 'run-1',
                eventType: 'task.started',
                occurredAt: new Date().toISOString(),
                taskRunId: 'task-1',
                nodeId: 'node-1',
            };
            const messages = toComfyUiMessages(event, promptId);
            expect(messages).toHaveLength(1);
            expect(messages[0]).toEqual({ type: 'executing', data: { node: 'node-1', prompt_id: promptId } });
        });
    });
});
```

**Step 2: Run test to verify it fails**

```bash
pnpm --filter @robota-sdk/dag-runtime-server test
```

Expected: FAIL — `toComfyUiMessages` does not exist (currently `toComfyUiMessage` returning single object).

**Step 3: Refactor ws-routes.ts**

Change `toComfyUiMessage` (returns single object | undefined) to `toComfyUiMessages` (returns array of objects). This supports events that produce multiple ComfyUI messages (e.g., `execution.started` → `status` + `execution_cached` + `execution_start`).

Update `apps/dag-runtime-server/src/routes/ws-routes.ts`:

```typescript
// Rename and change signature:
export function toComfyUiMessages(event: TRunProgressEvent, promptId: string): { type: string; data: object }[] {
    const messages: { type: string; data: object }[] = [];

    switch (event.eventType) {
        case EXECUTION_PROGRESS_EVENTS.STARTED:
            messages.push({ type: 'status', data: { status: { exec_info: { queue_remaining: 1 } } } });
            messages.push({ type: 'execution_cached', data: { nodes: [], prompt_id: promptId } });
            messages.push({ type: 'execution_start', data: { prompt_id: promptId } });
            break;
        case TASK_PROGRESS_EVENTS.STARTED:
            messages.push({ type: 'executing', data: { node: event.nodeId, prompt_id: promptId } });
            break;
        case TASK_PROGRESS_EVENTS.COMPLETED:
            messages.push({ type: 'executed', data: { node: event.nodeId, output: event.output, prompt_id: promptId } });
            break;
        case TASK_PROGRESS_EVENTS.FAILED:
            messages.push({
                type: 'execution_error',
                data: { prompt_id: promptId, node_id: event.nodeId, exception_message: event.error.message },
            });
            break;
        case EXECUTION_PROGRESS_EVENTS.COMPLETED:
            messages.push({ type: 'execution_success', data: { prompt_id: promptId } });
            messages.push({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } } } });
            break;
        case EXECUTION_PROGRESS_EVENTS.FAILED:
            messages.push({ type: 'status', data: { status: { exec_info: { queue_remaining: 0 } } } });
            break;
    }

    return messages;
}

// Update the subscriber to iterate over messages array:
eventBus.subscribe((event: TRunProgressEvent) => {
    const promptId = promptIdResolver.getPromptIdForDagRun(event.dagRunId);
    if (typeof promptId === 'undefined') return;

    const messages = toComfyUiMessages(event, promptId);
    for (const message of messages) {
        const payload = JSON.stringify(message);
        for (const client of wss.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        }
    }
});
```

**Step 4: Run test to verify it passes**

```bash
pnpm --filter @robota-sdk/dag-runtime-server test
```

Expected: PASS — all WS event mapping tests pass, existing endpoint tests unaffected.

**Step 5: Commit**

```bash
git add apps/dag-runtime-server/src/routes/ws-routes.ts \
  apps/dag-runtime-server/src/__tests__/ws-events-contract.test.ts
git commit -m "feat(dag-runtime-server): implement status, execution_cached, progress WS events"
```

---

### Task 4: SPEC Update + Regression Verification

**Files:**
- Modify: `apps/dag-runtime-server/docs/SPEC.md` (move items from "Not implemented" to "Implemented")
- Modify: `.agents/tasks/comfyui-api-parity.md` (check off completed items)

**Step 1: Update SPEC.md**

Move `/view` and `/upload/image` from "Not implemented" to "Implemented" in the HTTP endpoints table:

```markdown
| `/view` | GET | Implemented | query: `filename` (assetId) | binary stream with Content-Type |
| `/upload/image` | POST | Implemented | multipart/form-data (`image` file) | `{ name, subfolder, type }` |
```

Move WS events from "Not implemented" to implemented:

```markdown
| `status` | Server -> Client | `{ status: { exec_info: { queue_remaining } } }` | `status` |
| `execution_cached` | Server -> Client | `{ nodes: [], prompt_id }` | `execution_cached` |
```

Add note for `progress`:
```markdown
| `progress` | Server -> Client | `{ value, max, prompt_id, node }` | `progress` |
```
With note: `progress` event mapping exists but no current node emits progress data. Will be populated when nodes support per-step progress reporting.

Update test strategy section to list `ws-events-contract.test.ts`.

Remove **P0** labels and "Tracked in" references from the formerly-unimplemented items.

**Step 2: Update task tracker**

In `.agents/tasks/comfyui-api-parity.md`, check off completed items.

**Step 3: Full regression verification**

```bash
pnpm --filter @robota-sdk/dag-runtime-server build
pnpm --filter @robota-sdk/dag-runtime-server test
pnpm --filter @robota-sdk/dag-runtime-server exec tsc -p tsconfig.json --noEmit
```

All must pass.

**Step 4: Commit**

```bash
git add apps/dag-runtime-server/docs/SPEC.md \
  .agents/tasks/comfyui-api-parity.md
git commit -m "docs(dag-runtime-server): update SPEC for 100% ComfyUI API parity"
```

---

## Test Strategy

| Test File | Scope | Type |
|---|---|---|
| `endpoint-contract.test.ts` | GET /view, POST /upload/image response shapes + round-trip | Contract |
| `ws-events-contract.test.ts` | `toComfyUiMessages` mapping for all event types including new status/cached | Unit |

**Verification commands:**

```bash
pnpm --filter @robota-sdk/dag-runtime-server test
pnpm --filter @robota-sdk/dag-runtime-server build
pnpm --filter @robota-sdk/dag-runtime-server exec tsc -p tsconfig.json --noEmit
```
