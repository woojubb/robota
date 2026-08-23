# @robota-sdk/agent-command-workflows

agent-cli `/workflows` command module — surfaces the DAG workflow engine inside the agent CLI by
composing `@robota-sdk/dag-framework` in-process (no `dag-cli` dependency).

Subcommands: `/workflows create "<description>"`, `/workflows list`, `/workflows catalog`,
`/workflows validate`, `/workflows run <file.dag.json>`.

Composition requires an explicit `IWorkflowProject` created from a framework workspace authority.
Read-only subcommands use its root-relative reader; `create` and `build` additionally require the
same-authority mutation capability. The package never treats `cwd` or a generic filesystem as project
access, and absent project access returns an observable `WorkspaceAuthorityRequired` result.

See [docs/SPEC.md](./docs/SPEC.md) for the package contract.
