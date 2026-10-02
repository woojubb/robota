# @robota-sdk/agent-command-workflows

The configured CLI's `/workflows` command module (internal, not published). It surfaces the DAG workflow
engine inside an agent session by composing `@robota-sdk/dag-framework` in-process, and owns the
natural-language authoring pipeline behind `/workflows create` and `/workflows build`.

Subcommands: `create`, `build`, `list`, `catalog`, `validate <file.json>`, `run <file.json> [--detach]`,
`status <run-id>`, and `cancel <run-id>`. The [package README](../README.md) describes each one.

## Usage (composition)

```ts
import { createWorkflowsCommandModule } from '@robota-sdk/agent-command-workflows';

// Without a workflow project every subcommand answers WorkspaceAuthorityRequired;
// agent-cli passes one built with createWorkspaceWorkflowProject for a trusted workspace.
const workflowsModule = createWorkflowsCommandModule();
```

## Documents

- [SPEC.md](./SPEC.md) — package contract: shared subcommand registry, `build` never executes, provider
  seam, and project authority.
