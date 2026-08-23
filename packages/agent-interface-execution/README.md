# @robota-sdk/agent-interface-execution

Execution contract interfaces for the Robota SDK — background tasks, job groups, subagent jobs and
execution workspaces.

Type declarations only: no classes, no runtime logic. This package is the SSOT for the contracts that
the execution runtime and the surfaces displaying it agree on.

```ts
import type {
  IBackgroundTaskState,
  IBackgroundJobGroupState,
  IExecutionWorkspaceSnapshot,
  ISubagentJobState,
} from '@robota-sdk/agent-interface-execution';
```

See [`docs/SPEC.md`](docs/SPEC.md) for the full contract, the boundaries, and what this package
deliberately does not own.

## License

AGPL-3.0-only OR LicenseRef-Commercial
