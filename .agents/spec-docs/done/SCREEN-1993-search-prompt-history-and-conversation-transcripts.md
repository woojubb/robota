---
status: done
type: SCREEN
tags: [tui, session, search]
lane: L2
---

# SCREEN-1993: Search prompt history and conversation transcripts

Paired with `.agents/tasks/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md`. Arising from [issue #1993](https://github.com/woojubb/robota/issues/1993).

## Problem

The TUI's only prompt recall is Up/Down over an in-memory string array built from the current
session's history (`packages/agent-ui-terminal/src/flows/input-area-flow.ts:71-129`,
`InputArea.tsx:91-101`, `hooks/useInputAreaKeys.ts:69-100`). Reproduction: run `robota`, submit a few
prompts, press Ctrl+R — nothing happens; there is no filter-as-you-type search, no scope beyond the live
session, and no way to reuse a prompt from another session or project without opening that session. The
session records persist `cwd`, `createdAt`/`updatedAt`, `messages[].timestamp` and `history`
(`packages/agent-interface-session/src/session-contracts.ts:326-351`), but the store port is
`save/load/list/delete` and `list()` decodes every record in full, synchronously
(`packages/agent-session/src/session-store.ts:187-194`,
`packages/agent-framework/src/interactive/workspace-session-store.ts:133-150`); there is no paged or
streamed read, and no enumeration of other projects' stores (project stores are minted from the
admitted workspace's authority). Issue #1993's second premise — a 100-message render window that hides
the conversation from the terminal's own search — is stale: SCREEN-010 commits every history entry,
including a resumed session's, into one Ink `<Static>` (`packages/agent-ui-terminal/src/app-static-items.ts`)
and the alternate screen is never engaged (`docs/SPEC.md` § Screen Reader Mode,
`screen-010-scrollback.ptytest.ts`), so the full transcript already sits in native scrollback.
`DEPTH VERDICT: LOCAL` (`finding-depth-triager`, 2026-09-19): a missing feature on existing seams.

## Prior Art Research

**Researched:** 2026-09-19 by `prior-art-researcher` from product documentation only (docs, release
notes, manuals; no third-party source code).

| #   | Reference                                                                                                                                    | What it establishes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1  | Claude Code — Interactive mode § Command history: https://code.claude.com/docs/en/interactive-mode#command-history                           | History stored per working directory; a consecutive duplicate is recorded once. Inline `Ctrl+R` (again = older match, `Tab`/`Esc` accept-and-edit, `Enter` accept-and-execute, `Ctrl+C` cancel restoring the original input; always all projects) and a dialog (type to filter, `Up`/`Down`, `Ctrl+S` cycles session / project / all, `Enter` or `Tab` place the match in the input, `Esc` cancels). Newest first, duplicates collapsed to the newest; recent prompts appear immediately, older fill in; accept/cancel work while loading. |
| R2  | Claude Code — Keybindings § History search: https://code.claude.com/docs/en/keybindings                                                      | `history:search` (Ctrl+R); `HistorySearch` context `next` (Ctrl+R), `accept` (Esc, Tab), `cancel` (Ctrl+C), `execute` (Enter), `cycleScope` (Ctrl+S); the dialog's Enter/Tab/Esc documented as fixed; Ctrl+C/Ctrl+D reserved.                                                                                                                                                                                                                                                                                                              |
| R3  | Claude Code — Fullscreen § Search and review the conversation: https://code.claude.com/docs/en/fullscreen#search-and-review-the-conversation | `Ctrl+O` transcript mode with `/` search; `[` writes the full conversation into native scrollback "so `Cmd+f`, tmux copy mode … can search it"; stated motivation: the alternate screen hides the conversation. The classic renderer "keeps the conversation in your terminal's native scrollback so `Cmd+f` and tmux copy mode work as usual."                                                                                                                                                                                            |
| R4  | Claude Code — CHANGELOG: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md                                                    | 1.0.117 Ctrl-R search "like bash/zsh"; 2.1.129 picker defaults to all projects, Ctrl+S narrows; 2.1.147 no consecutive duplicates; 2.1.202 accept/cancel while the history file is still being scanned; 2.1.243 a malformed `history.jsonl` line is tolerated. No history-search or transcript change from 2.1.240 (2026-08-24) to 2.1.278 (2026-09-19).                                                                                                                                                                                   |
| R5  | Claude Code — What's new: https://code.claude.com/docs/en/whats-new                                                                          | Weeks 34–37 (Aug 17 – Sep 11, 2026): no history-search or transcript change; the issue's 2026-08-22 snapshot still holds.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| R6  | OpenAI Codex CLI — Developer commands: https://learn.chatgpt.com/docs/developer-commands?surface=cli                                         | `Ctrl+R` searches prompt history, `Enter` uses a match, `Esc` cancels; `/keymap` remaps; no scope cycling, no separate insert-vs-run.                                                                                                                                                                                                                                                                                                                                                                                                      |
| R7  | OpenAI Codex CLI — Config reference: https://learn.chatgpt.com/docs/config-file/config-reference                                             | `history.persistence = save-all` or `none` into one global `$CODEX_HOME/history.jsonl`; `history.max_bytes` caps it; `tui.alternate_screen = auto` skips the alternate screen in Zellij "to preserve scrollback"; `tui.keymap.<context>.<action>`.                                                                                                                                                                                                                                                                                         |
| R8  | Gemini CLI — Keyboard shortcuts: https://geminicli.com/docs/reference/keyboard-shortcuts/                                                    | `Ctrl+R` reverse search; `Enter` submits the selected match, `Tab` accepts; no scope cycling, no transcript viewer.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| R9  | Gemini CLI — Session management: https://geminicli.com/docs/cli/session-management/                                                          | State under `~/.gemini/tmp/<project_hash>/`; sessions are project-specific; no cross-project recall.                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| R10 | GitHub Copilot CLI: https://docs.github.com/en/copilot/how-tos/use-copilot-agents/use-copilot-cli                                            | No history search, no transcript viewer — no comparable reference.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| R11 | Aider — In-chat commands: https://aider.chat/docs/usage/commands.html                                                                        | Up arrow or `CONTROL-R` searches message history; `.aider.input.history` persisted per project; the transcript is a plain markdown file (native scrollback / editor search, no viewer).                                                                                                                                                                                                                                                                                                                                                    |
| R12 | GNU Readline — Searching: https://www.gnu.org/software/bash/manual/html_node/Searching.html                                                  | Incremental search narrows per character; `C-r` again = older; ESC ends the search leaving the line editable; newline accepts and executes; `C-g` aborts and restores the original line.                                                                                                                                                                                                                                                                                                                                                   |
| R13 | Bash — HISTCONTROL: https://www.gnu.org/software/bash/manual/html_node/Bash-Variables.html                                                   | `ignoredups` (consecutive) vs `erasedups` (all earlier duplicates, newest kept) — the two dedup levels.                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| R14 | Zsh — Line editor: https://zsh.sourceforge.io/Doc/Release/Zsh-Line-Editor.html                                                               | `^R` repeats to the next match; `accept-line` executes; an interrupt returns to the original line, still editable.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| R15 | fish — Searchable command history: https://fishshell.com/docs/current/interactive.html                                                       | Substring filter, `ctrl-r` pager, Esc stops the search to edit; duplicates removed globally with the newest kept.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| R16 | fzf — Reference: https://junegunn.github.io/fzf/reference/                                                                                   | Input consumed asynchronously — filtering and accepting start before input is fully read; `--scheme=history` newest-first; Esc/Ctrl-C abort with no output; the shell `Ctrl-R` binding pastes the selection rather than executing it.                                                                                                                                                                                                                                                                                                      |
| R17 | Atuin — Config: https://docs.atuin.sh/18.18/configuration/config/                                                                            | `filter_mode` default `global`, cycled through `host/session/directory/workspace` with ctrl-r; `enter_accept` default `false` (Tab returns to the shell to edit).                                                                                                                                                                                                                                                                                                                                                                          |

**Observed common behaviour.** `ctrl+r` opens reverse search everywhere (R1, R6, R8, R11, R12, R14,
R17); ordering is newest first (R1, R15, R16, R17); dedup has two layers — consecutive suppression at
write time (R1, R4 2.1.147, R13 `ignoredups`) and collapse-to-newest at search time (R1, R13
`erasedups`, R15); storage is per directory with a global default search and a key to narrow (R1, R4,
R17); the modern default for accept is _insert into the input_, with _execute_ as a separate key or an
opt-in (R1 dialog, R12, R16, R17); cancel restores the original line exactly (R1, R12, R14, R16); large
histories are streamed with accept allowed mid-load and a malformed line skipped, not fatal (R1, R4,
R16); keys live in a dedicated rebindable context with some documented as fixed (R2, R7); an in-app
transcript viewer exists only where alternate-screen rendering removes native scrollback (R3), otherwise
the terminal's own scrollback and search are the answer (R3 classic, R7, R11).

**Constraints for Robota.** Provider-neutral by construction (a prompt string, a session id and a
project root involve no provider). Extend the existing seams — `flows/input-area-flow.ts`
(`extractPromptHistory`, `appendPromptHistory` with its consecutive dedup), the `chat-input` context and
`keybindings/keybinding-catalogue.ts` — not a parallel path. `~/.robota/keybindings.json` rejects
unknown contexts, so a new context is a catalogue + published-schema change; Ctrl+C and screen-reader
numeric entry stay reserved. Native scrollback is a guarded invariant (no alternate screen), which rules
out a pager and makes the terminal the transcript viewer. Screen-reader mode must not re-render a
progressively filling list on every block. "Silence is not success": a corrupt line is a counted,
visible skip. The overlay is an input-owning Ink component like `SlashAutocomplete`; the loader is
cancellable and takes an injectable reader.

**Recommendation.** Ship prompt-history search as one overlay (Ctrl+R; filter-as-you-type with match
highlight; newest-first, collapse-to-newest; scope cycle defaulting to all; Enter/Tab insert, a separate
rebindable execute key; Esc cancels restoring text and cursor; chunked newest-first loading with
accept/cancel mid-load). Reject the in-app transcript viewer and the dump key: Robota already keeps the
whole conversation in native scrollback, which is the exact condition under which the reference product
itself says neither is needed.

## Architecture Review

### Affected Scope

- `packages/agent-interface-session` — new `prompt-history-contracts.ts`: `IPromptHistoryEntry { at, sessionId, project, text }`, `IPromptHistoryWriter { append(entry): void }`, `IPromptHistorySource { read({ signal }): AsyncIterable<IPromptHistoryBlock> }`, `IPromptHistoryBlock { entries (newest-first), skippedLines }`; exported from the index; SPEC Public API rows.
- `packages/agent-session` — new `prompt-history-file.ts`: `NodePromptHistoryFile` implementing both contracts over one owner-only JSONL file under the owned user root (the `NodeSessionLogSink` write regime and the `session-log-sources.ts` no-follow positional-read boundary); SPEC file-format section.
- `packages/agent-framework` — `paths.ts` (`userPaths().history`); `interactive/interactive-session-execution-controller.ts` appends through an injected `promptHistoryWriter` at the point that emits `turn_source`/`user_message`; session options thread the writer like `memoryStore`; a failed append is reported once per session as a visible notice; `workspace-trust/types.ts`: `IRestrictedWorkspaceProjectAccess` exposes the resolved `identity` when one resolved, so the project key has one derivation; SPEC seam paragraph.
- `packages/agent-cli` — `startup/prompt-history-enablement.ts` (settings `promptHistory`, `ROBOTA_PROMPT_HISTORY=0` kill switch, project key derivation), composition in `cli.ts` (writer into the TUI session options only; source + project key into `renderApp`); README section.
- `packages/agent-ui-terminal` — keybinding catalogue (`chat-input.history-search`, context `history-search`, `TEXT_ENTRY_CONTEXTS`), `history-search/history-search-flow.ts` (pure), `history-search/useHistorySearch.ts`, `HistorySearchOverlay.tsx` inside `InputArea.tsx` (the `SlashAutocomplete` pattern), `hooks/useInputAreaHistorySearch.ts` open action, the open flag lifted through `app-view-model.ts` / `hooks/useAppScreenState.ts` / `hooks/useAppInputBindings.ts`, `render.tsx`/`tui-channel-options.ts`/`tui-session-options.ts` options; `apps/docs/public/schemas/keybindings.schema.json`; SPEC section.
- No new package, app or presentation surface; one new user-home file (`~/.robota/history.jsonl`) beside the existing `~/.robota/sessions`.

### Alternatives Considered

1. **User-level append-only prompt-history file + streamed tail reader (chosen).** The interactive
   session appends one JSONL line per user-originated turn to `~/.robota/history.jsonl`; the reader walks
   the file backwards in fixed blocks, newest first; the overlay searches that stream for the `project` and
   `all` scopes and the live in-memory prompt list for `session`.
   - Pro: provider-neutral; no cross-project trust read; one file streamed tail-first gives "recent first,
     older fill in" by construction; matches the two products that ship global search (R1/R4, R7); a
     malformed line is a counted skip.
   - Con: a second, prompt-only copy of text the session record already owns (a derived projection, never
     authoritative); prompts sent before this version are not in the file, so `project`/`all` start empty
     at upgrade (`session` is unaffected); one more user-home file, with a kill switch.
2. **Paged query over the session stores.** Extend `IInteractiveSessionStore` with `enumerate()` and
   stream `load(id)` newest session first; enumerate other projects through a new trust-store listing and
   mint a read-only project state storage per root.
   - Pro: searches what already exists on disk; no second copy.
   - Con: every session file is decoded in full (messages, tool results) to extract a few prompts; "all
     projects" needs read authority the trust model deliberately scopes to the admitted workspace
     (`workspace-trust/types.ts:40-50` mints nothing for a foreign root, and a revoked root's `.robota/`
     would be attacker-controllable input); per-record loading gives session-major order, not newest-first
     across sessions; two persistence shapes (snapshot + replay log) to reconcile inside a search.
3. **In-app transcript viewer** (R3: `Ctrl+O`, `/` search, `[` dump).
   - Pro: mirrors the reference product line for line.
   - Con: justified upstream only by alternate-screen rendering; Robota's scrollback invariant makes the
     terminal the viewer; a pager would need the alternate screen or a second in-memory transcript copy,
     which the Task rules out.
4. **Search only over the live session** (no persistence).
   - Pro: smallest change.
   - Con: fails the issue's scope and responsiveness lines; the Task Objective names all three scopes.

### Decision

**Alternative 1** (`proposal-reviewer`: round 1 `REVISE` with 10 findings, round 2 `REVIEW VERDICT:
ENDORSE` on 2026-09-19; `DEPTH VERDICT: LOCAL`). Trade-off: a derived, append-only projection of prompt
text the session record already owns, in exchange for a search that never decodes a session record,
never crosses a workspace boundary, and streams newest-first from one file.

Amendments from the review that make the proposal's own claims true:

- The append is an injected port called inside the execution controller at the point that already emits
  `turn_source` and `user_message` — not an event subscriber, because `user_message` is overloaded with
  `[remote-control]` notices emitted without a preceding `turn_source`
  (`interactive-session.ts:496,582`), so a subscriber could not tell a prompt from a notice.
- Recorded only when `turnSource` is `'user'` AND `driverId` is absent or `OWNER_DRIVER_ID`: a remote
  co-driver's prompt is theirs, not the owner's history. Recorded text is `rawInput ?? input` (what the
  user typed, never a skill's synthesized `displayInput`), trimmed by the same rule as
  `appendPromptHistory`, so the `session` and file scopes dedupe identically; an entry equal to the last
  one this session wrote is suppressed.
- The file is written under the `NodeSessionLogSink` regime (`ensureOwnerOnlyDirectory`,
  `tightenExistingFile`, `appendFileSync` with `OWNER_ONLY_FILE_MODE`) with the user root passed as OWNED
  exactly as `createUserSessionStore` does (SEC-020); the reader opens with the package's no-follow
  `openFlags()` and reads positionally, the calls `session-log-sources.ts` already makes.
- Error policy: `ENOENT` alone is the empty fresh-install state; every other open/read error is thrown to
  the overlay, which renders it; a failed append is reported once per session through the session's
  event channel as a visible notice and never aborts the turn; `skippedLines` is displayed.
- Project key: the resolved workspace identity's `worktreeRoot` whenever the identity resolver succeeds
  (trusted, untrusted or revoked alike — the resolver is trust-independent); only `identity-unavailable` /
  `store-unavailable` fall back to `realpath(cwd)`. To avoid a second `git rev-parse`,
  `IRestrictedWorkspaceProjectAccess` carries the `identity` the trust service already resolved.
  Containment note: the two project-root carriers (ARCH-048) stay a separate root item; this key is
  derived from the identity so it is unaffected when they unify.
- Default ON is a product decision, stated: prompts are already persisted verbatim per session, the file
  is owner-only, and the shell-history analog is default-on; the README says what is written, where, and
  how to turn it off. Only the interactive TUI writes prompt history; `--serve` and print mode receive no
  writer.
- Screen-reader mode follows the `SlashAutocomplete` precedent (keys active, rows numbered for
  announcement only, digits are query text), not the switcher's numeric selection.
- The Task's Plan step 1, which described Alternative 2, is rewritten to the chosen design before the
  planning checkpoint.

Reachability: the source and writer are injected by `agent-cli` on the `memoryStore` precedent
(`cli.ts` → session options / `renderApp` → `tui-channel-options.ts`); the overlay reaches Ink through
the existing `Overlays` slot. Capability preservation: Up/Down recall, slash autocomplete, the
workspace switcher and the session picker keep their keys and behaviour; `ctrl+r`, `ctrl+s`, `ctrl+e`
are unbound today; Ctrl+C stays reserved. Adversarial pass: history file absent → empty `project`/`all`
with `session` intact; unreadable file → rendered error, never an empty list; corrupt line → counted
skip; append failure → one notice, the turn proceeds; a co-driver's prompt → not recorded; a skill
turn → the typed text, not the synthesized one; cancel mid-load → reader aborted, draft restored
byte-identical; insert mid-load → accepted against what is loaded; screen-reader mode → list re-rendered
per keystroke or at load end only; a multiplexer swallowing `ctrl+s` → the key is rebindable.

**Out of scope, stated:** an in-app transcript viewer or dump key (rejected with the reason above);
backfilling the file from existing session records; fuzzy matching (substring only); a `/history`
command; unifying the two project-root carriers (ARCH-048).

**Delivery mode:** `single`

One PR: the contracts and the file are observable only through the overlay.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — the in-memory prompt navigation (`flows/input-area-flow.ts`), the slash autocomplete popup (`SlashAutocomplete.tsx`, `hooks/useAutocomplete.ts`), the session picker (`SessionPicker.tsx` over `listResumableSessionSummaries`), the workspace switcher (`ExecutionWorkspaceSwitcher.tsx`), the keybinding catalogue (`keybinding-catalogue.ts`), the user session store (`createUserSessionStore`) and the session log sink/source fs boundary (`session-log-sinks.ts`, `session-log-sources.ts`) were read; the overlay reuses the autocomplete's input-owning pattern and the switcher's keybinding/hint pattern, the file reuses the sink's write regime and the source's read boundary, and the injection reuses `memoryStore`'s path — no parallel path is introduced.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification.

## Fallback & Degradation Declaration

- `~/.robota/history.jsonl` absent (fresh install, or `promptHistory: false` / `ROBOTA_PROMPT_HISTORY=0`):
  the `project` and `all` scopes are empty and the overlay says so ("no stored prompts yet"); the
  `session` scope is the live list and always works. Nothing is defaulted silently — the README and the
  overlay's footer state the switch.
- The file exists but cannot be opened or read (permissions, a directory, a symlink): the overlay renders
  the error text; it never shows an empty list for a read failure.
- A malformed line: skipped and counted; the overlay shows "N unreadable lines skipped".
- An append fails: one visible notice per session; the turn is not affected.
- Screen-reader mode: the results list is announced once per keystroke and once when loading completes;
  no fill-in re-renders.

## Solution

1. `packages/agent-interface-session/src/prompt-history-contracts.ts` (+ index, `docs/SPEC.md`): the
   three contracts and the block type above.
2. `packages/agent-session/src/prompt-history-file.ts` (+ index, `docs/SPEC.md`): `NodePromptHistoryFile`
   — writer (owner-only directory and file, tighten-then-append, one JSON object per line) and reader
   (no-follow open, backwards 64 KiB blocks, complete lines newest-first, partial line carried across
   blocks, shape guard, `skippedLines`, abort between blocks, `ENOENT` → empty).
3. `packages/agent-framework`: `paths.ts` `userPaths().history`; `workspace-trust/types.ts`
   `IRestrictedWorkspaceProjectAccess.identity?`, set by `workspace-trust-service.ts` when the resolver
   succeeded; session options gain `promptHistoryWriter`; `interactive-session-execution-controller.ts`
   appends per the driver/turn-source/text rules and reports a failed append once; `docs/SPEC.md`.
4. `packages/agent-cli/src/startup/prompt-history-enablement.ts`: `resolvePromptHistoryEnablement(settings, env)`
   and `resolvePromptHistoryProject(access, cwd)`; `cli.ts` composes `NodePromptHistoryFile` at
   `userPaths().history` under the composition's user root, passes the writer into the TUI session
   options only, and the source + project key into `renderApp`; `README.md` "Prompt history" section.
5. `packages/agent-ui-terminal/src/keybindings/keybinding-catalogue.ts`: `chat-input.history-search`
   (`ctrl+r`); context `history-search` — `previous` (`up`), `next` (`down`, `ctrl+r`), `cycle-scope`
   (`ctrl+s`), `insert` (`enter`, `tab`), `execute` (`ctrl+e`), `cancel` (`escape`); `TEXT_ENTRY_CONTEXTS`
   includes it; `apps/docs/public/schemas/keybindings.schema.json` updated.
6. `packages/agent-ui-terminal/src/history-search/history-search-flow.ts` (pure): `filterPrompts`
   (case-insensitive substring, match ranges), `collapseToNewest` (by trimmed text), `cycleScope`
   (`all → session → project → all`), scope predicate, draft snapshot/restore types.
7. `packages/agent-ui-terminal/src/history-search/useHistorySearch.ts`: overlay state, one loader per
   open with an `AbortController`, blocks appended through the pure filter, `session` scope from the live
   list, `insert`/`execute`/`cancel`, `skippedLines` and `error` surfaced, screen-reader render gating.
8. `packages/agent-ui-terminal/src/HistorySearchOverlay.tsx`, rendered inside `InputArea.tsx` on the
   `SlashAutocomplete` pattern (the overlay owns the composer's keys and the composer is never written
   while it is open, which is what restores the draft exactly); `hooks/useInputAreaHistorySearch.ts`
   owns the `chat-input.history-search` open action and the insert/execute effects; the open flag is
   lifted to `hooks/useAppScreenState.ts` so `hooks/useAppInputBindings.ts` (`overlaysBlockKeys`) keeps
   Esc-abort and the switcher key off while it is open; `app-view-model.ts` carries the search surface
   to the input; `render.tsx` / `tui-channel-options.ts` / `tui-session-options.ts` carry `promptHistory`,
   `promptHistorySource` and `promptHistoryProject`.
9. `packages/agent-ui-terminal/docs/SPEC.md`: keys and fixed keys, scopes, ordering, dedup, loading,
   screen-reader behaviour, and the transcript decision with its reason.
10. PTY scenario and the scrollback check (TC-09, TC-10).

## Affected Files

- `packages/agent-interface-session/src/prompt-history-contracts.ts`, `src/index.ts`, `docs/SPEC.md`
- `packages/agent-session/src/prompt-history-file.ts`, `src/index.ts`, `docs/SPEC.md`, tests
- `packages/agent-framework/src/paths.ts`, `src/workspace-trust/types.ts`, `src/workspace-trust/workspace-trust-service.ts`, `src/interactive/interactive-session-execution-controller.ts` (+ the session options it reads), `docs/SPEC.md`, tests
- `packages/agent-cli/src/startup/prompt-history-enablement.ts`, `src/cli.ts`, `README.md`, tests
- `packages/agent-ui-terminal/src/keybindings/keybinding-catalogue.ts`, `src/history-search/history-search-flow.ts`, `src/history-search/useHistorySearch.ts`, `src/HistorySearchOverlay.tsx`, `src/hooks/useInputAreaHistorySearch.ts`, `src/InputArea.tsx`, `src/hooks/useInputAreaKeys.ts`, `src/hooks/useAppScreenState.ts`, `src/hooks/useAppInputBindings.ts`, `src/hooks/useAppInteractionState.ts`, `src/hooks/useAppController.ts`, `src/app-view-model.ts`, `src/AppPresentation.tsx`, `src/App.tsx`, `src/render.tsx`, `src/tui-channel-options.ts`, `src/tui-session-options.ts`, `docs/SPEC.md`, tests, PTY tests
- `apps/docs/public/schemas/keybindings.schema.json`

## Completion Criteria

- [x] TC-01: `NodePromptHistoryFile` — appends one JSON line per entry with owner-only mode (directory and file), and reads a fixture file of >100 lines newest-first in more than one block with a partial line carried across a block boundary; a malformed line is counted in `skippedLines` and not yielded; aborting the signal between blocks stops the iteration; a missing file yields nothing; a file that cannot be opened (a directory at the path) throws.
- [x] TC-02: the execution controller appends `{ at, sessionId, project, text }` for a `'user'` turn with no `driverId` or `OWNER_DRIVER_ID`, using `rawInput` trimmed; does NOT append for `agent-wakeup`, `peer`, or a remote `driverId`; suppresses an immediate consecutive duplicate; a throwing writer produces exactly one visible notice per session and the turn still completes.
- [x] TC-03: `history-search-flow` — `filterPrompts` matches case-insensitively with correct match ranges; `collapseToNewest` keeps the newest occurrence of a trimmed text and preserves newest-first order; `cycleScope` cycles `all → session → project → all`; the scope predicate selects by `project` equality and by `sessionId`.
- [x] TC-04: `useHistorySearch` / overlay — opening starts exactly one loader; results from the first block render before the second is yielded; typing narrows without restarting the loader; `insert` puts the selected text into the input (nothing submitted); `execute` submits it; `cancel` restores the pre-search text and cursor byte-identically and aborts the loader; `skippedLines` and a read error are rendered; in screen-reader mode the list re-renders only per keystroke or at load end and rows are numbered without numeric selection.
- [x] TC-05: keybindings — the catalogue and the published schema agree on the `history-search` context; `ctrl+r` in `chat-input` opens the overlay; every `history-search` action is rebindable through `~/.robota/keybindings.json`; a document binding `ctrl+c` is refused; the footer lists exactly the live keys.
- [x] TC-06: `resolvePromptHistoryEnablement` — settings `promptHistory: false` and `ROBOTA_PROMPT_HISTORY=0` disable, `=1` enables over settings, default is enabled; `resolvePromptHistoryProject` returns the resolved identity's `worktreeRoot` for trusted, untrusted and revoked access and `realpath(cwd)` only for `identity-unavailable`/`store-unavailable`; `IRestrictedWorkspaceProjectAccess.identity` is set by the trust service whenever the resolver succeeded.
- [x] TC-07: composition — the TUI session receives the writer and the render options the source + project; `--serve` and print mode receive no writer (their session options carry none).
- [x] TC-08: `pnpm --filter` build, test and typecheck for agent-interface-session, agent-session, agent-framework, agent-cli and agent-ui-terminal exit 0; `pnpm harness:scan` exits 0; the lint-warning ceiling holds.
- [x] TC-09: the built CLI in a PTY (isolated HOME seeded with a `history.jsonl` of >100 prompts across three `project` values and one malformed line; a local stub provider): Ctrl+R shows matches from the newest block immediately, typing narrows with the match highlighted, `ctrl+s` cycles the scope label through `all → session → project`, `enter` on a match places it in the input and the stub receives nothing, `ctrl+e` on another sends it (the stub receives it), `escape` during a third search restores the original draft byte-identically, and the footer shows the skipped-line count.
- [x] TC-10: the built CLI resumes a persisted session of >100 messages in a PTY and every message text is present in the terminal's scrollback capture without any key being pressed (the transcript decision's evidence); the alternate-screen sequence `ESC [ ? 1049 h` never appears.

## Test Plan

| TC-ID | Test Type                | Tool / Approach                                                                                                                                                                                           | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Unit / fs                | Vitest with a temp directory (`makeTemp`), fixture file written by the writer, block size injected small                                                                                                  | Newest-first across blocks; partial-line carry; skip count — **Test reference:** `packages/agent-session/src/__tests__/prompt-history-file.test.ts` > "NodePromptHistoryFile (SCREEN-1993 TC-01)"                                                                                                                                                                                                                                           |
| TC-02 | Unit                     | Vitest over the execution controller with a recording writer and an `InteractiveSession` test double                                                                                                      | Driver / turn-source / text rules; one notice on failure — **Test reference:** `packages/agent-framework/src/interactive/__tests__/interactive-session-prompt-history.test.ts` > "createPromptHistoryRecorder (SCREEN-1993 TC-02)" and "InteractiveSession wires the recorder into the turn (SCREEN-1993 TC-02)"                                                                                                                            |
| TC-03 | Unit                     | Vitest over the pure flow                                                                                                                                                                                 | Match ranges, collapse, cycle, predicate — **Test reference:** `packages/agent-ui-terminal/src/history-search/__tests__/history-search-flow.test.ts` > "history-search-flow (SCREEN-1993 TC-03)"                                                                                                                                                                                                                                            |
| TC-04 | Component                | ink-testing-library with an injected async source yielding two blocks under fake timers                                                                                                                   | One loader per open; mid-load insert/cancel; SR gating — **Test reference:** `packages/agent-ui-terminal/src/__tests__/history-search-overlay.test.tsx` > "SCREEN-1993 TC-04: the history-search overlay"                                                                                                                                                                                                                                   |
| TC-05 | Unit                     | Vitest over the catalogue, registry and schema parity test; contextual keybindings input test                                                                                                             | Rebindable set; ctrl+c refused; footer parity — **Test reference:** `packages/agent-ui-terminal/src/keybindings/__tests__/keybinding-registry.test.ts` (schema parity; `history-search.execute: ctrl+c` refused); `src/__tests__/contextual-keybindings-input.test.tsx` > "rebinds the history-search open key and its actions through the document"; `src/__tests__/key-hint-consistency.test.tsx` (HistorySearchOverlay footer inventory) |
| TC-06 | Unit                     | Vitest over the enablement resolver and the trust service                                                                                                                                                 | Precedence table; project key per trust state — **Test reference:** `packages/agent-cli/src/startup/__tests__/prompt-history-enablement.test.ts` > "prompt-history enablement (SCREEN-1993 TC-06)"; `packages/agent-framework/src/workspace-trust/workspace-project-authority.test.ts` (restricted access carries `identity`)                                                                                                               |
| TC-07 | Unit                     | Vitest over the CLI composition helpers                                                                                                                                                                   | Writer only on the TUI path — **Test reference:** `packages/agent-cli/src/startup/__tests__/prompt-history-enablement.test.ts` > "prompt-history composition (SCREEN-1993 TC-07)"; `packages/agent-ui-terminal/src/__tests__/render-channel-options.test.ts` > "SCREEN-1993: projects the prompt-history writer to the channel and on to the session options"                                                                               |
| TC-08 | Engineering verification | package build/test/typecheck, `pnpm harness:scan`, `pnpm lint`                                                                                                                                            | **Test reference:** Test skipped as a checked-in suite: engineering verification is the GATE-VERIFY entry (five-package build/test/typecheck exit 0), `pnpm harness:scan` 161 passed / 1 skipped, `pnpm lint` 2347 ≤ 2356                                                                                                                                                                                                                   |
| TC-09 | Process / PTY            | Agent-controlled PTY over `node packages/agent-cli/bin/robota.cjs --name history-scenario --disable-update-check --no-session-persistence` with a seeded isolated HOME and a local OpenAI-compatible stub | The user execution scenario — **Test reference:** Test skipped as a checked-in suite: the PTY run needs a built CLI, a seeded isolated HOME and a local stub — recorded in `.agents/evals/scenarios/screen-1993-history-search-agent-run.md` (driver `scratch/src/screen-1993-history-scenario.mts`, strict, exit 0)                                                                                                                        |
| TC-10 | Process / PTY            | Agent-controlled PTY resuming a seeded >100-message session (`--resume <id>`), scrollback capture                                                                                                         | Transcript decision evidence; no alternate screen — **Test reference:** `packages/agent-ui-terminal/src/__tests__/pty/screen-1993-scrollback.ptytest.ts` > "SCREEN-1993 TC-10: the resumed transcript lives in native scrollback" (`pnpm test:pty`)                                                                                                                                                                                         |

## User Execution Test Scenarios

### Scenario 1: find, insert, run and cancel a prompt from stored history

- executability: agent-executable
- product surface: robota-tui
- surface rationale: shipped-entrypoint=robota
- prerequisites: affected packages are built; an isolated temporary HOME holds an `openai`-type provider profile pointing at a local stub HTTP server started by the driver `scratch/src/screen-1993-history-scenario.mts` (Node `http`, `POST /v1/chat/completions`, one canned reply, recording every request) and a seeded `~/.robota/history.jsonl` of more than 100 prompts across three `project` values plus one malformed line; a 100×32 xterm-256color PTY with `NO_COLOR=1` runs the command from a directory whose project key matches one of the three
- command: `pnpm exec robota --name history-scenario`
- observable type: ui-state
- observable rationale: source=rendered-product-ui
- expected observable: visible=after typing a partial draft and pressing `ctrl+r`, an overlay lists stored prompts newest-first with the scope label `all` and the skipped-line count; typing `deploy` narrows the list to prompts containing it with the match highlighted; `ctrl+s` changes the scope label to `session` then `project`, and under `project` only prompts from the current project remain; `enter` on a highlighted match closes the overlay and places that exact text in the input while the stub receives no request; `ctrl+r`, a query, then `ctrl+e` sends the highlighted match and the stub receives a request whose last user content equals it; `ctrl+r` with the input holding a new draft, a query, then `escape` closes the overlay and the input shows the draft byte-identically
- cleanup: exit the Robota process normally with Ctrl+C and confirm it exited, stop the stub server, then remove only the isolated HOME, project and captured transcript directories
- evidence: pending

## Tasks

- [x] `.agents/tasks/completed/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md` — done

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-19

**Status upgrade:** draft → review-ready

- GATE-WRITE — Ordering: entry gate, no prior gate required; `status: draft` matches the expected input state and the file sits under `.agents/spec-docs/draft/`; `## Evidence Log` was empty before this entry; no implementation ran ahead of the gate — `prompt-history-contracts.ts`, `prompt-history-file.ts`, `startup/prompt-history-enablement.ts`, `HistorySearchOverlay.tsx` and `history-search/` do not exist and `promptHistoryWriter` / `NodePromptHistoryFile` / `history-search` appear nowhere under `packages/*/src`; the worktree carries only the spec (untracked), the paired Task (Plan/Objective amendments) and the loop-run log.
- GATE-WRITE — Frontmatter: file begins with `---`; `status: draft`; `type: SCREEN` is one of the 11 allowed values; `tags: [tui, session, search]`; `lane: L2`.
- GATE-WRITE — Concrete symptom: a named command on the built CLI (`robota`, submit prompts, press Ctrl+R) with the wrong behaviour (nothing happens; recall is Up/Down over an in-memory string array only; no filter-as-you-type, no scope beyond the live session, no cross-session/project reuse) and the code that produces it. Checked against the tree: `flows/input-area-flow.ts` lines 71–129 hold `navigatePromptHistory` / `appendPromptHistory` (trim + consecutive-duplicate suppression at line 46) / `extractPromptHistory`; `keybinding-catalogue.ts` binds none of `ctrl+r`, `ctrl+s`, `ctrl+e` (0 matches) and `keybinding-registry.ts:182` refuses `ctrl+c`; `session-contracts.ts:326-351` carries `cwd`, `createdAt`, `updatedAt`, `history?`; `session-store.ts:187-194` `list()` maps every id through `outcomeForListedId` → `this.load(id)` (full synchronous decode) and `workspace-session-store.ts:133-150` does the same plus replay records; the stale-premise note holds — `app-static-items.ts` renders every history entry in one Ink `<Static>` and `__tests__/pty/screen-010-scrollback.ptytest.ts` exists.
- GATE-WRITE — Reproduction condition: stated inline as "run `robota`, submit a few prompts, press Ctrl+R" — any interactive TUI session, every time, since no binding and no persisted prompt source exist; the file-scope premises (no paged/streamed read, no cross-project enumeration) are the code facts above.
- GATE-WRITE — Problem has no TBD/TODO and is not a vague single sentence (1596 chars, 5 sentences).
- GATE-WRITE — Prior Art Research present and substantiated: 17 product/protocol-document references (Claude Code interactive-mode, keybindings, fullscreen, CHANGELOG, what's-new; Codex CLI commands and config; Gemini CLI shortcuts and sessions; Copilot CLI (no comparable reference); Aider; GNU Readline; Bash HISTCONTROL; Zsh ZLE; fish; fzf; Atuin), dated and attributed to `prior-art-researcher`; no `Waived:` line needed; `scan-spec-research` reports substantiated.
- GATE-WRITE — Research feeds Alternatives/Decision: the "Observed common behaviour" paragraph maps each design choice to R-numbers (Ctrl+R → R1/R6/R8/R11/R12/R14/R17; newest-first → R1/R15/R16/R17; two dedup layers → R1/R4 2.1.147/R13/R15; global default + narrow key → R1/R4/R17; insert-vs-execute split → R1/R12/R16/R17; cancel restores line → R1/R12/R14/R16; streamed load with mid-load accept and tolerated malformed line → R1/R4/R16; rebindable context with fixed keys → R2/R7); Alternative 1 cites R1/R4 and R7 for the global file; Alternative 3 (in-app viewer) is rejected on R3's own stated motivation (alternate screen hides scrollback) against Robota's no-alternate-screen invariant, corroborated by R3 classic / R7 / R11. Evidence-based, not asserted.
- GATE-WRITE — Architecture Review Checklist: 5/5 items `[x]`; Sibling scan carries completion evidence (`input-area-flow.ts`, `SlashAutocomplete.tsx` + `hooks/useAutocomplete.ts`, `SessionPicker.tsx`, `ExecutionWorkspaceSwitcher.tsx`, `keybinding-catalogue.ts`, `createUserSessionStore`, `session-log-sinks.ts` / `session-log-sources.ts` — all present in the tree; extended, not paralleled).
- GATE-WRITE — Alternatives Considered: 4 numbered entries, each with Pro and Con.
- GATE-WRITE — Decision references the driving trade-off: Alternative 1 chosen explicitly as "a derived, append-only projection of prompt text the session record already owns, in exchange for a search that never decodes a session record, never crosses a workspace boundary, and streams newest-first from one file" — Alternative 1's Con traded against Alternative 2's three Cons. Premises verified: `interactive-session-execution-controller.ts:243-244` emits `turn_source` then `user_message` at one point and has `rawInput` (line 198) and `turnOptions.driverId` (lines 218, 259, 317) in scope; `interactive-session.ts:496,582` emit `user_message` with `[remote-control]` notices and no `turn_source`, so an event subscriber could not tell a prompt from a notice; `session-log-sinks.ts:55-88` uses `ensureOwnerOnlyDirectory`, `tightenExistingFile`, `appendFileSync(..., { mode: OWNER_ONLY_FILE_MODE })`; `session-log-sources.ts:31-34` `openFlags()` sets `O_NOFOLLOW` and reads positionally; `IRestrictedWorkspaceProjectAccess` (`workspace-trust/types.ts:139-146`, not `:40-50` as the Alternative 2 Con cites — a line-range slip, the claim itself holds) carries no project storage, so a foreign root is minted nothing; `cli.ts:413` threads `memoryStore` as the precedent. The reviewer claim (round 1 REVISE, 10 findings; round 2 ENDORSE) matches the loop-run record `roundFindings:[10,0]`; the Task's Plan step 1 and Objective are rewritten to the chosen design as the Decision requires.
- GATE-WRITE — New-surface placement: **N/A** — no new package, app, presentation or interface surface and no layer / product-family reclassification: the contracts join the existing `agent-interface-session` package, the file joins `agent-session` beside `createUserSessionStore`, the overlay is a component inside the existing `agent-ui-terminal` package on the `SlashAutocomplete` pattern, and the only new artefact is one user-home file beside `~/.robota/sessions`. The checklist item states the N/A with its reason. Even read as applicable, the Sibling scan names the analogous existing layers and the reuse is at the shared contract level (`agent-interface-session`) with injection through `agent-cli` on the `memoryStore` path — no dependency on a sibling product.
- GATE-WRITE — Completion Criteria: 10 items, all `TC-NN:` prefixed; none uses a banned phrase.
- GATE-WRITE — At least 1 criterion per feature: Solution 1 (contracts) → TC-01 (shape exercised through the file) / TC-07; Solution 2 (`NodePromptHistoryFile` writer + tail reader, skip count, abort, ENOENT, open error) → TC-01; Solution 3 (`userPaths().history`, `identity` on restricted access, controller append with driver/turn-source/text rules, one failure notice) → TC-02 / TC-06; Solution 4 (enablement resolver, project key, `cli.ts` composition, README) → TC-06 / TC-07; Solution 5 (catalogue context, `TEXT_ENTRY_CONTEXTS`, published schema) → TC-05; Solution 6 (pure flow) → TC-03; Solution 7 (`useHistorySearch` loader/insert/execute/cancel/SR gating) → TC-04; Solution 8 (overlay, slot, view model, `overlaysBlockKeys`, draft snapshot/restore, render options) → TC-04 / TC-05 / TC-09; Solution 9 (SPEC) → TC-08 `pnpm harness:scan`; Solution 10 (PTY scenario, scrollback check) → TC-09 / TC-10; every Fallback declaration (absent file, unreadable file, malformed line, append failure, screen-reader gating) → TC-01 / TC-02 / TC-04 / TC-09.
- GATE-WRITE — Command/Observable form: every TC names the unit, hook, component, resolver, composition or PTY command under test and the observable it must produce (JSON lines with owner-only mode, newest-first across blocks, `skippedLines` count, thrown open error, recorded entries per driver/turn-source, exactly one notice, match ranges, cycle order, one loader per open, byte-identical draft restore, catalogue/schema parity, `ctrl+c` refused, precedence table, `worktreeRoot` per trust state, writer absent on `--serve`/print, exit codes, PTY-rendered scope label / highlighted match / stub request content / skipped-line footer, every message in scrollback and no `ESC [ ? 1049 h`); no vague language.
- GATE-WRITE — Test Plan: 10 rows = 10 TC criteria; every row has a Test Type and Tool/Approach; 0 manual rows.
- GATE-WRITE — Structure: `## Tasks` present with the paired-Task placeholder; `## Evidence Log` present and empty at judgement; no `## Status` / `## Classification` body sections.
- GATE-WRITE — Mechanical evaluation: 20 criteria PASS and 0 FAIL (`gate.mjs judge --gate GATE-WRITE --doc …`, run by the guardian without `--dry-run`: 27 judged — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN; the evaluator wrote no entry of its own on this L2 document, deferring the pending set to this entry).
- GATE-WRITE — Semantic evaluation: all 7 pending guardian criteria PASS.

**Judged by:** `backlog-gate-guard` (semantic) + `gate.mjs` (mechanical)
**Judged at:** HEAD `295f48655addb42b0c6c06bf9d0df2a6c162f3ac` · base `origin/develop@295f48655addb42b0c6c06bf9d0df2a6c162f3ac` · document `.agents/spec-docs/draft/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md` blob `f9f2b863a3b448c8c7b1841b06744d86752d0f16` (untracked)

**Independent review evidence:** the Decision records `proposal-reviewer` round 1 `REVISE` (10 findings) and round 2 `REVIEW VERDICT: ENDORSE` on 2026-09-19, and `finding-depth-triager` `DEPTH VERDICT: LOCAL` on 2026-09-19; the orchestrator loop-run record for this session (`.agents/loop-runs/backlog-execution-orchestrator.jsonl`, run `r20260919033845`, `roundFindings:[10,0]`) corroborates the two rounds; the paired Task does not yet carry a Recommendation Evidence section, so the verdict text itself is attested by the spec and the loop-run only. The endorsed design is the one stated in Architecture Review › Decision above.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-19

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "SCREEN-1993 spec을 승인합니다"
**Given:** 2026-09-19, this conversation
**Review fingerprint:** 11a8241693a3 (review 2eb80dc0, type/tags 5de4ad1b)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-19, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (11a8241693a3) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `295f48655add` · base `origin/develop@295f48655add` · document `.agents/spec-docs/backlog/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md` blob `94877701c9b2` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-19

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "SCREEN-1993 spec을 승인합니다"
**Given:** 2026-09-19, this conversation

- GATE-APPROVAL — Ordering: PASS — `[GATE-WRITE] — ✅ PASS | 2026-09-19` carries `**Status upgrade:** draft → review-ready`; current `status: review-ready` and the file sits under `.agents/spec-docs/backlog/`, the folder `spec-workflow.md` § status table maps to that status (`recorded-pass` rule satisfied; the GATE-WRITE entry's "sits under `draft/`" describes the folder at its own judgement, before the status move). NON-COMPLIANCE trigger not met: `prompt-history-contracts.ts`, `prompt-history-file.ts`, `startup/prompt-history-enablement.ts`, `HistorySearchOverlay.tsx` and `history-search/` do not exist, `promptHistoryWriter` / `NodePromptHistoryFile` / `history-search` appear nowhere under `packages/*/src`, and `git status` shows only the spec (untracked), the paired Task and the loop-run log.
- GATE-APPROVAL — User has provided explicit approval in the current conversation (mechanical): PASS — route `DIRECT`, `**Instruction (verbatim):** "SCREEN-1993 spec을 승인합니다"`, `**Given:** 2026-09-19, this conversation`, written by `gate.mjs approve --route DIRECT`; guardian dry run of `gate.mjs judge --gate GATE-APPROVAL --dry-run`: 9 judged — 6 PASS, 0 FAIL, 3 PENDING-GUARDIAN.
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the recorded instruction names this item's ID (`SCREEN-1993`) and the word `spec`, uses `승인` (a catalogue-listed Route DIRECT form), and was given 2026-09-19 in this conversation as the user's chosen answer to a question that summarised Architecture Review › Decision as written: user-level append-only `~/.robota/history.jsonl` with a streamed newest-first tail reader; a Ctrl+R overlay with `session` / `project` / `all` scopes (`ctrl+s` cycles); insert (`enter`/`tab`), execute (`ctrl+e`) and cancel (`escape`, draft restored) keys; the in-app transcript viewer rejected (Alternative 3, scrollback already holds the transcript); default ON with the `ROBOTA_PROMPT_HISTORY=0` kill switch; TUI-only (`--serve` and print mode receive no writer); `proposal-reviewer` ENDORSE round 2 and `DEPTH VERDICT: LOCAL`. The option's label carried a "(Recommended)" suffix that the entry omits; the suffix is the question's presentation, not part of the instruction. It is not a clarifying-question answer, not silence, not approval of another item, and not a standing class instruction. Same form as the sibling at this gate: "SCREEN-1992 spec을 승인합니다" (2026-09-19).
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval: N/A — route DIRECT; no class cited.
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: N/A as a CLASS condition — route DIRECT; the instruction, date and conversation are nonetheless recorded in the fields of the mechanical entry above and repeated here.
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: N/A — route DIRECT; no class measurement claimed.
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A — route DIRECT; no registered class is invoked or could contain an L2 SCREEN item.
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: PASS — the guardian recomputed `reviewFingerprint()` from `scripts/harness/gate-operations.mjs` over the current document and obtained `11a8241693a3 (review 2eb80dc0, type/tags 5de4ad1b)`, equal to the `**Review fingerprint:**` the mechanical entry recorded at approval; the dry run reports the same equality; `type: SCREEN` / `tags: [tui, session, search]` and the Architecture Review are the design the owner approved.
- GATE-APPROVAL — Independent architecture validation (conditional): N/A — the condition is not triggered: Affected Scope declares "No new package, app or presentation surface; one new user-home file"; every package in Affected Scope (`agent-interface-session`, `agent-session`, `agent-framework`, `agent-cli`, `agent-ui-terminal`) exists under `packages/`; the overlay is a component inside the existing `agent-ui-terminal` package on the `SlashAutocomplete` pattern; the contracts join the existing `agent-interface-session` package; no layer or product-family reclassification; the checklist item states the N/A with its reason. Independent review is nonetheless on record: the Decision cites `proposal-reviewer` round 1 `REVISE` (10 findings) and round 2 `REVIEW VERDICT: ENDORSE` (2026-09-19) and `finding-depth-triager` `DEPTH VERDICT: LOCAL` (2026-09-19); the GATE-WRITE entry corroborates the rounds against the loop-run record `r20260919033845` (`roundFindings:[10,0]`). No `architecture-audit-fanout` result is required because the surface is not new.
- GATE-APPROVAL — Semantic evaluation: all 3 pending guardian criteria resolved (1 PASS, 2 N/A with reason); 0 FAIL.

**Judged by:** `backlog-gate-guard` (semantic) + `gate.mjs` (mechanical)
**Judged at:** HEAD `295f48655addb42b0c6c06bf9d0df2a6c162f3ac` · base `origin/develop@295f48655addb42b0c6c06bf9d0df2a6c162f3ac` · document `.agents/spec-docs/backlog/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md` blob `d8e03686cfd758dc96906ae00c1465dd5af93401` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-19

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-19; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (10)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 219 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 1`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md",
  "specPath": ".agents/spec-docs/todo/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md",
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
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 1
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md",
    ".agents/tasks/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `295f48655add` · base `origin/develop@295f48655add` · document `.agents/spec-docs/todo/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md` blob `a4a8b9b7814e` (untracked)

### [GATE-VERIFY] — ✅ PASS | 2026-09-19

**Status upgrade:** in-progress → verifying

- GATE-VERIFY — ordering: prior gate GATE-IMPLEMENT PASS and status `in-progress`: the LAST `[GATE-IMPLEMENT]` entry in this Evidence Log is `✅ PASS | 2026-09-19` (`approved → in-progress`); frontmatter `status: in-progress`; document under `.agents/spec-docs/active/`; `gate.mjs judge --gate GATE-VERIFY --dry-run` re-run by the guardian reports the same ordering PASS (`[GATE-IMPLEMENT] — ✅ PASS | 2026-09-19; status in-progress`). Branch `feat/screen-1993-transcript-search` carries three commits above `origin/develop` `295f48655` (`eef2c0dda` planning checkpoint, `366e5aad8` implementation, `eea4c2152` scenario evidence + plan ticks); `git status --porcelain` shows only the paired Task (its uncommitted `[DONE-GATE-STAGE-2]` entry) and `.agents/loop-runs/backlog-execution-orchestrator.jsonl`.
- GATE-VERIFY — Every item in the `## Plan` section of `.agents/tasks/<ID>.md` is marked complete (`[x]`): `.agents/tasks/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md` `## Plan` (lines 23–36) holds exactly 5 items — `TC-01, TC-02`, `TC-03, TC-04`, `TC-05, TC-06, TC-07`, `TC-09, TC-10`, `TC-08` — all `- [x]`; 0 `- [ ]` boxes and 0 other box states in that section; the five items together name every TC id TC-01 … TC-10 that the GATE-IMPLEMENT checkpoint's `taskItems` lists. The ticks are committed in `eea4c2152`; the Task's uncommitted diff changes no checkbox line. Only the `## Plan` section was read — `## Test Plan`, `## User Execution Test Scenarios` and `## Recommendation Evidence` were not consulted for this criterion. `node scripts/harness/scan-task-plan-items.mjs` → exit 0 (`::examined:: 317 Task Plan sections`, `task-plan-items scan passed.`). `gate.mjs` bound no mechanical judgement to this wording (PENDING-GUARDIAN); judged here.
- GATE-VERIFY — No Plan item is blocked or pending: none of the 5 items carries `blocked`, `pending`, `deferred`, `todo` or any other deferral marker (case-insensitive grep over the `## Plan` section returns 0 hits); none is a disposition item — no merge/land/close/publish item; "Engineering verification" in the TC-08 item is the build/test/typecheck/scan work that TC-08 names, not a disposition. Task frontmatter `status: in-progress`. Judged here (PENDING-GUARDIAN from `gate.mjs`).
- GATE-VERIFY — Build passes for all affected packages (`pnpm build`): affected set per Task `area:` and spec `## Affected Files` is agent-interface-session, agent-session, agent-framework, agent-cli, agent-ui-terminal; `pnpm --filter @robota-sdk/agent-interface-session --filter @robota-sdk/agent-session --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-cli --filter @robota-sdk/agent-ui-terminal build` → exit 0, re-run by the guardian at HEAD `eea4c2152` (the earlier `gate.mjs judge --verify-cmd` run of the same command reported exit 0 but wrote no entry, so it is not cited as evidence); all five packages `build: Done`, no error lines in the log; `git status --porcelain` unchanged afterwards.
- GATE-VERIFY — Tests pass for all affected packages (`pnpm test`): `pnpm --filter @robota-sdk/agent-interface-session --filter @robota-sdk/agent-session --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-cli --filter @robota-sdk/agent-ui-terminal test` → exit 0, re-run by the guardian at HEAD `eea4c2152`: agent-interface-session 7 files / 33 tests passed; agent-session 52 files passed, 2 skipped / 387 passed, 20 skipped; agent-framework 227 files passed, 6 skipped / 1747 passed, 77 skipped; agent-ui-terminal 106 / 903 passed; agent-cli 71 passed, 1 skipped / 515 passed, 18 skipped; 0 failures; every package `test: Done`. Additionally the same five-package `typecheck` → exit 0 (all five `typecheck: Done`).

**Judged by:** `backlog-gate-guard` (semantic) + `gate.mjs` (ordering, dry-run)
**Judged at:** HEAD `eea4c21526da957addcb0e90c53eff97c56c72b9` · base `origin/develop@295f48655addb42b0c6c06bf9d0df2a6c162f3ac` · document `.agents/spec-docs/active/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md` blob `78d4d4d3d9a5ee35818a082d7bdd352288bbe6e0` (tracked)

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-09-19

**Command:** `cd packages/agent-session && npx vitest run src/__tests__/prompt-history-file.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
3:32:35 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5/packages/agent-session

 ✓ src/__tests__/prompt-history-file.test.ts (5 tests) 14ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
   Start at  15:32:35
   Duration  174ms (transform 35ms, setup 0ms, collect 45ms, tests 14ms, environment 0ms, prepare 29ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `eea4c21526da` · base `origin/develop@295f48655add` · document `.agents/spec-docs/active/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md` blob `0e66e8953a40` (modified)

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-09-19

**Command:** `cd packages/agent-framework && npx vitest run src/interactive/__tests__/interactive-session-prompt-history.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
3:32:36 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5/packages/agent-framework

 ✓ src/interactive/__tests__/interactive-session-prompt-history.test.ts (6 tests) 18ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  15:32:36
   Duration  743ms (transform 382ms, setup 0ms, collect 600ms, tests 18ms, environment 0ms, prepare 30ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `eea4c21526da` · base `origin/develop@295f48655add` · document `.agents/spec-docs/active/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md` blob `fe25bce99da2` (modified)

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-09-19

**Command:** `cd packages/agent-ui-terminal && npx vitest run src/history-search/__tests__/history-search-flow.test.ts`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
3:32:38 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5/packages/agent-ui-terminal

 ✓ src/history-search/__tests__/history-search-flow.test.ts (4 tests) 2ms

 Test Files  1 passed (1)
      Tests  4 passed (4)
   Start at  15:32:38
   Duration  136ms (transform 15ms, setup 0ms, collect 15ms, tests 2ms, environment 0ms, prepare 31ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `eea4c21526da` · base `origin/develop@295f48655add` · document `.agents/spec-docs/active/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md` blob `b94c6deb61db` (modified)

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-09-19

**Command:** `cd packages/agent-ui-terminal && npx vitest run src/__tests__/history-search-overlay.test.tsx`
**Exit:** 0
**Output:** (last 10 of 10 line(s))

```
3:32:38 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5/packages/agent-ui-terminal

 ✓ src/__tests__/history-search-overlay.test.tsx (7 tests) 1269ms

 Test Files  1 passed (1)
      Tests  7 passed (7)
   Start at  15:32:38
   Duration  1.97s (transform 324ms, setup 0ms, collect 581ms, tests 1.27s, environment 0ms, prepare 31ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `eea4c21526da` · base `origin/develop@295f48655add` · document `.agents/spec-docs/active/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md` blob `9d1fc64a6912` (modified)

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-09-19

**Command:** `cd packages/agent-ui-terminal && npx vitest run src/keybindings src/__tests__/contextual-keybindings-input.test.tsx src/__tests__/key-hint-consistency.test.tsx`
**Exit:** 0
**Output:** (last 10 of 13 line(s))

```

 ✓ src/keybindings/__tests__/keybinding-registry.test.ts (15 tests) 5ms
 ✓ src/keybindings/__tests__/node-keybindings-source.test.ts (3 tests) 119ms
 ✓ src/__tests__/key-hint-consistency.test.tsx (24 tests) 200ms
 ✓ src/__tests__/contextual-keybindings-input.test.tsx (2 tests) 326ms

 Test Files  4 passed (4)
      Tests  44 passed (44)
   Start at  15:32:41
   Duration  1.10s (transform 470ms, setup 0ms, collect 1.26s, tests 650ms, environment 0ms, prepare 170ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `eea4c21526da` · base `origin/develop@295f48655add` · document `.agents/spec-docs/active/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md` blob `4d0fae44134b` (modified)

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-09-19

**Command:** `cd packages/agent-cli && npx vitest run src/startup/__tests__/prompt-history-enablement.test.ts && cd ../agent-framework && npx vitest run src/workspace-trust/workspace-project-authority.test.ts`
**Exit:** 0
**Output:** (last 10 of 21 line(s))

```
3:32:44 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5/packages/agent-framework

 ✓ src/workspace-trust/workspace-project-authority.test.ts (10 tests | 3 skipped) 6ms

 Test Files  1 passed (1)
      Tests  7 passed | 3 skipped (10)
   Start at  15:32:44
   Duration  226ms (transform 65ms, setup 0ms, collect 94ms, tests 6ms, environment 0ms, prepare 32ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `eea4c21526da` · base `origin/develop@295f48655add` · document `.agents/spec-docs/active/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md` blob `148077d35d22` (modified)

### [GATE-COMPLETE: TC-07] — ✅ PASS | 2026-09-19

**Command:** `cd packages/agent-cli && npx vitest run src/startup/__tests__/prompt-history-enablement.test.ts -t 'TC-07' && cd ../agent-ui-terminal && npx vitest run src/__tests__/render-channel-options.test.ts`
**Exit:** 0
**Output:** (last 10 of 21 line(s))

```
3:32:57 PM [vite] warning: `esbuild` option was specified by "vitest" plugin. This option is deprecated, please use `oxc` instead.

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5/packages/agent-ui-terminal

 ✓ src/__tests__/render-channel-options.test.ts (6 tests) 2ms

 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  15:32:57
   Duration  1.09s (transform 483ms, setup 0ms, collect 961ms, tests 2ms, environment 0ms, prepare 32ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `eea4c21526da` · base `origin/develop@295f48655add` · document `.agents/spec-docs/active/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md` blob `373175060d72` (modified)

### [GATE-COMPLETE: TC-08] — ✅ PASS | 2026-09-19

**Command:** `pnpm --filter @robota-sdk/agent-interface-session --filter @robota-sdk/agent-session --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-cli --filter @robota-sdk/agent-ui-terminal build && pnpm --filter @robota-sdk/agent-interface-session --filter @robota-sdk/agent-session --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-cli --filter @robota-sdk/agent-ui-terminal typecheck && pnpm --filter @robota-sdk/agent-interface-session --filter @robota-sdk/agent-session --filter @robota-sdk/agent-framework --filter @robota-sdk/agent-cli --filter @robota-sdk/agent-ui-terminal test && pnpm harness:scan && pnpm lint`
**Exit:** 0
**Output:** (last 10 of 4378 line(s))

```
   2:3   warning  'TASK_PROGRESS_EVENTS' is defined but never used. Allowed unused vars must match /^_/u          @typescript-eslint/no-unused-vars
   3:3   warning  'TaskRunStateMachine' is defined but never used. Allowed unused vars must match /^_/u           @typescript-eslint/no-unused-vars
  17:8   warning  'TPortPayload' is defined but never used. Allowed unused vars must match /^_/u                  @typescript-eslint/no-unused-vars
  21:10  warning  'dispatchDownstreamReadyTasks' is defined but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  22:10  warning  'finalizeDagRunIfTerminal' is defined but never used. Allowed unused vars must match /^_/u      @typescript-eslint/no-unused-vars
  36:3   warning  'handleTerminalFailure' is defined but never used. Allowed unused vars must match /^_/u         @typescript-eslint/no-unused-vars
  37:3   warning  'handleRetry' is defined but never used. Allowed unused vars must match /^_/u                   @typescript-eslint/no-unused-vars
  39:3   warning  'successAfterAck' is defined but never used. Allowed unused vars must match /^_/u               @typescript-eslint/no-unused-vars

✖ 2347 problems (0 errors, 2347 warnings)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `eea4c21526da` · base `origin/develop@295f48655add` · document `.agents/spec-docs/active/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md` blob `ef817a115016` (modified)

### [GATE-COMPLETE: TC-09] — ✅ PASS | 2026-09-19

**Command:** `HISTORY_SCENARIO_STRICT=1 pnpm --dir scratch exec tsx src/screen-1993-history-scenario.mts | python3 -c "import json,sys; d=json.load(sys.stdin); print('exitCode', d['exitCode'], 'stub', [r['lastUserContent'] for r in d['stub']['requests']]); [print(t['matched'], t['name']) for t in d['todo']]"`
**Exit:** 0
**Output:** (last 10 of 12 line(s))

```
True overlay lists stored prompts newest-first
True overlay shows the skipped-line count 1
True typing `deploy` narrows the list to prompts containing it
True duplicate prompt collapsed to its newest occurrence
True the match is highlighted in the listed rows
True first ctrl+s changes the scope label to `session` (no deploy prompt in the live session)
True second ctrl+s changes the scope label to `project` and keeps only current-project prompts
True enter inserts the match into the input without sending it
True ctrl+e sends the highlighted match
True escape cancels the search and restores the draft byte-identically
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `eea4c21526da` · base `origin/develop@295f48655add` · document `.agents/spec-docs/active/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md` blob `b4d1d1f98f83` (modified)

### [GATE-COMPLETE: TC-10] — ✅ PASS | 2026-09-19

**Command:** `cd packages/agent-ui-terminal && npx vitest run --config vitest.pty.config.ts src/__tests__/pty/screen-1993-scrollback.ptytest.ts`
**Exit:** 0
**Output:** (last 10 of 11 line(s))

```

 RUN  v3.2.6 /Users/jungyoun/Documents/dev/woojubb/robota-5/packages/agent-ui-terminal

 ✓ src/__tests__/pty/screen-1993-scrollback.ptytest.ts (1 test) 566ms
   ✓ SCREEN-1993 TC-10: the resumed transcript lives in native scrollback > every one of 120 restored messages is in the terminal output with no key pressed, and no alternate screen  565ms

 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  15:35:43
   Duration  700ms (transform 24ms, setup 0ms, collect 29ms, tests 566ms, environment 0ms, prepare 31ms)
```

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `eea4c21526da` · base `origin/develop@295f48655add` · document `.agents/spec-docs/active/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md` blob `1d78c5ab0478` (modified)

### [GATE-COMPLETE] — ✅ PASS | 2026-09-19

**Status upgrade:** verifying → done

- GATE-COMPLETE — ordering: prior gate GATE-VERIFY PASS and status `verifying`: [GATE-VERIFY] — ✅ PASS | 2026-09-19; status `verifying`
- GATE-COMPLETE — The checkbox is checked (`[x]`): 10/10 TC checkboxes `[x]`
- GATE-COMPLETE — A `[GATE-COMPLETE: TC-N]` Evidence Log entry exists with: - The exact command or action used to verify - The a: a `[GATE-COMPLETE: TC-N]` entry with command/output exists for every TC (10)
- GATE-COMPLETE — **One of the following is recorded:** - **Test written:** test file path + test function/describe name (e.g., : every Test Plan row (10) carries a test reference or a skip reason
- GATE-COMPLETE — No TC-N is silently unaddressed — every row must have either a test reference or a skip reason: every Test Plan row (10) carries a test reference or a skip reason
- GATE-COMPLETE — Spec document `## Completion Criteria` checkboxes are all `[x]`: 10/10 TC checkboxes `[x]`
- GATE-COMPLETE — `## Test Plan` updated with test references or skip reasons for all TC-N rows: every Test Plan row (10) carries a test reference or a skip reason
- GATE-COMPLETE — The spec's `## Tasks` section names the exact active task path under `.agents/tasks/`: `## Tasks` names `.agents/tasks/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md`, which exists
- GATE-COMPLETE — That active task exists and is completion-ready: all tasks are `[x]`, with no pending or blocked item: 5/5 tasks `[x]` in .agents/tasks/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `eea4c21526da` · base `origin/develop@295f48655add` · document `.agents/spec-docs/active/SCREEN-1993-search-prompt-history-and-conversation-transcripts.md` blob `6f3e5ded17ac` (modified)
