# @robota-sdk/agent-interface-execution — documents

Execution contract families for the Robota SDK: what a background task is and what states it moves
through, how independent jobs are grouped, what a subagent is asked to do and returns, and the
workspace record that shows an execution's origin and detail.

Type contracts only, with no implementation. It depends on `@robota-sdk/agent-core` and on no peer
`agent-interface-*` package. Consumers compose it downward: `agent-interface-session` names these
types, never the reverse.

## Usage

```typescript
import type {
  TBackgroundTaskRequest,
  TBackgroundTaskState,
  ISubagentSpawnRequest,
  IExecutionWorkspaceSnapshot,
} from '@robota-sdk/agent-interface-execution';
// Narrow requests, results and states on `kind`:
// 'agent' | 'process' | 'scheduled' | 'tool-invocation'.
```

The four families it owns:

| family               | source                          | what it carries                                                         |
| -------------------- | ------------------------------- | ----------------------------------------------------------------------- |
| background task      | `background-task-contracts.ts`  | the request per kind, status, timeout and error categories, usage, logs |
| background job group | `background-group-contracts.ts` | grouping independent jobs and their result envelopes                    |
| subagent             | `subagent-contracts.ts`         | the spawn request, job state, and job result                            |
| execution workspace  | `workspace-contracts.ts`        | an execution's origin, entries, snapshots, and detail pages             |

## Documents

- [SPEC.md](./SPEC.md) — package purpose, ownership boundaries, invariants, and how a forked
  conversation becomes a background task.
