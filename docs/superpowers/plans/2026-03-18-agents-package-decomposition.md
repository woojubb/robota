# Agents Package Decomposition Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split `@robota-sdk/agent-core` into 12 focused packages while keeping all tests passing.

**Architecture:** Extract tools, event-service, and 9 plugins into independent packages. Each new package declares `@robota-sdk/agent-core` as `peerDependency`. No re-exports from agents.

**Tech Stack:** TypeScript, pnpm workspaces, tsup, vitest

**Spec:** `docs/superpowers/specs/2026-03-18-agents-package-decomposition-design.md`

---

## Chunk 1: Scaffold All 12 Packages

### Task 1: Create package scaffolding script

All 12 packages share identical scaffolding. This task creates them all at once.

**Files:**

- Create: `packages/tools/package.json`
- Create: `packages/tools/tsconfig.json`
- Create: `packages/tools/src/index.ts`
- Create: `packages/tool-mcp/package.json`
- Create: `packages/tool-mcp/tsconfig.json`
- Create: `packages/tool-mcp/src/index.ts`
- Create: `packages/event-service/package.json`
- Create: `packages/event-service/tsconfig.json`
- Create: `packages/event-service/src/index.ts`
- Create: `packages/plugin-conversation-history/package.json`
- Create: `packages/plugin-conversation-history/tsconfig.json`
- Create: `packages/plugin-conversation-history/src/index.ts`
- Create: `packages/plugin-error-handling/package.json`
- Create: `packages/plugin-error-handling/tsconfig.json`
- Create: `packages/plugin-error-handling/src/index.ts`
- Create: `packages/plugin-event-emitter/package.json`
- Create: `packages/plugin-event-emitter/tsconfig.json`
- Create: `packages/plugin-event-emitter/src/index.ts`
- Create: `packages/plugin-execution-analytics/package.json`
- Create: `packages/plugin-execution-analytics/tsconfig.json`
- Create: `packages/plugin-execution-analytics/src/index.ts`
- Create: `packages/plugin-limits/package.json`
- Create: `packages/plugin-limits/tsconfig.json`
- Create: `packages/plugin-limits/src/index.ts`
- Create: `packages/plugin-logging/package.json`
- Create: `packages/plugin-logging/tsconfig.json`
- Create: `packages/plugin-logging/src/index.ts`
- Create: `packages/plugin-performance/package.json`
- Create: `packages/plugin-performance/tsconfig.json`
- Create: `packages/plugin-performance/src/index.ts`
- Create: `packages/plugin-usage/package.json`
- Create: `packages/plugin-usage/tsconfig.json`
- Create: `packages/plugin-usage/src/index.ts`
- Create: `packages/plugin-webhook/package.json`
- Create: `packages/plugin-webhook/tsconfig.json`
- Create: `packages/plugin-webhook/src/index.ts`

- [ ] **Step 1: Create all 12 package.json files**

Each package.json follows this template (adjust `name`, `description`, `peerDependencies` per package):

```json
{
  "name": "@robota-sdk/{pkg-name}",
  "version": "3.0.0",
  "description": "{description}",
  "type": "module",
  "main": "dist/node/index.js",
  "types": "dist/node/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/node/index.d.ts",
      "node": {
        "import": "./dist/node/index.js",
        "require": "./dist/node/index.cjs"
      },
      "default": {
        "import": "./dist/node/index.js",
        "require": "./dist/node/index.cjs"
      }
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts --out-dir dist/node --clean",
    "test": "vitest run --passWithNoTests",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/ --ext .ts,.tsx",
    "lint:fix": "eslint src/ --ext .ts,.tsx --fix",
    "clean": "rimraf dist"
  },
  "peerDependencies": {
    "@robota-sdk/agent-core": "workspace:*"
  },
  "devDependencies": {
    "@robota-sdk/agent-core": "workspace:*",
    "rimraf": "^5.0.5",
    "tsup": "^8.0.1",
    "typescript": "^5.3.3",
    "vitest": "^1.6.1"
  },
  "license": "MIT"
}
```

**Per-package overrides:**

| Package                       | Extra peerDependencies                                                          | Extra dependencies                                  |
| ----------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------- |
| `tools`                       | `zod: "^3.24.0"`                                                                | —                                                   |
| `tool-mcp`                    | `@robota-sdk/agent-tools: "workspace:*"`, `@modelcontextprotocol/sdk: "^1.0.0"` | —                                                   |
| `event-service`               | —                                                                               | —                                                   |
| `plugin-conversation-history` | —                                                                               | —                                                   |
| `plugin-error-handling`       | —                                                                               | —                                                   |
| `plugin-event-emitter`        | —                                                                               | —                                                   |
| `plugin-execution-analytics`  | —                                                                               | —                                                   |
| `plugin-limits`               | —                                                                               | —                                                   |
| `plugin-logging`              | —                                                                               | —                                                   |
| `plugin-performance`          | —                                                                               | —                                                   |
| `plugin-usage`                | —                                                                               | `jssha: "^3.3.1"` (if usage tracking needs hashing) |
| `plugin-webhook`              | —                                                                               | —                                                   |

- [ ] **Step 2: Create all 12 tsconfig.json files**

Each identical:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src",
    "composite": false,
    "declaration": true,
    "declarationMap": true,
    "downlevelIteration": true,
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules"]
}
```

- [ ] **Step 3: Create all 12 empty src/index.ts files**

Each starts with a placeholder export:

```typescript
// @robota-sdk/{pkg-name} — placeholder until source files are moved
export {};
```

- [ ] **Step 4: Verify workspace resolves all packages**

Run: `pnpm install`
Expected: All 12 new packages discovered (pnpm-workspace.yaml already has `packages/*`)

- [ ] **Step 5: Verify all packages build**

Run: `pnpm build`
Expected: All packages build successfully (empty packages produce empty dist)

- [ ] **Step 6: Commit**

```bash
git add packages/tools packages/tool-mcp packages/event-service packages/plugin-*
git commit -m "chore: scaffold 12 new packages for agents decomposition"
```

---

## Chunk 2: Extract event-service

Event service has zero dependencies on other extracted packages, so it moves first.

### Task 2: Move event-service source files

**Files:**

- Move: `packages/agents/src/services/event-service.ts` → `packages/event-service/src/event-service.ts`
- Move: `packages/agents/src/services/event-service.test.ts` → `packages/event-service/src/__tests__/event-service.test.ts`
- Move: `packages/agents/src/services/event-context.test.ts` → `packages/event-service/src/__tests__/event-context.test.ts`
- Move: `packages/agents/src/services/task-events.ts` → `packages/event-service/src/task-events.ts`
- Move: `packages/agents/src/services/user-events.ts` → `packages/event-service/src/user-events.ts`
- Modify: `packages/event-service/src/index.ts`
- Modify: `packages/agents/src/index.ts` (remove event-service exports)
- Modify: `packages/agents/src/services/index.ts` (remove event-service re-export)

- [ ] **Step 1: Copy source files to event-service package**

```bash
cp packages/agents/src/services/event-service.ts packages/event-service/src/event-service.ts
cp packages/agents/src/services/task-events.ts packages/event-service/src/task-events.ts
cp packages/agents/src/services/user-events.ts packages/event-service/src/user-events.ts
mkdir -p packages/event-service/src/__tests__
cp packages/agents/src/services/event-service.test.ts packages/event-service/src/__tests__/event-service.test.ts
cp packages/agents/src/services/event-context.test.ts packages/event-service/src/__tests__/event-context.test.ts
```

- [ ] **Step 2: Update import paths in copied files**

In `event-service.ts`, change any `../interfaces` or `../abstracts` imports to `@robota-sdk/agent-core`:

```typescript
// Before
import { IEventService } from '../interfaces/event-service';
// After
import { IEventService } from '@robota-sdk/agent-core';
```

Apply same pattern to all moved files. Test files update their relative imports to `../event-service` etc.

- [ ] **Step 3: Update event-service/src/index.ts**

```typescript
export {
  IEventContext,
  IOwnerPathSegment,
  AbstractEventService,
  DEFAULT_ABSTRACT_EVENT_SERVICE,
  isDefaultEventService,
  bindEventServiceOwner,
  bindWithOwnerPath,
  DefaultEventService,
  StructuredEventService,
  ObservableEventService,
  composeEventName,
} from './event-service';
export type { IEventService, TEventListener, IBaseEventData } from './event-service';
export { TASK_EVENTS, TASK_EVENT_PREFIX } from './task-events';
export { USER_EVENTS, USER_EVENT_PREFIX } from './user-events';
```

- [ ] **Step 4: Verify event-service builds and tests pass**

Run: `pnpm --filter @robota-sdk/agent-event-service build && pnpm --filter @robota-sdk/agent-event-service test`
Expected: Build succeeds, tests pass

- [ ] **Step 5: Remove source files from agents**

Delete the original files from `packages/agents/src/services/`:

- `event-service.ts`
- `event-service.test.ts`
- `event-context.test.ts`
- `task-events.ts`
- `user-events.ts`

- [ ] **Step 6: Update agents/src/index.ts**

Replace event-service exports with re-imports from `@robota-sdk/agent-event-service`:

**Remove these lines (approximately lines 344-380):**

```typescript
export { IEventContext, ... } from './services/event-service';
export { TASK_EVENTS, TASK_EVENT_PREFIX } from './services/task-events';
export { USER_EVENTS, USER_EVENT_PREFIX } from './services/user-events';
```

**Do NOT re-export from event-service** (Decision 1: no re-exports).

- [ ] **Step 7: Add @robota-sdk/agent-event-service as devDependency to agents**

Update `packages/agents/package.json`:

```json
"devDependencies": {
  "@robota-sdk/agent-event-service": "workspace:*",
  ...
}
```

- [ ] **Step 8: Update agents internal imports**

Any file in `packages/agents/src/` that imports from `./services/event-service` or `./services/task-events` or `./services/user-events` must now import from `@robota-sdk/agent-event-service`.

Search: `grep -r "from.*services/event-service\|from.*services/task-events\|from.*services/user-events" packages/agents/src/ --include="*.ts" -l`

Update each file found.

- [ ] **Step 9: Verify agents still builds and tests pass**

Run: `pnpm --filter @robota-sdk/agent-core build && pnpm --filter @robota-sdk/agent-core test`
Expected: Build succeeds, all remaining tests pass

- [ ] **Step 10: Commit**

```bash
git add packages/event-service packages/agents
git commit -m "refactor: extract @robota-sdk/agent-event-service from agents"
```

---

## Chunk 3: Extract tools and tool-mcp

### Task 3: Move tools source files

**Files:**

- Move: `packages/agents/src/tools/registry/tool-registry.ts` → `packages/tools/src/registry/tool-registry.ts`
- Move: `packages/agents/src/tools/implementations/function-tool.ts` → `packages/tools/src/implementations/function-tool.ts`
- Move: `packages/agents/src/tools/implementations/function-tool/` → `packages/tools/src/implementations/function-tool/`
- Move: `packages/agents/src/tools/implementations/openapi-tool.ts` → `packages/tools/src/implementations/openapi-tool.ts`
- Move test files correspondingly
- Modify: `packages/tools/src/index.ts`
- Modify: `packages/agents/src/index.ts`

- [ ] **Step 1: Copy tools source files**

```bash
mkdir -p packages/tools/src/registry packages/tools/src/implementations packages/tools/src/__tests__
cp packages/agents/src/tools/registry/tool-registry.ts packages/tools/src/registry/
cp packages/agents/src/tools/implementations/function-tool.ts packages/tools/src/implementations/
cp -r packages/agents/src/tools/implementations/function-tool packages/tools/src/implementations/
cp packages/agents/src/tools/implementations/openapi-tool.ts packages/tools/src/implementations/
```

Copy test files similarly.

- [ ] **Step 2: Update import paths**

Change `../interfaces`, `../abstracts` imports to `@robota-sdk/agent-core`.

- [ ] **Step 3: Write tools/src/index.ts**

```typescript
export { ToolRegistry } from './registry/tool-registry';
export {
  FunctionTool,
  createFunctionTool,
  createZodFunctionTool,
} from './implementations/function-tool';
export { OpenAPITool } from './implementations/openapi-tool';
export { zodToJsonSchema } from './implementations/function-tool/schema-converter';
```

- [ ] **Step 4: Verify tools builds and tests pass**

Run: `pnpm --filter @robota-sdk/agent-tools build && pnpm --filter @robota-sdk/agent-tools test`

- [ ] **Step 5: Commit**

```bash
git add packages/tools
git commit -m "refactor: extract @robota-sdk/agent-tools from agents"
```

### Task 4: Move tool-mcp source files

**Files:**

- Move: `packages/agents/src/tools/implementations/mcp-tool.ts` → `packages/tool-mcp/src/mcp-tool.ts`
- Move: `packages/agents/src/tools/implementations/relay-mcp-tool.ts` → `packages/tool-mcp/src/relay-mcp-tool.ts`
- Modify: `packages/tool-mcp/src/index.ts`

- [ ] **Step 1: Copy MCP tool files**

```bash
cp packages/agents/src/tools/implementations/mcp-tool.ts packages/tool-mcp/src/
cp packages/agents/src/tools/implementations/relay-mcp-tool.ts packages/tool-mcp/src/
```

- [ ] **Step 2: Update imports to use @robota-sdk/agent-core and @robota-sdk/agent-tools**

- [ ] **Step 3: Write tool-mcp/src/index.ts**

```typescript
export { MCPTool } from './mcp-tool';
export { RelayMcpTool, type IRelayMcpOptions, type IRelayMcpContext } from './relay-mcp-tool';
```

- [ ] **Step 4: Verify tool-mcp builds**

Run: `pnpm --filter @robota-sdk/agent-tool-mcp build`

- [ ] **Step 5: Remove all tools/ from agents**

Delete `packages/agents/src/tools/` directory entirely.

- [ ] **Step 6: Update agents/src/index.ts**

Remove all tool exports (ToolRegistry, FunctionTool, createFunctionTool, createZodFunctionTool, RelayMcpTool lines).

- [ ] **Step 7: Update agents internal imports**

Search: `grep -r "from.*tools/" packages/agents/src/ --include="*.ts" -l`

Files that import ToolRegistry or FunctionTool internally (like tool-manager.ts, tool-execution-service.ts) must import from `@robota-sdk/agent-tools`.

Add to agents devDependencies:

```json
"@robota-sdk/agent-tools": "workspace:*",
"@robota-sdk/agent-tool-mcp": "workspace:*"
```

- [ ] **Step 8: Verify agents builds and tests pass**

Run: `pnpm --filter @robota-sdk/agent-core build && pnpm --filter @robota-sdk/agent-core test`

- [ ] **Step 9: Commit**

```bash
git add packages/tool-mcp packages/agents
git commit -m "refactor: extract @robota-sdk/agent-tool-mcp from agents"
```

---

## Chunk 4: Extract 9 Plugin Packages

Each plugin follows the same extraction pattern. Process them in this order to handle any cross-references: event-emitter, limits, error-handling, execution-analytics, logging, conversation-history, usage, performance, webhook.

### Task 5-13: Extract each plugin (repeat per plugin)

For each plugin in the list above, follow this procedure:

- [ ] **Step 1: Identify source files**

Use this mapping:

| Plugin                      | Source dir                      | Extra root files                  |
| --------------------------- | ------------------------------- | --------------------------------- |
| plugin-event-emitter        | `plugins/event-emitter/`        | `plugins/event-emitter-plugin.ts` |
| plugin-limits               | `plugins/limits/`               | `plugins/limits-plugin.ts`        |
| plugin-error-handling       | `plugins/error-handling/`       | —                                 |
| plugin-execution-analytics  | `plugins/execution/`            | —                                 |
| plugin-logging              | `plugins/logging/`              | —                                 |
| plugin-conversation-history | `plugins/conversation-history/` | —                                 |
| plugin-usage                | `plugins/usage/`                | —                                 |
| plugin-performance          | `plugins/performance/`          | —                                 |
| plugin-webhook              | `plugins/webhook/`              | —                                 |

- [ ] **Step 2: Copy all files from source dir to new package src/**

```bash
cp -r packages/agents/src/plugins/{plugin-dir}/* packages/{plugin-pkg}/src/
```

Move test files to `src/__tests__/`.

- [ ] **Step 3: Update imports**

Change all `../../interfaces`, `../../abstracts`, `../` imports to `@robota-sdk/agent-core`.

- [ ] **Step 4: Write index.ts**

Export the plugin class, types, and storages.

- [ ] **Step 5: Verify build and tests**

Run: `pnpm --filter @robota-sdk/{plugin-pkg} build && pnpm --filter @robota-sdk/{plugin-pkg} test`

- [ ] **Step 6: Commit**

```bash
git add packages/{plugin-pkg}
git commit -m "refactor: extract @robota-sdk/{plugin-pkg} from agents"
```

After all 9 plugins are extracted:

- [ ] **Step 7: Remove all plugins/ from agents**

Delete `packages/agents/src/plugins/` directory entirely.

- [ ] **Step 8: Update agents/src/index.ts**

Remove all plugin exports (lines 230-253, 369-372 approximately).

- [ ] **Step 9: Add all plugin packages as devDependencies in agents**

- [ ] **Step 10: Verify agents builds and tests pass**

Run: `pnpm --filter @robota-sdk/agent-core build && pnpm --filter @robota-sdk/agent-core test`

- [ ] **Step 11: Commit**

```bash
git add packages/agents
git commit -m "refactor: remove extracted plugins from agents, update exports"
```

---

## Chunk 5: Update Consumers and Final Verification

### Task 14: Update consumer import paths

**Files:**

- Modify: All files in `apps/` and `packages/` that import extracted symbols from `@robota-sdk/agent-core`

- [ ] **Step 1: Find all affected consumers**

```bash
# Find imports of extracted symbols across the monorepo (excluding agents itself)
grep -r "from '@robota-sdk/agent-core'" packages/ apps/ --include="*.ts" --include="*.tsx" -l | grep -v "packages/agents/"
```

- [ ] **Step 2: For each consumer file, update imports**

Consult the Import Path Migration Guide in the spec. Key changes:

```typescript
// Before
import { FunctionTool, LoggingPlugin, EventService } from '@robota-sdk/agent-core';

// After
import { FunctionTool } from '@robota-sdk/agent-tools';
import { LoggingPlugin } from '@robota-sdk/agent-plugin-logging';
import { EventService } from '@robota-sdk/agent-event-service';
```

- [ ] **Step 3: Add new packages as dependencies in consumer package.json files**

For each consumer that imports from a new package, add it to `dependencies` (or `devDependencies` if test-only).

- [ ] **Step 4: Verify monorepo-wide typecheck**

Run: `pnpm typecheck`
Expected: Zero type errors

- [ ] **Step 5: Commit**

```bash
git add apps/ packages/
git commit -m "refactor: update consumer imports for agents decomposition"
```

### Task 15: Remove empty directory and templates

- [ ] **Step 1: Remove agents/src/templates/ (empty directory)**

```bash
rm -rf packages/agents/src/templates
```

- [ ] **Step 2: Remove legacy stubs**

If `plugins/event-emitter-plugin.ts` and `plugins/limits-plugin.ts` still exist at `agents/src/plugins/` root, delete them.

- [ ] **Step 3: Commit**

```bash
git add packages/agents
git commit -m "chore: remove empty directories and legacy stubs from agents"
```

### Task 16: Create SPEC.md for each new package

- [ ] **Step 1: Create docs/SPEC.md for each of the 12 new packages**

Use `.agents/templates/spec-template.md` as the template. Fill in Scope, Boundaries, Architecture, Type Ownership, Public API Surface, Test Strategy sections.

Each SPEC.md should be concise (the packages are small and focused).

- [ ] **Step 2: Verify harness scan**

Run: `pnpm harness:scan`
Expected: All new packages detected with valid SPEC.md

- [ ] **Step 3: Commit**

```bash
git add packages/*/docs/SPEC.md
git commit -m "docs: add SPEC.md for all 12 extracted packages"
```

### Task 17: Final verification

- [ ] **Step 1: Full build**

Run: `pnpm build`
Expected: All packages build

- [ ] **Step 2: Full typecheck**

Run: `pnpm typecheck`
Expected: Zero errors

- [ ] **Step 3: Full test suite**

Run: `pnpm test`
Expected: All tests pass

- [ ] **Step 4: Lint**

Run: `pnpm lint`
Expected: No new violations

- [ ] **Step 5: Harness scan**

Run: `pnpm harness:scan`
Expected: Pass

- [ ] **Step 6: Update agents/docs/SPEC.md**

Reduce scope description to reflect that tools, event-service, and plugins have been extracted. Update Type Ownership, Public API Surface, and Class Contract Registry sections.

- [ ] **Step 7: Final commit**

```bash
git add .
git commit -m "chore: complete agents package decomposition (12 packages extracted)"
```

### Task 18: Update project documentation

- [ ] **Step 1: Update .agents/project-structure.md**

Add all 12 new packages with their descriptions and dependency directions.

- [ ] **Step 2: Update README.md**

Add new packages to the Project Structure section.

- [ ] **Step 3: Commit**

```bash
git add .agents/project-structure.md README.md
git commit -m "docs: update project structure for agents decomposition"
```
