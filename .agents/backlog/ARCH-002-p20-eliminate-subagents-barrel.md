# ARCH-002-p20: Eliminate agent-cli subagents/index.ts pass-through barrel

## Status: done

## Problem

`packages/agent-cli/src/subagents/index.ts` is a pure pass-through re-export barrel:

```typescript
export { ChildProcessSubagentRunner, createChildProcessSubagentRunnerFactory, ... }
  from '@robota-sdk/agent-framework';
export { GitWorktreeIsolationAdapter, createGitWorktreeIsolationAdapter, ... }
  from '@robota-sdk/agent-executor';
```

It is not exported from `packages/agent-cli/src/index.ts` (not part of the public API).
Within agent-cli, only `cli.ts` and `print-mode.ts` import from it, and only for
`createChildProcessSubagentRunnerFactory`. The `GitWorktreeIsolationAdapter` re-exports
are unused by production code (tests import directly from `@robota-sdk/agent-executor`).

This barrel adds unnecessary indirection and obscures where the symbols actually live.

## Fix

1. In `packages/agent-cli/src/cli.ts`, replace:
   ```typescript
   import { createChildProcessSubagentRunnerFactory } from './subagents/index.js';
   ```
   with:
   ```typescript
   import { createChildProcessSubagentRunnerFactory } from '@robota-sdk/agent-framework';
   ```
2. In `packages/agent-cli/src/modes/print-mode.ts`, replace:
   ```typescript
   import type { createChildProcessSubagentRunnerFactory } from '../subagents/index.js';
   ```
   with:
   ```typescript
   import type { createChildProcessSubagentRunnerFactory } from '@robota-sdk/agent-framework';
   ```
3. Delete `packages/agent-cli/src/subagents/index.ts`.
4. Typecheck agent-cli; run tests.

## Architecture map update

- Note in composition-tree.md that `createChildProcessSubagentRunnerFactory` is imported
  directly from `@robota-sdk/agent-framework`.
