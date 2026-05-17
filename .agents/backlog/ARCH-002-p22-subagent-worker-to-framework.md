# ARCH-002-p22: Move child-process-subagent-worker to agent-framework

## Status: todo

## Problem

`packages/agent-cli/src/subagents/child-process-subagent-worker.ts` is the default child process
worker used by `ChildProcessSubagentRunner`. The runner lives in `agent-framework`, but the
worker script lives in `agent-cli` — so any consumer of `ChildProcessSubagentRunner` outside of
agent-cli must supply their own worker script or reuse the CLI package as a peer dependency.

The worker has **zero CLI-specific dependencies**. It uses:

- `@robota-sdk/agent-framework` (createDefaultTools, createSubagentLogger, createSubagentSession, IPC types)
- `@robota-sdk/agent-executor` (createProviderFromProfile)
- `@robota-sdk/agent-provider` (createDefaultProviderDefinitions)

Per CLI-AUDIT-009 / Composable-material-first rule: the default child-process subagent worker
is a reusable infrastructure capability that belongs co-located with its runner in
`agent-framework`, not in the CLI product package.

## Dependency consideration

`agent-provider` is currently NOT a dependency of `agent-framework`. The worker calls
`createDefaultProviderDefinitions()` to create a provider from the serialized profile.

Layered architecture positions `agent-provider` BELOW `agent-framework`
(`agent-providers → agent-sdk`), so adding `@robota-sdk/agent-provider` to
`agent-framework`'s dependencies is architecturally valid.

This addition means `agent-framework` bundles all provider API SDKs (anthropic, openai, etc.),
which increases its install footprint. This is the accepted trade-off for making subagents
work out-of-the-box without agent-cli.

## Fix

1. Move `child-process-subagent-worker.ts` to
   `packages/agent-framework/src/subagents/child-process-subagent-worker.ts`
2. Add `@robota-sdk/agent-provider` to `packages/agent-framework/package.json` dependencies
3. Add a `getDefaultSubagentWorkerPath()` helper to
   `packages/agent-framework/src/subagents/index.ts`:
   ```typescript
   import { fileURLToPath } from 'node:url';
   import { dirname, join } from 'node:path';
   export function getDefaultSubagentWorkerPath(): string {
     return join(dirname(fileURLToPath(import.meta.url)), 'child-process-subagent-worker.js');
   }
   ```
4. Update `createChildProcessSubagentRunnerFactory` in
   `packages/agent-framework/src/subagents/child-process-subagent-runner.ts` to make
   `workerPath` optional with a default:
   ```typescript
   options.workerPath ?? getDefaultSubagentWorkerPath();
   ```
5. Update `packages/agent-cli/src/cli.ts` to remove manual worker path construction
   (lines that compute `subagentWorkerPath`) and call the factory without `workerPath`.
6. Build and typecheck both packages; run tests.
7. Verify `agent-framework` subagent tests still pass with updated fixture worker.

## Architecture map update

- Add `CLI-AUDIT-022` to layering-audit.md (new finding, immediately resolved)
- Update composition-tree.md: worker path construction removed from cli.ts
