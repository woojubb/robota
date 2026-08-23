---
status: approved
type: INFRA
tags: [architecture]
---

# STRUCT-011: name the aggregator apart from what it aggregates

Paired with
`.agents/tasks/STRUCT-011-provider-aggregator-carries-the-prefix-of-what-it-aggregates.md`.
Arising from [issue #2198](https://github.com/woojubb/robota/issues/2198).

## Problem

See the paired Task. In short: `agent-provider-defaults` is the provider family's aggregator, sitting
inside the family it aggregates, and its name does not say whose defaults it holds.

## Prior Art Research

Waived: the decision is a naming policy for this repository's own package families, given directly by
the owner. There is no external product whose documentation could settle what a Robota family prefix
should mean. The waiver is recorded rather than the section left empty, per
[research.md](../../rules/research.md).

The one checkable external fact was verified rather than assumed: `@robota-sdk/agent-provider` is still
published at `3.0.0-beta.79` with 16 versions, which is why reclaiming the family root was rejected on
more than the rule.

## Architecture Review

**Alternatives and why each fails**, in the order they were considered:

1. **`agent-provider` (the family root).** Rejected on the owner's rule — a root may not depend on its
   own members, only the reverse — and independently on the registry fact above.
2. **`agent-cli-provider`.** Rejected on measurement, not taste: the consumers are `agent-cli`,
   `agent-command-workflows`, `dag-cli` and `dag-nodes-default`. Naming it for the CLI is accurate for
   one of four and wrong for the DAG side.
3. **`agent-chat-providers`.** Rejected because it names the scope (chat; the bytedance video provider
   is deliberately excluded) while staying silent on "built-in" — leaving exactly the ambiguity the
   rename exists to remove — and because it does not describe `DEFAULT_ROLE_MODELS` at all.
4. **Folding into `agent-preset`.** Rejected on layering: `agent-preset` depends on `agent-framework`,
   this package is Layer 1 on `agent-core` only, and folding drags a layer edge in.
5. **`agent-builtin-providers`.** Chosen. `builtin` names the subject the old name omitted, the prefix
   is distinct from `agent-provider-` and states a purpose rather than a consumer, and `agent-tool-defaults`
   is the identical shape waiting to join it.

**Capability preservation.** The exported surface is unchanged in name, signature and result —
`createDefaultProviderDefinitions` and `DEFAULT_ROLE_MODELS`. Only the specifier changes. The
`agent-cli` suite exercises the aggregator in five places including
`robota-assembly-equivalence.test.ts`, and passes unchanged.

**Blast radius, classified rather than counted.** 75 references, of which 26 are historical records
left untouched. See the Task for the table and the reasoning: a record describes the state when it was
written.

## Completion Criteria

- **TC-01** The package, its directory, and its `package.json` name are `agent-builtin-providers`.
- **TC-02** The description no longer says "Default … aggregator" — the rename would otherwise leave the
  defect in the sentence readers meet on the registry.
- **TC-03** Every live reference resolves to the new name; every historical record still carries the old one.
- **TC-04** `agent-builtin-*` is a documented package family in `project-structure.md` and registered in
  `check-capability-placement.mjs`, which refuses an undocumented workspace package.
- **TC-05** `project-structure.md` stays within its frozen routing size.
- **TC-06** Typecheck, the affected package suites, and `pnpm harness:scan` are green.

## Test Plan

See the paired Task. The load-bearing checks are TC-03 (both directions — the live set empty and the
historical set still 26) and TC-06.

## Evidence Log

| Claim                                      | Verified at                                                                                                                                                                                                                                               |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GATE-APPROVAL                              | The owner approved the recommended name directly in the current conversation, after being given the alternatives and the reasoning: "추천안대로 승인 한다". A direct instruction about a specific change, so the delegated-class question does not arise. |
| The package is the family's aggregator     | `agent-provider-defaults out:[anthropic, gemini, openai, openai-compatible] in:[]`                                                                                                                                                                        |
| `agent-provider` is still published        | `npm view @robota-sdk/agent-provider` → 16 versions, `latest: 3.0.0-beta.79`                                                                                                                                                                              |
| The consumers span two products            | `agent-cli`, `agent-command-workflows`, `dag-cli`, `dag-nodes-default`                                                                                                                                                                                    |
| `agent-tool-defaults` is the same shape    | its description: "Default tool-set aggregator for Robota SDK (composition leaf)"                                                                                                                                                                          |
| Live references rewritten, historical left | live set greps to 0; `tasks/completed` + `spec-docs/done` + `.changeset` + `archive` + `.design` still 26                                                                                                                                                 |
| Suites pass                                | agent-builtin-providers 10, dag-nodes-default 13, agent-cli 423, dag-cli 1039                                                                                                                                                                             |
| Scans pass                                 | `pnpm harness:scan` 140 passed, 2 skipped, 0 failed                                                                                                                                                                                                       |

## Notes on two judgement calls a reviewer should check rather than take

**The CI workflow line.** `.github/workflows/live-provider-smoke.yml:74` filters the package by name.
`backlog-execution.md` reserves CI workflows for user judgement even inside an approved item, because
"backlog approval covers the backlog's stated scope, not policy files it happens to pass through". This
line is not passed through — it names the package being renamed, and leaving it would land CI red. The
reservation exists to stop a policy decision riding along unnoticed; there is no policy decision here.
Changed deliberately, recorded here rather than assumed.

**One decorative line removed to stay inside the routing ratchet.** `project-structure.md` is frozen at
385 lines and a new package family is a genuine routing addition, so `routing-document-size` requires
lowering something else first. The line removed is a bare `│` tree rule carrying no content, and the
rule clause about aggregators and family roots was kept OUT of the tree entry — that rule belongs to
ARCH-101, which owns the layer declaration, not to a package listing.
