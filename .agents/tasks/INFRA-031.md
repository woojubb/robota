# INFRA-031 — Move GitWorktreeIsolationAdapter to the composition root (ARL-02 / ARCH-FIX-024)

Spec: `.agents/spec-docs/active/INFRA-031-worktree-adapter-to-composition-root.md`
Resolves: ARL-02 (`.agents/architecture-remediation-log.md`)

## Tasks

- [ ] T1 (TC-01/05): Move `packages/agent-executor/src/subagents/git-worktree-isolation-adapter.ts` → `packages/agent-cli/src/subagents/git-worktree-isolation-adapter.ts`; repoint its imports (`BackgroundTaskError`, `ISubagentWorktreeAdapter`, `IPreparedSubagentWorktree`, `ISubagentWorktreePrepareRequest`) to `@robota-sdk/agent-executor`. Move its test to `packages/agent-cli/src/subagents/__tests__/` and repoint it to the local module.
- [ ] T2 (TC-02): Remove the concrete adapter exports from `packages/agent-executor/src/index.ts` and `packages/agent-executor/src/subagents/index.ts` (keep the `ISubagentWorktreeAdapter` port + `WorktreeSubagentRunner`).
- [ ] T3 (TC-04): In `packages/agent-subagent-runner/src/child-process-subagent-runner.ts`: drop the `createGitWorktreeIsolationAdapter` import + `?? createGitWorktreeIsolationAdapter()` default; make `worktreeAdapter` required on `IChildProcessSubagentRunnerOptions`.
- [ ] T4 (TC-05): In `packages/agent-cli/src/cli.ts` (~258): inject `worktreeAdapter: createGitWorktreeIsolationAdapter()` from the moved module (direct import; no barrel).
- [ ] T5 (TC-06): Add `packages/agent-cli/src/subagents/git-worktree-isolation-adapter.ts` to the `cli-agent-executor-import` rule's `exemptions` in `scripts/harness/check-background-workspace-conformance.mjs` with a reason ("composition root — concrete worktree adapter wiring").
- [ ] T6 (TC-07): Add a `.changeset/*.md` entry — breaking: `@robota-sdk/agent-subagent-runner` now requires `worktreeAdapter`. Update `packages/agent-subagent-runner/README.md` (usage example now needs the field).
- [ ] T7 (TC-03): Confirm `rg "execFileSync|mkdirSync" packages/agent-executor/src` and the git adapter in `packages/agent-subagent-runner/src` are gone.
- [ ] T8 (TC-06): `pnpm build`, `pnpm typecheck`, affected tests (agent-executor, agent-subagent-runner, agent-cli), `pnpm harness:scan` (45/45 incl. `cli-agent-executor-import`) all green.
- [ ] T9 (TC-07): Update `agent-executor`/`agent-subagent-runner`/`agent-cli` SPECs; mark ARL-02 Resolved in `.agents/architecture-remediation-log.md`.

## Test Plan / 검증

Structural + behavior-preserving. The change relocates a concrete adapter to the imperative shell and
turns a hidden default into a required injected port — runtime behavior is unchanged (agent-cli injects
the same adapter the default previously supplied; it is the sole factory caller). Guards: the relocated
adapter unit test (moved to agent-cli), `tsc` proving `worktreeAdapter` is now required (omission is a
type error), grep proving the executor no longer owns/creates worktrees (`execFileSync`/`mkdirSync`
gone), and the full green gate including the `cli-agent-executor-import` conformance scan (with the new
allowlist entry) and the changeset for the breaking published-API change. Delegated to
`architecture-implementer`; land via the gated flow + `merge-verifier`.
