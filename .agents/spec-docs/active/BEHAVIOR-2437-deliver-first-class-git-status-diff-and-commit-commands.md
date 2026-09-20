---
status: in-progress
type: BEHAVIOR
tags: [behavior]
lane: L2
---

# BEHAVIOR-2437: Deliver first-class Git status diff and commit commands

Paired with `.agents/tasks/BEHAVIOR-2437-deliver-first-class-git-status-diff-and-commit-commands.md`. Arising from [issue #2437](https://github.com/woojubb/robota/issues/2437).

## Problem

CLI-032 was marked done in 2026-05 with no product implementation behind it (issue #2437, and the
process findings PROC-001 / HARNESS-096 that recorded the false `done`). At `develop` today Robota has
no first-class `/status`, `/diff` or `/commit`: `createDefaultCommandModules` registers 35 modules and
none is a git module; the only git executions in the product are the plugin marketplace's `git clone`
and the subagent worktree adapter, neither user-facing. A user who wants to see what is staged, read a
diff, or commit from inside the session has two routes, and both hand their arguments to a shell as
TEXT: the Bash tool (the model's route) and `/shell <command>`, whose contract (TERM-003) is exactly
`sh -c <string>`.

**Reproduction.** In any git repository, `robota`, then `/status` → `Unknown command`. `/shell git
status` works, but `/shell git diff "$(cat /tmp/x)"` is shell syntax, and there is no confirmation
boundary of any kind before `/shell git commit -a -m …` runs.

**What a first-class family adds that the shell route cannot.** Three things, and they are the
reasons the issue's first acceptance criterion asks for a recorded product decision rather than an
assumption: (1) argument safety — a revision or a path the user types is passed as an argv element,
never parsed as syntax; (2) structured output — `/status` answers with parsed staged / unstaged /
untracked sets a UI or a later command can consume, not a screen of text; (3) an explicit confirmation
boundary on the one write, `/commit`, that the shell path has no way to express. The model already
has the Bash tool with its own permission system for git; this family is for the PERSON at the
terminal, so none of the three commands is model-invocable.

## Prior Art Research

Researched by `prior-art-researcher` (2026-09-20) from product documentation only.

| Product              | Doc                                                                                                                                                                                                                    | What it establishes                                                                                                                                                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code          | [Slash commands](https://code.claude.com/docs/en/slash-commands), [Permissions](https://code.claude.com/docs/en/permissions)                                                                                           | No built-in git command; the canonical `/commit` is a USER-authored skill with `allowed-tools: Bash(git add *) Bash(git commit *) Bash(git status *)` and `disable-model-invocation: true`. Read-only git forms run without a prompt; string rules miss `git -C . push` and `git 'push'`; `.git` is a protected path. |
| Gemini CLI           | [Commands](https://geminicli.com/docs/reference/commands/), [Custom commands](https://geminicli.com/docs/cli/custom-commands/)                                                                                         | No built-in git command; `!git status` runs with the user's own shell permissions. A custom command using `!{git diff --staged}` prompts for confirmation showing "the exact command(s) to be executed"; `{{args}}` are shell-escaped.                                                                                |
| OpenAI Codex CLI     | [Developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)                                                                                                                                    | `/diff` shows staged, unstaged AND untracked in one view; **`/status` means session configuration and token usage**, not git; no commit command ("create Git checkpoints" is advice); requires a git repo and says so.                                                                                                |
| GitHub Copilot CLI   | [Command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference), [Allowing tools](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/allowing-tools) | `/diff` reviews the working tree and falls back to the branch diff when the tree is clean; **`/status` is session status**; `shell(git:*)` allow with `shell(git push)` deny, deny wins; modifying tools need approval.                                                                                               |
| Aider                | [Commands](https://aider.chat/docs/usage/commands.html), [Git integration](https://aider.chat/docs/git.html)                                                                                                           | `/commit` (message optional), `/diff`, `/git <cmd>`, `/undo`; auto-commits ALL dirty files with a generated Conventional Commit message and no confirmation — `/undo` is the safety net.                                                                                                                              |
| Cursor, Windsurf     | [Cursor git](https://cursor.com/help/integrations/git), [Windsurf AI commit message](https://docs.devin.ai/desktop/ai-commit-message)                                                                                  | Stage, then generate a message from the staged diff; the human reviews and commits. No auto-commit.                                                                                                                                                                                                                   |
| Git                  | [gitcli(7)](https://git-scm.com/docs/gitcli), [git-status](https://git-scm.com/docs/git-status)                                                                                                                        | `--end-of-options` separates options from revisions, `--` separates revisions from paths; ambiguity errors out rather than guessing; `--porcelain=v2 -z` is the stable machine-readable status.                                                                                                                       |
| Conventional Commits | [v1.0.0](https://www.conventionalcommits.org/en/v1.0.0/)                                                                                                                                                               | `<type>[optional scope][!]: <description>` — type, the `: ` and the description are MUST.                                                                                                                                                                                                                             |

**Observed common behaviour.** (a) A read-only diff is first-class in three of six agent CLIs and is
argument-less or near it; `git status` is first-class NOWHERE, and two products already use `/status`
for session state; commit is first-class only in Aider, and every product that commits does so via
`git commit` itself. Every CLI keeps a raw escape hatch (`!cmd`, `/git`, Bash) beside any first-class
surface. (b) Three confirmation models: a permission prompt on the write (Claude Code, Copilot,
Codex); message proposal with the human committing what THEY staged (Cursor, Windsurf, Gemini's
example); auto-commit with undo (Aider, coupled to `/undo`). Implicit staging appears only in the
auto-commit model. (c) The two docs that address argument safety converge: escape, show the exact
command, never pattern-match a shell string; git's manual supplies the argv discipline. (d) No product
documents the empty-staged or unknown-revision states; Copilot's clean-tree fallback is the only
documented empty-state behaviour and it is VISIBLE. (e) Generation defaults to Conventional Commits;
no product documents validating a user-supplied message — the spec's MUST rules are the only contract.

**Constraints for Robota.** Both existing routes are shell-string paths: the Bash tool spawns
`shell.commandArgs(command)` (`packages/agent-tools/src/builtins/shell-tool.ts`) and `/shell` does
the same via `resolveShell()` — exactly the surface Claude Code's own docs show cannot be made
argument-safe by matching. The confirm port (`ICommandHostUserInteraction`) documents absence as a
cancellation, which rules out the auto-commit model in headless runs. Robota does not yet own the
name `/status`; choosing it for git would foreclose the industry meaning. "Silence is not success"
forbids the one thing prior art is quiet on: an empty staged set or an unknown revision must be a
reported non-success.

**Recommendation (adopted in § Decision).** Retain the family, as ONE `/git` command with
`status | diff | commit` subcommands rather than three top-level names; execute via argv with
`--end-of-options` before user revisions and `--` before user paths, never `cd`; read status with
`--porcelain=v2 -z`; commit the staged set only, with an explicit confirmation that shows the
message and the staged files, absence of a human = cancellation, `modelInvocable: false`; validate a
supplied message against the Conventional Commits MUST rules and refuse otherwise; report empty and
invalid states as results.

## Architecture Review

### Affected Scope

- `packages/agent-command/src/git/` (new module, `agent-command-git`): the `/git` command, its
  `status | diff | commit` grammar, the porcelain-v2 parser, the conventional-message check, and a
  NEW neutral git-process seam `git-process.ts` — async, argv-only, exit code as data.
- `packages/pack-coding/src/coding-pack.ts`: registration beside `/shell` and `/editor` — the
  coding pack is where the codebase classifies capability-level command modules, and it claims that
  removing the pack removes its capability (`robota-profile.ts`). The robota product passes the pack's
  module names as `disabledCommandModules` to the base list (`packages/agent-cli/src/startup/command-setup.ts`), so the base list alone would never register `/git` for the product.
- `packages/agent-command/src/default/default-command-modules.ts`: mirrored registration, exactly as
  `/shell` and `/editor` are mirrored, so the pack-less fallback keeps the same set.
- `packages/agent-command/src/index.ts`: export the module factory and the runner port type.
- `packages/agent-command/docs/SPEC.md`, `packages/agent-cli/README.md`.

Not affected: the framework's command executor and host roles (the confirm port
`ICommandHostUserInteraction.ask` and the workspace port `getCwd()` already exist), the permission
enforcer, the Bash tool, `/shell`, and the plugin adapter's `runGit` — see § Decision on why that seam
is NOT reused.

### Alternatives Considered

1. **Do not retain the family; document `/shell git …` and the Bash tool as the supported routes.**
   - Pro: zero new surface; the issue explicitly allows this outcome.
   - Con: neither route can offer argument safety, structured output or a confirmation boundary.
     `/shell` is `sh -c` BY CONTRACT (TERM-003), so argument safety cannot be added to it without
     changing what it is; and there is no place to put a commit confirmation on a string the shell
     will run. The Bash tool's permission system governs the MODEL, not a person typing at the prompt.
2. **One `/git` command whose `execute` parses `status | diff | commit`, over an injected async
   argv git-process seam, confirming `commit` through `ask`.** (chosen)
   - Pro: one name in `/help`; the `/theme list | <id> | syntax on|off` shape is the in-repo precedent
     for a subcommand family, and `ISystemCommand.subcommands` carries the verbs to `/help` and to the
     TUI autocomplete (it is descriptive — nothing routes on it; `/memory` and `/plugin` parse their own
     first token, and so does this); it avoids the documented collision — Codex and Copilot both use
     `/status` for SESSION status, so a git `/status` here would foreclose the industry meaning; the
     confirm is the port the confirming commands already use; unit tests inject a scripted runner and
     a scripted `ask`, the PTY scenario uses the real ones; `/shell git …` stays as the raw escape hatch
     every reference product keeps.
   - Con: the issue and the Task name `/status`, `/diff`, `/commit`; a user who knows git types those
     words — the verbs are the same words one token later, and the collision argument is sourced. A
     single command carries a single `requiresPermission`/`safety`, so under the OPT-IN remote
     read-only policy (`interactive-session-skill-router.ts`, `readOnly` derived from the flag) the
     read-only `status` and `diff` are classified with the write. Accepted: the policy is opt-in and
     allow-by-default today, and a remote peer has no `/shell` at all — `canHandoffTerminal()` is false remotely — so the
     read-only verbs are not a regression there.
3. **Three top-level commands `/status`, `/diff`, `/commit` in one module.**
   - Pro: the literal names the issue and Task wrote; `/diff` and `/commit` are conventional (Codex,
     Copilot, Aider, Claude Code's canonical skill name).
   - Con: `/status` is not — two reference products own it for session state, and Robota will want
     that meaning for itself. Splitting the family (nest `status`, keep the other two flat) would
     leave a family with two spellings.
4. **Reuse the Bash tool's executor for the three verbs, so one permission system governs both.**
   - Pro: one execution path for all git.
   - Con: the Bash tool takes a COMMAND STRING — that is the property being avoided; and routing a
     user's slash command through the model-tool permission system inverts who is asking whom.

### Decision

**Alternative 2.** The family is retained, and the reason is recorded as the issue asks: the shell
routes cannot be made argument-safe or confirmable without ceasing to be what they are, and the
model's Bash permission system does not govern a person at the prompt. It ships as `/git status`,
`/git diff …`, `/git commit …` — the issue's three verbs under one name — because `/status` means
session status in two reference products (§ Prior Art).

**Delivery mode:** `single`

**The seam.** A new neutral module `packages/agent-command/src/git/git-process.ts`:

```ts
interface IGitProcessPort {
  /** argv only, never a string; `shell: false`; stdin IGNORED; exit code is DATA, not an exception. */
  run(
    args: readonly string[],
    options: { cwd: string; timeoutMs?: number; signal?: AbortSignal },
  ): Promise<TGitProcessOutcome>;
}
type TGitProcessOutcome =
  | { kind: 'exited'; stdout: string; stderr: string; exitCode: number }
  | {
      kind: 'failed';
      reason: 'not-found' | 'timeout' | 'aborted' | 'output-too-large';
      detail: string;
    };
```

built on `execFile` (async, so a commit hook — this repository's own runs commitlint and lint-staged —
never freezes the Ink render loop), `shell: false`, `stdio: ['ignore', 'pipe', 'pipe']` so a hook
that reads stdin or a `commit.gpgsign` pinentry with no TTY exits instead of hanging, a default
`timeoutMs` of 120 000 with the caller's `AbortSignal` honoured, and an explicit `maxBuffer` of 16 MiB.
The three things `execFile` reports WITHOUT an exit code — a spawn failure (`ENOENT`: git not on
PATH), a timeout or abort (the child is killed), and a `maxBuffer` overflow (the child is killed) —
are the `failed` variant, typed, never a thrown error the command has to guess at; a hung command
surfaces as a failed one instead of a frozen interface, which is the same reasoning
`packages/agent-cli/src/startup/shell-exec.ts` already records. It is NOT built over the plugin
adapter's `runGit` (`plugins/default-plugin-command-adapter.ts`): that seam has no `cwd`, throws on
a non-zero exit, returns a `Buffer`, is synchronous by the `TExecFn` contract it implements, and is
not exported — none of which fit a command for which `diff --cached --quiet` → 1 and `rev-parse
--verify --quiet` → 1 are normal answers. A sync `TExecFn` cannot be re-expressed over an async seam
without changing that framework-owned contract and its sync callers (`MarketplaceClient`,
`BundlePluginInstaller`), which is a plugin-subsystem migration whose cause sits beside this item,
not under it; so the plugin adapter is left as it is, the package gains one spawn site, and this spec
says so rather than pretending a reuse. That migration — the sync `git clone` behind `/plugin
marketplace add` blocks the interactive loop exactly as a sync commit would — and the divergence
between the plugin adapter's 11-name allowlist (SEC-017) and the worktree adapter's `GIT_*`
denylist are recorded as one root item on the shell-boundary umbrella (issue #1999), with
`git-process.ts` named as the seam the migration should land on.

**Environment policy — from THIS command's threat model.** A person typing `/git commit` in their
own repository is not attacker-controlled text reaching a program-naming variable (SEC-017's case);
their environment is theirs. What can go wrong is HOOK NESTING: a git hook exports the variables
that force a child `git` back to the hook's repository. So the policy is a narrow denylist of the
repository-locating variables — `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`,
`GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`, `GIT_PREFIX`, `GIT_NAMESPACE` — and everything
else is preserved: `XDG_CONFIG_HOME` and `GIT_CONFIG_GLOBAL` (where many users' identity lives),
`GIT_AUTHOR_*` / `GIT_COMMITTER_*` / `EMAIL`, `GPG_TTY`, `GNUPGHOME`, `SSH_AUTH_SOCK` (a
`commit.gpgsign` user must not hang or fail). `/git` runs on the HOST, never through the coding
pack's sandbox client; stated here because `pack-coding`'s tools may.

**`/git status`.** `git status --porcelain=v2 -z --branch` parsed into `{ branch, staged, unstaged,
untracked }` with paths; a `2` (rename/copy) record reads TWO NUL-terminated fields, `path` then
`origPath`, so the pair stays a pair; `-z` so a path with a space, a quote or a non-ASCII character
is one element. There is no `rev-parse --show-toplevel` pre-check: git's own exit 128 and its
stderr (`fatal: not a git repository …`) are the single source of "not a repository", reported as a
non-success result, and "git is not on PATH" is the spawn error reported the same way. Output is the
four groups with counts, and `data` carries the parsed sets.

**`/git diff`.** Grammar, and nothing outside it: `/git diff` (unstaged), `/git diff --staged` (index
vs HEAD), `/git diff <rev>` (worktree vs rev), `/git diff <rev>..<rev>` (two revisions), each
optionally followed by `-- <path>…`. Every revision — ONE for `<rev>`, TWO for a range — is checked
first with `rev-parse --verify --quiet --end-of-options <rev>^{commit}`; an unknown one is refused by
name before any diff runs. Any other token starting with `-` is refused with the usage line — the
family is not a pass-through for git flags, because a flag is exactly how an argv element turns into
an option. In the argv git receives, `--end-of-options` precedes every user revision and a literal
`--` precedes every path (gitcli(7)). Known limit, recorded not hidden: the slash tokeniser splits on
whitespace with no quoting, so a path containing a space cannot be expressed by ANY slash command
today; that is a framework item, not this one.

**`/git commit`.** Operates on the staged set only, ever: no `-a`, no `add`, no path arguments.
`git diff --cached --quiet` first (exit 1 = something staged); when nothing is staged, one
`status --porcelain=v2 -z` call supplies the counts for the guidance, and nothing else runs ⇒ "Nothing is staged
(N unstaged, M untracked). Stage files with `git add` or `/shell git add …` and run `/git commit`
again." — guidance naming WHY, not a silent no-op. The message is the rest of the line (`/git commit
feat: …` or `/git commit -m feat: …`); one matching pair of outer quotes is stripped, because a user
will type them; absent, it is asked for as free text. The inline form is SUBJECT-ONLY: the TUI and
headless channels split the line on whitespace and re-join with single spaces before any command
sees it (`TuiInteractionChannel.ts`, `headless-stream-json.ts`), so no newline reaches `execute`;
a commit body is out of scope for this item. The subject is validated against the Conventional
Commits v1.0.0 MUST rules and nothing more: `<type>[(scope)][!]: <description>` — a type token, an
optional parenthesised scope, an optional `!`, the terminal `: `, a non-empty description. The
commitlint conventions (a type from a fixed list, ≤ 72 characters, no trailing period) are NOT
enforced — a repository that does not use them must not be refused — but they are shown as warnings
in the confirmation. Then the confirmation: `confirmAction` listing the message and the staged files
from `git diff --cached --name-status`; a refusal commits nothing and says so; an absent
`IUserInteraction` (headless, automation) is a CANCELLATION with a message, never a guess — the
port's own documented rule, and the precedent is `/doctor repair`, which refuses without a UI
(`/exit`, by contrast, proceeds — the wrong precedent for a write). Only after `yes` does `git commit
-m <message>` run, as argv. `lifecycle` is per command, not per verb, so `/git` as a whole is `blocking` — `status`
and `diff` included, as `/compact` is — and the session shows the executing state through the hooks. `requiresPermission: true` is set for what it governs — the model-tool projection
and the opt-in remote policy — and NOT relied on for the user path: `SystemCommandExecutor.executeCommand`
(`packages/agent-framework/src/commands/system-command-executor.ts`) calls `execute` directly; the
prompt is in the command.

**Registration and reachability.** Always registered — in `pack-coding` beside `/shell` and
`/editor`, mirrored in the base list — with the runner defaulting to the in-package seam and
injectable for tests. Git being absent or the directory not being a repository are RUNTIME facts the
command answers with a reason (the `/handoff` precedent), not composition facts; the `/theme`
absence rule exists because print mode genuinely has no themes, which is not this case. `/help`
renders the `/git` line; the `ICommandSource` entry's `subcommands` carry the three verbs to
autocomplete. `/status` stays unclaimed for a future session-status command.

**Capability preservation.** `/shell` and the Bash tool are untouched; the plugin adapter is
untouched.

**Adversarial pass.** A revision named `--output=/tmp/x` is refused as a flag before `rev-parse`
sees it; `--end-of-options` and `--` mean `-p` as a revision or a filename is data; `-z` parsing
means a filename with a newline is one element; a runner exit code ≠ 0 with empty stdout is reported
with stderr, never as an empty status; the confirmation lists exactly the files `git diff --cached
--name-status` reports, so what is confirmed is what is committed; a hook that exports `GIT_DIR`
cannot redirect the child, because the policy strips it.

**Independent review record.** `finding-depth-triager`: `DEPTH VERDICT: LOCAL` (2026-09-20) — a missing module, deliverable on the existing composition, argv and confirm seams; the one premise corrected is that `requiresPermission: true` is not a user-path prompt. `prior-art-researcher`: `PRIOR_ART_RESEARCH: FOUND` (§ Prior Art). `proposal-reviewer`, three rounds against the live source (2026-09-20): round 1 `REVIEW VERDICT: REVISE` (10 findings — the runner seam's premises, the registration tier, the environment threat model, four unfalsifiable criteria, the message grammar, the newline claim), round 2 `REVISE` (5 — the seam's timeout/stdin/typed outcomes, the root item's scope, the preserve set, Task text), round 3 `REVIEW VERDICT: ENDORSE`, `ACTIONABLE FINDINGS: 0`. Ledger: `.agents/loop-runs/backlog-execution-orchestrator.jsonl` run `r20260920051523`, `roundFindings: [10, 5, 0]`.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — `/theme` (`theme-command-module.ts`) is the module-and-port precedent;
      `/memory` and `/plugin` parse their own verb with descriptive `subcommands`; `/doctor repair`
      (`doctor-command-module.ts`) is the refuse-without-a-UI precedent; `/handoff` is the
      register-and-answer-at-runtime precedent; `default-plugin-command-adapter.ts` (SEC-017) and
      `git-worktree-isolation-adapter.ts` are the two existing spawn sites, read and NOT reused, for
      the reasons § Decision gives; `pack-coding` is the registration tier for capability modules.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — one module inside the package that owns every other command
      module, registered through the pack that owns capability modules; no new package, app,
      presentation or interface surface; no layer reclassification.

## Fallback & Degradation Declaration

- `git` not on `PATH`, or the directory not a repository: the command fails with git's own reason
  (the spawn error, or exit 128 with its stderr); nothing is guessed and nothing is silent.
- `/git commit` with no interactive renderer: cancelled with a message saying a confirmation was
  needed and none could be asked for — never committed, never silently skipped.
- A runner failure (non-zero exit anywhere else): the command fails with git's stderr in the
  message.
- Nothing staged: guidance naming the unstaged and untracked counts — not an empty commit and not
  `-a`.
- A diff larger than 16 MiB: the child is killed and the result says the output exceeded 16 MiB —
  the exact size is unknowable past the cap and is not claimed.
- A child that never exits (a hook reading stdin, a pinentry): stdin is ignored and the timeout
  kills it; the result names the timeout. `git` not on PATH: the spawn failure is named.
- The pack disabled (a host without `pack-coding`): the base list mirrors the module, as it does
  `/shell`.

## Solution

1. `packages/agent-command/src/git/git-process.ts`: `IGitProcessPort`, `createGitProcess()` over
   `execFile` (`shell: false`, `maxBuffer` 16 MiB, exit code as data), and `gitEnvironment(source)`
   — the hook-nesting denylist.
2. `packages/agent-command/src/git/git-status.ts`: `parseStatusPorcelainV2(stdout)` and
   `executeGitStatus(port, cwd)`.
3. `packages/agent-command/src/git/git-diff.ts`: `parseDiffArgs(tokens)` (the grammar above, flags
   refused, `--end-of-options` and `--` placement), revision verification, `executeGitDiff`.
4. `packages/agent-command/src/git/git-commit.ts`: staged check, `validateConventionalSubject`
   (MUST rules; warnings for the conventions), the `ask` flow, `executeGitCommit`.
5. `packages/agent-command/src/git/git-command-module.ts`: one `ISystemCommand` named `git`
   (`requiresPermission: true`, `modelInvocable: false`, `lifecycle: 'blocking'`, `subcommands`
   for the three verbs) whose `execute` parses the verb; one `ICommandSource`;
   `createGitCommandModule(port?)`; `index.ts` exports.
6. `packages/pack-coding/src/coding-pack.ts`: register beside `/shell`; `default-command-modules.ts`:
   mirror; `packages/agent-command/src/index.ts`: exports.
7. `packages/agent-command/docs/SPEC.md`: the family's contract; `packages/agent-cli/README.md`: `/git`
   beside `/shell`.
8. Task `## Plan` renamed to the `/git <verb>` names.

## Affected Files

- `packages/agent-command/src/git/git-process.ts` (new)
- `packages/agent-command/src/git/git-status.ts` (new)
- `packages/agent-command/src/git/git-diff.ts` (new)
- `packages/agent-command/src/git/git-commit.ts` (new)
- `packages/agent-command/src/git/git-command-module.ts` (new), `src/git/index.ts` (new)
- `packages/agent-command/src/default/default-command-modules.ts`
- `packages/agent-command/src/index.ts`
- `packages/pack-coding/src/coding-pack.ts`
- `packages/agent-command/docs/SPEC.md`, `packages/agent-cli/README.md`
- `packages/agent-command/src/git/__tests__/*.test.ts` (new),
  `packages/agent-ui-terminal/src/__tests__/pty/behavior-2437-git.ptytest.ts` (new)

## Completion Criteria

- [ ] TC-01: `/git status` — the port receives exactly one call, `['status', '--porcelain=v2', '-z',
'--branch']`; the parser yields branch, staged, unstaged and untracked sets from a fixture that
      holds a `2` rename record (pair kept), a path with a space, a quote and a non-ASCII character
      (each one element), and a `MM` entry (in both staged and unstaged); exit 128 with `fatal: not a
git repository` on stderr yields a non-success result carrying that reason and no second call.
- [ ] TC-02: `/git diff` — bare ⇒ `['diff']`; `--staged` ⇒ `['diff', '--staged']`; `<rev>` ⇒ first
      `['rev-parse', '--verify', '--quiet', '--end-of-options', '<rev>^{commit}']` then `['diff',
'--end-of-options', '<rev>']`; `<a>..<b>` ⇒ TWO `rev-parse` calls then `['diff',
'--end-of-options', '<a>..<b>']`; a trailing `-- p q` appends `['--', 'p', 'q']`; a `rev-parse`
      exit 1 refuses by name with NO `diff` call; `--output=x` (or any other `-`-token) is refused with
      the usage line and no call at all.
- [ ] TC-03: `/git commit` — `diff --cached --quiet` exit 0 ⇒ the guidance message naming the unstaged
      and untracked counts and no `commit` call; a subject failing a MUST rule (no `: `, empty
      description, bad type token) is refused naming the rule, while `feat!: x` and `fix(scope): y` are
      accepted and a > 72-character subject only warns; a refused confirmation ⇒ `Commit cancelled.`
      and no `commit` call; an absent `IUserInteraction` ⇒ a cancellation message and no `commit`
      call; a confirmed commit ⇒ exactly `['commit', '-m', '<subject>']` after the `--name-status`
      listing call, never `-a`, never `add`; one matching pair of outer quotes is stripped.
- [ ] TC-04: the seam — against a REAL temporary repository, `createGitProcess()` passes `shell:
false` with stdin ignored; a subject and a path containing shell metacharacters reach git as
      one element each; exit codes are returned as data (`diff --cached --quiet` → 1 when staged, 0
      when not); a child that reads stdin (a `pre-commit` hook running `cat`) exits with EOF rather
      than hanging; a child exceeding the timeout is killed and reported as `failed: timeout`; a
      missing executable is reported as `failed: not-found`; an output past 16 MiB is reported as
      `failed: output-too-large`. A run whose `signal` is aborted mid-way is reported as `failed: aborted`. `gitEnvironment()` at unit level strips `GIT_DIR`, `GIT_WORK_TREE`,
      `GIT_INDEX_FILE`, `GIT_OBJECT_DIRECTORY`, `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_COMMON_DIR`,
      `GIT_PREFIX`, `GIT_NAMESPACE` and preserves, by name, `XDG_CONFIG_HOME`, `GIT_CONFIG_GLOBAL`,
      `GIT_AUTHOR_NAME/EMAIL`, `GIT_COMMITTER_NAME/EMAIL`, `EMAIL`, `GPG_TTY`, `GNUPGHOME`,
      `SSH_AUTH_SOCK`; and a commit made with `GIT_CONFIG_GLOBAL` pointing at a temp config carries
      that identity while a hook-exported `GIT_DIR` pointing elsewhere does not redirect the child.
- [ ] TC-05: registration — `createCodingPack()`'s `commandModules` and `createDefaultCommandModules()`
      both contain `agent-command-git`; the `ICommandSource` entry is `git` with `subcommands`
      `status`, `diff`, `commit` and `modelInvocable: false`; the `/help` output contains a `/git`
      line; the command name `status` is registered nowhere.
- [ ] TC-06: engineering verification — build, test and typecheck for the affected packages exit 0;
      `pnpm harness:scan` exits 0; the lint-warning ceiling holds.
- [ ] TC-07: the built binary in a PTY over a temporary repository with staged, unstaged and untracked
      files: `/git status` shows the three groups; `/git diff` and `/git diff --staged` show the right
      content, `/git diff HEAD~1` and `/git diff nosuchrev` are refused by name; `/git commit` with
      `no` leaves `git log` unchanged; `/git commit feat: add greeting` with `yes` produces exactly one
      commit whose tree holds the staged file and not the unstaged edit.

## Test Plan

| TC-ID | Test Type                | Tool / Approach                                                                         | Notes                                              |
| ----- | ------------------------ | --------------------------------------------------------------------------------------- | -------------------------------------------------- |
| TC-01 | Unit                     | Vitest over `parseStatusPorcelainV2` and `executeGitStatus` with a scripted port        | Fixture from a real `--porcelain=v2 -z` run        |
| TC-02 | Unit                     | Vitest over `parseDiffArgs` and `executeGitDiff` with a scripted port                   | Asserts the exact argv sequence per branch         |
| TC-03 | Unit                     | Vitest over `executeGitCommit` with a scripted port and a scripted `ask`                | Every branch of the confirm flow                   |
| TC-04 | Integration              | Vitest over `createGitProcess` and `gitEnvironment` against a real temporary repository | Metacharacters, exit codes, hook-nesting variables |
| TC-05 | Unit                     | Vitest over `createCodingPack` and `createDefaultCommandModules`                        |                                                    |
| TC-06 | Engineering verification | package build/test/typecheck, `pnpm harness:scan`, `pnpm lint`                          |                                                    |
| TC-07 | Process / PTY            | Agent-controlled PTY over the built CLI in a temporary git repository                   | The user execution scenario                        |

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 4`

Executability was proven before drafting (2026-09-20, `user-execution-scenario-author`), against the surface as it is TODAY, with none of the four scenarios' behaviour implemented: the workspace binary `packages/agent-cli/bin/robota.cjs` was spawned under `process.execPath` in a 100x32 `xterm-256color` PTY with an isolated HOME holding the dummy provider profile, cwd a throwaway repository under the session scratchpad holding one commit, one staged edit (`greeting.txt`), one unstaged edit (`notes.txt`) and one untracked file (`scratch.log`). The TUI reached `Type a message or /help` and `Idle` with `git: main` in the status bar; typing `/` opened the autocomplete (which lists `/shell` and, today, no `/git`); `/git status` + Enter answered `Unknown command "/git". Type /help for help.`; `/shell git status --short` printed `?? scratch.log` from the fixture repository and the prompt redrew; `/exit` asked `Exit the session?` and Enter exited with code 0; `git log --oneline` afterwards still held exactly the one fixture commit. In the same fixture after `robota trust --yes`, print mode ran slash commands with no provider call: `robota -p "/help" --bare --no-session-persistence` printed the command list and exited 0; `robota -p "/git status" --bare --no-session-persistence` printed `Unknown command "/git".` and exited 1 — so a non-success command result is exit 1 headlessly. Every `Unknown command` line above is exactly the not-yet-implemented behaviour these scenarios replace; everything else (boot, slash dispatch, confirm dialog, exit, headless exit-code mapping) is the surface as shipped. Scenario 1 and 2 together are TC-07; Scenario 1 also observes TC-05's `/help` and `/status` clauses; Scenario 3 observes TC-03's nothing-staged branch and Scenario 4 TC-03's absent-`IUserInteraction` branch, each at the product surface rather than the scripted port. On a host where a global `robota` shadows the workspace one (`pnpm exec robota` resolves to `~/.volta/bin/robota` here), a human runs `node <repo>/packages/agent-cli/bin/robota.cjs` with the same arguments; the ptytest always spawns the workspace binary by path.

### Scenario 1: read the branch, the three status groups and each diff form through /git; /help lists it and /status stays unclaimed

- executability: agent-executable
- product surface: robota-tui
- surface rationale: shipped-entrypoint=robota
- prerequisites: the affected packages are built (`pnpm build:deps`, or `pnpm --filter @robota-sdk/agent-cli build` after `pnpm build` of its dependencies); `git` is on PATH; no live credential and no external service — no turn is submitted to a provider, only slash commands run. A temporary repository is created OUTSIDE the monorepo (`git init -b main`; `git config user.name Robota Scenario` and `git config user.email scenario@example.invalid` so a later commit has an identity without any global config; `greeting.txt` = `hello`, `notes.txt` = `note one`, committed as `chore: initial fixture`), then `greeting.txt` is changed to `hello world` and `git add greeting.txt` (the STAGED edit), `note two` is appended to `notes.txt` (the UNSTAGED edit), and `scratch.log` is created (UNTRACKED). The Robota process runs in a 100x32 `xterm-256color` PTY whose HOME is an isolated temporary directory holding `.robota/settings.json` with the dummy `anthropic` provider profile (`writeTuiProviderSettings`), driven by `packages/agent-ui-terminal/src/__tests__/pty/behavior-2437-git.ptytest.ts` (run with `pnpm --filter @robota-sdk/agent-ui-terminal exec vitest run --config vitest.pty.config.ts src/__tests__/pty/behavior-2437-git.ptytest.ts`); a human runs the same command below from the fixture repository, waits for `Type a message or /help`, and types each slash line followed by Enter, in this order — `/help`, `/status`, `/git status`, `/git diff`, `/git diff --staged`, `/git diff -- notes.txt`, `/git diff HEAD~1`, `/git diff nosuchrev`, `/git diff --output=/tmp/x` — then `/exit` and Enter on `Exit the session?` (TC-07 read half; TC-05 `/help` and `/status` clauses)
- command: `pnpm exec robota --name git-scenario`
- observable type: ui-state
- observable rationale: source=rendered-product-ui
- expected observable: visible=`/help` prints a line beginning `/git` in the command list; `/status` answers `Unknown command "/status"` (the name is still unclaimed); `/git status` prints the branch `main` and the three groups with counts — `staged (1)` naming `greeting.txt`, `unstaged (1)` naming `notes.txt`, `untracked (1)` naming `scratch.log` — with no other path under any group; `/git diff` prints a hunk containing `+note two` and NOT `+hello world`; `/git diff --staged` prints a hunk containing `+hello world` and NOT `+note two`; `/git diff -- notes.txt` prints `+note two` and no `greeting.txt` header; `/git diff HEAD~1` prints a refusal line containing the literal `HEAD~1` (the repository has exactly one commit) and no `diff --git` header follows it; `/git diff nosuchrev` prints a refusal line containing the literal `nosuchrev` and no `diff --git` header follows it; `/git diff --output=/tmp/x` prints the usage line naming the accepted forms (`--staged`, `<rev>`, `<a>..<b>`, `-- <path>`) and no diff, and afterwards `/tmp/x` does not exist; after `/exit` the process exits with code 0 and, in the fixture repository, `git log --oneline` still lists exactly one commit and `git status --porcelain` still reports `M  greeting.txt`, ` M notes.txt` and `?? scratch.log` — the read commands changed nothing
- cleanup: exit the Robota process with `/exit` (Yes) and confirm it exited, then remove only the temporary repository and the isolated HOME; nothing under the monorepo is touched
- evidence: pending

### Scenario 2: /git commit refuses a non-conventional subject, commits nothing on No, and on Yes commits exactly the staged file

- executability: agent-executable
- product surface: robota-tui
- surface rationale: shipped-entrypoint=robota
- prerequisites: the same build, the same fresh fixture repository (one commit, staged `greeting.txt`, unstaged `notes.txt`, untracked `scratch.log`, local `user.name`/`user.email` set) and the same isolated-HOME PTY as Scenario 1, driven by the same ptytest; a human runs the command below from the fixture repository, waits for `Type a message or /help`, and types in this order — `/git commit add greeting` Enter (no `: ` separator, a MUST-rule violation); `/git commit feat: add greeting` Enter, then on the confirmation moves the highlight to `No` with the arrow keys and presses Enter; `/git commit "feat: add greeting"` Enter (outer quotes, to be stripped), then on the confirmation moves the highlight to `Yes` and presses Enter; then `/exit` and Enter on `Exit the session?`. After the run, outside Robota: `git log --oneline`, `git show --stat --format=%s HEAD`, `git status --porcelain` in the fixture repository (TC-07 commit half; TC-03's subject-rule, quote-stripping, refusal and confirmed-commit branches at the surface)
- command: `pnpm exec robota --name git-scenario`
- observable type: ui-state
- observable rationale: source=rendered-product-ui
- expected observable: visible=`/git commit add greeting` prints a refusal that names the missing `: ` type separator (Conventional Commits MUST rule), shows NO confirmation dialog, and `git log --oneline` still lists one commit; `/git commit feat: add greeting` shows a confirmation dialog whose text contains the message `feat: add greeting` and the staged listing `M` `greeting.txt`, and does NOT list `notes.txt` or `scratch.log`; choosing `No` prints `Commit cancelled.` and `git log --oneline` still lists exactly one commit; `/git commit "feat: add greeting"` shows the confirmation with the message rendered as `feat: add greeting` WITHOUT the surrounding quotes and the same one-file listing; choosing `Yes` prints a success line containing a 7-hex-digit short hash and `feat: add greeting`; afterwards `git log --oneline` lists exactly two commits, the newest with subject `feat: add greeting`, `git show --stat --format=%s HEAD` lists `greeting.txt` as the ONLY changed file (`1 file changed`), and `git status --porcelain` reports exactly ` M notes.txt` and `?? scratch.log` — the unstaged edit and the untracked file were not committed; after `/exit` the process exits with code 0
- cleanup: exit the Robota process with `/exit` (Yes) and confirm it exited, then remove only the temporary repository and the isolated HOME; the commit made lives only in that removed repository
- evidence: pending

### Scenario 3: /git commit with nothing staged prints guidance with the unstaged and untracked counts and commits nothing

- executability: agent-executable
- product surface: robota-tui
- surface rationale: shipped-entrypoint=robota
- prerequisites: the same build and isolated-HOME PTY as Scenario 1, driven by the same ptytest, over a fixture repository built the same way EXCEPT that nothing is staged: one commit (`greeting.txt`, `notes.txt`), `note two` appended to `notes.txt` (unstaged) and `scratch.log` created (untracked), so `git diff --cached --quiet` exits 0; a human runs the command below from that repository, waits for `Type a message or /help`, types `/git commit feat: nothing to commit` Enter, then `/exit` and Enter on `Exit the session?`; afterwards `git log --oneline` and `git status --porcelain` outside Robota (TC-03's nothing-staged branch at the surface; TC-07's guidance clause)
- command: `pnpm exec robota --name git-scenario`
- observable type: ui-state
- observable rationale: source=rendered-product-ui
- expected observable: visible=`/git commit feat: nothing to commit` prints a guidance message containing `Nothing is staged (1 unstaged, 1 untracked)` and naming `git add` and `/shell git add` as the way to stage, shows NO confirmation dialog, and afterwards `git log --oneline` still lists exactly one commit while `git status --porcelain` still reports ` M notes.txt` and `?? scratch.log` — no empty commit and no implicit `-a`; after `/exit` the process exits with code 0
- cleanup: exit the Robota process with `/exit` (Yes) and confirm it exited, then remove only the temporary repository and the isolated HOME
- evidence: pending

### Scenario 4: headless /git commit cancels because no confirmation can be asked, exits non-zero, and commits nothing

- executability: agent-executable
- product surface: robota-cli
- surface rationale: shipped-entrypoint=robota
- prerequisites: the same build and a fixture repository built exactly as in Scenario 1 (one commit, staged `greeting.txt`, unstaged `notes.txt`, untracked `scratch.log`, local identity set); `HOME` exported to an isolated temporary directory holding `.robota/settings.json` with the dummy `anthropic` provider profile, `TERM=dumb`, no provider key in the environment — print mode runs a slash command without contacting a provider (proven above with `/help`); print mode requires workspace trust, so first run `robota trust --yes` in the fixture repository (it prints `Workspace trust: trusted`); then run the command below from the fixture repository, capture its exit code, and afterwards run `git log --oneline` there (TC-03's absent-`IUserInteraction` branch at the surface; § Fallback `/git commit` with no interactive renderer)
- command: `pnpm exec robota -p "/git commit feat: add greeting" --bare --no-session-persistence`
- observable type: product-output
- observable rationale: source=product-process
- expected observable: exit=1; output-contains=cancelled — the printed result says the commit was cancelled because a confirmation was needed and none could be asked for, no `Yes`/`No` prompt is written, the process exits 1 (a non-success command result, the same mapping `Unknown command` takes today) without hanging, and afterwards `git log --oneline` in the fixture repository still lists exactly one commit while `git status --porcelain` still reports `M  greeting.txt` — the staged file was NOT committed
- cleanup: remove only the temporary repository and the isolated HOME (the trust grant is recorded under that HOME and goes with it); nothing under the monorepo is touched
- evidence: pending

## Tasks

- [ ] `.agents/tasks/BEHAVIOR-2437-deliver-first-class-git-status-diff-and-commit-commands.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: line 1 is `---`, block closes at line 6 (`gate.mjs judge`, mechanical)
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft` at line 2 (mechanical)
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: `type: BEHAVIOR` (mechanical)
- GATE-WRITE — `tags:` field present in frontmatter: `tags: [behavior]` (mechanical)
- GATE-WRITE — Contains a concrete symptom: § Problem names the wrong behaviour precisely — `/status` → `Unknown command`; `createDefaultCommandModules` registers 35 modules and none is a git module (verified: 35 factories in `default-command-modules.ts`, no git module); both existing routes hand arguments to a shell as text, `/shell` being `sh -c <string>` by TERM-003 contract (verified in `shell-command.ts` via `resolveShell()`); no confirmation boundary before `/shell git commit -a -m …` (semantic, guardian)
- GATE-WRITE — Contains a reproduction condition: "In any git repository, `robota`, then `/status`" → `Unknown command`; `/shell git diff "$(cat /tmp/x)"` shows the shell-syntax exposure; the commit example shows the missing confirmation — where and when are both stated (semantic, guardian)
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: § Problem has none; 7 sentences, 1738 chars (mechanical)
- GATE-WRITE — `## Prior Art Research` section present: present, researched by `prior-art-researcher` 2026-09-20 (mechanical)
- GATE-WRITE — Section is substantiated: 8 product-doc rows (Claude Code, Gemini CLI, Codex, Copilot CLI, Aider, Cursor/Windsurf, gitcli(7)/git-status, Conventional Commits v1.0.0), all documentation links, no third-party source code (mechanical, `scan-spec-research`)
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present: not waived — substantiated instead (mechanical)
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision`: the `/status` = session-status finding (Codex, Copilot) is the stated reason Alternative 2 (`/git <verb>`) beats Alternative 3 (three flat names); gitcli(7) `--end-of-options` / `--` supplies the argv discipline in `/git diff`; `--porcelain=v2 -z` from git-status supplies `/git status`; the confirm port's documented absence-as-cancellation (verified `host-roles.ts:76-82`) is the stated reason the Aider auto-commit model is rejected; Conventional Commits MUST rules define the subject check; every reference product keeping a raw escape hatch is why `/shell git …` stays. Evidence-based, not asserted (semantic, guardian)
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 ticked (mechanical)
- GATE-WRITE — Sibling scan item is `[x]` with completion evidence: names `/theme`, `/memory`, `/plugin`, `/doctor repair`, `/handoff`, the two existing spawn sites, and `pack-coding` as registration tier (mechanical)
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con: 4 alternatives, each with Pro and Con (mechanical)
- GATE-WRITE — Decision references the trade-off that drove the choice: Alternative 2's Con is owned in the Decision — the issue's literal names `/status`/`/diff`/`/commit` are given up for one `/git` name to avoid the sourced session-status collision; one `requiresPermission`/`safety` per command classifies the read-only verbs with the write under the opt-in remote policy, accepted with the reason (allow-by-default, no `/shell` remotely); the seam is NOT built on the plugin adapter's `runGit` at the cost of a second spawn site, with the reasons (no `cwd`, throws on non-zero, sync `TExecFn`, not exported — verified `default-plugin-command-adapter.ts:85-185`) and the migration filed on the #1999 umbrella rather than hidden (semantic, guardian)
- GATE-WRITE — New-surface placement (conditional): N/A, recorded with reason — one command module inside `packages/agent-command`, the package that owns all 35 existing command modules, registered through `pack-coding` exactly as `/shell` and `/editor` are (verified `coding-pack.ts:88`) and mirrored in the base list; no new package, app, presentation or interface surface; no layer or product-family reclassification. The sibling scan still names the analogous modules and the registration tier (semantic, guardian)
- GATE-WRITE — Every item has a `TC-N` prefix: TC-01..TC-07, all prefixed (mechanical)
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: `/git status` parser + single call → TC-01; `/git diff` grammar, revision verification, `--end-of-options`/`--` placement, flag refusal → TC-02; `/git commit` staged-only check, CC MUST validation with `!` and scope, `ask` confirm, refusal, absent-UI cancellation, quote stripping, exact `commit -m` argv → TC-03; the async argv seam (`shell: false`, stdin ignored, exit code as data, timeout/abort/not-found/output-too-large) AND `gitEnvironment()` denylist/preserve set → TC-04 (both live in `git-process.ts`, Solution step 1, and TC-04 asserts each by name); registration in `createCodingPack()` and `createDefaultCommandModules()`, `subcommands`, `modelInvocable: false`, `/help` line, `status` unclaimed → TC-05; build/test/typecheck/scan/lint → TC-06; the PTY scenario → TC-07. Solution steps 7 (SPEC.md/README) and 8 (Task plan rename) are documentation deliverables, not behaviour, and carry no TC — noted, not required by this criterion (semantic, guardian)
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): TC-01/02/03 assert verbatim argv sequences against a scripted port (`['status','--porcelain=v2','-z','--branch']`; `['rev-parse','--verify','--quiet','--end-of-options','<rev>^{commit}']` then `['diff','--end-of-options','<rev>']`; exactly `['commit','-m','<subject>']` after the `--name-status` call) plus exact messages (`Commit cancelled.`) and call counts (no second call, no `diff` call, no call at all); TC-04 names each `failed` reason and each env variable stripped or preserved, against a real temporary repository; TC-05 asserts containment, `subcommands`, `/help` content and that `status` is registered nowhere; TC-06 is exit-code form; TC-07 is observable-behaviour form — its one soft clause, "`/git diff` and `/git diff --staged` show the right content", is bound by Scenario 1's expected observable in the same document (bare diff shows the unstaged edit and not the staged one; `--staged` the reverse), which the TC-07 Test Plan row names as the approach, so it is falsifiable as written. No criterion is unfalsifiable (semantic, guardian)
- GATE-WRITE — No criterion uses "works correctly", "no errors", "implemented", "displays correctly": none present (mechanical)
- GATE-WRITE — `## Test Plan` section present: present (mechanical)
- GATE-WRITE — One row exists for each TC-N: 7 rows = 7 criteria, TC-01..TC-07 (mechanical)
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach: 7 rows, no TBD (mechanical)
- GATE-WRITE — Rows where Tool is "manual" have a Notes entry: 0 manual rows (mechanical)
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` names `.agents/tasks/BEHAVIOR-2437-deliver-first-class-git-status-diff-and-commit-commands.md — todo` (mechanical)
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): present with 0 prior entries before this one (mechanical)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body: none (mechanical)

Independent review record verified, not accepted: ledger `.agents/loop-runs/backlog-execution-orchestrator.jsonl` line 60 carries run `r20260920051523`, `roundFindings: [10,5,0]`, `terminal: "converged"`, `ref` = the paired Task — consistent with § Architecture Review › "Independent review record". TC-N count: 7 in Completion Criteria, 7 in Test Plan.

**Judged at:** HEAD `867c7752984adaadc547e297e1f44a680a63d4bd` · base `origin/develop@867c7752984adaadc547e297e1f44a680a63d4bd` · document `.agents/spec-docs/draft/BEHAVIOR-2437-deliver-first-class-git-status-diff-and-commit-commands.md` blob `86e1e23f45263ba04d3d778757d5839d0c7d5ed1` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "BEHAVIOR-2437 스펙을 승인합니다"
**Given:** 2026-09-20, this conversation
**Review fingerprint:** 8fb3294103bc (review b15cdd2a, type/tags d80948cb)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (8fb3294103bc) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `867c7752984a` · base `origin/develop@867c7752984a` · document `.agents/spec-docs/backlog/BEHAVIOR-2437-deliver-first-class-git-status-diff-and-commit-commands.md` blob `d213a49fa6ef` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "BEHAVIOR-2437 스펙을 승인합니다"
**Given:** 2026-09-20, this conversation
**Review fingerprint:** 8fb3294103bc (review b15cdd2a, type/tags d80948cb)

- GATE-APPROVAL — Ordering: PASS — the prior gate `[GATE-WRITE] — ✅ PASS | 2026-09-20` is recorded on this document and carries `**Status upgrade:** draft → review-ready`; the document's current `status: review-ready` equals that entry's `Y`, which is what the prior-gate map's declared `recorded-pass` rule for this row requires. It is also the only GATE-WRITE entry, so the plain last-entry rule agrees. The file sits in `.agents/spec-docs/backlog/`, the folder `spec-workflow.md` § status table maps `review-ready` to; `node scripts/harness/scan-doc-folder-status-agreement.mjs` re-run by the guardian → `violations=0 result=PASS`.
- GATE-APPROVAL — User has provided explicit approval in the current conversation (mechanical): PASS — the standing entry above, written by `gate.mjs approve --route DIRECT --instruction "BEHAVIOR-2437 스펙을 승인합니다"`, carries `**Approval route:** DIRECT`, `**Instruction (verbatim):** "BEHAVIOR-2437 스펙을 승인합니다"`, `**Given:** 2026-09-20, this conversation`. Guardian re-ran rather than cited: `node scripts/harness/gate.mjs judge --gate GATE-APPROVAL --doc <this> --dry-run` → "9 criteria judged — 6 PASS, 0 FAIL, 3 PENDING-GUARDIAN", "no entry written". `node scripts/harness/scan-standing-delegation-evidence.mjs` → exit 0 (394 approved spec documents; 127 DIRECT, 49 CLASS).
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the statement names this item's ID (`BEHAVIOR-2437`) and the word `스펙`, and uses `승인` (a catalogue-listed Route DIRECT form). The ID resolves to exactly one spec document: `ls .agents/spec-docs/*/ | grep 2437` returns only this file. Provenance verified in the session transcript, not taken from the dispatch: at 2026-09-20T05:34:37Z the orchestrator asked, via `AskUserQuestion`, "BEHAVIOR-2437 스펙(GATE-APPROVAL, DIRECT 경로)을 승인하시겠습니까?" with the option labelled exactly "BEHAVIOR-2437 스펙을 승인합니다" beside an alternative that would have changed the design ("이슈의 이름 그대로 (/status, /diff, /commit)" — Alternative 3), and at 2026-09-20T05:37:56Z the user (a `type: user` turn, `tool_result` of that question) selected "BEHAVIOR-2437 스펙을 승인합니다". The design trade-off the owner most needed to weigh (`/git <verb>` vs the issue's three flat names) was put to the user and the approval chose it. The only tool calls between the question (05:34:37Z) and the recording (`gate.mjs advance` then `approve`, 05:38:47Z) were read-only `sed`/`grep` over `packages/pack-coding` and `packages/agent-command` — the document was not edited between what the user approved and what was fingerprinted. It is not a clarifying-question answer ("C"/"ㅇㅇ"/"응"), not silence, not approval of a different item (the same session's earlier approvals, "SCREEN-2002 스펙을 승인합니다" 2026-09-19 and "SCREEN-2670 스펙을 승인합니다" 2026-09-20T03:15Z, name different IDs and are not this statement), and not a standing class instruction.
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval: N/A — route DIRECT; no class is cited anywhere in the approval entry.
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: N/A as a Route CLASS condition — route DIRECT; the instruction, its date and the conversation are nonetheless recorded in the fields of both the mechanical entry above and this one, and the verbatim text matches the transcript's selected option code-point for code-point.
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: N/A — route DIRECT; no class evidence condition is claimed, so there is nothing to measure.
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A — route DIRECT; neither registered class (`LANE-L0-L1`, `BACKLOG-ZERO-MIGRATION`) is invoked, the document declares `lane: L2` (so `LANE-L0-L1` could not apply), and the change is package source (excluded from `BACKLOG-ZERO-MIGRATION` by its own row). The approval's authority rests entirely on the instruction naming THIS item, which the DIRECT semantic criterion above judges.
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: PASS — the guardian recomputed `reviewFingerprint()` (`scripts/harness/gate-operations.mjs:897`) over the current document text and obtained `8fb3294103bc (review b15cdd2a, type/tags d80948cb)`, identical to the `**Review fingerprint:**` the mechanical entry recorded at approval; the dry run reports the same equality. `type: BEHAVIOR` / `tags: [behavior]` and the whole Architecture Review (Affected Scope, 4 Alternatives, Decision incl. `**Delivery mode:** single`, 5/5 Checklist) are the design the owner approved.
- GATE-APPROVAL — Independent architecture validation (conditional): N/A — the condition is not triggered, verified against the tree rather than taken from the spec's claim. § Affected Files lists 6 new source paths, all under `packages/agent-command/src/git/` (plus its `__tests__/`), one new PTY test under `packages/agent-ui-terminal/src/__tests__/pty/`, and edits to 4 existing files (`default-command-modules.ts`, `agent-command/src/index.ts`, `pack-coding/src/coding-pack.ts`, two docs). Both packages exist under `packages/` (63 entries, none git-named); no new package, app, or presentation/interface surface is added — `/git` is one more `ISystemCommand` module in the package that already owns all 35 command modules (`grep -c "CommandModule(" default-command-modules.ts` → 35), registered in the tier that already registers the same-kind capability modules (`coding-pack.ts:88` — `commandModules: [createShellCommandModule(), createEditorCommandModule()]`) and mirrored in the base list exactly as those two are. The placement has one plausible home and a same-package sibling it mirrors (`/theme` for the module-and-port shape, `/shell`/`/editor` for the registration tier), so no layer or product-family boundary is reclassified and no `proposal-reviewer` placement verdict or `architecture-audit-fanout` structure-channel result is required by this criterion. Recorded as context, not as a criterion: an independent review did happen and did cover the registration tier — § Decision › "Independent review record" names `proposal-reviewer` round 1 `REVISE` (10 findings, including "the registration tier"), round 2 `REVISE` (5), round 3 `REVIEW VERDICT: ENDORSE`, `ACTIONABLE FINDINGS: 0`; the ledger `.agents/loop-runs/backlog-execution-orchestrator.jsonl` row `r20260920051523` (`ref` = this item's Task) corroborates it independently of prose: `roundFindings: [10, 5, 0]`, `terminal: "converged"`, `closed: 2026-09-20T05:33:46.882Z`.
- GATE-APPROVAL — NON-COMPLIANCE trigger (implementation started before this gate ran): not met — `packages/agent-command/src/git/` does not exist; `rg "createGitCommandModule|IGitProcessPort|git-process|agent-command-git" packages` (no symlink following) returns nothing; `default-command-modules.ts` names no git module; `git status --porcelain` carries no path outside `.agents/` (this spec, untracked; the paired Task, modified only to rename its `## Plan` items to `TC-01..TC-07` `/git <verb>` names and its scenario to the `/git` spellings — Solution step 8, a planning artifact; the orchestrator ledger's one appended row; two auto-generated lessons files). The checkout is on `feat/behavior-2437-git-commands` at `867c7752` = `origin/develop` — `git log origin/develop..HEAD` is empty, so no commit carries implementation; the only other worktree (`.claude/worktrees/robota-handoff-prompt-fb8dfd`) is on an unrelated branch, and no stash names this item.
- GATE-APPROVAL — Semantic evaluation: all 3 pending guardian criteria resolved — 1 PASS (approval directed at this spec) and 2 N/A with their reasons stated (inside-the-class, independent architecture validation); 0 FAIL.

**Judged by:** `backlog-gate-guard` (semantic) + `gate.mjs` (mechanical)
**Judged at:** HEAD `867c7752984adaadc547e297e1f44a680a63d4bd` · base `origin/develop@867c7752984adaadc547e297e1f44a680a63d4bd` · document `.agents/spec-docs/backlog/BEHAVIOR-2437-deliver-first-class-git-status-diff-and-commit-commands.md` blob `c454a7cac00aae37188aeec99eeb8139f778db96` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-20

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-20; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/BEHAVIOR-2437-deliver-first-class-git-status-diff-and-commit-commands.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/BEHAVIOR-2437-deliver-first-class-git-status-diff-and-commit-commands.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (7)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 198 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 4`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 3 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/BEHAVIOR-2437-deliver-first-class-git-status-diff-and-commit-commands.md",
  "specPath": ".agents/spec-docs/todo/BEHAVIOR-2437-deliver-first-class-git-status-diff-and-commit-commands.md",
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
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 4
  },
  "worktreePaths": [
    ".agents/loop-runs/backlog-execution-orchestrator.jsonl",
    ".agents/spec-docs/todo/BEHAVIOR-2437-deliver-first-class-git-status-diff-and-commit-commands.md",
    ".agents/tasks/BEHAVIOR-2437-deliver-first-class-git-status-diff-and-commit-commands.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `867c7752984a` · base `origin/develop@867c7752984a` · document `.agents/spec-docs/todo/BEHAVIOR-2437-deliver-first-class-git-status-diff-and-commit-commands.md` blob `d33cfdaad25f` (untracked)
