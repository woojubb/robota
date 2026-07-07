# @robota-sdk/agent-command-workflows

The agent-cli `/workflows` command module. Surfaces the DAG workflow engine inside the agent CLI by
composing `@robota-sdk/dag-framework` in-process — no dependency on the `dag-cli` product.

See [SPEC.md](./SPEC.md) for the package contract.

## Subcommands

- `/workflows create "<description>"` — author and run a workflow from a natural-language
  description via the active provider, then execute it in-process (FLOW-007 natural-language
  authoring). Accepts `--input k=v` and `--name <name>`.
- `/workflows list` — list the workflow nodes available to the in-process runtime.
- `/workflows catalog` — browse workflows saved in the workspace.
- `/workflows validate <file.dag.json>` — validate a workflow definition without running it.
- `/workflows run <file.dag.json>` — execute a workflow file on the in-process runtime.

## Usage (composition)

```ts
import { createWorkflowsCommandModule } from '@robota-sdk/agent-command-workflows';

// agent-cli registers this module in its default command set.
const workflowsModule = createWorkflowsCommandModule();
```
