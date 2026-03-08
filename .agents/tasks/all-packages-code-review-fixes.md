# All Packages Code Review Fixes

## Status: pending

## Priority: high

## Review Summary (2026-03-08)

| Package | MUST | SHOULD | CONSIDER | NIT |
|---------|------|--------|----------|-----|
| dag-core | 2 | 5 | 5 | 2 |
| dag-runtime | 1 | 3 | 2 | 1 |
| dag-worker | 1 | 3 | 4 | 1 |
| dag-scheduler | 0 | 2 | 2 | 1 |
| dag-projection | 0 | 1 | 2 | 0 |
| dag-api | 1 | 3 | 3 | 1 |
| dag-designer | 0 | 5 | 6 | 2 |
| dag-nodes | 2 | 3 | 4 | 1 |
| remote | 11 | 7 | 1 | 1 |
| playground | 11 | 10 | 3 | 1 |
| sessions | 2 | 4 | 1 | 1 |
| team | 1 | 3 | 2 | 1 |
| **Total** | **32** | **49** | **35** | **13** |

---

## Phase 1: MUST fixes — dag-* packages (8 items)

### dag-core
1. `types/domain.ts:114` — `configSchema?: object` → `configSchema?: Record<string, unknown>`
2. `utils/node-descriptor.ts:13` — `buildConfigSchema` throws instead of returning `TResult`. Convert to Result pattern.

### dag-runtime
3. `services/run-orchestrator-service.ts:390` — `parsed as IDagDefinition` blind cast. Add structural validation before assertion.

### dag-worker
4. `services/worker-loop-service.ts:710` — Same `parsed as IDagDefinition` blind cast. Same fix.

### dag-api
5. `composition/run-progress-event-bus.ts:17` — Silent listener removal on error violates no-fallback policy. Surface error instead of swallowing.

### dag-nodes
6. `gemini-image-edit/src/runtime-core.ts:171,233` — Non-null assertions `provider.editImage!()`. Store method reference from capability check.
7. `llm-text-openai/src/index.ts:49` — `process.env.OPENAI_API_KEY` read at constructor time creates temporal coupling. Defer to execution time. Same in gemini/seedance.

---

## Phase 2: MUST fixes — remote (11 items)

All in `packages/remote/src/`:
1. `client/http-client.ts:100-107` — `as IBasicMessage & { toolCalls? }` unsafe casts (2 locations)
2. `client/http-client.ts:121,124,150,252,280,300` — Multiple `as T` casts on parsed JSON/fetch responses without validation (6 locations)
3. `server/websocket-transport-simple.ts:76` — `event.data as string` without typeof guard
4. `server/websocket-transport-simple.ts:125,137` — Unsound generic casts on send() return

---

## Phase 3: MUST fixes — playground (11 items)

1. `remote-injection.ts:534` — `new Function()` eval risk (document security boundary)
2. `remote-injection.ts:534-543` — Fallback mock executor violates no-fallback policy
3. `robota-executor.ts:625,700` — `as TUniversalMessage` casts (2 locations)
4. `execution-subscriber.ts:87-91,107,178,302` — `as IEventEmitterHierarchicalEventData` casts (5 locations)
5. `use-playground-statistics.ts:107` — `as PlaygroundExecutor | null` cast
6. `playground-context.tsx:252` — `as IVisualizationData` cast in reducer
7. `llm-tracker.ts:234` — `as IRealTimeBlockMetadata` downcast

---

## Phase 4: MUST fixes — sessions + team (3 items)

### sessions
1. `session-manager.ts:84` — `as Robota` unchecked cast. Add instanceof check.
2. `chat-instance.ts` — Misleading `readonly` on mutated metadata/config. Remove readonly or use internal mutable copies.

### team
3. `relay-assign-task.ts:153` — `aiProviders: []` creates agent with no providers. Source from context.

---

## Phase 5: SHOULD fixes — dag-* (17 items)

### dag-core
- `definition-service.ts:161-167` — Document version increment behavior on publish
- `testing/in-memory-lease-port.ts` — Use IClockPort instead of Date.now()
- `definition-validator.ts` — 476 lines, extract edge validation
- `node-io-accessor.ts` — 355 lines, extract binary parsing

### dag-runtime
- `run-orchestrator-service.ts:30` — Empty `ICreateRunInput extends IStartRunInput` (1:1 alias)
- `run-orchestrator-service.ts:111-138` — Misleading "enqueue error" message for storage failure
- `run-orchestrator-service.ts:269-306` — Orphaned queued tasks on partial enqueue failure

### dag-worker
- `worker-loop-service.ts` — 869 lines, decompose into focused modules
- `worker-loop-service.ts:347-353` — timeoutMs in payload pollutes TPortPayload namespace
- `worker-loop-service.ts:356-403` — Timeout doesn't abort underlying executor

### dag-scheduler
- `scheduler-trigger-service.ts:7` — Sibling dependency on dag-runtime (violates direction rule)
- `scheduler-trigger-service.ts:58-69` — No partial progress reporting on batch failure

### dag-projection
- `projection-read-model-service.ts:84-86` — ITaskStatusSummary keys not enforced against TTaskRunStatus

### dag-api
- `design-api.ts:73-89` — Lease category gets 400 instead of 409
- `dag-design-controller.ts:15` — Duplicate import statement
- `dag-design-controller.ts:36` — `.error.map()` assumes error is array

---

## Phase 6: SHOULD fixes — remote + playground + sessions + team (24 items)

### remote (7)
- `http-transport.ts:106` — response.json() unvalidated
- `http-transport.ts:189-190` — Empty catch in SSE parser
- `shared/types.ts:33,54` — Overly loose tool schema type
- `websocket-utils.ts:108` — Partial WebSocket message validation
- `transformers.ts:112` — Fallback logic in extractContent
- `remote-server.ts:113` — Request body not schema-validated
- `transformers.ts:151-156` — safeJsonParse gives false type safety

### playground (10)
- `remote-injection.ts:249-462` — 200 lines of untyped JS string injection
- `project-manager.ts:59-69` — Singleton pattern violates DI
- `use-block-tracking.ts:142` — Non-null assertions on first render
- `use-robota-execution.ts:82` — Typo: executionTimeouRef
- `use-robota-execution.ts:129` — Reference equality for object comparison
- `code-executor.ts:130-134` — Artificial simulateDelay
- `playground-context.tsx:396-430` — Fallback conversion path for events
- 6 files — Deprecated `.substr()` usage
- `robota-executor.ts:343,467` — Hardcoded 'openai'/'gpt-4' in stats
- `use-websocket-connection.ts:361` — Simulated ping/pong

### sessions (4)
- `session-manager.ts:244,251` — Deprecated `.substr()`
- `session-manager.ts:244,251` — Math.random() for IDs, use crypto.randomUUID()
- `chat-instance.ts:31` — Hardcoded TemplateManagerAdapter violates DI
- `chat-instance.ts:136-147` — save()/load() always throw

### team (3)
- `relay-assign-task.ts:5` — `TemplateEntry` → `TTemplateEntry` naming
- `relay-assign-task.ts:15` — Unvalidated JSON cast
- `relay-assign-task.ts:143` — Unchecked ownerPath element types

---

## Phase 7: SHOULD fixes — dag-designer (5 items)

- `dag-designer-canvas.tsx` — 1270 lines, split state management and canvas
- `node-config-panel.tsx` — 816 lines, extract sub-components
- Duplicated `isNodeConfigValue` in node-config-panel and schema-defaults
- Duplicated `findPort`/`resolveInputPort` across 3 files
- Zero test coverage for entire package

---

## Execution Order

1. **Phase 1** (dag-* MUST) — structural safety, Result pattern compliance
2. **Phase 2** (remote MUST) — type safety at network boundaries
3. **Phase 3** (playground MUST) — type casts, fallback elimination
4. **Phase 4** (sessions + team MUST) — runtime correctness
5. **Phase 5** (dag-* SHOULD) — architecture, decomposition
6. **Phase 6** (other SHOULD) — validation, DI, deprecated APIs
7. **Phase 7** (dag-designer SHOULD) — large file decomposition, dedup

CONSIDER and NIT items are documented above for future reference but not prioritized.

## Acceptance Criteria

- Zero MUST findings remaining
- `pnpm build` passes with 0 errors
- `pnpm test` passes all existing tests
- No new `any` or unsafe casts introduced
