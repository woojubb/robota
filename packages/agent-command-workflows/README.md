# @robota-sdk/agent-command-workflows

agent-cli `/workflows` command module — surfaces the DAG workflow engine inside the agent CLI by
composing `@robota-sdk/dag-framework` in-process (no `dag-cli` dependency).

Subcommands: `/workflows create "<description>"`, `/workflows list`, `/workflows catalog`,
`/workflows validate`, `/workflows run <file.dag.json>`.

See [docs/SPEC.md](./docs/SPEC.md) for the package contract.
