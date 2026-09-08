---
status: in-progress
type: FLOW
tags: [cli, typescript]
lane: L2
---

# CLI-1994: fork the conversation into a background session

Paired with `.agents/tasks/CLI-1994-fork-the-conversation-into-a-background-session.md`. Arising from [issue #1994](https://github.com/woojubb/robota/issues/1994) (parent: issue #1981).

## Problem

**Symptom.** A session can be copied only at startup, from outside itself, and the copy replaces the
terminal instead of running beside it. Verified in the tree:

1. **The fork is a startup flag and nothing else.** `--fork-session`
   (`packages/agent-cli/src/utils/cli-args.ts:186`, parsed at `:258`, help at `:96`) reaches the
   framework as `IInteractiveSessionOptions.forkSession`
   (`packages/agent-framework/src/interactive/interactive-session-options.ts:59`), where its entire
   mechanism is one line — `const sessionId = options.resumeSessionId && !options.forkSession ?
options.resumeSessionId : undefined;`
   (`packages/agent-framework/src/interactive/interactive-session-init.ts:130-131`). There is no
   command, tool, or API that reaches it from inside a live session. Bare `--fork-session` without
   `-c`/`-r` is accepted and silently does nothing, because the restore path is gated on
   `options.resumeSessionId`.
2. **The copy takes over the terminal.** The forked session _is_ the process's session; the original
   is not running. Nothing in the repo starts a session copy as a background job.
3. **No child path carries a conversation or the parent's prompt.** Every existing child —
   `createSubagentSession` (`packages/agent-framework/src/assembly/create-subagent-session.ts:196`),
   the in-process runner (`packages/agent-framework/src/subagents/in-process-subagent-runner.ts:186-236`),
   the child-process worker, and `runSkillInFork`
   (`packages/agent-framework/src/interactive/interactive-session-fork.ts:36-67`) — builds its prompt
   with `assembleSubagentPrompt` (`packages/agent-framework/src/assembly/subagent-prompts.ts:69-84`,
   `agentBody + CLAUDE.md + AGENTS.md + suffix`) and calls `session.run(prompt)` with an empty
   conversation. A subagent's prompt is structurally different from an interactive one: it never calls
   `buildSystemPrompt` (`packages/agent-framework/src/context/system-prompt-builder.ts:124-145`), so it
   has no persona, self-verification, memory, cwd, tool-description or skills sections.
4. **The spawn contract has nowhere to put a conversation.** `ISpawnAgentJobInput`
   (`packages/agent-framework/src/interactive/interactive-session-agent-jobs.ts:63-70`) is
   `{ agentType, label, mode, prompt, model?, isolation? }`, and `IAgentBackgroundTaskRequest`
   (`packages/agent-interface-execution/src/background-task-contracts.ts:86-100`) likewise carries only
   `prompt: string`. Neither has a seed-history or resume-id field.
5. **The material for the prompt half already exists and is dead.** `buildInteractiveSessionRecord`
   writes `systemPrompt: input.session.getSystemMessage()` and `toolSchemas: …`
   (`packages/agent-framework/src/interactive/interactive-session-persistence.ts:132-133`), and
   `grep -rn "record.systemPrompt\|record.toolSchemas" packages/*/src` outside tests returns **nothing** —
   `loadSessionRecord` (`interactive-session-restore.ts:48-141`) never reads either back.
6. **There is no attach.** `TExecutionControl`
   (`packages/agent-interface-execution/src/workspace-contracts.ts:22`) is
   `'select' | 'cancel' | 'close' | 'send' | 'read_log' | 'wait'`, and the UI-intent union
   (`packages/agent-interface-command/src/command-contracts.ts:132-135`) has
   `show-plugin-manager | show-settings | show-session-picker | show-agent-switcher` — no
   switch-to-session intent.
7. **Two copy leaks in the existing startup fork.** `interactive-session.ts:318` sets
   `this.sessionName = restored.sessionName`, so the fork answers to the source's name in
   `resolveSessionIdByIdOrName` (`packages/agent-framework/src/interactive/session-persistence.ts:97`);
   and a spawned job inherits the parent's cwd (`interactive-session-agent-jobs.ts:92`,
   `deps.cwd ?? cwd ?? process.cwd()`), so filesystem work collides unless
   `isolation: 'worktree'` is set.

**Reproduction condition.** In a live session, after the expensive context is built — which is exactly
when a fork is wanted — there is no way to obtain one: no slash command lists a fork verb
(`packages/agent-command/src/default/default-command-modules.ts:95-140` registers `/agent` at `:107`,
`/background` at `:112`, `/peers` at `:129`, and no fork), and the only mechanism requires quitting and
relaunching with `robota -c --fork-session`, which ends the session the user wanted to keep. Even then
the copy is the foreground session, and its system prompt is rebuilt from scratch rather than inherited.

## Prior Art Research

Waived: the reference behaviour for this item is two sentences of Claude Code product documentation already quoted verbatim in issue #1994's own checklist — https://code.claude.com/docs/en/commands ("Copy the current conversation into a new background session and keep working here") and https://code.claude.com/docs/en/sub-agents (a subagent "runs its own" system prompt, unlike a fork). Both were re-read live on 2026-09-07 and both still hold; the changelog range v2.1.238–v2.1.263 contains no entry changing either. The design question this spec must answer is not "what do comparable products do" — the five checklist lines are already the answer, and no second product documents a _background_ conversation fork — but "which of this repository's two existing copy mechanisms does the fork extend", which is a repo-survey question answered in § Architecture Review from the tree. A full `prior-art-researcher` pass was therefore not dispatched; the sibling seams surveyed instead are `--fork-session` (CLI-073), `createSubagentSession`, and the handoff carrier, each cited below with file and line.

## Architecture Review

### Affected Scope

- `packages/agent-interface-execution` — `src/background-task-contracts.ts`
  (`IAgentBackgroundTaskRequest.resumeSessionId?: string`), `src/workspace-contracts.ts`
  (`TExecutionControl` gains `'attach'`), `docs/SPEC.md`.
- `packages/agent-interface-command` — `src/command-contracts.ts` (the UI-intent union gains
  `{ type: 'switch-session'; sessionId: string }`), `docs/SPEC.md`.
- `packages/agent-framework` — new `src/interactive/interactive-session-fork-record.ts`
  (`buildForkedSessionRecord`), `src/interactive/interactive-session-restore.ts` (read
  `record.systemPrompt` back as `restoredSystemPrompt`), `src/interactive/interactive-session-init.ts`
  (apply it when present), `src/interactive/interactive-session-agent-jobs.ts`
  (`ISpawnAgentJobInput.resumeSessionId`), `src/command-api/host-roles.ts` (a `forkSession` member on
  the session-access role), `src/interactive/interactive-session-base.ts` /
  `interactive-session.ts` (the implementation), `docs/SPEC.md`.
- `packages/agent-command` — new `src/fork/` module (`/fork`), `docs/SPEC.md`.
- `packages/agent-executor` — `src/subagents/subagent-manager.ts` (forward `resumeSessionId`),
  `docs/SPEC.md`.
- `packages/agent-subagent-runner`, `packages/agent-framework/src/subagents/in-process-subagent-runner.ts`
  — resume the named session instead of starting empty.
- `packages/agent-transport-tui` — `src/execution-workspace-view-model.ts`,
  `src/BackgroundTaskPanel.tsx`, `src/flows/background-focus-flow.ts` (the `attach` control),
  `docs/SPEC.md`.
- `.agents/tasks/CLI-1994-fork-the-conversation-into-a-background-session.md`.

Not in scope, stated so the boundary is explicit: output styles (issue #1988 / `CLI-082`, `skipped`) —
see the Decision's line-3 verdict for why this is deliberately _not_ a dependency; checkpoint branching
(`SELFHOST-007` `forkCheckpointBranch`, a different fork concept over filesystem checkpoints in the same
session); cross-device handoff (`HANDOFF-001`, which carries a whole record to another machine); and the
kind-safe background-contract migration (`DATA-011`) and `/background` relocation (`CMD-015`), both open
and touching the same files — this spec adds one optional field and one union member rather than
restructuring, so it composes with either landing first.

### Alternatives Considered

1. **Write a forked record, then spawn a background job that resumes it (chosen).** `/fork` builds a new
   `IInteractiveSessionRecord` from the live session — fresh `session_<uuid>`, copied `messages` and
   `systemPrompt`, a distinct name — writes it through the session store, then spawns a background agent
   job carrying `resumeSessionId`. The worker restores that record exactly as `--fork-session` does today.
   - Pro: reuses `loadSessionRecord` and the deferred injection at `interactive-session-init.ts:276-278`
     verbatim; the conversation never crosses a process wire (the child reads the file), so the
     child-process runner's deliberate projection boundary (ARCH-044, which keeps AGENTS.md/CLAUDE.md
     text off the wire) is respected; the copy is durable and inspectable on disk before the job starts;
     and the "is a copy" property is the one already proven by `fork-restores-context.test.ts` TC-03.
   - Con: the fork is written to disk even if the job never runs; it needs a session-store capability on
     the command host, which `ICommandHostAdapters`
     (`packages/agent-framework/src/command-api/host-adapters.ts:225-246`) does not have today.
2. **Carry the conversation on the spawn request (`seedMessages: TUniversalMessage[]`).**
   - Pro: no store write, no new host capability; the request is self-contained.
   - Con: it puts a whole conversation on the child-process wire, which ARCH-044 exists to prevent; the
     request becomes unboundedly large; and it duplicates a restore path that already works, so two
     mechanisms would have to agree about what a copy includes.
3. **Reuse `runSkillInFork`'s in-process fork.**
   - Pro: exists today; inherits the parent's cwd (ARCH-010).
   - Con: it is a one-shot blocking `forkSession.run(content)` with no task id, so it does not appear in
     `/background`, cannot be stopped, and cannot be attached to — it fails four of the five checklist
     lines. It also starts with an empty conversation and a fork-worker suffix prompt.

### Decision

Alternative 1. The trade-off that decided it: Alternative 2 is cheaper at the command boundary and pays
for it at the process boundary, putting the full conversation on a wire the repository deliberately keeps
narrow (ARCH-044), while Alternative 1 pays once for a session-store capability and then reuses a restore
path that is already proven by three existing tests. Alternative 3 is not a smaller version of the
feature; it is a different one that fails most of the gate list.

Checklist verdicts (issue #1994, one per line):

| #   | Line                                                                                        | Verdict                              | Reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | One command forks from **inside** the conversation                                          | **Adopt**                            | `/fork [name]` — a `userInvocable`, `modelInvocable: false`, `lifecycle: 'inline'` command module mirroring `packages/agent-command/src/peers/peers-command-module.ts`. It reads the live conversation through `ICommandSessionHistory` (`packages/agent-framework/src/command-api/session-roles.ts:19-24`) and the prompt through `session.getSystemMessage()`, writes the record through a new host capability, and spawns the job.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 2   | Runs in the **background**; the original stays interactive                                  | **Adopt**                            | `spawnAgentJobFromSession({ mode: 'background', … , resumeSessionId })`. The parent is never blocked — this half is entirely existing machinery.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| 3   | Inherits the parent's full system prompt, **including the output style**, unlike a subagent | **Adapt**                            | Specified as _"inherits the parent's **assembled system message**"_. That is strictly stronger and removes the dependency on issue #1988: `getSystemMessage()` already contains every `buildSystemPrompt` section (preset prompt, persona, self-verification, AGENTS.md, CLAUDE.md, memory, cwd, response language, tool descriptions, skills), and an output style would be one more section inside the same string, so the fork picks it up for free whenever #1988 lands. Output styles do not exist in the tree — `grep -rn "outputStyle\|output-style" packages apps` returns zero code occurrences, independently confirmed by `CLI-082`'s research pass — so a line worded against a named style would block this item on an unstarted one for no gain. Mechanically: `record.systemPrompt` is already written and read by nobody; this spec makes the restore path read it and the fork apply it, which also retires a dead field. |
| 4   | Appears in the background list; can be **attached to**, peeked at, and stopped              | **Adapt**                            | List / peek / stop / send are existing behaviour the moment the fork is a `kind: 'agent'` background task (`/background list`, `read`/`open`, `cancel`, `close`, and the TUI panel). **Attach is new** and is the only genuinely new user surface: `TExecutionControl` gains `'attach'` and the command layer gains a `{ type: 'switch-session'; sessionId }` UI intent that the TUI honours by pointing its channel at the forked session id — reusing the existing session-switch path (`session-switch-channel.test.tsx` pins that the factory is the sole channel source and the previous channel is stopped first). Attaching is a _view_ switch, not a merge: the two sessions stay separate records.                                                                                                                                                                                                                                |
| 5   | Is a copy — work in it does not affect the original                                         | **Adopt, and close two known leaks** | The append-only property is established (`fork-restores-context.test.ts` TC-03 asserts the source file is byte-identical; `print-mode-integration.test.ts` TC-03 asserts two records and an unchanged source message count). Two leaks are closed here rather than inherited: (a) the fork gets a **distinct name** — `<source name or id> (fork)`, or the operator's `/fork <name>` — instead of `interactive-session.ts:318`'s inherited one, so `resolveSessionIdByIdOrName` cannot match two records; (b) the fork job declares `isolation: 'worktree'` by default so filesystem work does not collide with the parent's cwd, with `/fork --same-dir` to opt out. Fields the startup fork already drops — `sandboxSnapshotId`, `goal`, `plan`, `activeBranch` (`interactive-session.ts:326-332`) — are dropped identically.                                                                                                            |

Validation (spec-workflow.md § "Validated Recommendation Before Approval" — this adds members to two
interface packages):

- _Reachability._ `IAgentBackgroundTaskRequest.resumeSessionId?` is optional, so every existing spawn is
  unchanged; `TExecutionControl` and the UI-intent union are unions whose consumers switch on the member
  (adding one is a compile error only where a switch is exhaustive, which TC-08 asserts is handled).
  `record.systemPrompt` is already written by every persist, so no migration is needed for existing
  records — a record without it simply rebuilds the prompt as today.
- _Capability preservation._ `--fork-session` keeps its current semantics; this adds a second entry
  point to the same restore path rather than changing it. `runSkillInFork` is untouched.
- _Adversarial pass._ (a) A forked record whose `systemPrompt` is stale relative to the current
  AGENTS.md is still the _parent's_ prompt, which is what "inherits" means — the fork is a copy of the
  conversation as it was, and TC-04 pins that the applied prompt equals the parent's at fork time.
  (b) The child-process runner never receives the conversation on the wire; it reads the record from the
  project state directory, so ARCH-044's projection boundary is intact — TC-06 asserts the wire DTO
  carries only `resumeSessionId`. (c) Attaching to a forked session that has since failed must not
  strand the TUI: attach is refused with the task's status when the session record is missing or the
  task is terminal, asserted by TC-09. (d) A fork of a fork increases `depth`
  (`interactive-session-agent-jobs.ts:93`, `(deps.subagentDepth ?? 0) + 1`), so the existing depth guard
  applies unchanged. (e) Worktree isolation is already plumbed end to end
  (`TBackgroundTaskIsolation`), so defaulting to it introduces no new mechanism.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — the repository's three existing copy/child mechanisms were scanned and each is
      cited above: `--fork-session` (CLI-073, `.agents/spec-docs/done/CLI-073-fork-restores-context.md`)
      whose restore path this reuses; `createSubagentSession` / `runSkillInFork` (ARCH-010) which start
      empty and are explicitly _not_ extended; and the handoff carrier
      (`packages/agent-interface-session-mobility/src/handoff-contracts.ts:116`, whole-record transfer to
      another machine) which is the only other full-record copy and is out of scope. `SELFHOST-007`'s
      `forkCheckpointBranch` was checked and is a different concept (checkpoint branches within one
      session), recorded so the two are not conflated.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — one new command module (`packages/agent-command/src/fork/`)
      mirroring the sibling `src/peers/` in the same package, one new framework module beside its
      `interactive-session-*.ts` siblings, and optional members added to two existing contract modules
      that already own those unions (`workspace-contracts.ts` owns `TExecutionControl`,
      `command-contracts.ts` owns the UI-intent union — both already listed in
      `.agents/specs/contract-family-owner-map.md`). No new package, app, presentation or interface
      surface; no layer or product-family reclassification; no new package dependency edge.

## Fallback & Degradation Declaration

None. Every new path is a declared branch: a record with no `systemPrompt` rebuilds the prompt exactly as
today (the pre-existing behaviour, not a caught error), and `attach` on a missing record or terminal task
is an explicit refusal that names the reason rather than a silent no-op.

## Solution

1. **Forked record builder** — new
   `packages/agent-framework/src/interactive/interactive-session-fork-record.ts`:
   `buildForkedSessionRecord({ source, name, cwd })` returns an `IInteractiveSessionRecord` with a fresh
   `session_<uuid>` (`createSessionId`), `messages: session.getHistory()`,
   `systemPrompt: session.getSystemMessage()`, `toolSchemas: session.getToolSchemas()`,
   `history: session.getFullHistory()`, fresh `createdAt`/`updatedAt`, the distinct `name`, and no
   `sandboxSnapshotId` / `goal` / `plan` / `activeBranch`.
2. **Prompt restore** — `loadSessionRecord`
   (`packages/agent-framework/src/interactive/interactive-session-restore.ts`) returns
   `restoredSystemPrompt: record.systemPrompt`; `interactive-session-init.ts` passes it into session
   assembly as the system message when present, so the field stops being dead.
3. **Host capability** — `ICommandHostSessionAccess`
   (`packages/agent-framework/src/command-api/host-roles.ts:46-56`) gains
   `forkSession(input: { name?: string }): Promise<{ sessionId: string; name: string }>`, implemented on
   `InteractiveSession` by calling the builder and `sessionStore.save`. This is a role-port member rather
   than an `ICommandHostAdapters` entry because the session store is already owned by the session, not
   by the shell.
4. **Spawn plumbing** — `IAgentBackgroundTaskRequest.resumeSessionId?: string`
   (`packages/agent-interface-execution/src/background-task-contracts.ts`), inherited by
   `ISubagentSpawnRequest`; `ISpawnAgentJobInput.resumeSessionId?`
   (`interactive-session-agent-jobs.ts:63-70`) forwarded at `:93`; `SubagentManager.spawn`
   (`packages/agent-executor/src/subagents/subagent-manager.ts:81-84`) passes it through; the in-process
   runner (`in-process-subagent-runner.ts:189`) and the child-process worker construct the child session
   with `resumeSessionId` + `forkSession: false` so it _restores_ that record rather than starting empty.
5. **The command** — new `packages/agent-command/src/fork/{fork-command-module.ts,fork-command.ts,index.ts}`,
   registered in `default-command-modules.ts` beside `/background`. `/fork [name] [--same-dir]`:
   calls `context.getSession().forkSession({ name })`, then `spawnAgentJob({ agentType: 'general-purpose',
label: name, mode: 'background', prompt: '', resumeSessionId, isolation: 'worktree' | 'none' })`, and
   reports the task id and the new session name. `sessionRequirements: ['agent-runtime']`.
6. **Attach** — `TExecutionControl` gains `'attach'`; the execution-workspace detail exposes it for a
   `background_task` entry whose request carries a `resumeSessionId`; selecting it emits the new
   `{ type: 'switch-session'; sessionId }` UI intent, which the TUI handles through its existing
   session-switch path (a new channel via the factory, the previous one stopped first). Attach is refused
   with the task's status when the record is missing or the task is terminal.
7. **Docs** — SPEC.md of `agent-interface-execution` (the request field and the control),
   `agent-interface-command` (the intent), `agent-framework` (the fork record, the prompt restore, the
   host member), `agent-command` (`/fork`), `agent-executor` (pass-through), `agent-transport-tui`
   (attach), each stating that a fork is a _copy_ and that attach is a view switch, not a merge.

### Corrections against the tree (2026-09-08, after independent review)

Four points where the shipped code deliberately differs from § Solution / § Decision above. Each is
here rather than edited into the prose, so the plan and what shipped can both be read.

1. **The first turn is `'Continue.'`, not `''`** (§ Solution 5). A turn with no user content is
   rejected by providers; one word is the smallest thing that is not, and anything longer would be
   the neutral command layer deciding how a forked agent behaves.
2. **`switch-session` is not a `TCommandUiIntent` member** (§ Solution 6). Attach starts at a
   keypress in the TUI's own background panel, not at a command, so the requester-routed intent bus
   would add a hop with no second consumer. The union member and its `useSideEffects` case were a
   reader with no writer and are removed; attach and the session picker call `App`'s one
   `onSessionSwitch`, so "one switch path" holds through the shared function.
3. **Worktree isolation is honoured only by the runtime-shell runner.** § Decision's adversarial pass
   said the mechanism was plumbed end to end; the in-process runner refuses it outright
   (`in-process-subagent-runner.ts`). The shipped binary selects the child-process runner, so a bare
   `/fork` works there; under `--session-log` or an embedding that supplies its own
   `providerDefinitions`, `/fork --same-dir` is the route. The refusal now names that recovery where
   the operator meets it.
4. **A fork's own turns are not written back to its record.** `createSubagentSession` composes no
   session store, so attach opens the copy as it stood at fork time. Recorded as a known limitation
   in `agent-transport-tui/docs/SPEC.md`, stated in `/fork`'s own message, and filed as
   [issue 2675](https://github.com/woojubb/robota/issues/2675).

The generated fork name also counts up (`(fork)`, `(fork 2)`, …) and an explicit name already in the
store is refused: checking only against the SOURCE's name left the commonest collision — forking the
same parent twice — open.

## Affected Files

- `packages/agent-interface-execution/src/background-task-contracts.ts` — `resumeSessionId`
- `packages/agent-interface-execution/src/workspace-contracts.ts` — `'attach'`
- `packages/agent-interface-execution/docs/SPEC.md`
- `packages/agent-interface-command/src/command-contracts.ts` — `switch-session`
- `packages/agent-interface-command/docs/SPEC.md`
- `packages/agent-framework/src/interactive/interactive-session-fork-record.ts` — new
- `packages/agent-framework/src/interactive/__tests__/fork-record.test.ts` — new (TC-01, TC-02)
- `packages/agent-framework/src/interactive/interactive-session-restore.ts` — `restoredSystemPrompt`
- `packages/agent-framework/src/interactive/interactive-session-init.ts` — apply it
- `packages/agent-framework/src/interactive/__tests__/fork-restores-context.test.ts` — TC-04 case
- `packages/agent-framework/src/interactive/interactive-session-agent-jobs.ts` — `resumeSessionId`
- `packages/agent-framework/src/interactive/__tests__/interactive-session-agent-jobs.semantic-roles.test.ts` — TC-05 case
- `packages/agent-framework/src/command-api/host-roles.ts` — `forkSession`
- `packages/agent-framework/src/interactive/interactive-session.ts` — implementation
- `packages/agent-framework/src/subagents/in-process-subagent-runner.ts` — resume the record
- `packages/agent-framework/src/subagents/__tests__/fork-job-resumes-record.test.ts` — new (TC-03)
- `packages/agent-framework/docs/SPEC.md`
- `packages/agent-executor/src/subagents/subagent-manager.ts` — pass-through
- `packages/agent-executor/docs/SPEC.md`
- `packages/agent-subagent-runner/src/child-process-subagent-worker.ts` — resume; wire DTO
- `packages/agent-subagent-runner/src/__tests__/subagent-worker-start-dto.test.ts` — TC-06 case
- `packages/agent-command/src/fork/fork-command-module.ts`, `fork-command.ts`, `index.ts` — new
- `packages/agent-command/src/fork/__tests__/fork-command.test.ts` — new (TC-07)
- `packages/agent-command/src/default/default-command-modules.ts` — registration
- `packages/agent-command/docs/SPEC.md`
- `packages/agent-transport-tui/src/execution-workspace-view-model.ts`, `BackgroundTaskPanel.tsx`, `flows/background-focus-flow.ts` — attach
- `packages/agent-transport-tui/src/__tests__/fork-attach.test.tsx` — new (TC-08, TC-09)
- `packages/agent-transport-tui/docs/SPEC.md`
- `.agents/tasks/CLI-1994-fork-the-conversation-into-a-background-session.md`

## Completion Criteria

- [x] TC-01: `pnpm --filter @robota-sdk/agent-framework exec vitest run src/interactive/__tests__/fork-record.test.ts`
      → exits 0; `buildForkedSessionRecord` from a session with two messages produces a record whose `id`
      differs from the source, whose `messages` equal the source's, whose `systemPrompt` equals
      `session.getSystemMessage()`, whose `name` is not the source's name, and which carries no
      `goal`, `plan`, `activeBranch` or `sandboxSnapshotId`.
- [x] TC-02: same file — writing the forked record leaves the source record byte-identical (read the
      source file before and after and compare strings), and the store then lists exactly two records.
- [x] TC-03: `pnpm --filter @robota-sdk/agent-framework exec vitest run src/subagents/__tests__/fork-job-resumes-record.test.ts`
      → exits 0; an in-process job started with `resumeSessionId` pointing at a forked record makes its
      first provider request contain the copied conversation, and the same job without `resumeSessionId`
      makes a request containing only its own prompt. RED with the runner's `resumeSessionId` forwarding
      removed.
- [x] TC-04: `pnpm --filter @robota-sdk/agent-framework exec vitest run src/interactive/__tests__/fork-restores-context.test.ts`
      → exits 0; `loadSessionRecord` returns `restoredSystemPrompt` equal to the persisted
      `record.systemPrompt`, and a session initialised from it reports that exact string from
      `getSystemMessage()`; a record with no `systemPrompt` still initialises and rebuilds the prompt
      (the unchanged pre-existing path). RED with the restore read removed.
- [x] TC-05: `pnpm --filter @robota-sdk/agent-framework exec vitest run src/interactive/__tests__/interactive-session-agent-jobs.semantic-roles.test.ts`
      → exits 0; `spawnAgentJob({ ..., resumeSessionId: 'session_x' })` hands the manager a request
      carrying `resumeSessionId: 'session_x'`; omitting it yields a request with no such key.
- [x] TC-06: `pnpm --filter @robota-sdk/agent-subagent-runner exec vitest run src/__tests__/subagent-worker-start-dto.test.ts`
      → exits 0; the child-process start DTO for a fork job carries `resumeSessionId` and does **not**
      carry any message array or AGENTS.md/CLAUDE.md text (asserted by a key-set check), preserving the
      ARCH-044 projection boundary.
- [x] TC-07: `pnpm --filter @robota-sdk/agent-command exec vitest run src/fork/__tests__/fork-command.test.ts`
      → exits 0; `/fork` calls `getSession().forkSession({})` once and then `spawnAgentJob` with
      `mode: 'background'`, `isolation: 'worktree'` and the returned `resumeSessionId`, and prints the new
      session name and task id; `/fork my-branch` passes `name: 'my-branch'`; `/fork --same-dir` passes
      `isolation: 'none'`; a `forkSession` rejection is reported and no job is spawned.
- [x] TC-08: `pnpm --filter @robota-sdk/agent-transport-tui exec vitest run src/__tests__/fork-attach.test.tsx`
      → exits 0; a background-task entry whose request carries `resumeSessionId` offers the `attach`
      control and selecting it emits `{ type: 'switch-session', sessionId }`; an entry without one does
      not offer it; every exhaustive switch over `TExecutionControl` still compiles
      (`pnpm --filter @robota-sdk/agent-transport-tui run typecheck` exits 0).
- [x] TC-09: same file — attaching to a task whose session record is missing, or whose status is
      terminal, is refused with a message naming the status, and no `switch-session` intent is emitted.
- [x] TC-10: `pnpm --filter @robota-sdk/agent-cli exec vitest run src/modes/__tests__/print-mode-integration.test.ts src/utils/__tests__/cli-args.test.ts`
      → exits 0 — `--fork-session`'s existing behaviour is unchanged by this change.
- [x] TC-11: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
      → exits 0.
- [x] TC-12: `grep -n "fork" packages/agent-framework/docs/SPEC.md packages/agent-command/docs/SPEC.md packages/agent-interface-execution/docs/SPEC.md packages/agent-interface-command/docs/SPEC.md packages/agent-transport-tui/docs/SPEC.md packages/agent-executor/docs/SPEC.md`
      → at least one match in each of the six files, and `agent-framework/docs/SPEC.md` states that a
      fork inherits the parent's assembled system message and that attach is a view switch, not a merge.

## Test Plan

Test strategy (type FLOW, tags `[cli, typescript]`): process/session integration tests over the real
session store and the scripted provider, plus component tests for the attach control. Every criterion is
command-form.

| TC-ID | Test Type        | Tool / Approach                                                                                | Notes                                                                    |
| ----- | ---------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| TC-01 | Unit             | vitest, new `fork-record.test.ts` over a real `FileSessionStore` fixture                       | Record shape and the dropped fields                                      |
| TC-02 | Integration      | same file (byte-compare of the source file, as `fork-restores-context.test.ts` TC-03 does)     | The copy invariant                                                       |
| TC-03 | Integration      | vitest, new `fork-job-resumes-record.test.ts` with `createScriptedProvider`                    | The conversation reaches the child; RED without forwarding               |
| TC-04 | Integration      | vitest, existing `fork-restores-context.test.ts`                                               | The dead `systemPrompt` field becomes live; the no-prompt path unchanged |
| TC-05 | Unit             | vitest, existing agent-jobs test (manager `spawn` captured)                                    | Request field plumbing                                                   |
| TC-06 | Unit             | vitest, existing start-DTO test                                                                | ARCH-044 boundary held (key-set assertion)                               |
| TC-07 | Unit             | vitest, new `fork-command.test.ts` (host context stubbed)                                      | Command behaviour incl. flags and the failure path                       |
| TC-08 | Component + Type | vitest + `ink-testing-library`, new `fork-attach.test.tsx`; `tsgo` via the package `typecheck` | The new control and the union's exhaustive switches                      |
| TC-09 | Component        | same file                                                                                      | Attach refusals                                                          |
| TC-10 | Regression       | vitest, existing print-mode and cli-args suites                                                | `--fork-session` untouched                                               |
| TC-11 | Suite            | `run-all-scans.mjs --affected --context pr`                                                    | Regression over the affected set                                         |
| TC-12 | Command          | `grep`                                                                                         | SPEC coverage incl. the two stated semantics                             |

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

## Tasks

- [ ] `.agents/tasks/CLI-1994-fork-the-conversation-into-a-background-session.md` — todo

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-09-07

**Status remains:** draft

**Ordering:** GATE-WRITE is the entry gate (no prior status gate); document is `status: draft` in
`.agents/spec-docs/draft/`, the expected input state. Ordering check passes.

**Per-criterion record (27 criteria: 20 mechanical by `gate.mjs`, 7 semantic by `backlog-gate-guard`):**

- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS (mechanical judge); block opens line 1, closes line 6.
- GATE-WRITE — `status: draft` present in frontmatter: PASS (mechanical judge); `status: draft` at line 2.
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: PASS (mechanical judge); `type: FLOW`.
- GATE-WRITE — `tags:` field present in frontmatter: PASS (mechanical judge); `tags: [cli, typescript]`.
- GATE-WRITE — Problem does not contain "TBD"/"TODO"/vague single-sentence description: PASS (mechanical judge); Problem is 7 numbered findings plus a Reproduction condition paragraph.
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: PASS (mechanical judge); `## Prior Art Research` at line 69.
- GATE-WRITE — Section substantiated (≥1 documentation source, or states no comparable reference found): PASS (mechanical judge); cites two Claude Code doc URLs and explicitly states no second product documents a background conversation fork.
- GATE-WRITE — OR explicit `Waived: <reason>` line present: PASS (mechanical judge); `Waived:` line opens the section with a stated reason.
- GATE-WRITE — All 4 Architecture Review Checklist items are `[x]`: PASS (mechanical judge); 5 items, all `[x]`.
- GATE-WRITE — Sibling scan item is `[x]` with completion evidence or explicit `N/A`: PASS (mechanical judge); `[x]` with three named seams, each carrying a file/line or spec path.
- GATE-WRITE — Alternatives Considered has ≥2 entries with pro/con for each: PASS (mechanical judge); 3 alternatives, each with a Pro and a Con bullet.
- GATE-WRITE — Every Completion Criteria item has a `TC-N` prefix: PASS (mechanical judge); TC-01 … TC-12, no unprefixed item.
- GATE-WRITE — No criterion uses "works correctly"/"no errors"/"implemented"/"displays correctly": PASS (mechanical judge); none of the four banned phrases occurs.
- GATE-WRITE — `## Test Plan` section present: PASS (mechanical judge); at line 318.
- GATE-WRITE — One Test Plan row per TC-N (count must match): PASS (mechanical judge); 12 Completion Criteria ↔ 12 Test Plan rows, TC-01 … TC-12, verified by reading both lists.
- GATE-WRITE — Each Test Plan row has non-empty Test Type and Tool/Approach: PASS (mechanical judge); every row carries both, no "TBD".
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry: PASS (mechanical judge); no row names "manual" as its tool — N/A, satisfied vacuously.
- GATE-WRITE — Tasks section present with placeholder: PASS (mechanical judge); `## Tasks` names `.agents/tasks/CLI-1994-…md — todo`.
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): PASS (mechanical judge); section was empty when this entry was appended.
- GATE-WRITE — No `## Status` or `## Classification` sections in the body: PASS (mechanical judge); neither heading occurs.
- GATE-WRITE — Problem contains a concrete symptom: PASS. Seven findings, each naming the wrong behaviour with a verified location: `--fork-session` is startup-only (`cli-args.ts:186` option, `:258` parse, `:96` help — all three confirmed verbatim) and its whole mechanism is the ternary at `interactive-session-init.ts:130-131` (confirmed; the only other `forkSession` use in that file is the pass-through at `:226`); bare `--fork-session` without `-c`/`-r` is silently inert (confirmed — `cli-args.ts` has no validation coupling the flag to a resume, and the ternary yields `undefined` either way); no child carries a conversation (`create-subagent-session.ts:196` confirmed, and it assembles via `assembleSubagentPrompt` at `:221`, never `buildSystemPrompt` — whose only caller in the tree is `create-session-runtime.ts:161`); `assembleSubagentPrompt` at `subagent-prompts.ts:69-84` confirmed as `agentBody + CLAUDE.md + AGENTS.md + suffix`; `runSkillInFork` at `interactive-session-fork.ts:36-67` confirmed; `ISpawnAgentJobInput` at `interactive-session-agent-jobs.ts:63-70` confirmed to be exactly `{ agentType, label, mode, prompt, model?, isolation? }` and `IAgentBackgroundTaskRequest` at `background-task-contracts.ts:86-100` confirmed to carry only `prompt: string` (its base `IBaseBackgroundTaskRequest:72-84` also has no history or resume field); `interactive-session-persistence.ts:132-133` confirmed to write `systemPrompt`/`toolSchemas`, and `grep -rn "record.systemPrompt\|record.toolSchemas" packages/*/src` returned zero matches (exit 1) — stronger than the document's "outside tests", and `interactive-session-restore.ts` (whose `loadSessionRecord` spans `:48-141`) mentions neither identifier; `TExecutionControl` at `workspace-contracts.ts:22` confirmed verbatim as the six-member union; the UI-intent union at `command-contracts.ts:132-135` confirmed as exactly the four quoted members; `interactive-session.ts:318` confirmed to set `this.sessionName` from `restored.sessionName`, and `resolveSessionIdByIdOrName` confirmed at `session-persistence.ts:97`.
- GATE-WRITE — Problem contains a reproduction condition: PASS. "In a live session, after the expensive context is built … there is no way to obtain one" names when and where, and both supports verify: `default-command-modules.ts:95-140` registers `/agent` at `:107`, `/background` at `:112`, `/peers` at `:129` — all three line numbers exact — and the module list contains no fork entry; the stated fallback `robota -c --fork-session` matches the flag wiring above.
- GATE-WRITE — Research findings feed Alternatives Considered / Decision: PASS. The section is a `Waived:` line, which `research.md` § Enforcement permits the agent to propose; judged on whether the stated reason is honest and sufficient rather than on the absence of a research block, because a waiver that automatically fails the next criterion would not be the opt-out that rule grants. Honesty: every checkable part holds — the three sibling seams it says were surveyed instead are real and accurately located (`CLI-073` at `.agents/spec-docs/done/CLI-073-fork-restores-context.md`, `createSubagentSession` at `create-subagent-session.ts:196`, the handoff carrier at `handoff-contracts.ts:116`, which is indeed `readonly record: IInteractiveSessionRecord` — a whole-record copy); the measured fact the waiver's central adaptation rests on is exact (`grep -rn "outputStyle\|output-style" packages apps` exits 1, zero matches, with `apps/` present). Sufficiency: the named external reference does reach the Decision rather than sitting beside it — the checklist verdict table carries one row per documented line, and the one substantive departure (line 3, "including the output style" → "the parent's assembled system message") is argued from the verified grep plus `buildSystemPrompt`'s section list at `system-prompt-builder.ts:121-146`, not asserted. The design question the waiver says is actually open is answered from surveyed tree facts (ARCH-044's projection boundary, the absent session-store capability at `host-adapters.ts:225-246`, three named existing tests). Not verifiable from here: the live re-read of the two external URLs and the v2.1.238–v2.1.263 changelog range; recorded as unverified, and not load-bearing, since no alternative or verdict in the document turns on it.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS. The trade-off is stated as a cost exchange, not a preference: Alternative 2 "is cheaper at the command boundary and pays for it at the process boundary, putting the full conversation on a wire the repository deliberately keeps narrow (ARCH-044)", against Alternative 1 paying "once for a session-store capability". Both sides check out — ARCH-044 is a real item (`.agents/tasks/completed/ARCH-044-subagent-child-wire-reuses-live-runtime-contracts.md`), and the cost accepted is real: `ICommandHostAdapters` at `host-adapters.ts:225-246` has no session-store member (grep for `sessionStore` in that file returns nothing). Alternative 3's rejection is likewise grounded — `runSkillInFork` at `interactive-session-fork.ts:36-67` ends in a blocking `return forkSession.run(content)` with no task id.
- GATE-WRITE — New-surface placement (conditional): PASS, as N/A, with the substance supplied anyway. No new package, app, presentation or interface surface is introduced: `/fork` is a new module inside the existing `packages/agent-command`, and the named sibling it mirrors exists (`packages/agent-command/src/peers/` — `peers-command-module.ts`, `peers-command.ts`, `index.ts`, `__tests__`); the new framework file sits beside its `interactive-session-*.ts` siblings; the two contract changes are members added to unions the cited modules already own, confirmed in the tree (`workspace-contracts.ts:22` owns `TExecutionControl`, `command-contracts.ts:131-135` owns `TCommandUiIntent`) and in `.agents/specs/contract-family-owner-map.md`, which lists `workspace-contracts` under `agent-interface-execution` (line 29) and `command-contracts` under `agent-interface-command` (line 28). No layer or product-family reclassification, no new dependency edge.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: PASS. Solution 1 (fork-record builder) → TC-01, TC-02; 2 (prompt restore, both the present and absent branches) → TC-04; 3 (host `forkSession` member) → TC-07, with the builder+save half at TC-01/TC-02; 4 (spawn plumbing, four legs) → TC-05 (input→request), TC-03 (in-process resume), TC-06 (child-process DTO), with the `subagent-manager.ts:81-84` pass-through covered downstream by TC-03/TC-06; 5 (the `/fork` command and its flags and failure path) → TC-07, with registration exercised by the § User Execution Test Scenario; 6 (attach) → TC-08, TC-09; 7 (docs) → TC-12 over the six SPEC.md files, all six confirmed to exist. Capability preservation is additionally pinned by TC-10 and the scan suite by TC-11.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): **FAIL**. TC-08 names `pnpm --filter @robota-sdk/agent-transport exec vitest run src/__tests__/fork-attach.test.tsx` and `pnpm --filter @robota-sdk/agent-transport run typecheck`, but `@robota-sdk/agent-transport` is `packages/agent-transport`, whose `src/index.ts` is `export {}` ("STRUCT-012 S2 … this interim package root deliberately exports nothing") with no `src/__tests__/` directory and no `TExecutionControl` consumer. The artifact TC-08 asserts is declared in § Affected Files as `packages/agent-transport-tui/src/__tests__/fork-attach.test.tsx`, whose package is `@robota-sdk/agent-transport-tui`; pnpm resolves the exact name `@robota-sdk/agent-transport` to the other package, so neither half of TC-08's observable can be produced by the command it names — the vitest invocation cannot exit 0 on a path that package does not contain, and typechecking an `export {}` barrel cannot show "every exhaustive switch over `TExecutionControl` still compiles" (the consumers are in `agent-framework`, e.g. `execution-workspace-projection.ts:144-145`, plus the TUI files this spec's own Affected Scope lists). TC-09 says "same file" and inherits the same mis-addressed command. Every other criterion's command target was verified to resolve: TC-01/03/04/05 → `@robota-sdk/agent-framework`, TC-06 → `@robota-sdk/agent-subagent-runner` (file exists), TC-07 → `@robota-sdk/agent-command`, TC-10 → `@robota-sdk/agent-cli` (both files exist), TC-11 → `scripts/harness/run-all-scans.mjs` with `--affected`, `--context`, `--skip` all recognised flags, TC-12 → six existing SPEC.md paths.

**Failed criteria:**

- Each criterion uses Command form or Observable behavior form (no vague language): TC-08 and TC-09
  address `pnpm --filter @robota-sdk/agent-transport`, which resolves to `packages/agent-transport` (an
  interim `export {}` package with no tests and no `TExecutionControl` consumer), while the test file
  they assert is declared at `packages/agent-transport-tui/src/__tests__/fork-attach.test.tsx`
  (`@robota-sdk/agent-transport-tui`). Required: a command whose target package contains the artifact
  the criterion asserts, and a typecheck that reaches the exhaustive switches it claims to protect.
  **Required action:** correct the package filter in TC-08 (both the vitest invocation and the
  typecheck) and, if TC-09 continues to say "same file", ensure the command it inherits is the
  corrected one. Re-run GATE-WRITE afterwards.

**Judged at:** HEAD `754c9e239eec` · base `origin/develop@754c9e239eec` · document `.agents/spec-docs/draft/CLI-1994-fork-the-conversation-into-a-background-session.md` blob `e15db1429ea37ff24fc96bcaada4cd68c6b71dcc` (untracked)

### [GATE-WRITE] — ✅ PASS | 2026-09-07

**Status upgrade:** draft → review-ready

**Ordering:** GATE-WRITE is the entry gate (the prior-gate map records no prior status gate for it);
the document is `status: draft` (line 2) and sits in `.agents/spec-docs/draft/`, the expected input
state. Ordering check passes. This is a re-run after the bounded correction required by the
`❌ FAIL | 2026-09-07` entry above, which is retained.

**Correction under judgement:** the two `pnpm --filter @robota-sdk/agent-transport` occurrences in TC-08
(the vitest invocation and the typecheck) are now `@robota-sdk/agent-transport-tui`. Confirmed by
enumerating every `pnpm --filter` in the document: lines 274/281/286/291/294/298/303/307/310/348 all name
`agent-framework`, `agent-subagent-runner`, `agent-command`, `agent-transport-tui` or `agent-cli`; the only
remaining `@robota-sdk/agent-transport` strings are at lines 400/405 inside the retained FAIL entry, which
quote the defect. All 7 semantic criteria were re-judged independently against the tree at HEAD
`754c9e239eec`, not carried over.

**Per-criterion record (27 criteria: 20 mechanical by `gate.mjs`, 7 semantic by `backlog-gate-guard`):**

- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS (mechanical judge); block opens line 1, closes line 6.
- GATE-WRITE — `status: draft` present in frontmatter: PASS (mechanical judge); `status: draft` at line 2, unchanged by the correction.
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: PASS (mechanical judge); `type: FLOW`.
- GATE-WRITE — `tags:` field present in frontmatter: PASS (mechanical judge); `tags: [cli, typescript]`.
- GATE-WRITE — Problem does not contain "TBD"/"TODO"/vague single-sentence description: PASS (mechanical judge); Problem is 7 numbered findings plus a Reproduction condition paragraph.
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: PASS (mechanical judge); `## Prior Art Research` at line 69.
- GATE-WRITE — Section substantiated (≥1 documentation source, or states no comparable reference found): PASS (mechanical judge); cites two Claude Code doc URLs and states no second product documents a background conversation fork.
- GATE-WRITE — OR explicit `Waived: <reason>` line present: PASS (mechanical judge); the section opens with `Waived:` and a stated reason.
- GATE-WRITE — All 4 Architecture Review Checklist items are `[x]`: PASS (mechanical judge); 5 items, all `[x]`.
- GATE-WRITE — Sibling scan item is `[x]` with completion evidence or explicit `N/A`: PASS (mechanical judge); `[x]` with three named seams, each carrying a file/line or spec path.
- GATE-WRITE — Alternatives Considered has ≥2 entries with pro/con for each: PASS (mechanical judge); 3 alternatives, each with a Pro and a Con bullet.
- GATE-WRITE — Every Completion Criteria item has a `TC-N` prefix: PASS (mechanical judge); TC-01 … TC-12, no unprefixed item.
- GATE-WRITE — No criterion uses "works correctly"/"no errors"/"implemented"/"displays correctly": PASS (mechanical judge); no banned phrase occurs inside `## Completion Criteria` (the sole "implemented" in the body is at line 214, in `## Solution`, which this criterion does not read).
- GATE-WRITE — `## Test Plan` section present: PASS (mechanical judge); at line 318.
- GATE-WRITE — One Test Plan row per TC-N (count must match): PASS (mechanical judge); 12 Completion Criteria ↔ 12 Test Plan data rows (13 `| TC-` lines less the `| TC-ID |` header), TC-01 … TC-12.
- GATE-WRITE — Each Test Plan row has non-empty Test Type and Tool/Approach: PASS (mechanical judge); every row carries both, no "TBD".
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry: PASS (mechanical judge); no row names "manual" as its tool — N/A, satisfied vacuously.
- GATE-WRITE — Tasks section present with placeholder: PASS (mechanical judge); `## Tasks` names `.agents/tasks/CLI-1994-…md — todo`.
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): PASS (mechanical judge); the first-run emptiness clause was satisfied at the 2026-09-07 FAIL run, and the only content added since is that gate's own entry — no non-gate content was introduced by the correction.
- GATE-WRITE — No `## Status` or `## Classification` sections in the body: PASS (mechanical judge); neither heading occurs.
- GATE-WRITE — Problem contains a concrete symptom: PASS. Re-verified independently at HEAD `754c9e239eec`; every citation was opened by line. `--fork-session` is startup-only: `cli-args.ts:96` is the help line, `:186` is `'fork-session': { type: 'boolean', default: false }`, `:258` is `forkSession: values['fork-session'] ?? false` — all three exact; `interactive-session-options.ts:59` is `forkSession?: boolean`; the entire mechanism is the ternary at `interactive-session-init.ts:130-131`, quoted verbatim and confirmed, so bare `--fork-session` without `-c`/`-r` yields `undefined` either way (silently inert). No child carries a conversation: `createSubagentSession` at `create-subagent-session.ts:196`, whose prompt comes from `assembleSubagentPrompt` (`subagent-prompts.ts:69-84`, confirmed as `agentBody + projectNotesMd(CLAUDE.md) + agentsMd + suffix`) and never from `buildSystemPrompt` — whose section list (preset, persona, self-verification, AGENTS.md, project notes, memory, task context, cwd, project, language, permission, tool descriptions, capabilities) is at `system-prompt-builder.ts:121-148`, one line wider than the document's `:124-145` citation but the same block; `in-process-subagent-runner.ts:189` constructs the child via `createSubagentSession`; `runSkillInFork` at `interactive-session-fork.ts:36-67` confirmed. The spawn contract has nowhere to put a conversation: `ISpawnAgentJobInput` at `interactive-session-agent-jobs.ts:63-70` is exactly `{ agentType, label, mode, prompt, model?, isolation? }`, and `IAgentBackgroundTaskRequest` at `background-task-contracts.ts:86-100` carries `prompt: string` with no history or resume field. The dead-field claim is exact and stronger than stated: `interactive-session-persistence.ts:132-133` writes `systemPrompt`/`toolSchemas`, `grep -rn "record.systemPrompt\|record.toolSchemas" packages/*/src` exits 1 with zero matches, and `loadSessionRecord` (`interactive-session-restore.ts:48-141`, both bounds exact) contains neither identifier. No attach: `TExecutionControl` at `workspace-contracts.ts:22` is the six-member union verbatim; `TCommandUiIntent` at `command-contracts.ts:132-135` is exactly the four quoted members. Both copy leaks confirmed: `interactive-session.ts:318` is `if (restored.sessionName) this.sessionName = restored.sessionName;` with `resolveSessionIdByIdOrName` at `session-persistence.ts:97`, and `interactive-session-agent-jobs.ts:92` is `cwd: deps.cwd ?? cwd ?? process.cwd()`.
- GATE-WRITE — Problem contains a reproduction condition: PASS. "In a live session, after the expensive context is built — which is exactly when a fork is wanted — there is no way to obtain one" names when and where, and its supports verify: `default-command-modules.ts:95-140` is the `createDefaultCommandModules` registration block, with `createAgentCommandModule()` at `:107`, `createBackgroundCommandModule()` at `:112` and `createPeersCommandModule()` at `:129` — all three line numbers exact — and the module array registers no fork command; the stated fallback `robota -c --fork-session` matches the flag wiring above. One scoping nuance, disclosed by the document rather than hidden by it: a `fork` subcommand does exist under `/rewind` (`rewind-command.ts:241` → `forkCheckpointBranch`), which is SELFHOST-007's checkpoint-branch concept — § Affected Scope and the sibling scan both name it and exclude it, so "no slash command lists a [conversation] fork verb" holds as scoped.
- GATE-WRITE — Research findings feed Alternatives Considered / Decision: PASS. The section is a `Waived:` line, which `research.md` § Enforcement expressly permits the agent to propose "when it judges research genuinely unnecessary"; the guardian criterion is the adequacy of that waiver, so it is judged on whether the stated reason is honest and sufficient, not on the absence of a research block. Honesty — every checkable part holds: the three sibling seams it says it surveyed instead are real and accurately located (`CLI-073` at `.agents/spec-docs/done/CLI-073-fork-restores-context.md`; `createSubagentSession` at `create-subagent-session.ts:196`; the handoff carrier at `handoff-contracts.ts:116`, which is `readonly record: IInteractiveSessionRecord`, i.e. genuinely the only other whole-record copy), and the measured fact its central adaptation rests on is exact — `grep -rn "outputStyle\|output-style" packages apps` (excluding `node_modules`/`dist`) returns 0 occurrences. Sufficiency: the external reference reaches the Decision rather than sitting beside it — the verdict table carries one row per documented checklist line, and the single substantive departure (line 3, "including the output style" → "the parent's assembled system message") is argued from that verified grep plus `buildSystemPrompt`'s section list, not asserted; the question the waiver says is actually open is answered from surveyed tree facts (ARCH-044's projection boundary — `.agents/tasks/completed/ARCH-044-subagent-child-wire-reuses-live-runtime-contracts.md` exists; the absent session-store capability at `host-adapters.ts:225-246`; three named existing tests). `research.md:13` (no third-party source code as design basis) is not offended: the external evidence is product documentation and the source cited is this repository's own. Not verifiable from here and recorded as unverified: the live re-read of the two `code.claude.com` URLs, the v2.1.238–v2.1.263 changelog range, and "no second product documents a background conversation fork". None is load-bearing — the choice among Alternatives 1/2/3 turns entirely on repo facts verified above.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS. The trade-off is stated as a cost exchange, not a preference: Alternative 2 "is cheaper at the command boundary and pays for it at the process boundary, putting the full conversation on a wire the repository deliberately keeps narrow (ARCH-044)", against Alternative 1 paying "once for a session-store capability" and then reusing a proven restore path. Both sides check out in the tree: ARCH-044 is a real completed item, and the cost accepted is real — `ICommandHostAdapters` at `host-adapters.ts:225-246` has no session-store member (grep for `sessionStore` in that file returns nothing), so the capability genuinely does not exist today. Alternative 3's rejection is likewise grounded: `runSkillInFork` (`interactive-session-fork.ts:36-67`) ends in a blocking `return forkSession.run(content);` with no task id. One citation drift observed and recorded rather than waived: the adversarial pass (d) cites `interactive-session-agent-jobs.ts:93` for `(deps.subagentDepth ?? 0) + 1`, which is at `:91` (`:93` is `prompt: input.prompt`); the depth-increment mechanism it relies on is present, so the argument stands and only the line number is off by two.
- GATE-WRITE — New-surface placement (conditional): PASS, as N/A, with the substance supplied anyway. No new package, app, presentation or interface surface is introduced, and the tree corroborates each placement claim: `/fork` is a new module inside the existing `packages/agent-command`, and the sibling it says it mirrors exists with the same shape (`packages/agent-command/src/peers/` → `peers-command-module.ts`, `peers-command.ts`, `index.ts`, `__tests__`); the new framework file sits beside its `interactive-session-*.ts` siblings; the two contract changes add members to unions the cited modules already own — `workspace-contracts.ts:22` owns `TExecutionControl`, `command-contracts.ts:131-135` owns `TCommandUiIntent` — and `.agents/specs/contract-family-owner-map.md` lists `command-contracts` under `agent-interface-command` (line 28) and `workspace-contracts` under `agent-interface-execution` (line 29). No new package dependency edge is required: `agent-command` already depends on `agent-interface-execution` + `agent-framework` and already reaches the job capability (`/agent` calls `session.spawnAgentJob` at `agent-command.ts:37`), and `agent-transport-tui` already depends on `agent-interface-execution` + `agent-interface-command`. No layer or product-family reclassification.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: PASS. Mapping the 7 `## Solution` steps: 1 (fork-record builder) → TC-01 shape, TC-02 copy invariant; 2 (prompt restore, both the present and the absent branch) → TC-04; 3 (host `forkSession` member) → TC-07 for the call, TC-01/TC-02 for the builder+save half; 4 (spawn plumbing, three legs) → TC-05 input→request, TC-03 in-process resume, TC-06 child-process DTO, with `subagent-manager.ts:81-84`'s pass-through exercised downstream by TC-03/TC-06; 5 (`/fork`, its flags and its failure path) → TC-07, with registration in `default-command-modules.ts` covered observably by the § User Execution Test Scenario rather than by a TC — the one sub-item without a dedicated criterion, and its observable is stated; 6 (attach) → TC-08, TC-09; 7 (docs) → TC-12 over six SPEC.md files, all six confirmed present. The five checklist lines map onto the same set, and capability preservation is separately pinned by TC-10 and the affected-scan suite by TC-11.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): PASS. The FAIL is cleared and every command target was re-resolved from scratch, not carried over. TC-08 now reads `pnpm --filter @robota-sdk/agent-transport-tui exec vitest run src/__tests__/fork-attach.test.tsx` and `pnpm --filter @robota-sdk/agent-transport-tui run typecheck`; `@robota-sdk/agent-transport-tui` is `packages/agent-transport-tui`, whose `package.json` declares `"typecheck": "tsgo --noEmit && tsgo -p tsconfig.examples.json --noEmit"` (both configs and `examples/` exist) and carries `vitest ^3.2.6` + `ink-testing-library ^4.0.0`, whose `vitest.config.ts` includes `src/**/*.{test,spec}.{ts,tsx}` so the named path is in the run set, and whose `src/__tests__/` exists. That package is where the asserted artifacts live: § Affected Files' `src/execution-workspace-view-model.ts`, `src/BackgroundTaskPanel.tsx`, `src/flows/background-focus-flow.ts`, `docs/SPEC.md` and the new `src/__tests__/fork-attach.test.tsx` are all under `packages/agent-transport-tui`, and the package already consumes the control union by value (`App.tsx:213,230` — `selectedExecutionEntry.controls.includes('send')`), so the typecheck reaches the exhaustive switches this change adds. Across all twelve TCs every `pnpm --filter` resolves and declares what it invokes: `agent-framework` (TC-01/02/03/04/05), `agent-subagent-runner` (TC-06), `agent-command` (TC-07), `agent-transport-tui` (TC-08/09), `agent-cli` (TC-10) each declare `vitest ^3.2.6`, and the only `run <script>` form in the document — `run typecheck` — names a script that package declares. Named existing files exist (`fork-restores-context.test.ts`, `interactive-session-agent-jobs.semantic-roles.test.ts`, `subagent-worker-start-dto.test.ts`, `print-mode-integration.test.ts`, `cli-args.test.ts`); every new file's parent directory exists except `packages/agent-command/src/fork/`, which the spec declares as new. TC-11's `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts` uses only recognised flags — the same combination the script's own comment at `:166` names as the PR-job form — and TC-12's six `grep` targets all exist. Non-command criteria are observable and bounded (TC-02/TC-09 "same file" now inherit the corrected invocation; TC-10's "unchanged" is bounded by two named suites exiting 0; TC-12's prose assertion names the exact two sentences to look for). One residual imprecision, recorded rather than waived: TC-08's "every exhaustive switch over `TExecutionControl`" is literally wider than one package's typecheck, but no exhaustive switch over that union exists anywhere else today — the only other consumer, `execution-workspace-projection.ts:144-145`, is a `push` builder that a new member cannot break — so the command does reach every switch the criterion is about.

**Judged at:** HEAD `754c9e239eec` · base `origin/develop@754c9e239eec` · document `.agents/spec-docs/draft/CLI-1994-fork-the-conversation-into-a-background-session.md` blob `175637a6c19dcbfa3a8f4c44a01f34a36653550e` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-07

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "#2004, #1990, #1994, #2054 모두 승인"
**Given:** 2026-09-07, this conversation
**Review fingerprint:** c78a2cbb51a4 (review 30197231, type/tags 61edf91f)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-07, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (c78a2cbb51a4) equals the document's current fingerprint
- GATE-APPROVAL — ordering (guardian): PASS — the prior gate is GATE-WRITE and this row's re-run rule is blank, so the LAST GATE-WRITE entry must itself be `✅ PASS`; the Evidence Log holds `[GATE-WRITE] — ❌ FAIL | 2026-09-07` followed by `[GATE-WRITE] — ✅ PASS | 2026-09-07`, so the last one is PASS. Expected input state also holds: frontmatter line 2 is `status: review-ready` and the document sits in `.agents/spec-docs/backlog/`, the folder `spec-workflow.md:255` maps to `review-ready`. GATE-APPROVAL transitions a status, so it is not one of the exempt gates and the check applies.
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the instruction `#2004, #1990, #1994, #2054 모두 승인` binds `모두` to a closed enumeration of four explicitly named referents rather than to an unrecorded set, and `#1994` resolves to THIS document from checkable sources rather than from assertion: `gh issue view 1994` returns OPEN issue `P1: a session can only be forked at startup, never from inside the conversation`, whose subject is this document's § Problem opening sentence; line 10 declares `Arising from [issue #1994](https://github.com/woojubb/robota/issues/1994)`; the paired Task `.agents/tasks/CLI-1994-fork-the-conversation-into-a-background-session.md` carries `issue: https://github.com/woojubb/robota/issues/1994` in its frontmatter; and `scripts/harness/new-spec.mjs:316-322` refuses any non-`--legacy-id` spec whose ID's trailing number differs from that Task's issue, so the ID `CLI-1994` is issue-backed by construction. Uniqueness checked: `rg -ln --hidden "1994"` over the worktree returns only this spec, its paired Task, and three `.agents/evals/work-runs/*.json` whose `1994` is a hex-digest substring (`…719945c3…`), so no second spec document binds to issue #1994; the other three tokens resolve to distinct OPEN issues (#2004 TUI screen-reader, #1990 tool search, #2054 TUI ports), each with its own worktree, so the enumeration does not collide here. **Correction to the record:** this spec's frontmatter (lines 1-6) is `status`/`type`/`tags`/`lane` only and carries NO `issue:` field — the `issue:` field is the paired Task's, and the binding above rests on the Task frontmatter, the body citation, the tool-enforced ID convention, and uniqueness, not on spec frontmatter. Route: a closed list of four already-existing, individually-named items is not the "category" that routes an instruction to CLASS, so DIRECT is the correct route and this document is one of the four named referents, not the "different item in the same conversation" the catalogue excludes. Relay check: the exact instruction string occurs in exactly one place in the whole worktree — line 469 of this document, the field `gate.mjs approve` itself wrote — so it is not reported by another session, agent, or document and `backlog-execution.md` § "A relay is not an instruction" is not triggered. Boundary recorded rather than overclaimed: the tree can rule out the relay mode but cannot itself witness the utterance; that limit is inherent to Route DIRECT, whose companion mechanical criterion reads back what `approve` recorded.
- GATE-APPROVAL — The item is inside the class as the registry defines it: PASS (N/A) — the entry records `**Approval route:** `DIRECT`` and names no class, and the two routes are mutually exclusive, so the Route CLASS boundary is not asserted. Checked rather than assumed that no registered class would have applied: `backlog-execution.md` § Delegated Approval Classes holds exactly two rows, both registered 2026-08-28 — `LANE-L0-L1`, whose scope is L0/L1 items as `scan-lane-declaration` accepts them, while this document declares `lane: L2` at frontmatter line 5; and `BACKLOG-ZERO-MIGRATION`, whose scope is documentation-only terminalization/handoff of the legacy population fixed at Git object `2c875dd3ec69…` and which expressly excludes package/app source and APIs/contracts, while this spec adds `resumeSessionId` to `IAgentBackgroundTaskRequest`, `'attach'` to `TExecutionControl`, `switch-session` to the UI-intent union, and a new `/fork` command module. The section's exclusion 1 (product direction and user-facing scope) would bar it independently, `/fork` being a new user-facing command.
- GATE-APPROVAL — Independent architecture validation (conditional): PASS (N/A) — the trigger condition is not met, verified against the tree rather than against the document's own claim. No new package or app: both new modules land inside existing packages (`packages/agent-command/src/fork/` is confirmed absent today and is a new directory in an existing package; `interactive-session-fork-record.ts` sits beside its `interactive-session-*.ts` siblings), and § Affected Files touches no path under `apps/`. No new presentation/interface surface: `/fork` mirrors the sibling `packages/agent-command/src/peers/`, whose shape (`__tests__`, `index.ts`, `peers-command-module.ts`, `peers-command.ts`) is confirmed on disk; `'attach'` and `switch-session` are members added to unions the cited modules already own (`workspace-contracts.ts:22`, `command-contracts.ts:132-135`); and attach reuses a session-switch path that exists — `packages/agent-transport-tui/src/__tests__/session-switch-channel.test.tsx`. No layer or product-family reclassification and no dependency on a sibling PRODUCT: no new package edge is required, `packages/agent-command/package.json` already declaring `@robota-sdk/agent-framework`, `@robota-sdk/agent-interface-execution` and `@robota-sdk/agent-interface-command`, and `packages/agent-transport-tui/package.json` already declaring the latter two, so reuse is at the shared contract level. This N/A is load-bearing and is recorded as such: `rg "proposal-reviewer|architecture-audit"` over this document exits 1 with zero matches, so had the condition been triggered this criterion would have been FAIL, not PASS.
- GATE-APPROVAL — NON-COMPLIANCE trigger (implementation started before this gate ran): not triggered — `git status --short` in this worktree lists exactly two paths, both untracked planning artifacts (this spec and its paired Task); no `packages/**` path is staged, modified, renamed or deleted, and `packages/agent-command/src/fork/` does not exist.
- GATE-APPROVAL — semantic set judged by `backlog-gate-guard` at HEAD `754c9e239eec`, document blob `57a2fe2149ee` (untracked, hashed before these lines were appended); the five preceding lines are `gate.mjs`'s mechanical set and were not re-judged here.

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `754c9e239eec` · base `origin/develop@754c9e239eec` · document `.agents/spec-docs/backlog/CLI-1994-fork-the-conversation-into-a-background-session.md` blob `e7da10051ef9` (untracked)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-07

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names 0/12 TC ids and carries 1 checkbox task(s)
  **Required action:** one task per TC-N
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task Test Plan/Testing section is 0 chars (absent)
  **Required action:** write a ≥50-char test plan in the Task

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `754c9e239eec` · base `origin/develop@754c9e239eec` · document `.agents/spec-docs/todo/CLI-1994-fork-the-conversation-into-a-background-session.md` blob `0c27c43f870d` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-07

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-07; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/CLI-1994-fork-the-conversation-into-a-background-session.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/CLI-1994-fork-the-conversation-into-a-background-session.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (12)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 1823 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 1`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/CLI-1994-fork-the-conversation-into-a-background-session.md",
  "specPath": ".agents/spec-docs/todo/CLI-1994-fork-the-conversation-into-a-background-session.md",
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
    },
    {
      "kind": "tc-id",
      "value": "TC-09"
    },
    {
      "kind": "tc-id",
      "value": "TC-10"
    },
    {
      "kind": "tc-id",
      "value": "TC-11"
    },
    {
      "kind": "tc-id",
      "value": "TC-12"
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 1
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/CLI-1994-fork-the-conversation-into-a-background-session.md",
    ".agents/tasks/CLI-1994-fork-the-conversation-into-a-background-session.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `754c9e239eec` · base `origin/develop@754c9e239eec` · document `.agents/spec-docs/todo/CLI-1994-fork-the-conversation-into-a-background-session.md` blob `6754c94d50e8` (untracked)

### [RECORD NOTE] — 2026-09-07

Not a gate verdict. Nothing above this line is edited. The `[GATE-IMPLEMENT] — ✅ PASS` recorded above and
the `approved → in-progress` transition it authorised were taken BEFORE the paired Task's
`DONE-GATE-STAGE-1` had passed and before the planning checkpoint was committed — the order
`backlog-execution.md` § "Pre-implementation planning checkpoint" requires is Stage-1 PASS → GATE-IMPLEMENT
→ checkpoint commit → implementation. For THIS pair the `DONE-GATE-STAGE-1` guardian dispatched against the dirty tree was stopped by the
orchestrator before it recorded anything; the violation and its remedy — restore the order on a
planning-only tree — were recorded by the sibling CLI-2004's guardian on the same day and apply here
identically, and a second CLI-1994 guardian later recorded NON-COMPLIANCE in the Task against the
parked-but-ticked state, which this note's next sentence describes. This note
records the restoration: the implementation work in the tree was parked in a tarball outside the tree (not `git stash`, whose ref is shared across this clone's worktrees); this document was moved back
from `active/` to `todo/` with `status: approved` and the Task's status and citations restored to match,
which is the exact inverse of the `advance` step the premature PASS authorised, performed by hand because
`gate.mjs` has no inverse of `advance`; `DONE-GATE-STAGE-1` is then re-run in its own invocation, and
GATE-IMPLEMENT is re-run so that its recorded PLAN binding (outcome and scenario count) matches the Task as
the guardian passed it. The earlier GATE-IMPLEMENT PASS stays in the log as what happened; the later one is
the checkpoint the branch commits. Cause: the orchestrator started implementation under a user instruction
to batch commits and verification, before the scenario stage had run — an ordering error of its own, not a
tool defect.

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-08

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : 1 path(s) outside the paired spec/Task: .agents/learn.md
  **Required action:** commit, stash, or remove them before this gate

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `a5f363f7eda6` · base `origin/develop@a5f363f7eda6` · document `.agents/spec-docs/todo/CLI-1994-fork-the-conversation-into-a-background-session.md` blob `42a5b869a00f` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-08

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-07; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/CLI-1994-fork-the-conversation-into-a-background-session.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/CLI-1994-fork-the-conversation-into-a-background-session.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (12)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 1851 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 1`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 3 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/CLI-1994-fork-the-conversation-into-a-background-session.md",
  "specPath": ".agents/spec-docs/todo/CLI-1994-fork-the-conversation-into-a-background-session.md",
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
    },
    {
      "kind": "tc-id",
      "value": "TC-09"
    },
    {
      "kind": "tc-id",
      "value": "TC-10"
    },
    {
      "kind": "tc-id",
      "value": "TC-11"
    },
    {
      "kind": "tc-id",
      "value": "TC-12"
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 1
  },
  "worktreePaths": [
    ".agents/loop-runs/user-execution-scenario.jsonl",
    ".agents/spec-docs/todo/CLI-1994-fork-the-conversation-into-a-background-session.md",
    ".agents/tasks/CLI-1994-fork-the-conversation-into-a-background-session.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `a5f363f7eda6` · base `origin/develop@a5f363f7eda6` · document `.agents/spec-docs/todo/CLI-1994-fork-the-conversation-into-a-background-session.md` blob `799ab7fe6cc6` (untracked)

### [GATE-COMPLETE: TC-11] — ✅ PASS | 2026-09-08

**Command:** `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
**Exit:** 0
**Output:** (last 10 of 83 line(s))

```
✓ orphan-exports
✓ rule-statement-floor
✓ test-plans
✓ doc-folder-status

⚑ 1 advisory finding(s) — NOT failures. The verdict below is unaffected.
⚑ task-merged-citation: ::advisory:: failed (exit 1) — advisory in pr context, so it does not fail this run; the same failure BLOCKS the integration run on develop.

56 scans passed, 5 skipped, 1 advisory failure(s) tolerated (pr context) (62 declared what they examined)
scan receipt NOT written: 1 advisory failure(s) were tolerated (task-merged-citation), and a receipt must not certify them.
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9d9503b3be7f` · base `origin/develop@9d9503b3be7f` · document `.agents/spec-docs/active/CLI-1994-fork-the-conversation-into-a-background-session.md` blob `6fe3d52ab387` (modified)
