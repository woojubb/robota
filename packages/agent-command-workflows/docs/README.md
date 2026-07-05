# @robota-sdk/agent-command-workflows

The agent-cli `/workflows` command module. Surfaces the DAG workflow engine inside the agent CLI by
composing `@robota-sdk/dag-framework` in-process — no dependency on the `dag-cli` product.

See [SPEC.md](./SPEC.md) for the package contract.

## Subcommands

- `/workflows list` — list the workflow nodes available to the in-process runtime.
- `/workflows run <file.dag.json>` — execute a workflow file on the in-process runtime.

## Usage (composition)

```ts
import { createWorkflowsCommandModule } from '@robota-sdk/agent-command-workflows';

// agent-cli registers this module in its default command set.
const workflowsModule = createWorkflowsCommandModule();
```
