# Build System 2-Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix intermittent DTS race condition by splitting `pnpm build` into JS-first then DTS-second phases.

**Architecture:** Keep tsup as build tool. Add `build:js` (no DTS) and `build:types` (DTS only) scripts to each package. Root `build` runs them sequentially so all JS is ready before any DTS starts.

**Tech Stack:** tsup (existing), pnpm workspace (existing)

---

## File Map

| File                              | Action | Responsibility                                     |
| --------------------------------- | ------ | -------------------------------------------------- |
| `package.json` (root)             | Modify | Change `build` script to 2-pass                    |
| 39 Pattern 1 `package.json` files | Modify | Add `build:js` and `build:types` scripts           |
| 8 Pattern 2 `package.json` files  | Modify | Add `build:js` and `build:types` scripts           |
| `packages/agent-cli/package.json` | Modify | Add `build:js` and `build:types` scripts (special) |

---

### Task 1: Add build:js and build:types to Pattern 2 packages (tsup config)

**Files:**

- Modify: `packages/agent-core/package.json`
- Modify: `packages/agent-sessions/package.json`
- Modify: `packages/agent-provider-anthropic/package.json`
- Modify: `packages/agent-provider-bytedance/package.json`
- Modify: `packages/agent-provider-google/package.json`
- Modify: `packages/agent-provider-openai/package.json`
- Modify: `packages/agent-team/package.json`
- Modify: `packages/agent-playground/package.json`

- [ ] **Step 1: Add scripts to all 8 packages**

For each of the 8 packages listed above, add two scripts immediately after the existing `"build": "tsup"` line:

```json
"build:js": "tsup --no-dts",
"build:types": "tsup --dts-only",
```

The existing `"build": "tsup"` line must NOT be changed.

- [ ] **Step 2: Verify individual build still works**

Run: `pnpm --filter @robota-sdk/agent-core build`
Expected: Build succeeds (ESM + CJS + DTS as before)

- [ ] **Step 3: Verify build:js produces JS without DTS**

Run: `pnpm --filter @robota-sdk/agent-core build:js`
Expected: ESM + CJS built, no `.d.ts` files generated

- [ ] **Step 4: Verify build:types produces DTS only**

Run: `pnpm --filter @robota-sdk/agent-core build:types`
Expected: `.d.ts` files generated, no JS rebuild

- [ ] **Step 5: Commit**

```bash
git add packages/agent-core/package.json packages/agent-sessions/package.json packages/agent-provider-anthropic/package.json packages/agent-provider-bytedance/package.json packages/agent-provider-google/package.json packages/agent-provider-openai/package.json packages/agent-team/package.json packages/agent-playground/package.json
git commit -m "feat(build): add build:js and build:types scripts to tsup-config packages"
```

---

### Task 2: Add build:js and build:types to Pattern 1 packages (inline tsup)

**Files:**

- Modify: 39 package.json files (see list below)

Packages: agent-event-service, agent-plugin-conversation-history, agent-plugin-error-handling, agent-plugin-event-emitter, agent-plugin-execution-analytics, agent-plugin-limits, agent-plugin-logging, agent-plugin-performance, agent-plugin-usage, agent-plugin-webhook, agent-remote-client, agent-sdk, agent-tool-mcp, agent-tools, agent-transport-headless, agent-transport-http, agent-transport-mcp, agent-transport-ws, dag-adapters-local, dag-api, dag-core, dag-cost, dag-designer, dag-node, dag-nodes/gemini-image-edit, dag-nodes/image-loader, dag-nodes/image-source, dag-nodes/input, dag-nodes/llm-text-openai, dag-nodes/ok-emitter, dag-nodes/seedance-video, dag-nodes/text-output, dag-nodes/text-template, dag-nodes/transform, dag-orchestrator, dag-projection, dag-runtime, dag-scheduler, dag-worker

- [ ] **Step 1: Add scripts to all 39 packages**

For each package, the existing build script looks like:

```json
"build": "tsup src/index.ts --format esm,cjs --dts --out-dir dist/node --clean",
```

Add two scripts immediately after it:

```json
"build:js": "tsup src/index.ts --format esm,cjs --out-dir dist/node --clean",
"build:types": "tsup src/index.ts --dts-only --out-dir dist/node",
```

The existing `"build"` line must NOT be changed.

- [ ] **Step 2: Verify on dag-adapters-local (the package that was failing)**

Run: `pnpm --filter @robota-sdk/dag-adapters-local build:js`
Expected: ESM + CJS built, no DTS

Run: `pnpm --filter @robota-sdk/dag-adapters-local build:types`
Expected: DTS generated

- [ ] **Step 3: Commit**

```bash
git add packages/*/package.json packages/*/*/package.json
git commit -m "feat(build): add build:js and build:types scripts to inline-tsup packages"
```

---

### Task 3: Add build:js and build:types to agent-cli (Pattern 3)

**Files:**

- Modify: `packages/agent-cli/package.json`

- [ ] **Step 1: Add scripts**

The existing build script is:

```json
"build": "tsup src/index.ts src/bin.ts --format esm,cjs --dts --out-dir dist/node --clean && rm -f dist/node/bin.cjs dist/node/bin.d.cts",
```

Add two scripts immediately after it:

```json
"build:js": "tsup src/index.ts src/bin.ts --format esm,cjs --out-dir dist/node --clean && rm -f dist/node/bin.cjs",
"build:types": "tsup src/index.ts src/bin.ts --dts-only --out-dir dist/node && rm -f dist/node/bin.d.cts",
```

- [ ] **Step 2: Verify**

Run: `pnpm --filter @robota-sdk/agent-cli build:js`
Expected: ESM + CJS built, `bin.cjs` removed, no DTS

Run: `pnpm --filter @robota-sdk/agent-cli build:types`
Expected: DTS generated, `bin.d.cts` removed

- [ ] **Step 3: Commit**

```bash
git add packages/agent-cli/package.json
git commit -m "feat(build): add build:js and build:types scripts to agent-cli"
```

---

### Task 4: Change root build script to 2-pass

**Files:**

- Modify: `package.json` (root)

- [ ] **Step 1: Update root build script**

Change line 16 from:

```json
"build": "pnpm --filter \"./packages/**\" build",
```

To:

```json
"build": "pnpm --filter \"./packages/**\" build:js && pnpm --filter \"./packages/**\" build:types",
```

- [ ] **Step 2: Run full build**

Run: `pnpm build`
Expected: All 48 packages build successfully (0 errors)

- [ ] **Step 3: Run full build 2 more times to confirm no intermittent failures**

Run: `pnpm build && pnpm build`
Expected: Both passes succeed

- [ ] **Step 4: Verify individual package build still works**

Run: `pnpm --filter @robota-sdk/dag-adapters-local build`
Expected: Full build (JS + DTS) succeeds

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "feat(build): switch root build to 2-pass (JS then DTS) to fix race condition"
```

---

### Task 5: Archive backlog and verify CI

**Files:**

- Modify: `.agents/tasks/INFRA-BL-008-build-system-improvement.md` → move to `completed/`

- [ ] **Step 1: Push branch and verify CI passes**

```bash
git push origin feat/infra-bl-008-build-improvement
```

Check CI build passes.

- [ ] **Step 2: Archive backlog**

```bash
git mv .agents/tasks/INFRA-BL-008-build-system-improvement.md .agents/tasks/completed/INFRA-BL-008-build-system-improvement.md
git commit -m "chore: archive INFRA-BL-008 build system improvement as completed"
```
