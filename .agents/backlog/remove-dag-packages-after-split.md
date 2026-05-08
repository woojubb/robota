# Remove DAG Packages After Repository Split

## Status

Backlog.

## Created

2026-05-09

## Priority

P0 - repository boundary cleanup after `robota-dag` extraction.

## Problem

The DAG product line is being split into a separate repository. After the new `robota-dag`
repository is prepared, this repository should stop owning DAG packages, DAG apps, DAG-specific
docs, and DAG-specific CI/harness behavior.

The final architecture should make this repository the agent product repository. DAG may depend on
published `@robota-sdk/agent-*` packages from its own repository, but this repository should no
longer build, test, publish, or document `@robota-sdk/dag-*` packages.

## Recommendation

Do this as a cleanup after the `robota-dag` repository is independently buildable.

Reason: removing DAG first would break package publication, docs, and CI before the replacement repo
is ready. The safe order is:

1. prepare `robota-dag` in a separate checkout/repository;
2. verify DAG builds and tests there with agent packages as external npm dependencies;
3. remove DAG ownership from this repository in one focused PR.

## Prerequisites

- The new `robota-dag` repository exists and contains the DAG packages/apps that are being removed
  from this repository.
- `robota-dag` can run its own install/build/test/typecheck/lint workflow without workspace access
  to this repository.
- DAG packages that still need agent functionality reference published `@robota-sdk/agent-*`
  packages as external npm dependencies.
- A migration note exists that tells users where DAG source, issues, docs, and releases moved.
- A decision is made for shared packages such as `auth` and `credits`: keep them here as agent-owned
  common packages, move them to `robota-dag`, or keep them published as independent shared packages.

## Scope

Remove or migrate ownership for:

- `packages/dag-*`
- `packages/dag-nodes/**`
- `apps/dag-studio`
- `apps/dag-runtime-server`
- `apps/dag-orchestrator-server`
- DAG-specific docs, architecture maps, specs, examples, harness checks, release scripts, and
  publish registry entries.
- Root workspace/package scripts that build, test, lint, typecheck, publish, or deploy DAG scopes.

Keep and verify:

- `packages/agent-*`
- `packages/agent-command-*`
- agent provider/runtime/sdk/cli/playground/transport/plugin/tool/team/session packages
- agent apps and docs
- shared packages that are explicitly still owned by this repository after the prerequisite
  decision.

## Boundary Rules

- This repository must not keep pass-through re-exports for removed DAG packages.
- This repository must not keep compatibility source packages named `@robota-sdk/dag-*`.
- If an agent package still imports a DAG package, stop and split that dependency before removal.
- If root scripts or harness plans still assume DAG scopes exist, update the script or harness owner
  before deleting files.
- Do not change npm package names as part of this backlog. Package rename decisions belong to a
  later release/migration backlog.
- Do not change the new `robota-dag` remote from this repository.

## Work Plan

- [ ] Confirm the branch starts from clean `develop`.
- [ ] Inventory all DAG packages, apps, docs, examples, scripts, and harness references.
- [ ] Inventory any agent-to-DAG imports and remove or replace them before deleting DAG packages.
- [ ] Remove DAG packages and apps from the workspace.
- [ ] Remove DAG package entries from root build/test/typecheck/lint/publish configuration.
- [ ] Remove or reroute DAG docs, architecture-map entries, backlog references, and publish
      registry rows.
- [ ] Update root `AGENTS.md`, `.agents/project-structure.md`, and rules/docs so this repository is
      agent-only.
- [ ] Add migration notes pointing DAG users and contributors to the new `robota-dag` repository.
- [ ] Run repository verification and fix any stale DAG assumptions.

## Acceptance Criteria

- [ ] `pnpm install` succeeds without any local DAG workspace packages.
- [ ] Root `pnpm build`, `pnpm test`, `pnpm typecheck`, and `pnpm lint` no longer reference removed
      DAG scopes.
- [ ] `rg -n "@robota-sdk/dag|packages/dag|apps/dag" packages apps .agents scripts package.json pnpm-workspace.yaml`
      returns only intentional migration notes or archived references.
- [ ] No package in this repository declares a production dependency on a removed DAG workspace
      package.
- [ ] Publish registry and changeset/release tooling no longer publish DAG packages from this
      repository.
- [ ] Docs clearly say DAG source moved to `robota-dag`.
- [ ] CI/harness plans only cover packages/apps that remain in this repository.
- [ ] The final PR contains only original-repo cleanup and does not modify the new DAG repository.

## Verification Plan

- `pnpm install`
- `pnpm build`
- `pnpm test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm harness:scan`
- `pnpm harness:verify -- --base-ref origin/develop --skip-record-check`
- Targeted stale-reference scans for `@robota-sdk/dag`, `packages/dag`, `apps/dag`, and DAG release
  registry entries.

## Promotion Path

1. Promote to `.agents/tasks/INFRA-BL-0XX-remove-dag-packages-after-split.md` after `robota-dag`
   has an independently verified branch or repository.
2. Complete the inventory before deleting files.
3. Remove DAG workspace ownership in one cleanup PR.
4. Merge only after GitHub CI confirms the agent-only repository is green.
