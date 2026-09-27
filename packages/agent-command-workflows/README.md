# @robota-sdk/agent-command-workflows

The `/workflows` command module for the `robota` CLI. It brings the DAG workflow engine into an agent
session by composing `@robota-sdk/dag-framework` in-process: author a workflow from a description,
validate it, and run it.

This is an internal workspace package (`private: true`), not published to npm. The CLI compiles it into
its own bundle.

## Subcommands

| Subcommand                                                              | What it does                                                               |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `/workflows create "<description>" [--input key=value] [--name <name>]` | Author a workflow from a natural-language description, save it, and run it |
| `/workflows build "<description>" [--input key=value] [--name <name>]`  | Author and save a workflow for review without running it                   |
| `/workflows list`                                                       | List the workflow nodes available (built-ins plus workspace nodes)         |
| `/workflows catalog`                                                    | List workflow files in the workspace's `.workflows` catalog                |
| `/workflows validate <file.json>`                                       | Validate a workflow file against the node catalog                          |
| `/workflows run <file.json> [--detach]`                                 | Run a workflow file; `--detach` returns a run id immediately               |
| `/workflows status <run-id>`                                            | Inspect a detached run in this CLI session                                 |
| `/workflows cancel <run-id>`                                            | Cancel an active detached run in this CLI session                          |

The model may run `create` and `build`; the other subcommands are user-only. Hosts that cannot accept a
later command (one-shot runs) refuse `--detach`.

## Composition

```ts
import { createWorkflowsCommandModule } from '@robota-sdk/agent-command-workflows';
import type { IWorkflowProject } from '@robota-sdk/agent-command-workflows';

declare const project: IWorkflowProject; // from createWorkspaceWorkflowProject(authority, mutation)

const workflowsModule = createWorkflowsCommandModule({ project });
```

Every subcommand needs an explicit `IWorkflowProject`, created with `createWorkspaceWorkflowProject` from
a framework workspace authority. Read-only subcommands use its root-relative reader; `create` and `build`
also need the same authority's mutation capability. The package never treats `cwd` or a generic
filesystem as project access: without a project, a subcommand returns an observable
`WorkspaceAuthorityRequired` result. Authoring resolves its provider per invocation from the
`providerDefinitions` and `settingsSources` the host passes in.

See [docs/SPEC.md](./docs/SPEC.md) for the package contract and the
[CLI guide](../../content/guide/cli.md#workflows-workflows) for usage in the CLI.
