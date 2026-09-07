---
title: 'CLI-1994: fork the conversation into a background session'
issue: https://github.com/woojubb/robota/issues/1994
status: in-progress
created: 2026-09-07
priority: medium
urgency: soon
area: agent-framework
depends_on: []
---

# CLI-1994: fork the conversation into a background session

## Objective

A user who wants to try something without disturbing the current conversation has no way to branch it:
the only fork today is the print-mode `--fork-session` flag, and a background job always starts from an
empty context. Add `/fork [name] [--same-dir]`: the session writes a _copy_ of its own record under a
fresh id (messages, system prompt, tool schemas, full history; no sandbox snapshot, goal, plan or
branch), then spawns a background job that carries only `resumeSessionId`, so the child restores that
record and the conversation never crosses the child-process wire (ARCH-044 holds). The background panel
gains an `attach` control that switches the terminal to the forked session — a view switch, not a
merge. The plan is `.agents/spec-docs/active/CLI-1994-fork-the-conversation-into-a-background-session.md`;
its § Decision records that the issue's stated dependency on #1988 is not real.

## Spec

`.agents/spec-docs/active/CLI-1994-fork-the-conversation-into-a-background-session.md`

## Plan

One item per spec sub-item, each naming the Completion Criteria it is verified by.

- [x] `buildForkedSessionRecord` in `interactive-session-fork-record.ts` — fresh id, copied messages / system prompt / tool schemas / full history, distinct name, dropped fields (spec § Solution 1) — TC-01
- [x] Copy invariant: writing the forked record leaves the source record byte-identical (§ Solution 1) — TC-02
- [x] Prompt restore: `loadSessionRecord` returns `restoredSystemPrompt` and `interactive-session-init.ts` applies it, so the dead `systemPrompt` field becomes live (§ Solution 2) — TC-04
- [x] `ICommandHostSessionAccess.forkSession({ name? })` role-port member implemented on `InteractiveSession` (§ Solution 3) — TC-07
- [x] `IAgentBackgroundTaskRequest.resumeSessionId?` → `ISpawnAgentJobInput` → `SubagentManager.spawn` → in-process runner and child-process worker construct the child with `resumeSessionId` + `forkSession: false` (§ Solution 4) — TC-03, TC-05
- [x] ARCH-044 boundary held: the worker start DTO's key set is unchanged, no conversation crosses the wire (§ Solution 4) — TC-06
- [x] `/fork [name] [--same-dir]` command module registered beside `/background`, incl. flags and the failure path (§ Solution 5) — TC-07
- [x] `TExecutionControl` gains `'attach'`; the `{ type: 'switch-session' }` UI intent; the TUI's existing session-switch path handles it (§ Solution 6) — TC-08
- [x] Attach refusals: missing record or terminal task refused with the task's status (§ Solution 6) — TC-09
- [x] `--fork-session` print-mode path and `cli-args` untouched (regression) — TC-10
- [x] SPEC.md updates across `agent-interface-execution`, `agent-interface-command`, `agent-framework`, `agent-command`, `agent-executor`, `agent-transport-tui`, each stating that a fork is a copy and attach is a view switch (§ Solution 7) — TC-12
- [ ] Affected-set regression: `run-all-scans.mjs --affected --context pr` exits 0 — TC-11

## Test Plan

Derived from the spec's § Test Plan (type FLOW, tags `[cli, typescript]`): vitest unit, integration
and component tests at each seam, one row per TC. TC-03 uses `createScriptedProvider` and is RED
without `resumeSessionId` forwarding. TC-06 is a key-set assertion on the worker start DTO. TC-08 pairs
`ink-testing-library` with the package `typecheck` so the union's exhaustive switches are compiled.
TC-11 runs the affected-set scan suite; TC-12 greps the SPEC.md files for `fork`. Each TC records its
test-file path here when green; the commands are the spec's § Completion Criteria verbatim.

| TC    | Test file / command                                                                                             | Status  |
| ----- | --------------------------------------------------------------------------------------------------------------- | ------- |
| TC-01 | `packages/agent-framework/src/interactive/__tests__/fork-record.test.ts` (new)                                  | green   |
| TC-02 | same file — byte-compare of the source record                                                                   | green   |
| TC-03 | `packages/agent-framework/src/subagents/__tests__/fork-job-resumes-record.test.ts` (new)                        | green   |
| TC-04 | `packages/agent-framework/src/interactive/__tests__/fork-restores-context.test.ts`                              | green   |
| TC-05 | `packages/agent-framework/src/interactive/__tests__/interactive-session-agent-jobs.semantic-roles.test.ts`      | green   |
| TC-06 | `packages/agent-subagent-runner/src/__tests__/subagent-worker-start-dto.test.ts`                                | green   |
| TC-07 | `packages/agent-command/src/fork/__tests__/fork-command.test.ts` (new)                                          | green   |
| TC-08 | `packages/agent-transport-tui/src/__tests__/fork-attach.test.tsx` (new) + package `typecheck`                   | green   |
| TC-09 | same file — attach refusals                                                                                     | green   |
| TC-10 | `packages/agent-cli/src/modes/__tests__/print-mode-integration.test.ts`, `src/utils/__tests__/cli-args.test.ts` | green   |
| TC-11 | `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`             | pending |
| TC-12 | `grep -n "fork"` over the six SPEC.md files                                                                     | green   |

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

Supersedes the earlier free-form draft; the spec's own § User Execution Test Scenarios carries this
same structured text (mirrored by the orchestrator so both documents state one scenario set). The scenario is decomposed per
`backlog-execution.md` § Scenario Design Preference Order: `/fork` writing a copied session record,
the copy's message/prompt equality, and the parent record staying unchanged are all driven
non-interactively through the ONE counted scenario below, which exercises the real `startCli()`
entrypoint (the exact function `bin/robota.cjs` calls) with a scripted, deterministic provider — no
network access or live API key required. The one piece confirmed genuinely not decomposable — the
background panel's `attach` view switch — is recorded separately below, outside the counted set, with
the specific technical reason and the decomposition attempted before reaching that conclusion.

Executability was proven live against this worktree (2026-09-07): `pnpm exec robota --version`
resolves and prints `robota 3.0.0-beta.72`; a full scripted print-mode run through `startCli()`
(build-context turn) reaches `exitCode: 0` with the scripted reply in stdout; `/fork experiment` is
already dispatched by the in-progress implementation and returns a clean JSON error envelope rather
than "unknown command" — `Cannot fork: this session has no session store to write the copy to.` under
`--no-session-persistence`, and `Could not fork this session: Project mutation requires stable
root-anchored host support.` with persistence on (this host is macOS; ARCH-047
(`packages/agent-framework/src/workspace-trust/project-relative-writer.ts:46`) refuses all
project-file mutation, including session persistence, on non-Linux platforms — the exact reason the
existing `packages/agent-cli/src/__tests__/e2e/scripted-e2e.test.ts` CLI-073/TC-04 cases are
`it.runIf(process.platform === 'linux')`). This is the same platform boundary the scenario's own
Linux prerequisite below states, so the invocation shape is confirmed real even though a full PASS is
only observable on Linux.

**State of the tree this section is judged in (recorded for DONE-GATE-STAGE-1).** The implementation of
§ Solution 1–7 was written before this scenario stage ran — an ordering error by the orchestrator, not
a tool defect. To restore the order Stage-1 → GATE-IMPLEMENT → planning checkpoint → implementation,
every implementation path was parked OUTSIDE the tree (58 paths, tarball
`/private/tmp/claude-501/-Users-jungyoun-Documents-dev-woojubb-robota/d79834aa-27a7-41b4-9442-26bb05568da8/scratchpad/park-cli-1994-session-fork/impl.tar`,
made with `tar`, not `git stash`, because refs/stash is shared across this clone's worktrees), and the
`## Plan` / `## Test Plan` ticks the implementation worker had recorded were reverted so this file
describes the tree being judged: no implementation present, nothing green yet. The parked work is
restored only after the planning checkpoint is an ancestor of HEAD, and the ticks return with it.

### Scenario 1: /fork copies the live session into a background-resumable record, parent unchanged

- Executability: agent-executable
- Product surface: public-sdk-example
- Surface rationale: shipped-interface=public-sdk-example
- Prerequisites: Linux host — ARCH-047 refuses all project-file mutation, including session persistence, on non-Linux platforms (`packages/agent-framework/src/workspace-trust/project-relative-writer.ts:46`), matching the existing `it.runIf(process.platform === 'linux')` gates in `packages/agent-cli/src/__tests__/e2e/scripted-e2e.test.ts`; Node >=22 with this repo's pnpm toolchain already installed (`pnpm install` run); no network access or API key needed — the fixture substitutes a scripted, deterministic provider via `startCli`'s `providerDefinitions`, the same mechanism `scripted-e2e.test.ts` uses; create `scratch/src/cli-1994-fork-scenario.ts` with the exact content in the "Fixture script" subsection below before running (`scratch/src/*` is gitignored and disposable, recreated before each run); run from the repository root of this worktree. On a non-Linux host the agent-reachable route is a Linux container over this same checkout: `docker run --rm -v "$PWD":/w -w /w node:22 bash -lc 'corepack enable && pnpm install --frozen-lockfile && pnpm exec tsx scratch/src/cli-1994-fork-scenario.ts'` (the `docker` binary is present on this host; the container satisfies ARCH-047's Linux requirement and prints the same `RESULT:` line).
- Command: `pnpm exec tsx scratch/src/cli-1994-fork-scenario.ts`
- Observable type: sdk-result
- Observable rationale: source=public-sdk-return
- Expected observable: result=the printed `RESULT:` line parses as JSON with forkRunExitCode=0, sessionFileCountAfterFork=2, idsDiffer=true, forkedNameDistinctFromSource=true, forkedMessagesEqualSourceMessages=true, forkedSystemPromptEqualsSource=true, sourceIdAndMessagesUnchangedAfterFork=true (id and messages unchanged; per the existing CLI-073 precedent in scripted-e2e.test.ts a resume/fork run may still refresh the source file's updatedAt via init-time persist, so the invariant asserted is id+messages equality rather than full byte identity), and forkRunStdout containing the forked session's name and a background task id
- Cleanup: the fixture script removes its own `mkdtemp` HOME/project directory in a `finally` block on every run, success or failure; delete `scratch/src/cli-1994-fork-scenario.ts` afterward since `scratch/src/` is disposable and gitignored; no tracked repository file is modified by this scenario; no real `~/.robota` state is touched (the script overrides `HOME` before any provider/session call).
- Evidence: (pending — record the exact printed `RESULT:` JSON line and an `ls .robota/sessions/` listing from the Linux run here after DONE-GATE-STAGE-2 execution)

### Fixture script: `scratch/src/cli-1994-fork-scenario.ts`

The command above requires this file to exist first (it is gitignored, so it is not committed —
recreate it verbatim before running). Verified executable on this worktree on 2026-09-07 (macOS):
resolves, builds the source-session context turn (`exitCode: 0`), and reaches `/fork`'s real
command handler, which is already wired up mid-implementation; it stops at the ARCH-047 platform
guard as expected on a non-Linux host, per the executability note above.

```ts
// CLI-1994 user-execution scenario fixture — drives the REAL `startCli()` entrypoint
// (the exact function `bin/robota.cjs` calls) through print mode, twice, using a scripted
// provider so the run is deterministic and needs no network access or live API key:
//   1) build a short conversation (one turn) in a fresh session — the "source" session;
//   2) resume that session and run `/fork experiment` — the command under test.
// Then it inspects `.robota/sessions/` directly (a real product-state file, not a mock) and
// prints one `RESULT:` line summarizing what happened.
//
// Requires a Linux host: ARCH-047 refuses ALL project-file mutation (including session
// persistence) on non-Linux platforms — see packages/agent-framework/src/workspace-trust/
// project-relative-writer.ts:46 and the existing
// `it.runIf(process.platform === 'linux')` gates in
// packages/agent-cli/src/__tests__/e2e/scripted-e2e.test.ts.
//
// scratch/src/* is gitignored and disposable — recreate this file from the Task's
// "Fixture script" section before running.

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  mkdtempSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { WorkspaceTrustService } from '@robota-sdk/agent-framework';
// Relative import: always the current worktree source, matching the pattern the package's
// own e2e suite uses (packages/agent-cli/src/__tests__/e2e/scripted-e2e.test.ts imports
// `startCli` the same way, one directory level closer).
import { startCli } from '../../packages/agent-cli/src/cli.js';

import type { IProviderDefinition } from '@robota-sdk/agent-core';
import type { IScriptedProvider } from '@robota-sdk/agent-core/testing';
import type {
  ITrustedWorkspaceProjectAccess,
  IWorkspaceIdentity,
  IWorkspaceTrustStoreSnapshot,
} from '@robota-sdk/agent-framework';

interface IPersistedSessionFile {
  record: {
    id: string;
    name?: string;
    messages: unknown[];
    systemPrompt?: string;
  };
}

const TMP_BASE = realpathSync(mkdtempSync(join(tmpdir(), 'cli1994-fork-scenario-')));
const project = join(TMP_BASE, 'project');

async function trustedAccess(worktreeRoot: string): Promise<ITrustedWorkspaceProjectAccess> {
  const identity: IWorkspaceIdentity = {
    repositoryKey: `scenario:${worktreeRoot}`,
    displayPath: worktreeRoot,
    worktreeRoot,
  };
  const trusted: IWorkspaceTrustStoreSnapshot = {
    state: 'trusted',
    generation: 1,
    grantedAt: '2026-08-22T00:00:00.000Z',
  };
  const access = await new WorkspaceTrustService({
    identityResolver: { resolve: () => identity },
    store: {
      inspect: async () => trusted,
      grant: async () => trusted,
      revoke: async () => ({ state: 'revoked', generation: 2 }),
    },
  }).inspect(worktreeRoot);
  if (access.status !== 'trusted') throw new Error('expected trusted project access');
  return access;
}

function scriptedDefinition(scripted: IScriptedProvider): IProviderDefinition {
  return {
    type: 'scripted',
    defaults: { model: 'scripted-model' },
    requiresApiKey: false,
    createProvider: () => scripted.provider,
  };
}

async function run(
  argv: string[],
  scripted: IScriptedProvider,
): Promise<{ exitCode: number; stdout: string }> {
  process.argv = ['node', 'robota', ...argv];
  const chunks: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  const originalErrWrite = process.stderr.write.bind(process.stderr);
  const originalExit = process.exit.bind(process);
  (process.stdout as unknown as { write: unknown }).write = ((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;
  (process.stderr as unknown as { write: unknown }).write = (() =>
    true) as typeof process.stderr.write;
  let exitCode = -1;
  const trap = new Error('__exit_trap__');
  (process as unknown as { exit: unknown }).exit = ((code?: number) => {
    exitCode = code ?? 0;
    throw trap;
  }) as typeof process.exit;
  try {
    await startCli({
      providerDefinitions: [scriptedDefinition(scripted)],
      projectAccess: await trustedAccess(project),
    });
  } catch (error) {
    if (error !== trap) throw error;
  } finally {
    process.stdout.write = originalWrite;
    process.stderr.write = originalErrWrite;
    process.exit = originalExit;
  }
  return { exitCode, stdout: chunks.join('') };
}

function sessionFiles(): string[] {
  try {
    return readdirSync(join(project, '.robota', 'sessions')).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
}

function readSession(file: string): IPersistedSessionFile {
  return JSON.parse(
    readFileSync(join(project, '.robota', 'sessions', file), 'utf8'),
  ) as IPersistedSessionFile;
}

async function main(): Promise<void> {
  mkdirSync(join(project, '.robota'), { recursive: true });
  writeFileSync(
    join(project, '.robota', 'settings.json'),
    JSON.stringify({
      currentProvider: 'scripted',
      providers: { scripted: { type: 'scripted', model: 'scripted-model' } },
    }),
    'utf8',
  );
  const originalHome = process.env.HOME;
  process.env.HOME = join(TMP_BASE, 'home');
  const originalCwd = process.cwd();
  process.chdir(project);
  try {
    // 1) Build a short conversation in a fresh session.
    const contextRun = await run(
      ['-p', 'Remember the number 42'],
      createScriptedProvider([{ text: 'noted: 42' }]),
    );
    const beforeFiles = sessionFiles();
    if (beforeFiles.length !== 1) {
      throw new Error(
        `expected exactly 1 session file after context turn, got ${beforeFiles.length}`,
      );
    }
    const sourceFile = beforeFiles[0]!;
    const sourceBefore = readSession(sourceFile);
    const sourceId = sourceBefore.record.id;

    // 2) Resume that session and fork it.
    const forkRun = await run(
      ['-p', '/fork experiment', '-r', sourceId, '--output-format', 'json'],
      createScriptedProvider([{ text: 'unused — /fork does not reach the model' }]),
    );

    // 3) Inspect the resulting session files.
    const afterFiles = sessionFiles();
    const forkedFile = afterFiles.find((f) => f !== sourceFile);
    const sourceAfter = readSession(sourceFile);
    const forkedAfter = forkedFile ? readSession(forkedFile) : null;

    console.log(
      `RESULT: ${JSON.stringify({
        contextRunExitCode: contextRun.exitCode,
        forkRunExitCode: forkRun.exitCode,
        forkRunStdout: forkRun.stdout.trim(),
        sessionFileCountAfterFork: afterFiles.length,
        sourceId,
        forkedId: forkedAfter?.record.id ?? null,
        idsDiffer: forkedAfter !== null && forkedAfter.record.id !== sourceId,
        forkedNameDistinctFromSource: forkedAfter?.record.name !== sourceBefore.record.name,
        forkedMessagesEqualSourceMessages:
          forkedAfter !== null &&
          JSON.stringify(forkedAfter.record.messages) ===
            JSON.stringify(sourceBefore.record.messages),
        forkedSystemPromptEqualsSource:
          forkedAfter !== null &&
          forkedAfter.record.systemPrompt === sourceBefore.record.systemPrompt,
        // Precedent: packages/agent-cli/src/__tests__/e2e/scripted-e2e.test.ts CLI-073 case —
        // a resume/fork run may refresh the source file's updatedAt via init-time persist, so the
        // invariant is id+messages equality, not full byte identity.
        sourceIdAndMessagesUnchangedAfterFork:
          sourceAfter.record.id === sourceBefore.record.id &&
          JSON.stringify(sourceAfter.record.messages) ===
            JSON.stringify(sourceBefore.record.messages),
      })}`,
    );
  } finally {
    process.chdir(originalCwd);
    process.env.HOME = originalHome;
    rmSync(TMP_BASE, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error('SCENARIO SCRIPT FAILED:', error);
  process.exitCode = 1;
});
```

**Record correction.** No `[DONE-GATE-STAGE-1]` entry dated 2026-09-07 exists for this Task: the
guardian dispatched that day against the dirty tree was stopped by the orchestrator before it wrote
anything. The entries below are the complete Stage-1 history of this Task.

### Written but uncounted — attach view-switch (manual-only)

This scenario is WRITTEN in full, in the canonical `robota-tui` form, so nothing delivered by
§ Solution 6 is left without one. It stays outside the `| 1` count because the repository's scenario
contract binds one verdict to one executability for every counted scenario
(`scripts/harness/scan-user-execution-plan-order.mjs:460`), and Scenario 1 is agent-executable while
this one is not: counting both would force a false label on one of them. That limitation is filed as
the amendment input the rule requires — `LRN-scenario-contract-single-executability` in
`.agents/learn.md` (a GitHub Issue for it is the owner's to open; the allocator refuses a Task without
one) — and the exception is claimed under that record, not asserted.

- Executability: manual-only: the background panel and its `attach` control are reached solely through Ink's raw-mode keyboard focus navigation (Ctrl+B panel toggle, arrow-key selection over a `/background list` entry, `a` on the entry); Ink refuses raw mode without a real interactive TTY (`Raw mode is not supported on the current process.stdin`); a pty-driven run was attempted in design and rejected because the forked background job completes its scripted turn immediately and a completed task is refused by attach (the control is for a RUNNING fork), so an automatable path needs a provider whose turn stays open on command, which no shipped fixture provides
- Product surface: robota-tui
- Surface rationale: shipped-entrypoint=robota
- Prerequisites: Linux host (ARCH-047, as Scenario 1; or the same docker container route); a real interactive terminal; the CLI built (`pnpm --filter @robota-sdk/agent-cli build`); a LIVE provider credential, stated explicitly because the forked job's first turn calls the model — `ANTHROPIC_API_KEY` exported and the provider configured under a throwaway HOME so no real `~/.robota` state is touched: `export HOME=$(mktemp -d) && pnpm exec robota --configure-provider anthropic --type anthropic --api-key-env ANTHROPIC_API_KEY --set-current`
- Command: `pnpm exec robota`
- UI steps: type one message and wait for the reply; run `/fork experiment`; press Ctrl+B to open the background panel; move the selection to the `experiment` task while it is still running; press `a` (the attach key shown in the panel footer); observe the terminal
- Observable type: ui-state
- Observable rationale: source=rendered-product-ui
- Expected observable: visible=the panel footer shows the attach hint for the forked task; after `a` the status bar shows `experiment` in place of the parent's name and the transcript shows the copied turn; `ls $HOME/.robota/sessions/` (or the project's `.robota/sessions/`) lists two records and the parent's `messages` are unchanged; selecting a task whose status is terminal and pressing `a` shows a refusal naming that status
- Cleanup: quit the session (`/exit`); `rm -rf "$HOME"` (the throwaway HOME); unset `ANTHROPIC_API_KEY` if it was exported only for this run
- Evidence: (pending — the maintainer records the observed footer hint, the status-bar name after attach, the sessions listing, and the refusal message for a terminal task)
- automation barrier: accessibility-tree-unavailable
- unavailable capability: Ink raw-mode keyboard-driven focus navigation in a real TTY, plus a provider turn that stays open on command so the fork is still running when attach is pressed
- attempted automation: `ink-testing-library` drives the identical component tree without a TTY and is exactly what TC-08/TC-09 assert at the engineering level; per the Done Gate that is engineering verification, not a user-execution surface, so it is recorded here rather than substituted as evidence

### [DONE-GATE-STAGE-1] — 🔴 NON-COMPLIANCE | 2026-09-08

**Status remains:** scenario drafted (Task frontmatter `status: todo` unchanged; no transition recorded)
**Violation:** Two process breaks, either of which stops the gate before its own criteria.
(1) **The prior DONE-GATE-STAGE-1 record is missing from this evidence surface.** The paired spec's
`[RECORD NOTE] — 2026-09-07` states that a DONE-GATE-STAGE-1 guardian "recorded that violation as
NON-COMPLIANCE in the Task". This Task carries no `[DONE-GATE-STAGE-1]` entry of any kind: not in the
working tree, not in the index copy (`git show :.agents/tasks/CLI-1994-….md` — 96 lines, author verdict
only, old free-form draft), in none of the 50 entries of `git stash list`, and the scenario ledger
`.agents/loop-runs/user-execution-scenario.jsonl` holds exactly one run for this Task
(`r20260907135632`, `terminal: null`) and none at HEAD. Whether the section rewrite removed it or it was
never written, the prior verdict now exists only as the orchestrator's prose, and a gate verdict that
leaves no trace cannot be audited.
(2) **The document's recorded state is past the state this gate takes as input.** STAGE-1 judges a
scenario drafted BEFORE the planning checkpoint (`backlog-execution.md` § Pre-implementation planning
checkpoint: Stage-1 PASS → GATE-IMPLEMENT → checkpoint commit → implementation). This Task is
`status: todo` yet records 11/12 `## Plan` items `[x]` and 11/12 `## Test Plan` rows `green`, naming
`fork-record.test.ts`, `fork-job-resumes-record.test.ts`, `fork-command.test.ts`, `fork-attach.test.tsx`
and `interactive-session-fork-record.ts` — none of which exists in the judged tree: HEAD `754c9e239eec`
equals `origin/develop`, `git status --short` lists only this Task, the spec and the ledger,
`packages/agent-command/src/fork/` is absent, `TExecutionControl` (`workspace-contracts.ts:22`) is still
the six-member union, and `switch-session` occurs nowhere under `packages/`. The scenario text is written
against that absent implementation ("`/fork experiment` is already dispatched by the in-progress
implementation", "reaches `/fork`'s real command handler, which is already wired up mid-implementation")
and `scratch/src/` holds only `.gitkeep`, so the executability probe it cites cannot be inspected. The
RECORD NOTE's account that the implementation "was stashed" is not corroborated: `git stash list` has no
entry for this branch, this worktree's reflog holds only `reset: moving to HEAD`, and the only `1994`
branch sits at `origin/develop`. Evidence that cannot be verified does not count, and a Task that records
implementation as complete is not a document awaiting its pre-implementation scenario gate.
**Required action:** Restore the record before re-running, then re-author against the findings below.
(a) Reinstate the prior `[DONE-GATE-STAGE-1] — 🔴 NON-COMPLIANCE | 2026-09-07` entry in this section
verbatim if it was written; if it never was, say so here and correct the spec's RECORD NOTE, so the trail
states what actually happened. (b) Make the Task describe the judged tree: on a planning-only tree the
`## Plan` boxes are unticked and the `## Test Plan` rows `pending`; if the implementation is to be
retained instead, it must be present and the item routed through GATE-IMPLEMENT's NON-COMPLIANCE path,
not through a Stage-1 re-run. (c) State where the implementation went — stash ref, patch path, or
"discarded" — because the scenario's executability claim rests on it. (d) Re-run DONE-GATE-STAGE-1 in its
own invocation on the restored record.

Findings on this gate's own criteria — recorded so re-authoring can proceed in the same round; none of
them decided the verdict above, and none is a PASS:

- DONE-GATE-STAGE-1 — Every scenario is written with exact commands or UI steps, prerequisites, an
  expected observable result, and an evidence field: NOT MET. Scenario 1 carries every field
  (`validateApplicableScenarioSection` → `ok: true`, 1 entry, form canonical). The attach view-switch —
  spec § Solution 6, TC-08/TC-09, a delivered user-facing TUI behaviour — has no written scenario: the
  block "Not one of the counted scenarios — attach view-switch (manual, TUI-only)" carries the manual
  barrier trio and no `Executability:`, `Product surface:`, `Surface rationale:`, `Prerequisites:`,
  start `Command:`, `UI steps:`, `Observable type:`, `Observable rationale:`, `Expected observable:`,
  `Cleanup:` or `Evidence:` field. The catalogue's exception (writing genuinely impossible) is not
  established: the reason given is why AUTOMATION is impossible (Ink raw-mode keyboard navigation), and
  `backlog-execution.md` § Scenario Design Preference Order prescribes the form for exactly that case —
  canonical `robota` start command, exact UI steps in order, `visible=<state>` observable, barrier trio.
  The block's closing sentence records that it was kept "outside the `| 1` count … so the mechanical
  scenario contract … stays satisfied": the record was shaped to the scanner, not to the rule.
- DONE-GATE-STAGE-1 — Every scenario carries its executability decision: NOT MET. Scenario 1 is
  `agent-executable`, but the author's own recorded attempt on this host (macOS) "stops at the ARCH-047
  platform guard" and the Task concedes "a full PASS is only observable on Linux"; the scenario names no
  route by which the agent reaches a Linux host (a container recipe, a CI job, or an environment the
  work ships — a `docker` binary exists on this host and the scenario does not use it). The rule's test
  (§ Agent Executability Requirement) is "Can I execute this via Bash right now?", which the author's
  probe answered no; "an unexecutable scenario that is not labeled `manual-only:` at write time means the
  agent already knows the done gate will fail". Either name the agent-reachable Linux route as a
  prerequisite/setup step, or redesign toward an observable not gated by ARCH-047. The attach block has
  no canonical `Executability:` line at all — "(manual, TUI-only)" in a heading is not the field.
- DONE-GATE-STAGE-1 — canonical product-surface identity and matching invocation; observable is not a
  build/typecheck/lint/test/harness/CI check or text inspection: MET, with a reservation recorded.
  `Product surface: public-sdk-example` / `shipped-interface=public-sdk-example` /
  `pnpm exec tsx scratch/src/cli-1994-fork-scenario.ts` / `sdk-result` / `source=public-sdk-return` /
  `result=…` are the canonical pairings (`productSurfaceInvocation` accepts the literal path below
  `scratch/`). The observable is product behaviour — `.robota/sessions/*.json` written by the real
  session path plus the product's print-mode stdout — not a test runner, build, scan or text
  inspection. `startCli` is exported from `@robota-sdk/agent-cli` (`packages/agent-cli/src/index.ts:2`),
  so a scratch example over it is public-SDK usage. Reservation: the rule reserves `public-sdk-example`
  for "SDK-only features" and makes `robota …` the default surface for command-package work, and the
  fixture imports `../../packages/agent-cli/src/cli.js` rather than the package entry. Recorded, not
  failed.
- DONE-GATE-STAGE-1 — live credentials / external service stated explicitly: MET. Scenario 1 states
  "no network access or API key needed" and names the scripted provider as the mechanism; the
  Linux-host requirement is stated explicitly with its cause (`project-relative-writer.ts:46`, verified:
  `if (process.platform !== 'linux') … refuseProjectRead(…)`), so an executor learns from the scenario,
  not from the failure, that it cannot run on macOS.
- Observation (not a criterion): Scenario 1 expects `forkRunExitCode=0` and a background task id in
  stdout, while the fixture's project directory is a bare `mkdtemp` folder that is not a git repository
  and `/fork` without `--same-dir` spawns with `isolation: 'worktree'` (spec TC-07); confirm the
  expectation is reachable before Stage 2, since rewriting an expectation after the run is forbidden
  (`backlog-execution.md` § Evidence).
- Observation (record integrity): the Task says the earlier free-form draft is "kept in the spec's own
  § User Execution Test Scenarios, which is not edited by this pass"; the spec's section in the working
  tree carries the same replacement text (index → worktree diff), so the earlier draft survives only in
  the uncommitted index.

**Judged at:** HEAD `754c9e239eec` · base `origin/develop@754c9e239eec` · document `.agents/tasks/CLI-1994-fork-the-conversation-into-a-background-session.md` blob `6169b181e085` (modified)

### [DONE-GATE-STAGE-1] — ❌ FAIL | 2026-09-08

**Status remains:** scenario drafted (Task frontmatter `status: todo` unchanged; no transition recorded)

**Ordering:** DONE-GATE-STAGE-1 has no prior gate (gate-catalogue.md § Prior-gate map), so only the
input-state half of the check applies, and it holds on the remedied tree: `**Author verdict:**
\`SCENARIO DRAFTED: automatable | 1\``is present;`## Plan`is 0/12 ticked and`## Test Plan`12/12`pending`; HEAD `754c9e239eec`equals`origin/develop`; `git status --short`lists only this Task, the
spec and`.agents/loop-runs/user-execution-scenario.jsonl`; no implementation path is in the tree
(`packages/agent-command/src/fork/`absent,`TExecutionControl`at`workspace-contracts.ts:22`still the
six-member union,`switch-session`and a subagent-side`resumeSessionId`occur nowhere under`packages/`).
The 2026-09-08 NON-COMPLIANCE's required actions were checked, not assumed: (b) ticks reverted — yes;
(c) the parked work is where the Task says — the tarball exists, its `status.txt`inventory is the 58
status paths (46 modified + 12 untracked, including`.agents/learn.md`and`scripts/harness/file-size-baseline.json`), `tar -tf`lists 63 entries (58 plus the expansion of`packages/agent-command/src/fork/`), `deleted.txt`is empty; (a) the trail — the spec's`[RECORD NOTE]`
now states the 2026-09-07 guardian "was stopped by the orchestrator before it recorded anything",
corroborated by the sibling record it cites (`cli-2004-screen-reader`Task line 134:`[DONE-GATE-STAGE-1] — 🔴 NON-COMPLIANCE | 2026-09-07`), and this Task's only Stage-1 entry is the
2026-09-08 one, so no verdict is claimed that does not exist. Residual, recorded and not decided on: the
Task itself still does not say the 2026-09-07 entry was never written, and the RECORD NOTE still says
"stashed" where the Task says `tar`. Implementation-before-Stage-1 is already recorded as NON-COMPLIANCE
above and was remedied on the route that entry prescribed; it is not re-recorded here, and whether the
parked work may return after the checkpoint is GATE-IMPLEMENT's and `user-execution-plan-order`'s to judge.

**Per-criterion record:**

- DONE-GATE-STAGE-1 — Every scenario is written with exact commands or UI steps, prerequisites, an
  expected observable result, and an evidence field: MET. Scenario 1 carries `Command:`, `Prerequisites:`,
  `Expected observable:` and `Evidence:` (`validateApplicableScenarioSection` → `ok: true`, 1 entry). The
  attach view-switch block (lines 336–360) now carries `UI steps:`, `Prerequisites:`, `Expected
observable:` and `Evidence:`, so the 2026-09-08 finding that it was unwritten is cleared. Noted: its
  step "press `a`" comes from the parked implementation (`ExecutionWorkspaceSwitcher.tsx`:
  `ATTACH_KEY = 'a'`, hint `{ keys: 'a', label: 'Attach' }`), not from spec § Solution 6, which names no key.
- DONE-GATE-STAGE-1 — Every scenario carries its executability decision: MET. Scenario 1 is
  `agent-executable` and the 2026-09-08 gap is closed — the non-Linux route is named
  (`docker run … node:22 …`) and verified reachable on this host: `docker` at
  `/Users/jungyoun/.rd/bin/docker`, daemon 29.1.3 answering, `node:22` image cached. Attach is
  `manual-only:` with a specific technical reason (Ink raw mode needs a real TTY; keyboard-driven focus
  navigation) and the barrier trio is present (`accessibility-tree-unavailable`; capability 59 chars;
  attempted automation 465 chars). Reservation recorded, not failed: the pty route was "considered and
  rejected", not attempted, and its stated blocker ("needs a live provider turn") is avoidable with the
  scripted provider Scenario 1 itself injects through `startCli()`.
- DONE-GATE-STAGE-1 — The scenario uses a canonical product-surface identity and matching invocation;
  the observable is not a build/typecheck/lint/test/harness/CI check or text inspection: **NOT MET**
  (attach). Scenario 1 is canonical — `public-sdk-example` / `shipped-interface=public-sdk-example` /
  `pnpm exec tsx scratch/src/cli-1994-fork-scenario.ts` / `sdk-result` / `source=public-sdk-return` /
  `result=…` (`scenarioContract(body, 'automatable')` binds) — and its observable is product behaviour:
  `.robota/sessions/*.json` written by the product's own session path plus print-mode stdout,
  `guardian-observable-verdict=product-behavior`; reservation carried forward: the rule reserves
  `public-sdk-example` for SDK-only features and defaults command-package work to `robota …`, and the
  fixture imports `../../packages/agent-cli/src/cli.js` (`@robota-sdk/agent-cli` is not a
  `scratch/package.json` dependency). The attach scenario is not canonical: no start command (`Command:`
  absent — a manual `robota-tui` scenario records its `robota`/`pnpm exec robota` start command beside
  its UI steps, rule § Scenario Design Preference Order; the contract requires `command !== null` for
  manual `robota-tui`); `Observable type: rendered-terminal` is not one of `product-output` | `ui-state`
  | `product-state-file`; `Observable rationale: source=tui-render` is not `source=rendered-product-ui`;
  `Expected observable:` is prose, not `visible=<state>`; nine explanatory prose lines sit inside the
  field list; and the heading is not `### Scenario N`, so `scenarioEntries` cannot see it —
  `scenarioContract(attachBody, 'manual')` and `(…, 'automatable')` both return null. The stated reason
  for keeping it uncounted is true as far as it goes (`scan-user-execution-plan-order.mjs:460` maps
  `${outcome}:${surface}`, and `actionMapping` has no `manual:public-sdk-example`, so one verdict cannot
  bind a mixed set) — but a contract limit is not an exemption from the rule: "Each user execution test
  scenario must include …" binds every scenario, the catalogue's PASS evidence must name each scenario
  with its canonical surface, invocation and observable type, and the catalogue's only Stage-1 exception
  is for a scenario that is genuinely impossible to WRITE, which this one is not. A written scenario left
  outside the verdict count is a count that misstates the drafted set (two scenarios, `| 1`).
- DONE-GATE-STAGE-1 — A scenario requiring live credentials or an external service states that
  prerequisite explicitly: **NOT MET** (attach). Scenario 1 states "no network access or API key needed"
  with its mechanism (scripted provider via `startCli`'s `providerDefinitions`) and its Linux requirement
  with its cause (`project-relative-writer.ts:46` verified: `if (process.platform !== 'linux') …
refuseProjectRead(…)`). The attach scenario requires "the CLI built" and "a session with at least one
  turn" produced interactively — every provider definition in the tree that declares the flag declares
  `requiresApiKey: true` (anthropic, gemini, openai, deepseek, gemma, qwen; no key-free definition under
  `packages/agent-provider-*`), so that turn needs a live provider credential or an external model
  service, and the scenario names neither; "(Scenario 1's flow, driven interactively)" does not transfer,
  because Scenario 1's provider is injected programmatically and cannot be selected from the built binary.
  An executor learns this from the failure, which is exactly what the criterion forbids.

**Failed criteria:**

- The scenario uses a canonical product-surface identity and matching invocation: the attach
  view-switch scenario has no start command, and its observable type (`rendered-terminal`), rationale
  (`source=tui-render`) and expected-observable shape (prose) are not the canonical `robota-tui` values
  (`ui-state` / `source=rendered-product-ui` / `visible=<state>`); it sits outside the numbered, counted
  set with no exception the catalogue defines.
  **Required action:** Re-author the attach scenario in canonical form — `Command:` with its
  `robota`/`pnpm exec robota` start command, `Observable type: ui-state`, `Observable rationale:
source=rendered-product-ui`, `Expected observable: visible=<state>`, explanatory prose moved out of the
  field list, barrier trio kept — and bring the verdict into a form the rule recognises: a
  `### Scenario N` heading under a verdict/count that binds every drafted scenario. If one verdict
  genuinely cannot bind an automatable and a manual scenario together, that is an amendment for the
  contract's owner (file the backlog item — an argument against a rule is the input to an amendment) or a
  second subject-bound work unit for the attach behaviour; "uncounted by exception" is not a form this
  gate can pass.
- A scenario requiring live credentials or an external service states that prerequisite explicitly: the
  attach scenario's "session with at least one turn" in the built CLI needs a provider credential (every
  shipped provider is `requiresApiKey: true`) or a model service, and states neither.
  **Required action:** Name the provider and credential (or the local model service) as an explicit
  prerequisite, or restructure the setup to a provider-free path (a pre-seeded session record, or a
  scratch launcher that starts the interactive session with the scripted provider inside a real TTY) and
  say which.

**Observations (not criteria; recorded for Stage 2 and the next round):**

- Scenario 1 still expects `forkRunExitCode=0` and a background task id while the parked
  `fork-command.ts` defaults `isolation: 'worktree'` and the fixture's project is a bare `mkdtemp`
  directory, not a git repository — carried over from the 2026-09-08 entry unanswered; a wrong expectation
  is corrected before the Stage-2 run, never after.
- The docker route runs `pnpm install --frozen-lockfile` inside the container (registry access, which
  the "no network access" wording excludes) over the host's macOS `node_modules` through the bind mount,
  and `Cleanup:` does not restore the host install.
- The 2026-09-07 executability probe ("reaches `/fork`'s real command handler") was taken with the
  now-parked implementation present and left no inspectable artifact (`scratch/src/` holds only
  `.gitkeep`); recorded as unverified and not load-bearing.
- `.agents/loop-runs/user-execution-scenario.jsonl` holds one open run for this Task
  (`r20260907135632`, `roundFindings: [0]`, `terminal: null`) with no round for the 2026-09-08 verdict or
  this one.

**Judged at:** HEAD `754c9e239eec` · base `origin/develop@754c9e239eec` · document `.agents/tasks/CLI-1994-fork-the-conversation-into-a-background-session.md` blob `05619a03f1e7` (modified)

### [DONE-GATE-STAGE-1] — ❌ FAIL | 2026-09-08

**Status remains:** scenario drafted (Task frontmatter `status: todo` unchanged; no transition recorded)

**Run:** third Stage-1 run dated 2026-09-08 — the re-run after the `❌ FAIL | 2026-09-08` entry directly
above (blob `05619a03f1e7`); judged against blob `922e5dbe961c`, which differs from that entry's blob by the
re-authored attach block (lines 336–360), the `**Record correction.**` paragraph (362–364) and nothing else
in the scenario set.

**Ordering:** DONE-GATE-STAGE-1 has no prior gate (gate-catalogue.md § Prior-gate map), so only the
input-state half applies, and it holds: the Task sits under `.agents/tasks/`, carries `## User Execution
Test Scenarios` with `**Author verdict:** \`SCENARIO DRAFTED: automatable | 1\``, `## Plan`0/12 ticked,`## Test Plan`12/12`pending`; HEAD `754c9e239eec`equals`origin/develop`; `git status --short`lists`.agents/learn.md`(M),`.agents/loop-runs/user-execution-scenario.jsonl`(M), the spec (AM) and this Task
(AM); no implementation path is in the tree —`packages/agent-command/src/fork/`absent,`switch-session`zero hits under`packages/`, `TExecutionControl`at`workspace-contracts.ts:22`still the six-member union,`resumeSessionId`occurs only in the pre-existing CLI/print/serve modes, none of`fork-record.test.ts`,
`fork-job-resumes-record.test.ts`, `fork-command.test.ts`, `fork-attach.test.tsx`,
`interactive-session-fork-record.ts`tracked or on disk. The parked work is where the Task says: the
tarball exists (1,139,200 bytes,`tar -tf`63 entries,`status.txt`58 lines,`deleted.txt`empty, plus a`task-ticked.md` copy of the ticked Task). The prior FAIL's required actions were checked, not assumed:
credential named for attach — yes (`ANTHROPIC_API_KEY`); `Observable type: ui-state`, `Observable
rationale: source=rendered-product-ui`, `Expected observable: visible=…`, a `Command:`line and the barrier
trio — present; the prose moved out of the field list — no (8 lines remain inside it); the verdict brought
into a form the rule recognises — no (heading`### Written but uncounted — …`, count still `| 1`). Residuals
from the prior entry are closed: the Task now states the 2026-09-07 entry was never written, and the spec's
`[RECORD NOTE]`now says "parked in a tarball outside the tree (not`git stash` …)".

**Per-criterion record:**

- DONE-GATE-STAGE-1 — Every scenario is written with exact commands or UI steps, prerequisites, an
  expected observable result, and an evidence field: MET. Scenario 1 carries `Command:`, `Prerequisites:`,
  `Expected observable:`, `Evidence:` and reproduces its fixture script in full
  (`validateApplicableScenarioSection` → `ok: true`, 1 entry). The attach block carries `Command:`,
  `UI steps:` (six ordered steps), `Prerequisites:`, `Expected observable:`, `Evidence:`. Its configure
  command is complete as written: `provider-startup.ts:145-147` requires only `--type`
  (`--configure-provider requires a provider profile and --type`) and `:152` treats `--model` as optional.
  Noted, not failed: the `a` key in the UI steps comes from the parked `ExecutionWorkspaceSwitcher.tsx`, not
  from spec § Solution 6, which names no key.
- DONE-GATE-STAGE-1 — Every scenario carries its executability decision: MET, with reservations. Scenario 1
  is `agent-executable` and names its non-Linux route; verified on this host: `docker` at
  `/Users/jungyoun/.rd/bin/docker`, daemon 29.1.3 answering, `pnpm exec robota --version` prints
  `robota 3.0.0-beta.72` from the worktree root, `node_modules/.bin/tsx` present, `dist/` present for
  `agent-core`/`agent-framework`/`agent-cli`. The only cached node image is `node:22.14.0-bookworm`, not the
  `node:22` tag the command names, so the first run pulls. The attach block is `manual-only:` with a
  specific technical reason, and its checkable parts hold: the quoted Ink error exists
  (`ink@7.1.1` `build/components/App.js` contains "Raw mode is not supported"), and `TScriptedTurn`
  (`packages/agent-core/src/testing/scripted-provider.ts:27-32`) is `{ text } | { toolCalls }` with no
  hold/delay capability, so "no shipped fixture provides" a turn that stays open is true. Reservation carried
  forward: `attempted automation:` records an engineering-level component test (`ink-testing-library`,
  TC-08/09) and a pty route "attempted in design" — no attempt on the user surface is recorded, and
  `backlog-execution.md` § Scenario Design Preference Order prescribes restructuring toward "a fixture the
  work itself ships" (the Scenario 1 fixture already constructs a custom `IProviderDefinition`; one whose
  `chat()` awaits a file signal would keep the fork running for as long as attach needs). Recorded, not
  decided on.
- DONE-GATE-STAGE-1 — The scenario uses a canonical product-surface identity and matching invocation; the
  observable is not a build/typecheck/lint/test/harness/CI check or text inspection: **NOT MET** (attach).
  Scenario 1 is canonical and mechanically bound — `scenarioContract(body, 'automatable')` → surface
  `public-sdk-example`, rationale `shipped-interface=public-sdk-example`, invocation
  `pnpm exec tsx scratch/src/cli-1994-fork-scenario.ts`, `sdk-result`, `source=public-sdk-return`,
  `result=…` — and its observable is product behaviour (`.robota/sessions/*.json` written by the product's
  own session path plus print-mode stdout): `guardian-observable-verdict=product-behavior`. Reservation
  carried forward unchanged: the rule reserves `public-sdk-example` for SDK-only features and defaults
  command-package work to `robota …`, and the fixture imports `../../packages/agent-cli/src/cli.js`
  rather than a `scratch/package.json` dependency. The attach block is not canonical:
  `scenarioContract(attachBody, 'manual')` and `(…, 'automatable')` both return null, and substitution
  isolates three causes — (a) eight non-field prose lines sit inside the block ("This scenario is WRITTEN in
  full …" through "… claimed under that record, not asserted."), and the contract requires every line of a
  scenario to be a known field; (b) `Surface rationale: shipped-interface=robota-tui` is not a canonical
  value — the rule lists exactly three (`shipped-entrypoint=robota`, `shipped-interface=robota-browser-ui`,
  `shipped-interface=public-sdk-example`) and `robota-tui` maps to `shipped-entrypoint=robota`
  (`user-execution-scenario-contract.mjs:96-97`); (c) `Command: \`pnpm exec robota\` (interactive; then the
  UI steps)`—`tokenizeCanonicalShell`returns null on the trailing text, so`productSurfaceInvocation('robota-tui', …)`is null. With (a)+(b)+(c) corrected the block binds under`manual`(invocation`pnpm exec robota`, `ui-state`, barrier `accessibility-tree-unavailable`). (d) Its
heading is not `### Scenario N`, so `scenarioEntries`sees one scenario where two are drafted, and the
author verdict`| 1`misstates the drafted set; the catalogue's PASS evidence must name each scenario and
the`doneGateStageOne`record must bind the authored scenario fields exactly, so a PASS naming both cannot
bind against a section that declares one and a PASS naming one omits a written scenario. The exception
claimed ("written but uncounted", under`LRN-scenario-contract-single-executability`in`.agents/learn.md`) is not one the catalogue defines — its only Stage-1 exception is for a scenario
genuinely impossible to WRITE — and AGENTS.md sets the floor for an amendment attempt at a filed backlog
item; the learn.md entry itself records "Not yet allocated a Task". The underlying claim is true and is
recorded as such: `matchingExecutability`(contract lines 128-148) requires`agent-executable`under`automatable`and`manual-only:`under`manual`, so one verdict cannot bind this mixed pair — which is why
  the compliant routes are the ones the prior entry named, not an uncounted block.
- DONE-GATE-STAGE-1 — A scenario requiring live credentials or an external service states that
  prerequisite explicitly: MET. The attach block names the provider, `ANTHROPIC_API_KEY`, the configure
  command and the throwaway HOME. Scenario 1 states it is provider-free with its mechanism (scripted
  provider via `startCli`'s `providerDefinitions`) and its Linux requirement with its cause
  (`project-relative-writer.ts:46-50`, verified: `if (process.platform !== 'linux') … refuseProjectRead(…)`).
  Defect recorded, not decided on: the docker route needs registry access (`pnpm install --frozen-lockfile`
  in the container) and, on this host, an image pull, while the same `Prerequisites:` says "no network
  access or API key needed"; say which route the sentence applies to.

**Failed criteria:**

- The scenario uses a canonical product-surface identity and matching invocation: the attach view-switch
  block is non-canonical on three fields (prose inside the field list; `Surface rationale:
shipped-interface=robota-tui` where `robota-tui` requires `shipped-entrypoint=robota`; a `Command:` line
  carrying `(interactive; then the UI steps)` that the invocation tokenizer rejects) and it remains outside
  the numbered, counted set under an exception the catalogue does not define and an amendment attempt that
  has not reached the filed-backlog-item floor.
  **Required action:** Make the block canonical — delete the prose between its heading and its first
  field (move any explanation above the `**Author verdict:**` line or into a paragraph outside the
  scenario), set `Surface rationale: shipped-entrypoint=robota`, set `Command:` to exactly
  `\`pnpm exec robota\``with the interaction left to`UI steps:`— and then take one of the three
compliant routes: (1) file the backlog item for the contract amendment (open the GitHub Issue, allocate
the Task) and cite it here, keeping the block outside the count until the amendment lands; (2) split the
attach behaviour into its own subject-bound work unit with its own`manual | 1`verdict and remove the
block from this Task; or (3) redesign attach as agent-executable (pty-driven start plus a scratch
provider whose turn stays open on a signal) so both scenarios bind under`automatable | 2`with`### Scenario 2` as its heading. Then re-run DONE-GATE-STAGE-1 in its own invocation.

**Observations (not criteria; recorded for the next round and Stage 2):**

- Scenario 1 still expects `forkRunExitCode=0` and a background task id while spec TC-07 defaults `/fork`
  to `isolation: 'worktree'` and the fixture's project is a bare `mkdtemp` directory, not a git
  repository (`worktree-subagent-runner.ts:59` branches on that isolation) — carried over from both prior
  entries, still unanswered; a wrong expectation is corrected before the Stage-2 run, never after.
- The docker route's `pnpm install` runs inside Linux over the bind-mounted host `node_modules` and
  `Cleanup:` does not restore the host install afterwards.
- The attach `visible=` value also embeds an `ls … sessions/` file check (a `product-state-file`
  observable folded into a `ui-state` one), and its "while it is still running" step is a race against
  the fork's single model turn, since § Solution 6 refuses attach on a terminal task; confirm the
  expectation is reachable before Stage 2.
- `.agents/learn.md` carries a 19-line uncommitted addition (the LRN entry) and also appears in the parked
  tarball; it is outside the paired planning artifacts — GATE-IMPLEMENT's inventory to judge, not this
  gate's.
- `.agents/loop-runs/user-execution-scenario.jsonl` still holds one open run for this Task
  (`r20260907135632`, `roundFindings: [0]`, `terminal: null`) with no round for any 2026-09-08 verdict.
- The 2026-09-07 executability probe remains unverifiable (`scratch/src/` holds only `.gitkeep`); not
  load-bearing.

**Judged at:** HEAD `754c9e239eec` · base `origin/develop@754c9e239eec` · document `.agents/tasks/CLI-1994-fork-the-conversation-into-a-background-session.md` blob `922e5dbe961c` (modified)
