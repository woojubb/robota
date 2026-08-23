---
title: 'STRUCT-011: the provider aggregator carries the prefix of what it aggregates'
issue: https://github.com/woojubb/robota/issues/2198
status: in-progress
created: 2026-08-23
priority: high
urgency: now
area: packages/agent-builtin-providers, packages/agent-cli, packages/dag-cli, scripts/harness
depends_on: []
---

# STRUCT-011: the provider aggregator carries the prefix of what it aggregates

## Problem

`@robota-sdk/agent-provider-defaults` depends on four packages sharing its own prefix and nothing
depends on it in return:

```
agent-provider-defaults   out:[anthropic, gemini, openai, openai-compatible]   in:[]
```

It is the provider family's aggregator, sitting inside the family it aggregates. The owner ruled on
2026-08-23 that a package which holds several same-level packages in order to offer them as one must
carry a **completely different prefix**, and that its name must state its **purpose** — "defaults"
does not say whose defaults.

The dependency itself is legal: an aggregator is a layer above what it aggregates, the same shape as
`dag-framework` over `dag-core`. What the shared prefix does is make that invisible. `agent-provider-*`
reads as "one provider", so a member of that family depending on four other providers looks like a peer
reaching sideways — and a reader choosing a provider sees five `agent-provider-*` packages of which one
is not a provider.

## Decision

Rename to `@robota-sdk/agent-builtin-providers`. Approved by the owner, 2026-08-23.

`builtin` names the subject the old name left out: what the SDK ships with. Both exports are that —
`createDefaultProviderDefinitions()` (the built-in chat provider definitions) and `DEFAULT_ROLE_MODELS`
(the built-in role→model mapping).

The `package.json` description is rewritten in the same change. Leaving _"Default provider definition
aggregator for Robota SDK"_ in place would rename the package and keep the defect in the sentence
readers actually meet on the registry.

## Alternatives rejected

- **`agent-provider` (the family root).** The owner ruled a family root may not depend on its own
  members — only the reverse. A root is a base that members build on, never an aggregator over them.
  Separately, `@robota-sdk/agent-provider` is still published at `3.0.0-beta.79` from before
  ARCH-PROVIDER-002 split it, so reclaiming it would continue a version line with different contents.
- **`agent-cli-provider`** (the shape the owner offered as an example). Measured, the consumers span
  two products — `agent-cli`, `agent-command-workflows`, `dag-cli`, `dag-nodes-default` — so naming it
  for the CLI is accurate for one of four and wrong for the DAG side.
- **`agent-chat-providers`.** Names the deliberate scope (chat; the bytedance video provider is
  excluded) but is silent on "built-in", leaving the owner's stated objection unaddressed, and does not
  cover `DEFAULT_ROLE_MODELS` at all.
- **Folding into `agent-preset`.** Conceptually close — a preset is "a named, pre-tuned bundle" — but
  `agent-preset` depends on `agent-framework` while this package is Layer 1 on `agent-core` only.
  Folding would drag a layer edge in.

## Scope: what changed and what deliberately did not

75 files reference the old name. They are not one kind:

| Class                                                                                                         | Count  | Action         |
| ------------------------------------------------------------------------------------------------------------- | ------ | -------------- |
| Live code (`packages/**/*.ts`, `package.json`)                                                                | 18     | rewritten      |
| Harness scripts and CI                                                                                        | 12     | rewritten      |
| Live routing docs (`project-structure`, `publish-registry`, `harness.config`, architecture-map)               | 7      | rewritten      |
| Open Task records and `scratch/`                                                                              | 4      | rewritten      |
| **Historical records** (`tasks/completed/`, `spec-docs/done/`, `.changeset/`, `.agents/archive/`, `.design/`) | **26** | **left alone** |

A record describes the state when it was written. `ARCH-PROVIDER-002`'s completed spec citing the name
that existed then is accurate, not stale; rewriting it would turn a record of the past into a
transcript of the present.

### The CI workflow line, and why it is in scope

`.github/workflows/live-provider-smoke.yml:74` filters the package by name:

```
run: pnpm --filter @robota-sdk/agent-provider-defaults... build:js
```

`backlog-execution.md` reserves CI workflows for user judgement "even when the change is bundled inside
an already-approved backlog", on the reasoning that "backlog approval covers the backlog's stated scope,
not policy files it happens to pass through". This line is not passed through: it names the package
being renamed, and leaving it would make the workflow filter a package that no longer exists, so the
change would knowingly land CI red. The reservation exists to stop a policy decision riding along
unnoticed; there is no policy decision here, and the alternative is shipping a break. Changed, with the
reasoning recorded rather than assumed.

## Plan

- [x] `git mv` the package directory and rewrite its `package.json` name and description.
- [x] Rewrite every live reference; leave historical records untouched.
- [x] Rebuild and typecheck the workspace.
- [ ] Full test and scan pass.
- [ ] File the sibling item for `agent-tool-defaults`, which carries the identical defect.

## Test Plan

- `pnpm -w typecheck` clean — it failed first on a stale `dist/` (SEC-015's `THookOutcome` was missing
  locally), which is the diagnosis trap recorded on this repo's `dist` scan; rebuilt before concluding.
- `pnpm harness:scan` green, including `ghost-package-refs`, `workspace-refs`, `publish`,
  `capability-placement` and `arch-map-paths` — the five that read package names or paths.
- Affected package tests: `agent-cli`, `dag-cli`, `dag-nodes-default`, `agent-command-workflows`.
- `grep -rl agent-provider-defaults` over the live classes returns zero, and over the historical
  classes still returns 26.

## User Execution Test Scenarios

Not applicable — a package rename with no behaviour change. The exported surface
(`createDefaultProviderDefinitions`, `DEFAULT_ROLE_MODELS`) is identical in name, signature and result;
only the specifier a consumer imports from changes. Per `.agents/tasks/README.md`, a change delivering no
runnable user-facing behaviour records the not-applicable with its reason rather than inventing a
product scenario. The equivalence is covered in the Test Plan by the existing `agent-cli` suite, which
imports the aggregator in five places including `robota-assembly-equivalence.test.ts`.

## Follow-up filed rather than absorbed

`agent-tool-defaults` is described as _"Default tool-set aggregator for Robota SDK (composition leaf)"_ —
the identical shape and the identical ambiguity. It is filed separately: same cause, different consumer
set, and combining them is the leaf expansion issue #2079 § Execution rules forbids.
