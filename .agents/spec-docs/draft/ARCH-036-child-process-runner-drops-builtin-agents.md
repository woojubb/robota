---
status: draft
type: BEHAVIOR
tags: [cli, typescript]
---

# ARCH-036: the child-process subagent runner ignores the injected built-in agent set

## Problem

NEUT-003 established that an injected `deps.builtInAgents` set **replaces** the module built-ins — an
empty array removes them entirely. `packages/agent-framework/src/agents/built-in-agents.ts` states it
in those words, and `getBuiltInAgent` already accepts the set as its second parameter, defaulting to
`BUILT_IN_AGENTS`.

The **in-process** runner honours the seam
(`packages/agent-framework/src/subagents/in-process-subagent-runner.ts:65-70`):

```ts
deps: Pick<IInProcessSubagentRunnerDeps, 'customAgentRegistry' | 'builtInAgents'>,
…
(deps.builtInAgents
  ? deps.builtInAgents.find((agent) => agent.name === agentType)
```

The **child-process** runner does not. `createStartPayload`
(`packages/agent-subagent-runner/src/child-process-subagent-runner.ts:168`) calls:

```ts
const definition = resolveAgentDefinition(job.request.agentType, this.deps.customAgentRegistry);
```

and `resolveAgentDefinition` (`:188-192`) falls back to the module default:

```ts
const definition = customRegistry?.(agentType) ?? getBuiltInAgent(agentType);
```

`this.deps` is typed `IInProcessSubagentRunnerDeps`, which declares `builtInAgents?`. The field is
present, populated by the composition root's contract, and never read on this path.

Reproduction condition: construct a runner with `deps.builtInAgents` set to a value other than
`BUILT_IN_AGENTS` — for example `[]` — and request an agent type that the module defaults contain.
The in-process runner reports `Unknown agent type`; the child-process runner resolves it and runs the
agent the composition root removed.

**Latent today**: no composition root in this repository populates `builtInAgents`, and robota's pack
subagents reach the child through `customAgentRegistry`. It becomes observable the moment a product
injects or removes built-ins — which is the entire purpose of the seam NEUT-003 added.

The two runners implement the same `ISubagentRunner` contract, so this is the same class of defect as
ARCH-034 (differing tool surfaces): the choice of runner is an isolation and packaging decision, and
it is silently also a capability decision.

## Prior Art Research

Waived: the correct behavior is already implemented in this repository, by the sibling runner, against
the same `deps` type, for the same seam — `in-process-subagent-runner.ts:65-70` is the reference
implementation. `getBuiltInAgent(name, builtInAgents = BUILT_IN_AGENTS)` already exposes the parameter
the fix needs. No external product's convention would change the decision, because the decision is
"match the sibling that already conforms", and NEUT-003 already settled the replacement semantics
(injected set REPLACES, empty array removes) that an external comparison might otherwise inform.

## Architecture Review

### Affected Scope

- `packages/agent-subagent-runner/src/child-process-subagent-runner.ts` — `resolveAgentDefinition` and
  its one call site in `createStartPayload`.
- `packages/agent-subagent-runner/docs/SPEC.md` — the runner's documented dependency contract.
- `scripts/harness/` — a conformance check that the two runners read the same `deps` fields.

### Alternatives Considered

1. **Thread `deps.builtInAgents` into `resolveAgentDefinition` and forward it to `getBuiltInAgent`'s
   existing second parameter.**
   Pro: matches the sibling runner exactly; uses a parameter that already exists; roughly two lines;
   no contract change, because the field is already on the `deps` type.
   Con: fixes this one dropped field and leaves the general question — which other `deps` members does
   the child-process runner ignore? — unanswered. ARCH-034 and ARCH-032 already record that it is not
   the only one.
2. **Derive the child-process runner's definition resolution from the in-process runner's exported
   helper, so there is one implementation rather than two conforming ones.**
   Pro: removes the possibility of the two drifting again, which is the actual recurring defect;
   a single owner for "how an agent type becomes a definition".
   Con: `agent-subagent-runner` would import a resolution helper from `agent-framework`, which it
   already depends on — acceptable — but the helper is currently private to the subagents module, so
   this widens `agent-framework`'s public surface for an internal seam.
3. **Do nothing until a composition root actually populates `builtInAgents`.**
   Pro: zero risk now; the defect is unobservable in this repository today.
   Con: the seam exists precisely so an external product can use it, and the first product to use it
   gets a silent divergence between two runners it was told are interchangeable. It also leaves a
   declared capability that the child ignores — the shape ARCH-021 exists to remove.
4. **Make the child-process runner reject construction when `deps.builtInAgents` is set, rather than
   silently ignoring it.**
   Pro: fails loudly instead of diverging silently; smaller than implementing the behavior.
   Con: refusing to support a field the shared `deps` type declares makes the two runners
   non-interchangeable by contract, which is a larger contract regression than the bug it avoids.

### Decision

Choose alternative 1 for the behavior, and add the conformance check that alternative 1's Con names.

The trade-off: alternative 2 is the structurally better answer to "why did these drift", but it
widens a public surface to fix a two-line omission, and ARCH-032/ARCH-034 already own the general
question of what the child-process runner drops. Solving the general case here would duplicate items
that exist. Alternative 3 is rejected because a declared-and-ignored capability is the defect class,
not its severity; alternative 4 is rejected because it degrades the contract to avoid implementing it.

The check is the part that closes the item. A test that the child-process runner honours
`builtInAgents` proves this field; a check that both runners read the same `deps` members is what
prevents the next field from being dropped — and this is the second field known to have been dropped
at this seam, so the recurrence is established, not hypothetical.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — the in-process runner (`agent-framework/src/subagents/in-process-subagent-runner.ts`)
      inspected as the conforming reference; `getBuiltInAgent` confirmed to already accept the set;
      `agent-tool.ts` and `agent-definition-loader.ts` confirmed to honour the same seam, making the
      child-process runner the sole non-conforming reader
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None

## Solution

1. Give `resolveAgentDefinition` a third parameter for the injected built-in set and forward it to
   `getBuiltInAgent`'s existing second parameter; pass `this.deps.builtInAgents` at the call site in
   `createStartPayload`.
2. Add a red-first test proving an injected set replaces the module defaults on the child-process path,
   including the empty-array case that must remove them entirely.
3. Add a check that the two `ISubagentRunner` implementations read the same members of the shared
   `deps` type, so a third dropped field fails a gate rather than waiting for a product to find it.
4. Record the dependency contract in `agent-subagent-runner`'s SPEC.

## Affected Files

- `packages/agent-subagent-runner/src/child-process-subagent-runner.ts`
- `packages/agent-subagent-runner/src/__tests__/child-process-subagent-runner.test.ts`
- `packages/agent-subagent-runner/docs/SPEC.md`
- `scripts/harness/scan-subagent-runner-deps-parity.mjs`
- `scripts/harness/run-all-scans.mjs`
- `scripts/harness/__tests__/scan-subagent-runner-deps-parity.test.mjs`
- `.agents/tasks/ARCH-036-child-process-runner-drops-builtin-agents.md`

## Completion Criteria

- [ ] TC-01: With `deps.builtInAgents` set to a single custom definition, the child-process runner
      resolves that definition for its name and throws `Unknown agent type` for a name present only in
      `BUILT_IN_AGENTS`.
- [ ] TC-02: With `deps.builtInAgents` set to `[]`, the child-process runner throws `Unknown agent
type` for every name in `BUILT_IN_AGENTS`.
- [ ] TC-03: With `deps.builtInAgents` absent, the child-process runner resolves the same definitions
      as before the change — no regression for the current composition roots.
- [ ] TC-04: For the same `deps`, the in-process and child-process runners resolve the same definition
      for the same agent type.
- [ ] TC-05: The parity check exits non-zero on a fixture runner pair where one reads a `deps` member
      the other ignores, and exits 0 on the repository's two runners after the fix.
- [ ] TC-06: `pnpm harness:scan` exits 0 with the parity check registered and reporting the number of
      `deps` members it compared.

## Test Plan

| TC-ID | Test Type              | Tool / Approach                                                               | Notes                                                                                                   |
| ----- | ---------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| TC-01 | Unit test              | Vitest constructing the runner with an injected set, asserting on the payload | Red-first: currently the injected set is not read at all, so this fails before the change               |
| TC-02 | Unit test              | Vitest empty-array case                                                       | NEUT-003's stated semantics — an empty array removes the built-ins — is the case most likely to regress |
| TC-03 | Unit test              | Vitest with `builtInAgents` absent                                            | Guards the default path the current composition roots actually use                                      |
| TC-04 | Unit test              | Vitest driving both runners from one `deps` fixture                           | States the interchangeability the `ISubagentRunner` contract claims, as an assertion                    |
| TC-05 | Unit test              | Vitest fixtures for the parity check (divergent and conforming pairs)         | Red-first: the check must reject the divergent fixture before the runner is fixed                       |
| TC-06 | CI pipeline smoke test | `pnpm harness:scan`                                                           | Proves registration and dispatch plus the examined-size report                                          |

## User Execution Test Scenarios

`builtInAgents` is a **public SDK seam** — `ISubagentOptions` and `IInProcessSubagentRunnerDeps`
document that an injected set REPLACES the framework built-ins and that an empty array removes them.
A composition root enabling that seam is a product surface, so the reachability rule applies and the
gate is not "not applicable".

**Scenario — a composition root's agent set reaches the child-process runner.**
`agent-executable`. Prerequisites: none — agent-type resolution happens in the parent before any
provider call, so the scenario needs no credentials, no network, and no external service. Fixture:
the scenario writes its own one-line worker (`process.exit(0)`) to a temp dir, since the child is
never reached. Driven through the PUBLISHED `@robota-sdk/agent-subagent-runner` barrel
(`ChildProcessSubagentRunner`) — the artifact an SDK consumer installs, not repository-internal
source.

Command:

```bash
pnpm --filter robota-scratch run run src/arch-036-builtin-agents.ts
```

Expected observable result (exit code 0, four rows):

| injected `builtInAgents` | requested `agentType` | expected                                        |
| ------------------------ | --------------------- | ----------------------------------------------- |
| `[]`                     | `general-purpose`     | rejected: `Unknown agent type: general-purpose` |
| `[only-this-one]`        | `general-purpose`     | rejected: `Unknown agent type: general-purpose` |
| `[only-this-one]`        | `only-this-one`       | `started`                                       |
| omitted                  | `general-purpose`     | `started`                                       |

Cleanup: the temp worker directory is disposable; the scenario cancels each handle it starts.

**Evidence (run 2026-08-17, against the completed implementation):**

```
empty set → general-purpose: rejected: Unknown agent type: general-purpose
injected set → general-purpose: rejected: Unknown agent type: general-purpose
injected set → only-this-one: started
omitted → general-purpose: started
PASS
```

Red-proof of the scenario itself — with `resolveAgentDefinition` reverted to the pre-fix form
(`deps.builtInAgents` unread), every row flips and the scenario reports FAIL:

```
empty set → general-purpose: started
injected set → general-purpose: started
injected set → only-this-one: rejected: Unknown agent type: only-this-one
omitted → general-purpose: started
FAIL
```

Durable engineering artifacts backing the same behavior:
`packages/agent-subagent-runner/src/__tests__/child-process-subagent-runner.test.ts`
(`ChildProcessSubagentRunner — injected built-in agents (ARCH-036)`).

## Tasks

- [ ] `.agents/tasks/ARCH-036-child-process-runner-drops-builtin-agents.md` — problem record exists;
      implementation begins after GATE-APPROVAL

## Evidence Log

### [IMPLEMENTED] — ✅ | 2026-08-17

Executed under the owner's standing instruction of this session, recorded verbatim:
"너가 제안한 1위부터 5위 까지 작업을 모두 진행해서 완료해줘". Each item's premise was
independently reproduced against the code before any change (see the Problem section's
measurements), and each change is reversible and internal to this repository.

`deps.builtInAgents` threaded into `resolveAgentDefinition`. Red-proof: 2 of 3 new cases fail without the change; the third is the no-regression case. The `deps`-parity scan in the Solution is NOT delivered — recorded as remaining work. 14 runner tests.
