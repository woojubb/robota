---
status: in-progress
type: SECURITY
tags: [security]
lane: L2
---

# SECURITY-2465: complete the workspace trust boundary

Paired with `.agents/tasks/SECURITY-2465-complete-the-workspace-trust-boundary.md`. Arising from [issue #2465](https://github.com/woojubb/robota/issues/2465).

## Problem

Complete one end-to-end, provenance-aware workspace trust boundary: resolve canonical repository
identity before project-controlled executable contributions are applied; require an explicit,
revocable trust grant; enforce monotonic policy; isolate secret-bearing provider fields when endpoints
change; and expose safe provenance diagnostics in both startup modes.

<!-- Symptom + reproduction condition: the command, the output that is wrong, and when it occurs.
     Replace the seed above if it does not name both. -->

## Prior Art Research

VS Code Workspace Trust places an opened folder in Restricted Mode until the user trusts it, limiting
terminals, tasks, extensions, and other executable workspace contributions. See the official
[Workspace Trust](https://code.visualstudio.com/docs/editing/workspace-trust) and
[extension trust API](https://code.visualstudio.com/api/extension-guides/workspace-trust)
documentation. Anthropic's Claude Code IAM documentation describes managed, user, project, and local
settings as separate policy owners and states that managed restrictions cannot be overridden by lower
layers; see [IAM](https://docs.anthropic.com/en/docs/claude-code/iam) and
[CLI usage](https://docs.anthropic.com/en/docs/claude-code/cli-usage).

The applicable Robota constraint is stronger than a path check: project-controlled bytes are untrusted
until a host-owned grant binds the canonical repository identity, and the resulting authority is the
only route to project settings, hooks, plugins, skills, context, memory, and state. Provider
credentials remain owned by their source layer and are never inherited by a lower-trust endpoint.

**Review waiver:** the user explicitly prohibited subagents and additional worktrees. I performed the
source/architecture review and primary product-document research in this checkout instead.

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/workspace-trust/` — Node host identity resolver, file-backed grant
  store, authority service, and public exports.
- `packages/agent-framework/src/config/` and provider command API — monotonic trust/deny merging and
  endpoint/credential ownership.
- `packages/agent-cli/src/startup/` and `src/utils/` — one startup admission decision, `trust`
  command, headless refusal, and safe diagnostics/help.
- `packages/agent-framework/docs/SPEC.md` and `packages/agent-cli/docs/SPEC.md` — lifecycle and
  user-facing recovery contract. `agent-session` and `agent-core` are existing contract consumers;
  they are changed only if verification proves an owner-level gap.

### Alternatives Considered

1. Central host-owned admission before CLI composition.
   - Pro: one decision gates every existing project source and preserves the opaque authority design.
   - Con: startup becomes async and requires a small persistent user-owned trust store.
2. Add an independent trust check to each hook, plugin, skill, provider, and session consumer.
   - Pro: each package can evolve independently.
   - Con: duplicated checks leave reachability gaps and make interactive/headless parity fragile.
3. Trust a canonical path or always allow project configuration after a one-time prompt.
   - Pro: minimal code and simple UX.
   - Con: symlink aliases and repository replacement inherit access; it cannot prove provenance or
     bind credentials to endpoints.

### Decision

Choose alternative 1. The Node host resolves a canonical Git worktree and a stable host filesystem
identity for the repository's common Git directory. `WorkspaceTrustService` reads and writes a
user-owned, owner-only grant record, then mints the existing opaque authority only for a current,
matching generation. CLI startup resolves this service before any project source is composed;
restricted composition therefore has no project reader and cannot load project-controlled executable
material.

Configuration merging keeps the most restrictive trust level, unions deny rules, and clears an
inherited credential whenever a later provider layer changes the endpoint without supplying its own
credential. The result is used by both print/serve and TUI paths. A manual reachability pass traced
`startCli` through preparsed and normal routing into `createCliWorkspaceComposition` and session
assembly. An adversarial pass covered symlink aliases, replaced repositories, nested repositories,
worktrees, unavailable identity, lower-layer deny removal, and endpoint redirection.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — N/A: internal fix with no contract change; the remedy is the repository's own precedent
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

Non-Git or unavailable identity produces restricted user-only composition and never grants project
authority. Interactive startup may continue with host-owned sources and exposes `robota trust status`;
headless startup fails closed for an untrusted, revoked, stale, or unavailable grant store before
provider construction. A trust-store parse/I/O error is surfaced as `store-unavailable` and is
terminal in headless mode. The only fallback is to omit project sources; no project file is read as a
fallback.

## Solution

1. Add `createNodeWorkspaceIdentityResolver()` and `createNodeWorkspaceTrustStore()` under
   `packages/agent-framework/src/workspace-trust/`, with canonical Git identity, replacement-safe
   generation, owner-only persistence, inspect/grant/revoke, and fail-closed parsing.
2. Make `packages/agent-cli/src/startup/` resolve one initial access decision before preparsed or
   normal startup, add `trust`, `trust status`, `trust grant`, and `trust revoke`, and refuse
   headless startup when a Git workspace is not trusted.
3. Make configuration and provider merges monotonic and provenance-safe while preserving the existing
   public provider settings shape and authority-derived project sources.
4. Add red-first framework/CLI unit and integration coverage for all eight criteria, including real
   Git identity and a real CLI headless scenario with a sentinel hook.
5. Update the affected SPECs, CLI help/README, execute both user scenarios, and run package and
   harness verification.

## Affected Files

- `packages/agent-framework/src/workspace-trust/`
- `packages/agent-framework/src/config/config-merge.ts`
- `packages/agent-framework/src/command-api/provider/provider-merge.ts`
- `packages/agent-cli/src/startup/`
- `packages/agent-cli/src/utils/cli-args.ts`, `cli-help.ts`
- affected package SPECs and user README documentation

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run packages/agent-framework/src/workspace-trust/node-host-workspace-trust.test.ts`
      exits 0; the untrusted/replaced/alias cases fail with the fix reverted.
- [ ] TC-02: `pnpm exec vitest run packages/agent-framework/src/config/config-merge.test.ts packages/agent-framework/src/command-api/provider/__tests__/provider-merge.test.ts`
      exits 0 and proves monotonic policy and credential/endpoint isolation.
- [ ] TC-03: `pnpm exec vitest run packages/agent-cli/src/startup/workspace-trust-startup.test.ts`
      exits 0 and proves real startup admission, command lifecycle, and headless refusal.
- [ ] TC-04: `pnpm --filter @robota-sdk/agent-framework build && pnpm --filter @robota-sdk/agent-cli build`
      exits 0.
- [ ] TC-05: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
      exits 0.
- [ ] TC-06: `pnpm harness:verify-like-ci` exits 0 with the exact CI-shaped verification recorded.
- [ ] TC-07: User Scenario 1 records nonzero exit, trust diagnostic, and absent sentinel.
- [ ] TC-08: User Scenario 2 records no credential at the lower-trust endpoint and a redacted
      diagnostic.

## Test Plan

| TC-ID | Test Type | Tool / Approach | Notes |
| ----- | --------- | --------------- | ----- |
| TC-01 | Unit/integration | `node-host-workspace-trust.test.ts` | Git identity, grants, replacement, aliases, non-Git, store failure |
| TC-02 | Unit | `config-merge.test.ts`, `provider-merge.test.ts` | Trust level/deny monotonicity and endpoint-secret isolation |
| TC-03 | CLI integration | `workspace-trust-startup.test.ts` | One decision for preparsed, print, serve, and TUI-capable startup |
| TC-04 | Build | framework + CLI package builds | Public exports and bundled CLI compile |
| TC-05 | Harness | affected scan command | Mechanical gates and changed-path contracts |
| TC-06 | CI-shaped | `pnpm harness:verify-like-ci` | Full repository gate |
| TC-07 | User scenario | Scenario 1 exact shell command | No untrusted startup execution |
| TC-08 | User scenario | Scenario 2 exact shell command | No credential redirection |

## User Execution Test Scenarios

### Scenario 1: headless startup refuses untrusted executable project configuration

- Executability: agent-executable
- Product surface: robota-cli
- Surface rationale: shipped-entrypoint=robota
- Prerequisites: Node.js 22 with workspace dependencies installed and the local Robota CLI built; current directory is an isolated temporary Git repository containing a project SessionStart sentinel fixture; use an isolated temporary HOME; no API key, network, or TTY is required.
- Command: pnpm exec robota -p "workspace trust probe" --output-format text
- Observable type: product-output
- Observable rationale: source=product-process
- Expected observable: exit=1; output-contains=Workspace trust is required
- Cleanup: remove the isolated temporary HOME, repository, sentinel, and trust store after the command; leave no tracked repository changes.
- Evidence: record exit code 1, the actionable diagnostic substring, and sentinel absence here after DONE-GATE-STAGE-2 execution.

### Scenario 2: endpoint replacement cannot redirect a credential

- Executability: agent-executable
- Product surface: robota-cli
- Surface rationale: shipped-entrypoint=robota
- Prerequisites: Node.js 22 with the local Robota CLI built; current directory is an isolated trusted Git repository with a higher-trust provider credential and a lower-trust project endpoint configured; use an isolated temporary HOME and a local capture server; the dummy credential is SECURITY_2465_DUMMY_SECRET; no external network or live model key is required.
- Command: pnpm exec robota diagnose
- Observable type: product-output
- Observable rationale: source=product-process
- Expected observable: exit=0; output-contains=provider endpoint quarantined
- Cleanup: stop the local capture server and remove the isolated temporary HOME, repository, settings, and trust store; verify the dummy credential is absent from captured output.
- Evidence: record exit code 0, the capture-server request result, the redacted diagnostic substring, and absence of SECURITY_2465_DUMMY_SECRET here after DONE-GATE-STAGE-2 execution.

## Tasks

- [ ] `.agents/tasks/SECURITY-2465-complete-the-workspace-trust-boundary.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-10

**Status upgrade:** draft → review-ready
Manual single-agent semantic review under the user's explicit no-subagent/no-worktree constraint:
the Problem names the affected command/startup behavior and its Git-checkout condition; the prior-art
findings directly motivate the alternatives and the central-admission decision; the decision names the
trade-off (one async host admission and persistent grant versus duplicated gaps); all eight independent
criteria have observable command or behavior forms; and no new package, workspace edge, or presentation
surface is introduced. Mechanical GATE-WRITE result: 20 PASS, 0 FAIL, 7 pending semantic criteria.

- GATE-WRITE — frontmatter block: PASS — begins with YAML frontmatter.
- GATE-WRITE — draft status: PASS — `status: draft` is present.
- GATE-WRITE — SECURITY type: PASS — type is an allowed value.
- GATE-WRITE — tags: PASS — non-empty tags field is present.
- GATE-WRITE — concrete symptom: PASS — names CLI startup and project-controlled behavior.
- GATE-WRITE — reproduction condition: PASS — names a Git checkout and startup composition.
- GATE-WRITE — no vague placeholder: PASS — no TBD/TODO remains in Problem.
- GATE-WRITE — Prior Art Research section: PASS — section is present.
- GATE-WRITE — research substantiation: PASS — official documentation URLs are cited.
- GATE-WRITE — research waiver: PASS — waiver is explicit and supplementary to cited research.
- GATE-WRITE — research feeds decision: PASS — trust-mode precedents motivate the selected alternative.
- GATE-WRITE — architecture checklist: PASS — all checklist items are checked.
- GATE-WRITE — sibling scan: PASS — existing authority/source precedent is named.
- GATE-WRITE — alternatives: PASS — three alternatives each have a pro and con.
- GATE-WRITE — decision trade-off: PASS — async central admission versus duplicated gaps is named.
- GATE-WRITE — new-surface placement: PASS — no new package, edge, or presentation surface.
- GATE-WRITE — criterion prefixes: PASS — TC-01 through TC-08 prefix every criterion.
- GATE-WRITE — feature coverage: PASS — trust lifecycle, policy, credentials, startup, diagnostics,
  and documentation each have criteria.
- GATE-WRITE — observable criteria: PASS — each criterion uses a command or observable behavior.
- GATE-WRITE — banned vague criteria: PASS — no banned vague wording is used.
- GATE-WRITE — Test Plan section: PASS — section is present.
- GATE-WRITE — Test Plan row count: PASS — eight rows map one-to-one to TC-01 through TC-08.
- GATE-WRITE — Test Plan tools: PASS — every row names a test type and approach.
- GATE-WRITE — manual-row notes: PASS — no manual-only test row exists.
- GATE-WRITE — Tasks section: PASS — exact paired Task path is present.
- GATE-WRITE — Evidence Log: PASS — this is the first complete recorded gate entry.
- GATE-WRITE — forbidden body sections: PASS — no `## Status` or `## Classification` section exists.

**Judged at:** HEAD `working tree` · base `origin/develop@b486f8cb5e42344d3dcdf54ed6592db2cc0b30de` · document `.agents/spec-docs/draft/SECURITY-2465-complete-the-workspace-trust-boundary.md` blob `modified`

### [GATE-APPROVAL] — ✅ PASS | 2026-09-10

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "다 사전승인함"
**Given:** 2026-09-10, this conversation
**Review fingerprint:** fd0b36394d69 (review 4353e73a, type/tags 28193824)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-10, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (fd0b36394d69) equals the document's current fingerprint
- GATE-APPROVAL — direct approval is directed at this spec: PASS — the user's `다 사전승인함` was given for the active implementation work and this paired Task/spec.
- GATE-APPROVAL — class boundary: PASS — the item is a direct, explicitly approved L2 security work item; no delegated class is being claimed.
- GATE-APPROVAL — independent architecture validation: PASS — manual single-agent review confirmed the existing authority boundary is reused and no parallel policy engine or new package edge is introduced; subagent review was waived by the user's explicit restriction.

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `b486f8cb5e42` · base `origin/develop@b486f8cb5e42` · document `.agents/spec-docs/backlog/SECURITY-2465-complete-the-workspace-trust-boundary.md` blob `2ac9c10d7ee8` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-10

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-10; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/SECURITY-2465-complete-the-workspace-trust-boundary.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/SECURITY-2465-complete-the-workspace-trust-boundary.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (8)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 721 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 2`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 3 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/SECURITY-2465-complete-the-workspace-trust-boundary.md",
  "specPath": ".agents/spec-docs/todo/SECURITY-2465-complete-the-workspace-trust-boundary.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    },
    {
      "kind": "tc-id",
      "value": "TC-07"
    },
    {
      "kind": "tc-id",
      "value": "TC-08"
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 2
  },
  "worktreePaths": [
    ".agents/loop-runs/backlog-execution-orchestrator.jsonl",
    ".agents/loop-runs/user-execution-scenario.jsonl",
    ".agents/spec-docs/todo/SECURITY-2465-complete-the-workspace-trust-boundary.md",
    ".agents/tasks/SECURITY-2465-complete-the-workspace-trust-boundary.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `b486f8cb5e42` · base `origin/develop@b486f8cb5e42` · document `.agents/spec-docs/todo/SECURITY-2465-complete-the-workspace-trust-boundary.md` blob `eaa373434fb0` (untracked)
