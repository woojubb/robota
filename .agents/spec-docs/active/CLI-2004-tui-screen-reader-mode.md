---
status: in-progress
type: SCREEN
tags: [cli, a11y]
lane: L2
---

# CLI-2004: TUI screen-reader mode

Paired with `.agents/tasks/CLI-2004-tui-screen-reader-mode.md`. Arising from [issue #2004](https://github.com/woojubb/robota/issues/2004) (parent: issue #1981, the Claude Code ↔ agent-cli comparison).

## Problem

**Symptom.** `robota` has no screen-reader mode, and every rendering decision the TUI makes is one a
screen reader cannot follow. Verified in the tree:

1. **Chrome is drawn with box characters at eight component sites** — Ink `borderStyle` in `MenuSelect.tsx:93`,
   `ConfirmPrompt.tsx:72`, `TextPrompt.tsx:66`, `PermissionPrompt.tsx:80`, `MultiSelectList.tsx:97`,
   `SlashAutocomplete.tsx:106`, `ExecutionWorkspaceSwitcher.tsx:65`, `ContextWarningBanner.tsx:17` —
   plus hand-drawn rules (`InputArea.tsx:315` writes `'─'.repeat(innerWidth)`; `utils/input-top-border.ts`;
   `ToolDiffBlock.tsx:24,31` a `│` gutter; `background-task-row-format.ts:7,33,40` `├`/`└` connectors)
   and an ASCII-art banner at `App.tsx:454-460`.
2. **The live region repaints on every state change.** `App.tsx` renders committed history inside
   `<Static>` (`:450-467`) but everything from `:468` to `:599` — `StreamingIndicator` (`:488`),
   `BackgroundTaskPanel` (`:507`), `PermissionPrompt` (`:520`), `PendingActionPrompt` (`:522`),
   `ContextWarningBanner` (`:555`), `InputArea` (`:556`), `SessionStatusBar` (`:581`) — is repainted
   whenever any of it changes, so a reader re-announces unchanged text. `WaveText.tsx:25-31` runs a
   400 ms `setInterval` colour ramp behind `InputArea.tsx:290`'s "Waiting for response…".
3. **Every menu is arrow-key driven with a `> ` cursor.** `key-hint-footer.tsx:33` `SELECTION_INDICATOR`,
   the shared reducers in `flows/selection-flow.ts`, and `MenuSelect.tsx:46` / `ListPicker.tsx:46` /
   `PermissionPrompt.tsx:46` / `ConfirmPrompt.tsx:43` (a two-option `['Yes','No']` menu). `ListPicker`
   announces position only as `↑ N more above` / `↓ N more below` (`:98,:104`) — never "item 3 of 7".
4. **There is no audible signal and no turn boundary marker.** The only escape sequence the package
   writes outside Ink is OSC 0 (`use-terminal-title.ts:24`, `\x1b]0;…\x07`); `grep -n "133"` over
   `packages/agent-transport-tui/src` returns nothing, and no bell (`\a`) is emitted anywhere.
5. **Markdown tables fall through to `marked-terminal`'s box-drawn renderer.**
   `render-markdown.ts:97-109` overrides only `renderer.code`; `renderer.table` is untouched.
6. **No activation surface exists.** `grep -rniE "screenreader|screen-reader|\ba11y\b|aria-" packages/agent-transport-tui/src
   packages/agent-cli/src` returns nothing (the bare substring `aria` does match unrelated identifiers
   such as `variant`, which is why the negative is stated against the anchored forms). The web playground has an `aria-live` announcer
   (`packages/agent-playground/src/components/ui/accessibility/announcer.tsx`), which is DOM-only and
   cannot be reused in a terminal.

**Reproduction condition.** Start `robota` under any screen reader on any platform. The reader
announces the banner art, then re-announces the whole input area and status bar on every keystroke and
every streaming delta; a permission prompt arrives as a bordered box whose selected row differs from
the others only by a `> ` prefix and a colour, and is answerable only with arrow keys; a reply
containing a markdown table is read as a grid of `│` and `─`; nothing rings when a long tool finishes
or when the prompt is waiting; and the terminal's jump-to-previous-prompt key does nothing because no
OSC 133 mark is emitted. There is no flag, env var or setting that changes any of it.

## Prior Art Research

**Topic:** accessibility / screen-reader mode for the Ink-based `agent-cli` TUI. Researched 2026-09-07 by the `prior-art-researcher` worker; all external evidence is product documentation fetched live on that date, and no third-party source code was used as the basis for any decision.

### 1. References consulted

Primary reference (the checklist's source), re-read in full: [Claude Code — Use Claude Code with a screen reader](https://code.claude.com/docs/en/accessibility) (R1), [CLI reference](https://code.claude.com/docs/en/cli-reference) (R2), [Environment variables](https://code.claude.com/docs/en/env-vars) (R3), [Settings reference](https://code.claude.com/docs/en/settings-reference) (R4), [Fullscreen rendering](https://code.claude.com/docs/en/fullscreen) (R5), [Changelog](https://code.claude.com/docs/en/changelog) (R6, searched 2.1.180 → 2.1.263).

Comparable agent CLIs: [Gemini CLI configuration](https://google-gemini.github.io/gemini-cli/docs/get-started/configuration.html) (R7) and its [settings reference](https://geminicli.com/docs/cli/settings/) (R8); [GitHub — Using Git, GitHub CLI, and Copilot CLI with a Screen Reader](https://accessibility.github.com/documentation/guide/cli/) (R9), the [Copilot CLI conformance report](https://accessibility.github.com/conformance/copilot-cli/) (R10), the [GA changelog entry](https://github.blog/changelog/2026-06-23-copilot-cli-new-terminal-interface-is-generally-available/) (R11); [OpenAI Codex config reference](https://learn.chatgpt.com/docs/config-file/config-reference) (R12) and [changelog](https://learn.chatgpt.com/docs/changelog?type=codex-cli) (R13).

Terminal / protocol / AT references: [VS Code — Terminal Shell Integration](https://code.visualstudio.com/docs/terminal/shell-integration) (R14), [iTerm2 — Shell Integration](https://iterm2.com/documentation-shell-integration.html) (R15), [Ink README § Screen Reader Support](https://github.com/vadimdemedes/ink) (R16 — read from the installed `ink@7.1.1` package, so it describes the version this repo has), [Apple — accessibility features in Terminal](https://support.apple.com/guide/terminal/use-accessibility-features-trml1020/mac) (R17), [NVDA User Guide](https://download.nvaccess.org/releases/2026.1/documentation/userGuide.html) (R18).

### 2. Per-checklist-line verdict

The issue's checklist was read on 2026-08-22. Re-read 2026-09-07: **all 18 lines still hold.** Four are now more specific; one gained a documented exception; none was retracted.

| Line | Current doc wording (verbatim, R1 unless noted) | Verdict |
|---|---|---|
| (a) three ways, flag > env > setting | "For one session: run `claude --ax-screen-reader`." / "set the `CLAUDE_AX_SCREEN_READER` environment variable to `1`" / "add `\"axScreenReader\": true` to your user settings file". "If you combine methods, Claude Code applies the `--ax-screen-reader` flag over the `CLAUDE_AX_SCREEN_READER` environment variable, and the variable over the `axScreenReader` setting." | HOLDS |
| (b) explicit off beats a `true` setting | "If you set `CLAUDE_AX_SCREEN_READER` to `0`, Claude Code keeps the mode off even when the setting is `true`." | HOLDS |
| (c) first line confirms mode + channel | "The first line Claude Code prints confirms the mode: `[Screen Reader Mode: on via flag]`, `[Screen Reader Mode: on via env]`, or `[Screen Reader Mode: on via settings]`." | HOLDS — exact strings now published |
| (d) opt-in, no auto-detect | "Screen reader mode is opt-in." + "Screen reader mode doesn't turn on automatically when a screen reader is running." | HOLDS |
| (e) no chrome / no colour-only / no redraws / static spinners | "No box-drawing characters for the interface chrome · No color-only cues · No redraws of content that hasn't changed. Progress spinners render as static text" | HOLDS |
| (f) tables → `Header: value` | "Tables in Claude's replies read as `Header: value` sentences instead of a box-character grid" | HOLDS |
| (g) scrollback, not alternate screen | "Claude Code leaves everything it prints in your terminal's scrollback… Apart from the attached background sessions listed under Known limitations, it prints scrolling text instead of fullscreen rendering." R2: "Forces the classic renderer… attached background sessions still render fullscreen." | HOLDS — now carries a documented exception |
| (h) searchable label per message | Exactly nine: `you:` `claude:` `thinking:` `tool:` `tool error:` `error:` `warning:` `Permission Required:` `Cost:` — "The labels are also searchable" | HOLDS — exact strings; note 7 lowercase, 2 Title Case |
| (i) two tunable pacing waits | "it waits 3 seconds before it draws the prompt… Press any key to end the wait" (`CLAUDE_AX_STARTUP_QUIET_MS`, default `3000`, cap `600000`, v2.1.217+); "it moves the cursor to the start of the line and waits 50 milliseconds" (`CLAUDE_AX_PREPARK_MS`, default `50`, cap `5000`, v2.1.233+ — R3) | HOLDS — both are env vars only, not settings keys |
| (j) only changed characters on type | "As you type at the end of the input line, or press `Backspace` there, Claude Code writes only the characters that change." | HOLDS |
| (k) deletions announce deleted text | "When you delete a word or a line… Claude Code announces the deleted text" | HOLDS |
| (l) cycled permission mode announced once | "Claude Code announces the permission mode you land on, such as `[plan mode on]`… prints the announcement once and doesn't repeat it on later redraws." | HOLDS |
| (m) numbered lists + `Enter selection` + range re-prompt | "menus you'd normally navigate with the arrow keys, including permission prompts, become numbered lists… then an `Enter selection` prompt that names the valid range." / "Press Escape to cancel a menu whose prompt ends with `or Escape to cancel`." / "If you type a number that isn't on the list, Claude Code announces the valid range and lets you try again." | HOLDS — **but the composed literal naming the range is NOT published**; only the prompt's name and the cancel suffix are quotable |
| (n) slider → same numbered list | "The `/effort` selector, which is a slider outside screen reader mode, becomes the same kind of numbered list." | HOLDS — the affected control is now named |
| (o) yes/no typed | "Yes-or-no prompts ask for a typed answer… Answer `y` or `n` and press Enter. `yes` and `no` also work." | HOLDS |
| (p) bell ×3, 5 s threshold | "The bell rings when: Claude finishes a reply · A prompt or dialog needs your answer… · A tool that ran longer than 5 seconds finishes" | HOLDS — threshold verbatim |
| (q) OSC 133 at turn boundaries | "Claude Code emits OSC 133 shell-integration markers at turn boundaries…" with a per-terminal matrix and two negatives: "macOS Terminal doesn't act on the markers, and Claude Code doesn't emit them in WezTerm." | HOLDS — protocol now named |
| (r) known limitations documented | Five bullets: no auto-detect · no announcement for non-`Shift+Tab` mode changes · `claude attach` enters the alternate screen · costs announced at exit, not per turn · unchanged in `-p` mode | HOLDS |

New since the snapshot, not on the checklist: a separate non-screen-reader accessibility track (`CLAUDE_CODE_ACCESSIBILITY=1`, `prefersReducedMotion`, daltonized themes, `preferredNotifChannel: "terminal_bell"`); version gating with a named failure string; SSH guidance; caret placement so the reader's read-current-line works; and a documented reporting channel. R6 shows no terminal screen-reader changes since 2026-08-22 — the surface has been stable for two weeks.

### 3. Cross-reference

| Behavior | Claude Code | Gemini CLI (R7/R8) | Copilot CLI (R9/R11) | Codex CLI (R12) | Ink 7.1.1 (R16) |
|---|---|---|---|---|---|
| Named screen-reader mode | ✅ | ✅ | ✅ | ❌ (composes primitives) | ✅ |
| Launch flag | `--ax-screen-reader` | `--screen-reader` | `--screen-reader` | — | — |
| Persistent setting | `axScreenReader` | `ui.accessibility.screenReader` | `"screenReader": true` | — | — |
| Env var | `CLAUDE_AX_SCREEN_READER` | `SCREEN_READER` (weakly documented) | — | — | `INK_SCREEN_READER` (`=== 'true'`) |
| Stated precedence | ✅ flag > env > setting | ❌ | ❌ | — | — |
| Kill spinners/animations | "static text" | `ui.accessibility.disableLoadingPhrases` | "animations that disable themselves" | `tui.animations` | `useAnimation`, `aria-hidden` |
| Numbered permission menus | ✅ | ❌ | ✅ "a numbered list of options" | ❌ | `aria-role="listbox"/"option"` |
| Audible attention signal | bell ×3, 5 s | ❌ | `"beep": true` | `tui.notification_method` = `auto\|osc9\|bel` | ❌ |
| Avoid alternate screen | forces classic renderer | ❌ | ❌ | `tui.alternate_screen` = `auto\|always\|never` | `alternateScreen` default **`false`** |
| Reduce streaming churn | "No redraws of content that hasn't changed" | ❌ | `"stream": false` — "reduce screen reader verbosity" | ❌ | `<Static>` |
| Colourblind theme (separate axis) | daltonized themes | ❌ | `/theme` → `colorblind` | ❌ | — |
| **Auto-detect a running reader** | **❌ explicitly refuses** | ❌ | **✅ "automatically turns on when a screen reader is detected"** | — | ❌ |

**Converged (≥2 independent references):** a single named mode (4/5); both a per-session flag and a persistent setting (3/3); `--screen-reader` as the flag name (2/3 verbatim — Claude's `--ax-` prefix is 1/3); suppressing spinners/animations (4/4, the strongest convergence found); an audible attention signal (3/3); numbered lists for permission prompts (2/2); keeping output in native scrollback (3/3, all three citing scrollback loss as the reason); reducing incremental-update churn (2/2); colourblind theming as a separate axis (2/2); mouse capture being hostile to AT navigation (2/2).

**Anthropic-specific (single reference):** the confirmation line, the `0`-beats-`true` override, the nine-label vocabulary, both pacing waits, deleted-text announcement, once-only mode announcement, OSC 133 at *agent-turn* boundaries, the 5-second threshold, `Header: value` flattening.

**A genuine conflict between references — auto-detection.** Claude Code documents refusing it; Copilot CLI documents doing it; Ink's default does not detect. This is the one line evidence cannot settle.

**Protocol layer (R14/R15).** VS Code documents the sequences verbatim: "`OSC 133 ; A ST`: Mark prompt start. `OSC 133 ; B ST`: Mark prompt end. `OSC 133 ; C ST`: Mark pre-execution. `OSC 133 ; D [; <exitcode>] ST`: Mark execution finished with an optional exit code", plus navigation on `Ctrl/Cmd+Up`/`Down` and "Navigation through detected commands in the accessible buffer". iTerm2 documents the user-facing half (a blue triangle in the left margin, `Cmd-Shift-Up`/`Down`) and an `iterm2_prompt_mark` hook any prompt may call — so a non-shell TUI emitting OSC 133 is within the documented contract, and unsupported emulators ignore unknown OSC sequences.

**AT-vendor references (R17/R18).** Neither vendor documents an application-facing announcement API for terminals. Apple states only that VoiceOver "speak[s] text that appears in a Terminal window"; NVDA documents reading the console *text buffer*. **Consequence: there is no terminal equivalent of `aria-live`** — the only channel to a reader is which characters land in the buffer, in what order, and when. That is why every reference solves this by changing the byte stream, and why the pacing waits exist.

### 4. Constraints that apply to Robota

1. **Ink 7.1.1 — the version already installed — ships a screen-reader mode, and that is the seam this issue asks for.** R16: "To enable it, you can either pass the `isScreenReaderEnabled` option to the `render` function or set the `INK_SCREEN_READER` environment variable to `true`", default `process.env['INK_SCREEN_READER'] === 'true'`; it provides `useIsScreenReaderEnabled()` and an ARIA subset (`aria-label`, `aria-hidden`, `aria-role` with 18 values including `listbox`, `option`, `menu`, `progressbar`, `table`, and `aria-state`). Two caveats: Ink self-describes as "basic support" and "will try its best", so labels, pacing, the bell and OSC 133 remain ours; and `INK_SCREEN_READER` matches the literal `'true'`, not `1`, so a `ROBOTA_*=1` convention must be mapped explicitly rather than inherited.
2. **Checklist line (g) is already satisfied by default.** Ink's `alternateScreen` defaults to `false` and no `alternateScreen` option or `\x1b[?1049h` write exists in `packages/agent-transport-tui/src` or `packages/agent-cli/src`. Robota starts where Claude Code had to force itself. The risk is regression, not absence.
3. **The web announcer is correctly non-reusable, but its idea transfers.** `announcer.tsx` clears then re-sets an `aria-live` region after `SCREEN_READER_DELAY_MS = 100`; that is conceptually the same as `CLAUDE_AX_PREPARK_MS`'s default of 50 — both exist so a reader restarts on a changed region. Internal precedent for the *pacing* concept only; no code is shared.
4. **Provider neutrality resolves trivially, and the spec should say so.** Every checklist line is a terminal-rendering concern; none touches a provider API. The only provider-adjacent decision is (h): `claude:` is a vendor label, so Robota's labels must derive from the message **role**, giving an identical transcript across every `agent-provider-*`. The answer to the issue's "say what each provider maps onto" is: nothing — the mode is provider-invariant by construction.
5. **Naming conventions already exist:** settings live in `.robota/settings.json` and env vars follow `ROBOTA_*`.
6. **Open-source consequence:** there is no telemetry, no feature flag and no staged rollout, so the mode must be correct on first release for anyone who passes the flag.

### 5. Evidence-based recommendation

Implement one named screen-reader mode as a prop layer over Ink's documented `isScreenReaderEnabled` seam rather than a parallel renderer; phase the 18 lines by evidence strength. Adopt now, without a user decision, everything in the converged list: three activation channels with a published precedence, the `=0` override, a confirmation line, suppression of spinners/animations/chrome/colour-only cues/unchanged redraws, numbered lists with typed selection, typed `y`/`n`, native scrollback as a guarded invariant, a bell on attention (with the 5-second threshold made a tunable constant rather than a copied number), role-derived searchable labels, and colourblind/reduced-motion kept as separate axes. Take the intent but measure the numbers locally for the single-reference items (pacing waits, deleted-text announcement, once-only mode announcement, table flattening, changed-characters echo) — the problems they solve are confirmed by R18, but `3000`/`50` are tuned to another render loop. Emit OSC 133 unconditionally in the mode and ship a support table naming the terminals where it does nothing, rather than promising jump-to-turn universally. For auto-detection, the references conflict: recommend opt-in plus a one-line plain-text hint when a reader is likely present — it keeps opt-in's determinism while removing its only real defect, and a false positive prints one extra line instead of reshaping the UI.

PRIOR_ART_RESEARCH: FOUND

## Architecture Review

### Affected Scope

- `packages/agent-transport-tui/src` — `render.tsx` (`IRenderOptions.screenReader`, the Ink
  `isScreenReaderEnabled` option, the confirmation line, `toChannelOptions`), new
  `screen-reader-context.tsx` (React context + `useScreenReader()`), new `screen-reader-labels.ts`
  (the role→label SSOT), new `terminal-marks.ts` (OSC 133 emission), new `attention-bell.ts`;
  `App.tsx` (banner suppression, live-region gating, bell triggers, OSC 133 turn boundaries);
  `MessageList.tsx` + `RoleLabel.tsx` (labels); `StreamingIndicator.tsx`, `WaveText.tsx`
  (static text); `MenuSelect.tsx`, `ListPicker.tsx`, `MultiSelectList.tsx`, `PermissionPrompt.tsx`,
  `ConfirmPrompt.tsx`, `TextPrompt.tsx`, `SlashAutocomplete.tsx`, `ExecutionWorkspaceSwitcher.tsx`,
  `ContextWarningBanner.tsx` (borderless + numbered-list branches); `InputArea.tsx` +
  `utils/input-top-border.ts` (rule suppression); `ToolDiffBlock.tsx`,
  `background-task-row-format.ts` (gutter/connector suppression); `render-markdown.ts`
  (`renderer.table` override); `terminal-capabilities.ts` (`supportsTurnMarks`); `docs/SPEC.md`.
- `packages/agent-cli/src` — `utils/cli-args.ts` (`--screen-reader` / `--no-screen-reader`),
  new `startup/screen-reader-enablement.ts` (the precedence resolver), `cli.ts` (wiring),
  `docs/SPEC.md`.
- `.agents/tasks/CLI-2004-tui-screen-reader-mode.md`.

Not in scope, stated so the boundary is explicit: colourblind/high-contrast theming and reduced motion
(separate axes per the survey's 2/2 convergence — reduced motion is partly delivered already by
SCREEN-006's `isInteractiveColorTerminal` gate on `WaveText`); auto-detection of a running reader
beyond the advisory hint (§ Decision); a `--print`/headless change (R1 documents its own mode as
unchanged there, and `HeadlessInteractionChannel` already emits plain text); the VS Code/GUI surfaces;
and per-turn cost announcement (R1 lists it as a known limitation, not a behaviour).

### Alternatives Considered

1. **A mode prop layered over Ink's `isScreenReaderEnabled` (chosen).** One resolved boolean is passed
   to Ink's `render` option and published through a React context; each component branches on it.
   - Pro: uses the seam the installed dependency already documents (`ink@7.1.1`), so Ink's own ARIA
     subset does the structural work (`aria-role="listbox"/"option"` on menus, `aria-hidden` on
     decorative rules) and Robota writes only what Ink says it does not do — labels, pacing, bell,
     OSC 133; `<Static>` already exists for the no-repaint requirement; the change is a branch per
     component, not a second renderer; every existing test file for those components stays valid and
     gains a mode case.
   - Con: touches ~20 component files; two sources of truth for "is the mode on" (Ink's option and our
     context) that must be set from one resolver; Ink's support is self-described as "basic", so its
     output shape is not a contract we control.
2. **A separate plain-text renderer (a second `render-*.tsx` entry that emits lines directly).**
   - Pro: total control of the byte stream, which is the only channel a reader has (R17/R18); no
     per-component branching.
   - Con: a parallel implementation of the entire TUI that would drift on every feature; it duplicates
     what Ink 7.1.1 already ships; and the repo's own rule is that a second path for the same product
     concern is the defect, not the design.
3. **Environment-driven degradation only (no mode): honour `INK_SCREEN_READER` and stop there.**
   - Pro: nearly free — Ink reads the variable itself.
   - Con: delivers only Ink's "basic" output and none of lines (c), (h)–(r); no flag, no setting, no
     precedence, no confirmation line, no bell, no marks — i.e. it satisfies 1 of the 18 checklist
     lines and would have to be replaced by Alternative 1 to satisfy the rest.

### Decision

Alternative 1. The trade-off that decided it: Alternative 2 buys byte-level control at the price of a
second renderer that must be kept in step with every future TUI change, while Alternative 1's cost is
mechanical breadth — one branch in each of ~20 components — that the existing per-component test files
already cover and that Ink's ARIA vocabulary shrinks further. Alternative 3 is not a smaller version of
the feature but a different, much smaller one.

Checklist verdicts (issue #2004, one per line):

| # | Line | Verdict | Reason |
|---|---|---|---|
| a | three ways, flag > env > setting | **Adapt** | Adopt three channels and publish the precedence, but name them for this repo: `--screen-reader` (2/3 references agree verbatim; Claude's `--ax-` prefix is 1/3), `ROBOTA_SCREEN_READER`, and `screenReader` in `.robota/settings.json`. `INK_SCREEN_READER=true` is also honoured as a fourth input at the env tier, so Ink's own documented contract is not shadowed. **Precedence direction is a deliberate divergence from this repo's only existing precedent**: `resolveMemoryEnablement` (`packages/agent-cli/src/startup/memory-enablement.ts:90-104`) is env-wins (`ROBOTA_MEMORY` overrides the flag, documented at `agent-cli/docs/SPEC.md:583`). Accessibility inverts it — a per-invocation flag must be able to turn the mode on for one run on a machine whose env has it off, which is exactly the SSH/remote case R1 calls out. The spec records the divergence in `agent-cli/docs/SPEC.md` beside the memory paragraph so the two are not read as one rule. |
| b | `=0` beats a `true` setting | **Adopt** | One branch; it is the difference between "off for one command" and "edit a JSON file". |
| c | first line confirms mode and channel | **Adopt (own wording)** | `[Screen reader mode: on via flag|env|settings]`, printed before anything else. Single-reference, but it is the only self-diagnostic in the design. |
| d | opt-in, no auto-detect | **Adapt** | References conflict (Claude refuses detection, Copilot performs it, Ink does neither). Adopt opt-in — nothing changes without consent — **plus** one plain-text advisory line when `INK_SCREEN_READER` is set to a non-`true` value or when the mode is off and stdout is a TTY under a `NVDA`/`JAWS`/`VOICEOVER`-shaped env hint, telling the user the flag exists. A false positive prints one line; a false positive under Copilot's design reshapes a sighted user's UI, and this repo has no telemetry to detect that (constraint 6). |
| e | no chrome, no colour-only, no redraws, static spinners | **Adopt** | `borderStyle` omitted at the eight component sites; hand-drawn rules and the banner suppressed; `WaveText` renders its text once with no interval; committed entries already live in `<Static>`. Colour-only cues are already absent — SCREEN-009's evidence log records "no color-only state found" and `status-glyph.ts:1-11` states the symbol+colour invariant — so this line is *verified as already met* and becomes a regression assertion rather than new work. |
| f | tables → `Header: value` | **Adopt** | A `renderer.table` override in `createTerminalRenderer` (`render-markdown.ts:97-109`, which today assigns only `renderer.code`); every caller reaches it through the single `renderMarkdown` entry point at `:115`. |
| g | native scrollback, no alternate screen | **Adopt (already true)** | Ink's `alternateScreen` defaults to `false` and nothing sets it; this becomes a guarded invariant with a test, not new work. |
| h | searchable label per message | **Adapt** | Adopt the mechanism and the nine categories; **derive the label from the message role, not the vendor** — `assistant:` not `claude:` — so the transcript is identical across every `agent-provider-*` (constraint 4). Labels are all lowercase for consistency; R1's Title-Case split for two of nine is not reproduced. |
| i | two tunable pacing waits | **Adapt** | Adopt both, tunable via `ROBOTA_SCREEN_READER_STARTUP_QUIET_MS` and `ROBOTA_SCREEN_READER_PREPARK_MS` with R1's caps (600000 / 5000) as sanity bounds, but Robota-measured defaults — R1's `3000`/`50` are tuned to another render loop and no second reference corroborates them. |
| j | changed characters only while typing | **Adapt** | Ink owns the diffing; the actionable part here is that `InputArea` must not repaint its surroundings on every keystroke — the mode omits the borders and the status bar's **volatile** fields (`StatusActivityText`, `StatusBar.tsx:61`, and `ContextText`, `:84` — both re-render on their own cadence and on every token) so the changed region is the input line itself. The **stable** fields stay, and one is rendered *more*: the permission mode (verdict l). Volatile vs stable is the line, not visible vs hidden — a value that changes only when the operator changes it is an anchor, not churn. |
| k | deletions announce deleted text | **Adopt** | Word/line deletion emits `[deleted: <text>]` once. Note the existing seam: `input-area-flow.ts:50-57` binds backspace to queue cancellation, and character deletion lives in `flows/cjk-text-input-flow.ts` — the announcement attaches to the latter. |
| l | permission-mode change announced once | **Reject for v1, with reason** | The behaviour is announcing a *cycled* mode, and **no key-based cycling exists in this repo** — `grep` for `shift+tab`/`cyclePermissionMode` over the TUI returns nothing; the mode is changed by command (`permission-mode-command-api.ts`). There is nothing to announce on. Adopted in its place: `StatusBar.tsx:112-114` hides the mode entirely when it is `default`, leaving no spoken anchor — in screen-reader mode the mode is always rendered, so a reader can find it. If key cycling is added later, the announcement is added with it. |
| m | numbered lists, `Enter selection`, range re-prompt | **Adopt (own literal)** | Every arrow-key menu renders `N. <option>` lines and reads a typed number; the composed prompt literal is **authored here, not copied** — R1 publishes only the prompt's name and the cancel suffix. Literal: `Enter selection (1-<n>)` , suffixed ` or Escape to cancel` where the menu is cancellable; an out-of-range entry re-prompts with the same literal. |
| n | slider degrades to the same list | **N/A** | No slider control exists in this repo (`grep` over the TUI returns none); R1's example is its `/effort` selector. Recorded so the line is decided rather than skipped: if a slider is added, it uses the same numbered-list branch. |
| o | yes/no typed | **Adopt** | `ConfirmPrompt` accepts `y`/`n`/`yes`/`no` + Enter instead of a two-option menu. |
| p | bell on attention | **Adapt** | Adopt all three triggers; the long-tool threshold becomes a named constant `LONG_TOOL_BELL_MS` (default 5000, documented as tunable) rather than a copied literal, since it is single-reference. |
| q | OSC 133 at turn boundaries | **Adopt (emit + document)** | `A` before the prompt, `B` at prompt end, `C` at turn start, `D` at turn end. Emission follows the `use-terminal-title.ts:24` carve-out pattern (framing written deliberately outside Ink, payload sanitised) — required because `sanitize-terminal-text.ts:107` strips OSC from untrusted text and the `tui-safe-text-boundary` scan restricts Ink's `Text`. Shipped with a support table naming the terminals where it does nothing. |
| r | known limitations documented | **Adopt** | Robota's own list: Ink's "basic support" caveat; the OSC 133 negatives; no auto-enable (only the advisory line); no per-turn cost announcement; no permission-mode-cycling announcement (line l). |

Validation (spec-workflow.md § "Validated Recommendation Before Approval" — a presentation-wide change):

- *Reachability.* The mode is a single resolved boolean threaded from `cli.ts` → `IRenderOptions` →
  Ink's `isScreenReaderEnabled` + a React context. Every consumer reads it through `useScreenReader()`;
  no component needs a new prop from its parent. `toChannelOptions` (`render.tsx:134`) carries the
  ARCH-110 containment label warning that this hand-maintained projection silently drops undeclared
  options — the field is therefore declared in `IRenderOptions` **and** added to that projection, and
  TC-02 fails if either half is missing.
- *Capability preservation.* Default-off: with no flag, env or setting, the existing pty fixtures
  `screen-010-scrollback.ptytest.ts` and `screen-006-no-color.ptytest.ts` — both of which spawn the
  binary with no flag — keep passing unchanged (TC-22 runs both files, so this is asserted, not
  assumed), and TC-11's default-off half asserts that the same
  replay fixture without the flag still renders the border characters. Native scrollback is guarded in
  BOTH states rather than assumed: TC-22 adds a `--screen-reader` case to
  `screen-010-scrollback.ptytest.ts` asserting no alternate-screen switch (`\x1b[?1049h` absent from
  `raw()`) and committed history still landing above the pinned input — verdict (g)'s "guarded
  invariant with a test".
- *Adversarial pass.* (a) The `palette-consistency` test (`docs/SPEC.md:199-240`) fails on any inline
  colour literal, so the mode must omit colour props rather than substitute strings — the branches drop
  `color`/`borderColor` instead of setting them. (b) `tui-safe-text-boundary` permits only `SafeText` to
  import Ink's `Text`, so the OSC 133 writer must live outside the component tree like
  `use-terminal-title.ts`. (c) A terminal that ignores OSC 133 sees nothing — unknown OSC sequences are
  discarded by every emulator in R14/R15 — so emission is safe unconditionally. (d) The advisory line
  (verdict d) is printed once at startup and never during a turn, so it cannot interleave with output a
  reader is consuming. (e) `INK_SCREEN_READER=true` alone (no Robota channel) still enables Ink's own
  behaviour independently of us; the resolver treats it as an env-tier input so the confirmation line
  does not lie about why the mode is on.

**Delivery mode:** `single`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — the SCREEN-0XX family was scanned: SCREEN-006 (shared palette + accessible
      motion, done — owns `tui-palette.ts`, the `NO_COLOR` gate at `render.tsx:196`, the
      `palette-consistency` floor and the `screen-006-no-color` pty test), SCREEN-009 (colour-only audit,
      done — evidence log records "no color-only state found", `status-glyph.test.ts` is its floor),
      SCREEN-004/005/007/008 (prompt footers, status indicator, status consistency, interactive-terminal
      detection), SCREEN-010 (scrollback via `<Static>`). This item extends those gates rather than
      adding a parallel one: the same `isInteractiveColorTerminal` gate shape, the same pty-test
      template, and the same palette floor.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — four new modules
      (`screen-reader-context.tsx`, `screen-reader-labels.ts`, `terminal-marks.ts`, `attention-bell.ts`)
      all sit inside the existing `packages/agent-transport-tui/src` presentation package beside their
      siblings (`terminal-capabilities.ts`, `status-glyph.ts`, `use-terminal-title.ts`), and one
      (`startup/screen-reader-enablement.ts`) mirrors `startup/memory-enablement.ts` in the same
      directory. No new package, app, presentation or interface surface; no layer or product-family
      reclassification; no new package dependency edge.

## Fallback & Degradation Declaration

None. The mode is a declared branch, not a fallback: when it is off the existing path runs unchanged,
and when it is on the plain-text path runs. OSC 133 emission on a terminal that ignores the sequence is
not a degradation path in the No-Fallback-Policy sense — nothing is caught, nothing defaults, and the
support table documents the outcome per terminal.

## Solution

1. **Resolver** — new `packages/agent-cli/src/startup/screen-reader-enablement.ts`, mirroring
   `memory-enablement.ts`: `resolveScreenReaderEnablement({ settings, flagEnabled, env, inkEnv })
   → { enabled: boolean; channel: 'flag' | 'env' | 'settings' | undefined }`. Order: settings
   (`screenReader` in `.robota/settings.json`) → env (`ROBOTA_SCREEN_READER=1|0`, and
   `INK_SCREEN_READER === 'true'` as an equal env-tier input) → flag (`--screen-reader` /
   `--no-screen-reader`) wins. `ROBOTA_SCREEN_READER=0` keeps it off against a `true` setting but loses
   to an explicit `--screen-reader`.
2. **Flag** — `cli-args.ts`: `screen-reader` / `no-screen-reader` booleans with **no default** (the
   tri-state shape `memory`/`no-memory` uses at `:220-223`), resolved by `resolveScreenReaderArgs`
   beside `resolveMemoryArgs:233`; `printHelp()` gains a line.
3. **Threading** — `cli.ts` calls the resolver and passes `screenReader` into `renderApp`;
   `IRenderOptions.screenReader?: boolean` is declared and added to `toChannelOptions`
   (`render.tsx:134`); `render(...)` gains `isScreenReaderEnabled: options.screenReader === true`
   beside `exitOnCtrlC: false` (`:217-234`); a new `ScreenReaderProvider` wraps `<App>` and
   `useScreenReader()` is the read used by every component.
4. **Confirmation + advisory line** — printed by `renderApp` before `render()`:
   `[Screen reader mode: on via flag]` (or `env` / `settings`). When the mode is off and the resolver
   saw a reader-shaped hint, one line instead: `[Screen reader mode: off — run with --screen-reader]`.
5. **Chrome and motion** — every `borderStyle` site takes the prop conditionally
   (`...(screenReader ? {} : { borderStyle: 'round' })`) so no colour/border literal is introduced;
   `InputArea` skips the top/bottom rules; `App.tsx:454-460` skips the banner; `WaveText` renders its
   text with no interval; `StreamingIndicator` renders `thinking: …` as a single static line.
6. **Labels** — new `screen-reader-labels.ts` maps message role → lowercase label
   (`you:`, `assistant:`, `thinking:`, `tool:`, `tool error:`, `error:`, `warning:`,
   `permission required:`, `cost:`); `RoleLabel.tsx` and `MessageList.tsx` render it in the mode.
7. **Menus** — a shared `NumberedList` branch used by `MenuSelect`, `ListPicker`, `MultiSelectList`,
   `PermissionPrompt`, `SlashAutocomplete`, `ExecutionWorkspaceSwitcher`: `N. <option>` lines, then
   `Enter selection (1-<n>)` (` or Escape to cancel` appended when cancellable); a non-numeric or
   out-of-range entry re-prints the same literal. `ConfirmPrompt` reads `y|n|yes|no` + Enter.
   `flows/selection-flow.ts` gains `applyNumericSelection` so the reducers stay the single owner.
8. **Deletion announcements** — `flows/cjk-text-input-flow.ts` returns the removed text for word/line
   deletes; `InputArea` prints `[deleted: <text>]` once in the mode.
9. **Tables** — `render-markdown.ts` `createTerminalRenderer` (`:97-109`) gains a `renderer.table` override in the
   mode emitting one `Header: value` line per cell, blank line between rows.
10. **Bell** — new `attention-bell.ts` writing `\x07` to stdout outside Ink; called on reply completion,
    on prompt mount (`App.tsx:520,522`), and when a tool whose start was recorded exceeds
    `LONG_TOOL_BELL_MS` (5000) at completion.
11. **Turn marks** — new `terminal-marks.ts` writing `\x1b]133;A\x07` / `;B` / `;C` / `;D` following the
    `use-terminal-title.ts:24` carve-out; `terminal-capabilities.ts` gains `supportsTurnMarks()` for the
    documented negatives; `App.tsx` emits at prompt and turn boundaries.
12. **Pacing waits** — new `screen-reader-pacing.ts` exporting `resolvePacing(env)` and the two awaits it
    feeds, used only in the mode: a startup quiet period after the confirmation line and before the first
    prompt is drawn (`ROBOTA_SCREEN_READER_STARTUP_QUIET_MS`, `0` = immediate, values above a 600000
    sanity bound clamped with the clamp reported on stderr), and a pre-write park that moves the cursor
    to column 0 and waits before a new or changed line is emitted (`ROBOTA_SCREEN_READER_PREPARK_MS`,
    same rules, bound 5000). A keypress ends the startup wait early. Defaults are measured against this
    render loop rather than copied from the reference, per § Decision verdict (i). Both are resolved once
    by `renderApp` and threaded with the mode.
13. **Status bar** — two changes in opposite directions, which are one rule applied to fields of different
    volatility. *Stable*: `shouldShowPermissionMode` (`StatusBar.tsx:112-114`) hides the mode when it is
    `default`; in the mode it renders unconditionally, giving a reader a permanent anchor. *Volatile*:
    `StatusActivityText` (`:61`) and `ContextText` (`:84`) are suppressed in the mode — they re-render on
    their own cadence and on every token, so a reader reviewing the status line would re-announce them
    continuously while the operator types (§ Problem symptom 2). `PresetText` and the model id are stable
    and are kept. `SessionStatusBar` (`SessionStatusBar.tsx:27`) threads the mode into `StatusBar`;
    neither gains a second code path.
14. **Docs** — `agent-transport-tui/docs/SPEC.md` (the mode, the label vocabulary, the numbered-list
    contract beside the existing footer grammar at `:165-197`, the OSC 133 support table, the
    known-limitations list); `agent-cli/docs/SPEC.md` (the three channels and the precedence, explicitly
    noting the divergence from the memory resolver's env-wins rule at `:583`).
15. **Scrollback / alternate-screen invariant guard (verdict (g))** — no code change: Ink's
    `alternateScreen` defaults to `false` (`ink` 7.1.1 `readme.md:2719-2722`) and nothing in the tree sets
    it, and the mode must keep it that way because "the terminal's scrollback buffer is not available
    while in the alternate screen" (`readme.md:2726`) — a reader's review of earlier output depends on it.
    The deliverable is the guard, not a behaviour: a second `it()` in the existing
    `src/__tests__/pty/screen-010-scrollback.ptytest.ts` spawning with `--screen-reader` (the existing
    case cannot serve, because it asserts on the boot banner and on `Idle`, both of which the mode
    suppresses) and asserting that `raw()` never contains `\x1b[?1049h`, that the committed `/help`
    output is present, and that the last `Type a message` prompt sits below it — the same pinned-input
    proof as the flagless case, minus the suppressed fields.

## Affected Files

- `packages/agent-cli/src/utils/cli-args.ts` — flag pair, help line
- `packages/agent-cli/src/startup/screen-reader-enablement.ts` — new resolver
- `packages/agent-cli/src/startup/__tests__/screen-reader-enablement.test.ts` — new (TC-01)
- `packages/agent-cli/src/cli.ts` — wiring
- `packages/agent-cli/docs/SPEC.md`
- `packages/agent-transport-tui/src/render.tsx` — option, Ink flag, projection, confirmation line
- `packages/agent-transport-tui/src/__tests__/screen-reader-render-options.test.ts` — new (TC-02, TC-03, TC-17, TC-18)
- `packages/agent-transport-tui/src/screen-reader-context.tsx` — new
- `packages/agent-transport-tui/src/screen-reader-labels.ts` — new
- `packages/agent-transport-tui/src/__tests__/screen-reader-labels.test.ts` — new (TC-05)
- `packages/agent-transport-tui/src/terminal-marks.ts` — new
- `packages/agent-transport-tui/src/screen-reader-pacing.ts` — new
- `packages/agent-transport-tui/src/__tests__/screen-reader-pacing.test.ts` — new (TC-20)
- `packages/agent-transport-tui/src/attention-bell.ts` — new
- `packages/agent-transport-tui/src/__tests__/attention-bell-and-marks.test.ts` — new (TC-08, TC-09)
- `packages/agent-transport-tui/src/App.tsx` — banner, live region, bell, marks
- `packages/agent-transport-tui/src/MessageList.tsx`, `RoleLabel.tsx` — labels
- `packages/agent-transport-tui/src/StreamingIndicator.tsx`, `WaveText.tsx` — static text
- `packages/agent-transport-tui/src/MenuSelect.tsx`, `ListPicker.tsx`, `MultiSelectList.tsx`, `PermissionPrompt.tsx`, `ConfirmPrompt.tsx`, `TextPrompt.tsx`, `SlashAutocomplete.tsx`, `ExecutionWorkspaceSwitcher.tsx`, `ContextWarningBanner.tsx` — borderless + numbered-list branches
- `packages/agent-transport-tui/src/flows/selection-flow.ts` — `applyNumericSelection`
- `packages/agent-transport-tui/src/__tests__/screen-reader-menus.test.tsx` — new (TC-06, TC-07)
- `packages/agent-transport-tui/src/InputArea.tsx`, `utils/input-top-border.ts` — rules
- `packages/agent-transport-tui/src/flows/cjk-text-input-flow.ts` — deleted text
- `packages/agent-transport-tui/src/__tests__/screen-reader-input.test.tsx` — new (TC-10)
- `packages/agent-transport-tui/src/ToolDiffBlock.tsx`, `background-task-row-format.ts` — gutters
- `packages/agent-transport-tui/src/render-markdown.ts` — `renderer.table`
- `packages/agent-transport-tui/src/__tests__/render-markdown.test.ts` — TC-04 case
- `packages/agent-transport-tui/src/StatusBar.tsx` — render the mode unconditionally; suppress `StatusActivityText` and `ContextText`
- `packages/agent-transport-tui/src/SessionStatusBar.tsx` — thread the mode through
- `packages/agent-transport-tui/src/terminal-capabilities.ts` — `supportsTurnMarks`
- `packages/agent-transport-tui/src/__tests__/pty/screen-reader-mode.ptytest.ts` — new (TC-11, TC-12)
- `packages/agent-transport-tui/src/__tests__/pty/screen-010-scrollback.ptytest.ts` — TC-22 case (a `--screen-reader` run of the existing scrollback proof)
- `packages/agent-transport-tui/docs/SPEC.md`
- `.agents/tasks/CLI-2004-tui-screen-reader-mode.md`

## Completion Criteria

- [x] TC-01: `pnpm --filter @robota-sdk/agent-cli exec vitest run src/startup/__tests__/screen-reader-enablement.test.ts`
      → exits 0; `resolveScreenReaderEnablement` returns `{enabled:true,channel:'flag'}` for
      `--screen-reader` even with `ROBOTA_SCREEN_READER=0` and `screenReader:false`;
      `{enabled:false,channel:undefined}` for `ROBOTA_SCREEN_READER=0` with `screenReader:true` and no
      flag; `{enabled:true,channel:'env'}` for `INK_SCREEN_READER=true` alone; `{enabled:true,channel:'settings'}`
      for the setting alone; `{enabled:false}` for no input. RED with the flag-override line removed.
- [x] TC-02: `pnpm --filter @robota-sdk/agent-transport-tui exec vitest run src/__tests__/screen-reader-render-options.test.ts`
      → exits 0; `renderApp({..., screenReader: true})` passes `isScreenReaderEnabled: true` to Ink's
      `render`, and `toChannelOptions({..., screenReader: true})` returns an object whose `screenReader`
      is `true`. RED with either the render option or the `toChannelOptions` line removed (the ARCH-110
      projection hazard).
- [x] TC-03: same file — `renderApp` writes `[Screen reader mode: on via flag]` to stdout before Ink's
      first frame when the channel is `flag`, `…on via env` / `…on via settings` for the others, and
      writes nothing when the mode is off and no reader hint is present.
- [x] TC-04: `pnpm --filter @robota-sdk/agent-transport-tui exec vitest run src/__tests__/render-markdown.test.ts`
      → exits 0; rendering `| A | B |\n|---|---|\n| 1 | 2 |` in the mode produces `A: 1` and `B: 2` on
      separate lines and contains none of `│ ─ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼`; outside the mode the existing
      output is unchanged.
- [x] TC-05: `pnpm --filter @robota-sdk/agent-transport-tui exec vitest run src/__tests__/screen-reader-labels.test.ts`
      → exits 0; the label map covers all nine roles with lowercase values, contains no provider or
      vendor name (asserted by a regex over the values), and `RoleLabel` renders `assistant:` for an
      assistant message in the mode regardless of which `agent-provider-*` produced it.
- [x] TC-06: `pnpm --filter @robota-sdk/agent-transport-tui exec vitest run src/__tests__/screen-reader-menus.test.tsx`
      → exits 0; in the mode `MenuSelect` with three options renders `1. `, `2. `, `3. ` lines and the
      literal `Enter selection (1-3)`; typing `2` + Enter selects the second option; typing `9` + Enter
      re-prints `Enter selection (1-3)` and selects nothing; a cancellable menu's prompt ends with
      ` or Escape to cancel`. RED with `applyNumericSelection` removed.
- [x] TC-07: same file — in the mode `PermissionPrompt` renders as a numbered list with no
      `borderStyle` prop, and `ConfirmPrompt` accepts `y`, `n`, `yes`, `no` + Enter and rejects other
      input without selecting.
- [x] TC-08: `pnpm --filter @robota-sdk/agent-transport-tui exec vitest run src/__tests__/attention-bell-and-marks.test.ts`
      → exits 0; the bell writer emits exactly one `\x07` on reply completion, one on prompt mount, one
      when a tool whose start was recorded exceeds `LONG_TOOL_BELL_MS` at completion, and none for a
      tool that finishes under it; nothing is written when the mode is off.
- [x] TC-09: same file — the marks writer emits `\x1b]133;A\x07`, `;B`, `;C`, `;D` at prompt start,
      prompt end, turn start and turn end in that order for one turn, and emits nothing when the mode
      is off or `supportsTurnMarks()` is false.
- [x] TC-10: `pnpm --filter @robota-sdk/agent-transport-tui exec vitest run src/__tests__/screen-reader-input.test.tsx`
      → exits 0; in the mode `InputArea` renders no `─` rule line and no `borderStyle`, and a word
      deletion prints `[deleted: <word>]` exactly once; outside the mode the border is still rendered.
- [x] TC-11: `pnpm --filter @robota-sdk/agent-transport-tui test:pty -- src/__tests__/pty/screen-reader-mode.ptytest.ts`
      → exits 0; driving the built binary with `--screen-reader` against a replay session-log fixture,
      `snapshot()` contains none of `│ ─ ╭ ╮ ╰ ╯ ┌ ┐ └ ┘`, contains `assistant:`, and `raw()` contains
      `\x1b]133;A`; the same fixture without the flag still contains the border characters (the
      default-off proof).
- [x] TC-12: same pty file — with `ROBOTA_SCREEN_READER=1` in the child env and no flag, `snapshot()`
      begins with `[Screen reader mode: on via env]`; with `ROBOTA_SCREEN_READER=0` and
      `--screen-reader`, it begins with `[Screen reader mode: on via flag]`.
- [x] TC-13: `pnpm --filter @robota-sdk/agent-transport-tui exec vitest run src/__tests__/palette-consistency.test.ts src/__tests__/status-glyph.test.ts src/__tests__/safe-text-boundary.test.tsx`
      → exits 0 — the mode introduces no inline colour literal, no colour-only state, and no new
      importer of Ink's `Text` (the OSC writers live outside the component tree).
- [x] TC-16: `pnpm --filter @robota-sdk/agent-transport-tui exec vitest run src/__tests__/status-bar.test.tsx`
      → exits 0; in the mode `StatusBar` (reached through `SessionStatusBar`) renders the permission mode even when it is `default`
      (today `StatusBar.tsx:112-114` hides it), so a reader has a spoken anchor for the common case;
      outside the mode the `default` mode is still hidden. RED with the unconditional branch removed.
- [x] TC-17: `pnpm --filter @robota-sdk/agent-transport-tui exec vitest run src/__tests__/screen-reader-render-options.test.ts`
      → exits 0; in the mode the `<Static>` items contain no banner entry, so none of the banner's own
      glyphs (`_`, `|`, `\`, `/`, `<`) is emitted as art; outside the mode the banner item is present.
      (Stated separately from TC-11's box-drawing sweep because the banner is ASCII art, not box-drawing
      characters, and would pass that sweep unchanged — `App.tsx:454-460`.)
- [x] TC-18: same file as TC-03 — with the mode **off** and a reader-shaped environment hint present,
      stdout's first line is `[Screen reader mode: off — run with --screen-reader]`; with the mode off
      and no hint, stdout carries no such line; with the mode on, the confirmation line is printed and
      the advisory is not.
- [x] TC-19: `pnpm --filter @robota-sdk/agent-transport-tui exec vitest run src/__tests__/streaming-indicator.test.tsx src/__tests__/wave-text.test.tsx`
      → exits 0; in the mode `WaveText` renders its text once with no interval scheduled (assert the
      fake timer has no pending timer after mount) and `StreamingIndicator` renders a single static
      line; outside the mode the existing 400 ms `MOTION.waveIntervalMs` behaviour is unchanged.
- [x] TC-21: `pnpm --filter @robota-sdk/agent-transport-tui exec vitest run src/__tests__/status-bar.test.tsx`
      → exits 0; in the mode the rendered status line contains neither `StatusActivityText`'s output nor
      `ContextText`'s percentage, while still containing the permission mode (including when it is
      `default`) and the preset id — the two halves of § Solution 13 asserted in one test so they cannot
      drift apart; outside the mode all four render exactly as today. RED with the volatile-field
      suppression removed.
- [x] TC-20: `pnpm --filter @robota-sdk/agent-transport-tui exec vitest run src/__tests__/screen-reader-pacing.test.ts`
      → exits 0; `resolvePacing` returns the documented defaults when neither env var is set, returns `0`
      for an explicit `0`, clamps `ROBOTA_SCREEN_READER_STARTUP_QUIET_MS=999999` to 600000 and
      `ROBOTA_SCREEN_READER_PREPARK_MS=99999` to 5000 while reporting each clamp on stderr, and ignores a
      non-numeric value with a stderr note rather than silently treating it as 0; with the mode off both
      waits resolve to 0 regardless of the variables; a keypress delivered during the startup wait settles
      it before its deadline, and the pre-write park emits a column-0 move before the waited write. RED
      with the clamp removed.
- [x] TC-14: `grep -n "screen reader\|screen-reader\|OSC 133" packages/agent-transport-tui/docs/SPEC.md packages/agent-cli/docs/SPEC.md`
      → at least one match in each; `agent-transport-tui/docs/SPEC.md` contains a "Known limitations"
      subsection listing at least the Ink "basic support" caveat and the terminals where OSC 133 does
      nothing; `agent-cli/docs/SPEC.md` states the precedence and names the divergence from the memory
      resolver's env-wins rule.
- [ ] TC-15: `node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`
      → exits 0.
- [x] TC-22: `pnpm --filter @robota-sdk/agent-transport-tui test:pty -- src/__tests__/pty/screen-010-scrollback.ptytest.ts src/__tests__/pty/screen-006-no-color.ptytest.ts`
      → exits 0; a new case spawns the built binary with `--screen-reader` at `rows: 16`, sends `/help`,
      and asserts that `raw()` contains no `\x1b[?1049h` (no alternate-screen switch at any point), that
      `snapshot()` contains `Available commands` or `/exit`, and that the last index of `Type a message`
      is greater than that committed content's index (history reached native scrollback with the input
      pinned) — without depending on the boot banner or on `Idle`, which the mode suppresses; the
      existing flagless case is unchanged and still passes. RED if the mode sets `alternateScreen: true`
      or writes `\x1b[?1049h` itself. `screen-006-no-color.ptytest.ts` is run in the same command so the
      capability-preservation claim that it keeps passing flagless is asserted rather than assumed.

## Test Plan

Test strategy (type SCREEN, tags `[cli, a11y]`): process spawn + stdout assertion (pty) for the
end-to-end terminal byte stream, `ink-testing-library` component tests for each rendering branch, and
unit tests for the resolver and the writers. Every criterion is command-form.

| TC-ID | Test Type | Tool / Approach | Notes |
| ----- | --------- | --------------- | ----- |
| TC-01 | Unit | vitest, new `screen-reader-enablement.test.ts` | Precedence table incl. the `=0` override; RED with the flag-override line removed |
| TC-02 | Unit | vitest, new `screen-reader-render-options.test.ts` (Ink `render` spied) | Both halves — Ink option and the ARCH-110-prone `toChannelOptions` projection |
| TC-03 | Unit | same file (stdout captured) | The three confirmation strings and the silent case |
| TC-04 | Unit | vitest, existing `render-markdown.test.ts` | `Header: value` flattening at the single choke point |
| TC-05 | Unit | vitest, new `screen-reader-labels.test.ts` | Role-derived, provider-invariant label vocabulary |
| TC-06 | Component | vitest + `ink-testing-library`, new `screen-reader-menus.test.tsx` | Numbered list, authored prompt literal, out-of-range re-prompt |
| TC-07 | Component | same file | Permission prompt borderless + typed yes/no |
| TC-08 | Unit | vitest, new `attention-bell-and-marks.test.ts` (stdout captured) | Three bell triggers and the sub-threshold negative |
| TC-09 | Unit | same file | OSC 133 A/B/C/D order and the two off-conditions |
| TC-10 | Component | vitest + `ink-testing-library`, new `screen-reader-input.test.tsx` | No rule line; deletion announced once |
| TC-11 | E2E (pty) | `test:pty`, new `screen-reader-mode.ptytest.ts` on the built binary, modelled on `screen-006-no-color.ptytest.ts` (`snapshot()` vs `raw()`, replay fixture) | The real byte stream, plus the default-off proof |
| TC-12 | E2E (pty) | same file with `env:` injection, as `screen-006-no-color` does for `NO_COLOR` | Env and flag channels end to end |
| TC-13 | Unit | vitest, existing `palette-consistency` / `status-glyph` / `safe-text-boundary` tests | The three mechanical floors this change must not break |
| TC-16 | Component | vitest + `ink-testing-library`, existing `status-bar.test.tsx` | Solution 13 — the permission mode is always spoken in the mode |
| TC-17 | Unit | vitest, the new render-options test | Solution 5 — banner suppression, which TC-11's box-drawing sweep cannot see |
| TC-18 | Unit | same file as TC-03 (stdout captured) | Solution 4 — the advisory hint's positive case and its two negatives |
| TC-19 | Component | vitest + fake timers, existing `streaming-indicator.test.tsx` / `wave-text.test.tsx` | Solution 5 — spinners/motion become static text |
| TC-21 | Component | vitest + `ink-testing-library`, existing `status-bar.test.tsx` | Solution 13 / verdict (j) — volatile fields suppressed and stable ones kept, asserted together |
| TC-20 | Unit | vitest + fake timers, new `screen-reader-pacing.test.ts` (env injected) | Solution 12 / verdict (i) — the two waits, their bounds, the early-exit keypress and the column-0 park |
| TC-14 | Command | `grep` | SPEC coverage incl. the known-limitations list and the precedence divergence |
| TC-15 | Suite | `run-all-scans.mjs --affected --context pr` | Regression over the affected set |
| TC-22 | E2E (pty) | `test:pty`, existing `screen-010-scrollback.ptytest.ts`, new `--screen-reader` case | Verdict (g) — no alternate screen, committed history in native scrollback, input pinned |

## User Execution Test Scenarios


<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 2`

Diverges from the spec's own § User Execution Test Scenarios draft on the surface mechanism,
corrected against code paths verified this session: `-p` print mode dispatches to `runPrintMode` and
returns before the interactive-TUI block ever calls `renderApp` (`packages/agent-cli/src/cli.ts:361`,
`:428`), so it cannot show the confirmation line the spec's draft pairs it with; and the richer
interactive observables (role labels, numbered menus, table flattening) need raw-mode keyboard input,
which Ink refuses outside a real TTY — verified: `robota` invoked non-interactively (as this
environment's Bash tool and any CI shell both run it) exits via Ink's `Raw mode is not supported on the
current process.stdin` right after its first frame. Both scenarios below instead target the boot-time
byte stream, which prints before Ink attempts raw mode and is therefore captured by one non-interactive
command each. The interactive richness stays engineering regression coverage (TC-05/TC-06/TC-07/TC-09/
TC-11), not scenario evidence.

### Scenario 1: `--screen-reader` prints the confirmation line before any chrome renders

- Executability: agent-executable
- Product surface: robota-tui
- Surface rationale: shipped-entrypoint=robota
- Prerequisites: Build the CLI (`pnpm --filter @robota-sdk/agent-cli build`, producing `packages/agent-cli/dist/node/bin.js`); create an isolated probe root `PROBE_DIR=$(mktemp -d)` with `mkdir -p "$PROBE_DIR/project" "$PROBE_DIR/home/.robota" "$PROBE_DIR/bin"`; write `$PROBE_DIR/home/.robota/settings.json` containing exactly `{"currentProvider":"anthropic","providers":{"anthropic":{"type":"anthropic","model":"claude-test-model","apiKey":"probe-dummy-key"}}}` (the same dummy-provider shape `writeTuiProviderSettings` writes in `packages/agent-transport-tui/src/__tests__/pty/pty-driver.ts`, so the CLI's provider-configured check passes with no live key and no model call is ever made, since the run below never reaches user input); symlink `$PROBE_DIR/bin/robota` to the repository's `packages/agent-cli/bin/robota.cjs` and `chmod +x` it (verified this session: an unmodified `PATH` on this machine resolves a bare `robota` to an unrelated pre-existing global install, not this worktree's build, so the shim is required, not optional); then, with `HOME="$PROBE_DIR/home"`, `PATH="$PROBE_DIR/bin:$PATH"`, and `cwd="$PROBE_DIR/project"`, run the Command below in a non-interactive shell with no controlling TTY on stdin (this agent's Bash tool, or any CI job) — run directly inside an interactive terminal it instead launches the live TUI and blocks waiting for keystrokes rather than terminating on its own.
- Command: `robota --screen-reader --name screen-reader-boot-probe | grep "Screen reader mode: on via flag"`
- Observable type: product-output
- Observable rationale: source=product-process
- Expected observable: exit=0; output-contains=Screen reader mode: on via flag
- Cleanup: `rm -rf "$PROBE_DIR"`.
- Evidence: Pending — to be captured at Stage-2 execution once `--screen-reader` exists: the matched line `grep` printed, and the command's exit code.

### Scenario 2: without the flag, the confirmation line is absent and the boot chrome is unchanged

- Executability: agent-executable
- Product surface: robota-tui
- Surface rationale: shipped-entrypoint=robota
- Prerequisites: Same technique as Scenario 1, run independently (this is its without-the-flag contrast, not a continuation — do not chain the two): create a fresh isolated probe root `PROBE_DIR_2=$(mktemp -d)` with `mkdir -p "$PROBE_DIR_2/project" "$PROBE_DIR_2/home/.robota" "$PROBE_DIR_2/bin"`; write `$PROBE_DIR_2/home/.robota/settings.json` with the identical dummy-provider JSON from Scenario 1; symlink `$PROBE_DIR_2/bin/robota` to `packages/agent-cli/bin/robota.cjs` and `chmod +x` it; then, with `HOME="$PROBE_DIR_2/home"`, `PATH="$PROBE_DIR_2/bin:$PATH"`, and `cwd="$PROBE_DIR_2/project"`, run the Command below in the same non-interactive shell/harness as Scenario 1.
- Command: `robota --name screen-reader-off-probe | grep "Welcome to robota"`
- Observable type: product-output
- Observable rationale: source=product-process
- Expected observable: exit=0; output-contains=Welcome to robota
- Cleanup: `rm -rf "$PROBE_DIR_2"`.
- Evidence: Pending — to be captured at Stage-2 execution: the matched line and exit code. Already reproduced once during scenario authoring (2026-09-07) against the unmodified worktree build: the boxed `Welcome to robota!` panel and the ASCII-art `ROBOTA` banner both printed, no `[Screen reader mode:` line appeared anywhere in the output, and `grep "Welcome to robota"` on that captured output matched with pipeline exit 0.

## Tasks

- [ ] `.agents/tasks/CLI-2004-tui-screen-reader-mode.md` — todo

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-09-07

**Status remains:** draft

**Ordering check:** GATE-WRITE is the entry gate (gate-catalogue.md § Prior-gate map: "GATE-WRITE has
no prior status gate"), so no prior-gate PASS is required. Input state matches: `status: draft` in
frontmatter, document located in `.agents/spec-docs/draft/`, Evidence Log empty before this entry.
No implementation exists — all six new files named in § Affected Files
(`screen-reader-enablement.ts`, `screen-reader-context.tsx`, `screen-reader-labels.ts`,
`terminal-marks.ts`, `attention-bell.ts`, `screen-reader-mode.ptytest.ts`) are absent, and
`git status` shows only the two untracked planning artifacts. No NON-COMPLIANCE trigger.

**Per-criterion result (27 criteria — 20 mechanical recorded PASS per `gate.mjs`; 7 semantic judged here):**

- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS (mechanical, per `gate.mjs`).
- GATE-WRITE — `status: draft` present in frontmatter: PASS (mechanical, per `gate.mjs`).
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: PASS (mechanical, per `gate.mjs`; `type: SCREEN`).
- GATE-WRITE — `tags:` field present in frontmatter: PASS (mechanical, per `gate.mjs`; `tags: [cli, a11y]`).
- GATE-WRITE — Problem contains a concrete symptom: PASS — six numbered symptoms, verified against the tree. All eight `borderStyle` file:line pairs exact (`MenuSelect.tsx:93`, `ConfirmPrompt.tsx:72`, `TextPrompt.tsx:66`, `PermissionPrompt.tsx:80`, `MultiSelectList.tsx:97`, `SlashAutocomplete.tsx:106`, `ExecutionWorkspaceSwitcher.tsx:65`, `ContextWarningBanner.tsx:17`); `InputArea.tsx:315` is `'─'.repeat(innerWidth)`; `ToolDiffBlock.tsx:24,31` carry the `│` gutter; `background-task-row-format.ts:7,33,40` carry `├`/`└`; `App.tsx` `<Static>` spans `:450-467`, banner `:454-460`, live region `:468-599`, and `StreamingIndicator:488` / `BackgroundTaskPanel:507` / `PermissionPrompt:520` / `PendingActionPrompt:522` / `ContextWarningBanner:555` / `InputArea:556` / `SessionStatusBar:581` all match; `WaveText.tsx:25-31` is the `setInterval` at `MOTION.waveIntervalMs`, confirmed `400` in `tui-palette.ts:69`; `InputArea.tsx:290` is the `<WaveText text="  Waiting for response...">`; `key-hint-footer.tsx:33` is `SELECTION_INDICATOR = '> '`; `ListPicker.tsx:98,104` are the `↑ N more above` / `↓ N more below` lines; `use-terminal-title.ts:24` is the sole escape write and `grep -n "133"` over `packages/agent-transport-tui/src` returns nothing (exit 1); no audible BEL is emitted (the only `\x07` is the OSC 0 terminator the document itself names); `render-markdown.ts:97-109` assigns only `renderer.code` (`renderer.table` untouched); the playground announcer exists at the stated path with `SCREEN_READER_DELAY_MS = 100` and `aria-live`. TWO DEFECTS RECORDED, neither defeating concreteness: (i) the text says "nine sites" but enumerates eight and the tree has exactly eight `borderStyle` occurrences — § Decision line (e) repeats "the nine sites"; (ii) symptom 6 states `grep -rn "screenReader\|a11y\|aria" packages/agent-transport-tui/src packages/agent-cli/src` "returns nothing", but that command returns 29 lines (all substring hits inside `invariant`/`variable`/`variant`). The underlying claim is true — `grep -rn "screenReader\|a11y\|aria-\|ARIA"` over the same paths returns nothing (exit 1) — but the command as published does not reproduce its stated output.
- GATE-WRITE — Problem contains a reproduction condition: PASS — "Start `robota` under any screen reader on any platform", followed by the ordered observable sequence (banner art announced, whole input area and status bar re-announced per keystroke and per streaming delta, bordered permission box answerable only by arrow keys, markdown table read as `│`/`─` grid, no ring on long-tool completion, jump-to-previous-prompt inert) and the closing "There is no flag, env var or setting that changes any of it." When/where is unambiguous and needs no privileged environment.
- GATE-WRITE — Problem does not contain "TBD"/"TODO"/vague single-sentence descriptions: PASS (mechanical, per `gate.mjs`).
- GATE-WRITE — `## Prior Art Research` section present: PASS (mechanical, per `gate.mjs`).
- GATE-WRITE — Section is substantiated (≥1 documentation source): PASS (mechanical, per `gate.mjs`; R1–R18 cited, `PRIOR_ART_RESEARCH: FOUND`).
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present: N/A — the opt-out branch does not apply because the preceding substantiation criterion is satisfied on its merits (18 documentation references, no waiver claimed). Recorded rather than skipped.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision`: PASS — the feed is evidence-based, not asserted, and its load-bearing external claims verify against the installed dependency. Ink 7.1.1 is the lockfile-resolved version; its README documents `isScreenReaderEnabled` with `Default: process.env['INK_SCREEN_READER'] === 'true'` (readme.md:2650, `build/render.d.ts:52`) — quoted verbatim in constraint 1 — plus `useIsScreenReaderEnabled()` (readme.md:2509) and exactly 18 `aria-role` values in `build/components/Box.d.ts:17` (button, checkbox, combobox, list, listbox, listitem, menu, menuitem, option, progressbar, radio, radiogroup, tab, tablist, table, textbox, timer, toolbar), matching the document's "18 values including `listbox`, `option`, `menu`, `progressbar`, `table`". Constraint 2's `alternateScreen` "Default: `false`" matches readme.md:2719-2722, and no `alternateScreen`/`\x1b[?1049h` write exists in either src tree. § 3's convergence counts drive the Decision table's per-line verdicts (e.g. verdict (a) picks `--screen-reader` on the stated 2/3-vs-1/3 split; verdict (d) is explicitly resolved from the § 3 auto-detection conflict), and § 5's recommendation is carried into Alternative 1. Alternative 3 exists solely because Ink reads `INK_SCREEN_READER` itself.
- GATE-WRITE — All 4 Architecture Review checklist items are `[x]`: PASS (mechanical, per `gate.mjs`).
- GATE-WRITE — Sibling scan item is `[x]` with completion evidence or explicit N/A: PASS (mechanical, per `gate.mjs`). Substantively corroborated: SCREEN-004/005/006/007/008/009 all exist as completed tasks under `.agents/tasks/completed/` with titles matching the document's characterisations (prompt footers, status indicator, shared palette + motion, status consistency, interactive-terminal detection, colour-only audit); SCREEN-006 and SCREEN-010 are `done` spec documents; SCREEN-009's quoted string "no color-only state found" is verbatim at `.agents/tasks/completed/SCREEN-009-tui-color-only-audit.md:14` with `status: done`, `completed: 2026-06-27`, and `status-glyph.test.ts` named as its regression floor at :22.
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: PASS (mechanical, per `gate.mjs`; three alternatives, each with Pro and Con).
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — § Decision names the trade-off explicitly and comparatively: "Alternative 2 buys byte-level control at the price of a second renderer that must be kept in step with every future TUI change, while Alternative 1's cost is mechanical breadth — one branch in each of ~20 components — that the existing per-component test files already cover and that Ink's ARIA vocabulary shrinks further", and disposes of Alternative 3 as "not a smaller version of the feature but a different, much smaller one". Both sides of the axis are named, not merely the winner. The cited constraints check out: `render.tsx:134` is `toChannelOptions` carrying the ARCH-110 containment comment at :138-139 ("This hand-maintained projection can silently omit optional composition-root capabilities"), `render.tsx:196` is the `isInteractiveColorTerminal()` chalk/NO_COLOR gate, `render.tsx:217-234` is the `render(<App …/>, { exitOnCtrlC: false })` call, `sanitize-terminal-text.ts:107` is the OSC-stripping regex, `scan-tui-safe-text-boundary.mjs` exists, `docs/SPEC.md:199-240` is the "Color & Motion Contract (SCREEN-006)" section naming the `palette-consistency` floor, and `docs/SPEC.md:165-197` is the SCREEN-005 footer-grammar body. The verdict-(l) and verdict-(n) negative claims hold: no `shift+tab`/`cyclePermissionMode`/permission cycling in the TUI (exit 1), no `slider` in either src tree (exit 1), and `StatusBar.tsx:112-114` is `shouldShowPermissionMode` returning `permissionMode !== 'default'`.
- GATE-WRITE — New-surface placement (conditional): PASS as **N/A**, and the N/A is evidenced rather than asserted. No new package, app, presentation or interface surface is introduced and no layer / product-family boundary is reclassified: the four new TUI modules (`screen-reader-context.tsx`, `screen-reader-labels.ts`, `terminal-marks.ts`, `attention-bell.ts`) are intra-package files in the existing `packages/agent-transport-tui/src`, and their three named siblings (`terminal-capabilities.ts`, `status-glyph.ts`, `use-terminal-title.ts`) all exist in that same directory. The fifth new module, `packages/agent-cli/src/startup/screen-reader-enablement.ts`, mirrors `packages/agent-cli/src/startup/memory-enablement.ts`, confirmed present in the same directory. No new package dependency edge is created — every consumer is inside a package that already depends on Ink and on the TUI package. The conditional therefore does not fire; the (a)/(b) sub-requirements are inapplicable for want of a new surface, not unanswered.
- GATE-WRITE — Every Completion Criteria item has a `TC-N` prefix: PASS (mechanical, per `gate.mjs`; TC-01…TC-15).
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: **FAIL** — four distinct sub-items of § Solution carry no criterion. (1) § Solution item 12, "`StatusBar.tsx:112-114` renders the permission mode unconditionally in the mode", is the behaviour § Decision verdict (l) adopts *in place of* the rejected cycled-mode announcement, and no TC-01…TC-15 references `StatusBar` or the permission mode. (2) Banner suppression — § Solution item 5's "`App.tsx:454-460` skips the banner", which is Problem symptom 1's ASCII-art site — has no criterion; TC-11 sweeps only `│ ─ ╭ ╮ ╰ ╯ ┌ ┐ └ ┘`, and the banner is drawn from `_ / \ | ( )`, so it passes that sweep unchanged. (3) The advisory hint of § Solution item 4 / § Decision verdict (d) — `[Screen reader mode: off — run with --screen-reader]` — has only its negative asserted (TC-03 requires "writes nothing when the mode is off and no reader hint is present"); no criterion asserts the line is emitted when a hint IS present, which is the entire behaviour the verdict adopts to resolve the § 3 auto-detection conflict. (4) Static spinners — § Solution item 5's "`WaveText` renders its text with no interval; `StreamingIndicator` renders `thinking: …` as a single static line", checklist line (e) — has no criterion; no TC names `WaveText` or `StreamingIndicator`. Covered sub-items, for contrast: item 1→TC-01, item 3→TC-02, item 6→TC-05, items 7→TC-06/TC-07, item 8→TC-10, item 9→TC-04, item 10→TC-08, item 11→TC-09, item 13→TC-14.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form: **FAIL** — 12 of the 15 criteria are phrased as commands whose command runs the wrong package, so they cannot verify the work they claim to verify. TC-02, TC-04, TC-05, TC-06, TC-08, TC-10 and TC-13 invoke `pnpm --filter @robota-sdk/agent-transport exec vitest run src/__tests__/…`, and TC-11 invokes `pnpm --filter @robota-sdk/agent-transport test:pty -- …`; TC-03, TC-07, TC-09 and TC-12 inherit those commands via "same file". `@robota-sdk/agent-transport` is a REAL and DIFFERENT workspace package: `pnpm --filter @robota-sdk/agent-transport list --depth -1` resolves to `packages/agent-transport` (verified), which contains only `src/index.ts`, has no `src/__tests__/` directory, and has no `test:pty` script — so TC-11's command fails at script lookup and the vitest criteria find no test files at the stated paths. The package the change actually targets is `@robota-sdk/agent-transport-tui` (`packages/agent-transport-tui`), which is the path § Affected Files itself uses throughout; `pnpm --filter @robota-sdk/agent-transport-tui` resolves there correctly. Note for the author: the same incorrect filter already appears in `packages/agent-transport-tui/vitest.pty.config.ts:6`, which is the likely source, but a pre-existing wrong comment does not make the criterion runnable. TC-01 (`--filter @robota-sdk/agent-cli`), TC-14 (`grep`) and TC-15 (`node scripts/harness/run-all-scans.mjs --affected --context pr --skip dist --skip build-contracts`, whose flags are all supported and whose `--skip dist --skip build-contracts` pairing is the form documented at `run-all-scans.mjs:166`) are correct and runnable as written.
- GATE-WRITE — No criterion uses "works correctly"/"no errors"/"implemented"/"displays correctly": PASS (mechanical, per `gate.mjs`).
- GATE-WRITE — `## Test Plan` section present: PASS (mechanical, per `gate.mjs`).
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): PASS (mechanical, per `gate.mjs`; 15 criteria ↔ 15 rows, TC-01…TC-15).
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): PASS (mechanical, per `gate.mjs`).
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry: N/A — no Test Plan row names "manual" as its Tool/Approach (the 15 rows use vitest, `ink-testing-library`, `test:pty`, `grep` and `run-all-scans.mjs`); the manual confirmation described in § User Execution Test Scenarios is scoped there, not to a Test Plan row. Recorded rather than skipped. `gate.mjs` records this line PASS as vacuously satisfied.
- GATE-WRITE — Tasks section present with placeholder: PASS (mechanical, per `gate.mjs`).
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): PASS (mechanical, per `gate.mjs`; empty before this entry).
- GATE-WRITE — No `## Status` or `## Classification` sections in the body: PASS (mechanical, per `gate.mjs`).

**Failed criteria:**

- Each criterion uses Command form or Observable behavior form: found 12 of 15 criteria (TC-02…TC-13) commanding `pnpm --filter @robota-sdk/agent-transport …`, which resolves to `packages/agent-transport` — a different package holding only `src/index.ts`, with no `src/__tests__/` and no `test:pty` script. Required was a command that executes the named tests in the package under change, `@robota-sdk/agent-transport-tui`.
  **Required action:** Replace `--filter @robota-sdk/agent-transport` with `--filter @robota-sdk/agent-transport-tui` in TC-02, TC-04, TC-05, TC-06, TC-08, TC-10, TC-11 and TC-13 (TC-03, TC-07, TC-09, TC-12 inherit by "same file"), and in the § User Execution Test Scenarios automated-equivalent command, then re-run GATE-WRITE.
- At least 1 criterion per distinct feature or sub-item: found no criterion covering § Solution item 12 (StatusBar renders the permission mode unconditionally), the banner suppression in § Solution item 5 / Problem symptom 1, the positive case of the § Solution item 4 advisory hint, or the static-spinner behaviour of § Solution item 5. Required was at least one criterion per distinct sub-item.
  **Required action:** Add criteria covering those four sub-items (or fold them into existing TCs with explicit assertions — e.g. extend TC-11's character sweep to the banner glyphs and add a positive advisory-line assertion to TC-03), add the matching § Test Plan rows so the TC-N counts still match, then re-run GATE-WRITE.

**Defects recorded but not gate-deciding** (fix alongside the above; each is a published claim that does not match the tree):

- § Problem symptom 1 and § Decision verdict (e) both say "nine sites" of Ink `borderStyle`; the enumeration lists eight and `grep -rn "borderStyle" packages/agent-transport-tui/src packages/agent-cli/src` returns exactly eight.
- § Problem symptom 6 publishes `grep -rn "screenReader\|a11y\|aria" …` as returning nothing; it returns 29 lines (substring hits inside `invariant`/`variable`/`variant`). The negative claim itself is true under `"screenReader\|a11y\|aria-\|ARIA"`.
- § Architecture Review > Affected Scope and § Affected Files both give `packages/agent-transport-tui/src/utils/background-task-row-format.ts`; the file is at `packages/agent-transport-tui/src/background-task-row-format.ts` (no `utils/`). The bare citation in § Problem symptom 1 is unaffected. Every other path in § Affected Files was checked and exists, and all six files marked "new" are correctly absent.

**Judged at:** HEAD `754c9e239eec0a1622334c9f7b022f9dd64f01c1` · base `origin/develop@754c9e239eec0a1622334c9f7b022f9dd64f01c1` · document `.agents/spec-docs/draft/CLI-2004-tui-screen-reader-mode.md` blob `9e3abe9d8d6c3569254905a08152aeb65b2f2886` (untracked)

### [GATE-WRITE] — 🔴 NON-COMPLIANCE | 2026-09-07

**Status remains:** draft

**Ordering check:** SATISFIED. GATE-WRITE is the entry gate (gate-catalogue.md § Prior-gate map: "GATE-WRITE has no prior status gate (it is the entry gate)"), so no prior-gate PASS is required. Input state matches the expected re-run state: `status: draft` in frontmatter, document located in `.agents/spec-docs/draft/`, and the Evidence Log carries exactly one prior entry — `[GATE-WRITE] — ❌ FAIL | 2026-09-07` — with no entry from a later gate. No implementation exists: all six files marked "new" in § Affected Files (`packages/agent-cli/src/startup/screen-reader-enablement.ts`, `screen-reader-context.tsx`, `screen-reader-labels.ts`, `terminal-marks.ts`, `attention-bell.ts`, `src/__tests__/pty/screen-reader-mode.ptytest.ts`) are absent from the tree, and `git status --porcelain` reports only the two untracked planning artifacts. The implementation-before-gate NON-COMPLIANCE trigger did NOT fire; the violation recorded below is a different one.

**Per-criterion result (27 criteria — 20 mechanical from `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this> --lane L2 --date 2026-09-07 --dry-run`, re-run this session, which reported "gate GATE-WRITE (lane L2): 27 criteria judged — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN" and wrote no entry (document blob unchanged at `35b4a7a9…` after the run); the 7 semantic criteria judged here independently, not carried over):**

- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS (mechanical) — `gate.mjs` observed "file begins with a `---` frontmatter block".
- GATE-WRITE — `status: draft` present in frontmatter: PASS (mechanical) — `gate.mjs` observed "`status: draft`".
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: PASS (mechanical) — `gate.mjs` observed "`type: SCREEN` is one of 11 allowed values".
- GATE-WRITE — `tags:` field present in frontmatter: PASS (mechanical) — `gate.mjs` observed "`tags:` present (2 value(s))"; the value is `[cli, a11y]`.
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): PASS — six numbered symptoms, every file:line citation re-verified against this tree in this run. All eight `borderStyle` pairs exact and exhaustive (`grep -rn "borderStyle" packages/agent-transport-tui/src packages/agent-cli/src` returns exactly 8 lines: `MenuSelect.tsx:93`, `ContextWarningBanner.tsx:17`, `PermissionPrompt.tsx:80`, `ConfirmPrompt.tsx:72`, `TextPrompt.tsx:66`, `SlashAutocomplete.tsx:106`, `ExecutionWorkspaceSwitcher.tsx:65`, `MultiSelectList.tsx:97`); `InputArea.tsx:315` is `<Text color={borderColor}>{'─'.repeat(innerWidth)}</Text>`; `ToolDiffBlock.tsx:24,31` carry the `│` gutter; `background-task-row-format.ts:7,33,40` carry `├`/`└` and the file resolves at `packages/agent-transport-tui/src/background-task-row-format.ts` as now cited; `App.tsx` is 602 lines with `<Static>` opening at :450 and closing at :467, the ASCII banner at :454-460, and the live region :468-599, with `StreamingIndicator:488` / `BackgroundTaskPanel:507` / `PermissionPrompt:520` / `PendingActionPrompt:522` / `ContextWarningBanner:555` / `InputArea:556` / `SessionStatusBar:581` all matching; `WaveText.tsx:25-31` is the `setInterval(..., MOTION.waveIntervalMs)` effect and `InputArea.tsx:290` is `<WaveText text="  Waiting for response... (ESC to interrupt)" />`; `key-hint-footer.tsx:33` is `export const SELECTION_INDICATOR = '> ';`; `ListPicker.tsx:98,104` are the `↑ … more above` / `↓ … more below` lines; `use-terminal-title.ts:24` is `process.stdout.write(\`\x1b]0;${title}\x07\`)` and `grep -rn "133" packages/agent-transport-tui/src` exits 1 with no output; `render-markdown.ts:97-109` is `createTerminalRenderer`, whose only renderer assignment is `renderer.code` at :101 (`renderer.table` untouched); the playground announcer exists at the stated path. Both defects the prior FAIL recorded against THIS criterion are corrected in § Problem: symptom 1 now reads "eight component sites", and symptom 6's command is now anchored — `grep -rniE "screenreader|screen-reader|\ba11y\b|aria-" packages/agent-transport-tui/src packages/agent-cli/src` was executed and exits 1 with no output, exactly as published, and the accompanying sentence names `variant` as the substring hazard the anchoring removes.
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): PASS — "Start `robota` under any screen reader on any platform", followed by the ordered observable sequence (banner art announced, whole input area and status bar re-announced per keystroke and per streaming delta, bordered permission box answerable only by arrow keys, markdown table read as a `│`/`─` grid, no ring on long-tool completion, jump-to-previous-prompt inert for want of an OSC 133 mark) and closing with "There is no flag, env var or setting that changes any of it." The when/where is unambiguous, needs no privileged environment, and the "no setting changes it" clause is corroborated by the same anchored grep returning nothing.
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: PASS (mechanical) — `gate.mjs` observed "`## Problem` has no TBD/TODO; 3372 chars, 19 sentences".
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: PASS (mechanical) — `gate.mjs` observed "`## Prior Art Research` section present".
- GATE-WRITE — Section is substantiated (cites ≥1 documentation source, or states none found): PASS (mechanical) — `gate.mjs` observed "`scan-spec-research` reports the section substantiated or explicitly waived"; R1–R18 are cited and the section ends `PRIOR_ART_RESEARCH: FOUND`.
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present: PASS (mechanical, vacuous) — `gate.mjs` observed "`scan-spec-research` reports the section substantiated or explicitly waived". Judged N/A on the merits: the opt-out branch does not apply because the preceding substantiation criterion is met on its own (18 documentation references, no waiver claimed). Recorded rather than skipped.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based, not asserted): PASS — the load-bearing external claims were re-verified against the installed dependency, not taken on the document's word. `pnpm-lock.yaml:16543` resolves `ink@7.1.1`, matching § 4 constraint 1; that package's `readme.md:3009` reads verbatim "To enable it, you can either pass the `isScreenReaderEnabled` option to the `render` function or set the `INK_SCREEN_READER` environment variable to `true`", `readme.md:2650` reads "Default: `process.env['INK_SCREEN_READER'] === 'true'`", `readme.md:2500-2509` documents `useIsScreenReaderEnabled()`, and `build/components/Box.d.ts` declares exactly 18 `aria-role` values (button, checkbox, combobox, list, listbox, listitem, menu, menuitem, option, progressbar, radio, radiogroup, tab, tablist, table, textbox, timer, toolbar) — matching the document's "18 values including `listbox`, `option`, `menu`, `progressbar`, `table`". Constraint 2's `alternateScreen` "Default: `false`" matches `readme.md:2719-2722`, and no `alternateScreen` option or `\x1b[?1049h` write exists in either src tree (the single `1049h` hit is an input fixture string in `sec-019-terminal-sanitizer.test.ts:40`, not a write). The feed is directional and visible: § 3's convergence counts decide Decision verdicts (a) (`--screen-reader` on the stated 2/3-vs-1/3 split), (d) (explicitly resolved from § 3's named auto-detection conflict), (i) and (p) (single-reference numbers demoted to locally-measured defaults / a named constant), and § 5's recommendation is carried into Alternative 1 and the Decision. Alternative 3 exists only because Ink reads `INK_SCREEN_READER` itself.
- GATE-WRITE — All 4 Architecture Review checklist items are `[x]`: PASS (mechanical) — `gate.mjs` observed "5/5 checklist items `[x]`".
- GATE-WRITE — Sibling scan item is `[x]` with completion evidence or explicit `N/A: <reason>`: PASS (mechanical) — `gate.mjs` observed "Sibling scan `[x]` with completion evidence".
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — § Decision names the trade-off comparatively, on both sides of one axis: "Alternative 2 buys byte-level control at the price of a second renderer that must be kept in step with every future TUI change, while Alternative 1's cost is mechanical breadth — one branch in each of ~20 components — that the existing per-component test files already cover and that Ink's ARIA vocabulary shrinks further", and disposes of Alternative 3 as "not a smaller version of the feature but a different, much smaller one". The constraints the Decision leans on check out: `render.tsx:134` is `toChannelOptions` carrying the ARCH-110 containment comment at :138-139 ("This hand-maintained projection can silently omit optional composition-root capabilities"), `render.tsx:196` is the `isInteractiveColorTerminal()` gate, `render.tsx:217-234` is `render(<App …/>, { exitOnCtrlC: false })`, `StatusBar.tsx:112-114` is `shouldShowPermissionMode` returning `permissionMode !== 'default'`, and the verdict (l)/(n) negatives hold (`grep -rniE "shift\+tab|cyclePermissionMode|slider"` over both src trees exits 1; `permission-mode-command-api.ts` exists at `packages/agent-framework/src/command-api/permissions/`). TWO NON-DECIDING DEFECTS, neither touching the trade-off itself: (i) § Decision verdict (e) at line 202 still reads "`borderStyle` omitted at the nine sites" — the tree has eight and § Problem symptom 1 was corrected to "eight component sites", so the correction did not reach the Decision table; (ii) verdict (f) calls `render-markdown.ts:115` "the single choke point" for a `renderer.table` override, but :115 is `export function renderMarkdown(...)` — the renderer is constructed in `createTerminalRenderer` at :97-109, which § Solution item 9 names correctly.
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: PASS (mechanical) — `gate.mjs` observed "3 numbered alternatives, each with Pro and Con".
- GATE-WRITE — New-surface placement (conditional): PASS as N/A, evidenced rather than asserted. The conditional does not fire: no new package, app, presentation or interface surface is introduced and no layer / product-family boundary is reclassified. The four new TUI modules (`screen-reader-context.tsx`, `screen-reader-labels.ts`, `terminal-marks.ts`, `attention-bell.ts`) are intra-package files in the existing `packages/agent-transport-tui/src`, and the three siblings the N/A names — `terminal-capabilities.ts`, `status-glyph.ts`, `use-terminal-title.ts` — were each confirmed present in that same directory. The fifth new module, `packages/agent-cli/src/startup/screen-reader-enablement.ts`, mirrors `packages/agent-cli/src/startup/memory-enablement.ts`, confirmed present in the same directory. No new package dependency edge: every consumer already sits in a package depending on Ink and on the TUI package. The (a)/(b) sub-requirements are therefore inapplicable for want of a new surface, not unanswered.
- GATE-WRITE — Every Completion Criteria item has a `TC-N` prefix: PASS (mechanical) — `gate.mjs` observed "15 criteria, all `TC-NN:` prefixed".
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: **FAIL — UNCHANGED FROM THE PRIOR RUN.** The correction added no criterion and no Test Plan row: the document still carries 15 `TC-NN:` criteria and 15 Test Plan rows, the same counts the FAIL entry above judged. All four sub-items that decided the prior FAIL remain uncovered, confirmed by term search over the § Completion Criteria + § Test Plan region (document lines 348-432): `StatusBar` 0 hits, `permission mode` 0 hits, `banner` 0 hits, `WaveText` 0 hits, `StreamingIndicator` 0 hits, `spinner` 0 hits, `advisory` 0 hits. (1) § Solution item 12 — "`StatusBar.tsx:112-114` renders the permission mode unconditionally in the mode", the behaviour § Decision verdict (l) adopts *in place of* the rejected cycled-mode announcement — has no criterion. (2) Banner suppression, § Solution item 5's "`App.tsx:454-460` skips the banner" and § Problem symptom 1's ASCII-art site, has no criterion: TC-11 sweeps only `│ ─ ╭ ╮ ╰ ╯ ┌ ┐ └ ┘` and the banner at `App.tsx:454-460` is drawn from `_ | \ / < ( )`, none of which is in that set, so it passes TC-11 unchanged. (3) The advisory hint of § Solution item 4 / § Decision verdict (d) — `[Screen reader mode: off — run with --screen-reader]` — still has only its NEGATIVE asserted (TC-03: "writes nothing when the mode is off and no reader hint is present"); no criterion asserts the line is emitted when a hint IS present, which is the entire behaviour verdict (d) adopts to resolve the § 3 auto-detection conflict. (4) Static spinners, § Solution item 5's "`WaveText` renders its text with no interval; `StreamingIndicator` renders `thinking: …` as a single static line" (checklist line (e)), has no criterion. Required: at least one criterion per distinct sub-item, with matching Test Plan rows so the TC-N counts still agree.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): PASS — the filter defect that decided the prior FAIL is fully corrected, verified command by command. All nine filter-bearing criteria now name `@robota-sdk/agent-transport-tui` (TC-02 :356, TC-04 :364, TC-05 :368, TC-06 :372, TC-08 :380, TC-10 :387, TC-11 :390, TC-13 :398, and the § User Execution Test Scenarios automated equivalent :441); `packages/agent-transport-tui/package.json` declares `"name": "@robota-sdk/agent-transport-tui"`, so every one resolves to `packages/agent-transport-tui`, the package § Affected Files targets. No criterion now names the bare `@robota-sdk/agent-transport`. Every named script exists in that package's `package.json`: `test:pty` is `"vitest run --config vitest.pty.config.ts"` (TC-11 no longer fails at script lookup, as it did against `packages/agent-transport`, which has no such script). Every named EXISTING test file exists at the stated path: `src/__tests__/render-markdown.test.ts` (TC-04), `src/__tests__/palette-consistency.test.ts`, `src/__tests__/status-glyph.test.ts`, `src/__tests__/safe-text-boundary.test.tsx` (TC-13), and the two pty fixtures TC-11 models itself on, `src/__tests__/pty/screen-006-no-color.ptytest.ts` and `src/__tests__/pty/screen-010-scrollback.ptytest.ts`; the six files marked "new" are correctly absent. TC-01 targets `@robota-sdk/agent-cli` with `packages/agent-cli/src/startup/__tests__/` present; TC-14's two `grep` targets `packages/agent-transport-tui/docs/SPEC.md` and `packages/agent-cli/docs/SPEC.md` both exist; TC-15's flags are all supported by `run-all-scans.mjs` (`--skip` parsed at :1758, `--context` at :1782, `--affected` at :1790) with the `--skip dist --skip build-contracts` pairing documented at :166. TC-03, TC-07, TC-09 and TC-12 inherit corrected commands via "same file". Each criterion states an exit code or a concrete observable string.
- GATE-WRITE — No criterion uses "works correctly"/"no errors"/"implemented"/"displays correctly": PASS (mechanical) — `gate.mjs` observed "none of \"works correctly\", \"no errors\", \"implemented\", \"displays correctly\" appears".
- GATE-WRITE — `## Test Plan` section present: PASS (mechanical) — `gate.mjs` observed "`## Test Plan` present".
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): PASS (mechanical) — `gate.mjs` observed "15 Test Plan rows = 15 TC criteria".
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): PASS (mechanical) — `gate.mjs` observed "15 rows with Test Type and Tool, no TBD".
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry: PASS (mechanical, vacuous) — `gate.mjs` observed "0 manual row(s), each with Notes". Judged N/A on the merits: no Test Plan row names "manual" as its Tool/Approach (the 15 rows use vitest, `ink-testing-library`, `test:pty`, `grep` and `run-all-scans.mjs`); the manual confirmation described in § User Execution Test Scenarios is scoped there, not to a Test Plan row. Recorded rather than skipped.
- GATE-WRITE — Tasks section present with placeholder: PASS (mechanical) — `gate.mjs` observed "`## Tasks` present".
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): PASS (mechanical) — `gate.mjs` observed "`## Evidence Log` present with 1 prior entry (none from a later gate)"; the emptiness requirement is scoped by the criterion's own "(first GATE-WRITE run)" qualifier and this is a re-run.
- GATE-WRITE — No `## Status` or `## Classification` sections in the body: PASS (mechanical) — `gate.mjs` observed "no `## Status` / `## Classification` body sections".

**Violation (why this is NON-COMPLIANCE and not a plain FAIL):** the correction MODIFIED the recorded `[GATE-WRITE] — ❌ FAIL | 2026-09-07` entry above, rewriting that gate's quotation of the defect it found into the corrected form. The per-criterion line for "Each criterion uses Command form or Observable behavior form" in that entry now reads "TC-02, TC-04, TC-05, TC-06, TC-08, TC-10 and TC-13 invoke `pnpm --filter @robota-sdk/agent-transport-tui exec vitest run src/__tests__/…`, and TC-11 invokes `pnpm --filter @robota-sdk/agent-transport-tui test:pty -- …`" — naming the CORRECT filter — and then, in the same sentence, concludes those commands "cannot verify the work they claim to verify" and explains that "`@robota-sdk/agent-transport` is a REAL and DIFFERENT workspace package". A recorded verdict now asserts both that the criteria named `-tui` and that they named the wrong package. The rewrite was partial, which is how it is detectable: the bare `@robota-sdk/agent-transport` survives in the same entry at its `**Failed criteria:**` summary and `**Required action:**` line, so the entry is internally self-contradictory. This is consistent with an unscoped find-and-replace of `--filter @robota-sdk/agent-transport exec` / ` test:pty` across the whole file rather than across § Completion Criteria and § User Execution Test Scenarios only. An Evidence Log entry is the immutable record of what a gate observed; once its findings text is rewritten, a later reader cannot tell what was found, and every downstream gate reads this log. The prior entry's `**Judged at:**` blob `9e3abe9d…` no longer corresponds to any recoverable content — the document is untracked (`git status --porcelain` reports `?? .agents/spec-docs/draft/CLI-2004-tui-screen-reader-mode.md`), so the pre-correction text is not retrievable from git and the alteration cannot be reversed by reconstruction.

Second, and independently of the record integrity: the correction did not do what this re-run was dispatched on. The dispatch stated that both failed criteria shared one root defect and that replacing the filter resolved them. That is not what the document shows. The filter defect was real and is fully fixed (criterion "Each criterion uses Command form or Observable behavior form" now PASSes on verified evidence), but the second failed criterion — "At least 1 criterion per distinct feature or sub-item" — was never a filter problem and was not touched: no criterion was added, no Test Plan row was added, and all four uncovered sub-items are still uncovered. That criterion FAILs again on its own merits.

**Required action:**

1. Restore the `[GATE-WRITE] — ❌ FAIL | 2026-09-07` entry's per-criterion line for "Each criterion uses Command form or Observable behavior form" so it again quotes the defect as observed — `pnpm --filter @robota-sdk/agent-transport exec vitest run src/__tests__/…` and `pnpm --filter @robota-sdk/agent-transport test:pty -- …` — matching that entry's own surviving `**Failed criteria:**` and `**Required action:**` lines. Do not alter anything else in that entry. Restoring a record to what it recorded is the remedy; it is not a content edit to this document's spec sections.
2. Constrain future corrections to the sections named in the required action. A find-and-replace must not cross into `## Evidence Log`.
3. Then complete the outstanding criterion: add at least one criterion per uncovered sub-item — § Solution item 12 (StatusBar renders the permission mode unconditionally), the banner suppression of § Solution item 5 / § Problem symptom 1, the POSITIVE case of the § Solution item 4 advisory hint, and the static-spinner behaviour of § Solution item 5 (`WaveText`, `StreamingIndicator`) — or fold them into existing TCs as explicit assertions (e.g. extend TC-11's character sweep to the banner glyphs `_ | \ / <`, add a positive advisory-line assertion to TC-03), and add the matching § Test Plan rows so the TC-N counts still agree.
4. Also fix, though neither is gate-deciding: § Decision verdict (e) line 202 "the nine sites" → eight, to match the corrected § Problem symptom 1 and the tree's eight `borderStyle` occurrences; and § Decision verdict (f)'s choke-point citation `render-markdown.ts:115` → `render-markdown.ts:97-109` (`createTerminalRenderer`), which is where a `renderer.table` override goes and which § Solution item 9 already names correctly.
5. Re-run GATE-WRITE.

**Judged at:** HEAD `754c9e239eec0a1622334c9f7b022f9dd64f01c1` · base `origin/develop@754c9e239eec0a1622334c9f7b022f9dd64f01c1` · document `.agents/spec-docs/draft/CLI-2004-tui-screen-reader-mode.md` blob `35b4a7a953d38e70e3ccc7f92ef7d575e781efdf` (untracked)

### [RECORD REPAIR] — 2026-09-07

**Not a gate verdict.** This note records damage to a recorded gate verdict above, and its repair.

**What happened.** Correcting the `--filter` defect the 2026-09-07 ❌ FAIL entry identified, I applied an
unscoped whole-document string substitution (`@robota-sdk/agent-transport exec` →
`@robota-sdk/agent-transport-tui exec`, and the same for ` test:pty`). It was intended for § Completion
Criteria only, but it also rewrote two quotations inside that FAIL entry's per-criterion line for "Each
criterion uses Command form or Observable behavior form". The entry was left asserting both that the
criteria named `-tui` and that they named the wrong package. The 2026-09-07 🔴 NON-COMPLIANCE entry above
identified this.

**Repair.** The two altered quotations were restored to the bare `@robota-sdk/agent-transport` form. The
restoration is exact rather than reconstructed: the substitution that damaged them is known verbatim, so
inverting it on that one line returns the original text. The NON-COMPLIANCE entry's own quotation of the
damaged text was deliberately **not** touched — it is that entry's evidence, and correcting it would
destroy the record of the incident.

**Also corrected in the same pass** (a defect the earlier correction missed): § Decision verdict (e) said
"the nine sites"; the tree has eight `borderStyle` occurrences, and § Problem symptom 1 had already been
fixed. Occurrences of "nine sites" that remain inside Evidence Log entries are those entries' own
observations and are left as recorded.

**Cause, for the next author.** The substitution was run with no line-range or section bound on a document
whose Evidence Log quotes the spec body verbatim. Any edit to a spec that has recorded verdicts must be
scoped above the `## Evidence Log` heading; a whole-file substitution cannot be.

### [GATE-WRITE] — ❌ FAIL | 2026-09-07

**Status remains:** draft

**Ordering check:** SATISFIED; the prior-gate half is exempt. GATE-WRITE is the entry gate
(gate-catalogue.md § Prior-gate map: "GATE-WRITE has no prior status gate (it is the entry gate)"), so no
prior-gate PASS is required. Input state matches: `status: draft` and `lane: L2` in frontmatter, document
at `.agents/spec-docs/draft/CLI-2004-tui-screen-reader-mode.md`, and the log carries only GATE-WRITE
material — no entry from a later gate. No implementation preceded this gate: all six files marked "new" in
§ Affected Files (`packages/agent-cli/src/startup/screen-reader-enablement.ts`, `screen-reader-context.tsx`,
`screen-reader-labels.ts`, `terminal-marks.ts`, `attention-bell.ts`,
`src/__tests__/pty/screen-reader-mode.ptytest.ts`) are absent from the tree, and `git status --porcelain`
reports exactly the two untracked planning artifacts.

**Record-integrity check (the 2026-09-07 🔴 NON-COMPLIANCE): RESOLVED — verified by round-trip, not
accepted on the author's word.** The damaged line (the ❌ FAIL entry's per-criterion line for "Each
criterion uses Command form or Observable behavior form") again quotes the defect as observed:
`pnpm --filter @robota-sdk/agent-transport exec vitest run src/__tests__/…` and
`pnpm --filter @robota-sdk/agent-transport test:pty -- …`. The restoration is exact rather than
reconstructed, and this was checked mechanically: applying the known damaging substitution
(`@robota-sdk/agent-transport exec` → `…-tui exec`, `@robota-sdk/agent-transport test:pty` →
`…-tui test:pty`) to that line's current text reproduces, character for character, the damaged text the
NON-COMPLIANCE entry quotes verbatim in its **Violation** paragraph. Two independent corroborations:
(i) the FAIL entry's `**Failed criteria:**` and `**Required action:**` lines were never reachable by that
substitution — neither carries the ` exec` / ` test:pty` suffix it matched — and both name the bare
`@robota-sdk/agent-transport` as the defect found, so the entry is internally consistent again; (ii) the
NON-COMPLIANCE entry's own quotation of the damaged text survives at its `-tui` form, preserving the
incident record. Scoping demonstrably held this round: the FAIL entry's "nine sites" observation and the
NON-COMPLIANCE entry's "§ Decision verdict (e) … still reads 'the nine sites'" observation are both
preserved as recorded even though § Decision now reads "eight component sites" — those are exactly the
places an unscoped "fix the record" pass would have rewritten. The `### [RECORD REPAIR] — 2026-09-07` note
alters no verdict, self-labels as not one, and `gate.mjs` parses the log cleanly ("`## Evidence Log`
present with 3 prior entries (none from a later gate)"). No NON-COMPLIANCE trigger fired this run; the
verdict below is a plain FAIL on incomplete work.

**Per-criterion result (27 criteria — 20 mechanical from `node scripts/harness/gate.mjs judge --gate
GATE-WRITE --doc <this> --lane L2 --date 2026-09-07 --dry-run`, re-run this session, which reported
"gate GATE-WRITE (lane L2): 27 criteria judged — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN" and wrote no entry;
the 7 semantic criteria judged here independently, not carried over):**

- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS (mechanical) — `gate.mjs` observed "file begins with a `---` frontmatter block".
- GATE-WRITE — `status: draft` present in frontmatter: PASS (mechanical) — `gate.mjs` observed "`status: draft`".
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: PASS (mechanical) — `gate.mjs` observed "`type: SCREEN` is one of 11 allowed values".
- GATE-WRITE — `tags:` field present in frontmatter: PASS (mechanical) — `gate.mjs` observed "`tags:` present (2 value(s))"; the value is `[cli, a11y]`.
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): PASS — six numbered symptoms, re-verified against this tree in this run rather than carried from the prior entries. `grep -rn "borderStyle" packages/agent-transport-tui/src packages/agent-cli/src` returns exactly 8 lines, matching the eight enumerated sites and the corrected wording "eight component sites"; `InputArea.tsx:315` is `<Text color={borderColor}>{'─'.repeat(innerWidth)}</Text>` and `:290` is `<WaveText text="  Waiting for response... (ESC to interrupt)" />`; `ToolDiffBlock.tsx:24` carries the `│` gutter; `background-task-row-format.ts:7` declares `connector: '├' | '└'` and `:33` assigns it; the ASCII banner is at `App.tsx:454-460` and `SessionStatusBar` is at `App.tsx:581`; `WaveText.tsx:29` is `setInterval(…, MOTION.waveIntervalMs)` with `waveIntervalMs: 400` at `tui-palette.ts:69`; `key-hint-footer.tsx:33` is `export const SELECTION_INDICATOR = '> ';`; `ListPicker.tsx:98,104` are the `↑ … more above` / `↓ … more below` lines; `use-terminal-title.ts:24` is `process.stdout.write(\`\x1b]0;${title}\x07\`)`; `grep -rn "133" packages/agent-transport-tui/src` exits 1; `render-markdown.ts:97-109` is `createTerminalRenderer`, whose only renderer assignment is `renderer.code` at :101. Symptom 6's published command was executed as published — `grep -rniE "screenreader|screen-reader|\ba11y\b|aria-" packages/agent-transport-tui/src packages/agent-cli/src` exits 1 with no output — so both defects the first FAIL recorded against this criterion are now closed.
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): PASS — "Start `robota` under any screen reader on any platform", followed by the ordered observable sequence (banner art announced, input area and status bar re-announced per keystroke and per streaming delta, bordered permission box answerable only by arrow keys, markdown table read as a `│`/`─` grid, no ring on long-tool completion, jump-to-previous-prompt inert for want of an OSC 133 mark) and closing with "There is no flag, env var or setting that changes any of it." The when/where needs no privileged environment, and the closing negative is corroborated by the anchored grep above exiting 1.
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: PASS (mechanical) — `gate.mjs` observed "`## Problem` has no TBD/TODO; 3372 chars, 19 sentences".
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: PASS (mechanical) — `gate.mjs` observed "`## Prior Art Research` section present".
- GATE-WRITE — Section is substantiated (cites ≥1 documentation source, or states none found): PASS (mechanical) — `gate.mjs` observed "`scan-spec-research` reports the section substantiated or explicitly waived"; R1–R18 are cited and the section ends `PRIOR_ART_RESEARCH: FOUND`.
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present: PASS (mechanical, vacuous) — `gate.mjs` observed the same substantiated-or-waived result. Judged N/A on the merits: the opt-out branch does not apply because the preceding substantiation criterion is met on its own (18 documentation references, no waiver claimed). Recorded rather than skipped.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based, not asserted): PASS — the load-bearing external claims were re-checked against the installed dependency this run. `pnpm-lock.yaml:16543` pins `ink@7.1.1`; that package's `readme.md:3009` reads verbatim "To enable it, you can either pass the `isScreenReaderEnabled` option to the `render` function or set the `INK_SCREEN_READER` environment variable to `true`", `readme.md:2650` reads "Default: `process.env['INK_SCREEN_READER'] === 'true'`", `readme.md:2500-2509` documents `useIsScreenReaderEnabled()`, `readme.md:2719-2722` gives `alternateScreen` "Default: `false`", and `build/components/Box.d.ts:17` declares exactly 18 `aria-role` values (button, checkbox, combobox, list, listbox, listitem, menu, menuitem, option, progressbar, radio, radiogroup, tab, tablist, table, textbox, timer, toolbar) — matching constraint 1's "18 values including `listbox`, `option`, `menu`, `progressbar`, `table`". The feed is directional and visible, not asserted: § 3's convergence counts decide verdicts (a) (`--screen-reader` on the 2/3-vs-1/3 split), (d) (resolved from § 3's named auto-detection conflict), (i) and (p) (single-reference numbers demoted to locally-measured defaults / a named constant), and § 5's recommendation is carried into Alternative 1; Alternative 3 exists only because Ink reads `INK_SCREEN_READER` itself.
- GATE-WRITE — All 4 Architecture Review checklist items are `[x]`: PASS (mechanical) — `gate.mjs` observed "5/5 checklist items `[x]`".
- GATE-WRITE — Sibling scan item is `[x]` with completion evidence or explicit `N/A: <reason>`: PASS (mechanical) — `gate.mjs` observed "Sibling scan `[x]` with completion evidence".
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: PASS (mechanical) — `gate.mjs` observed "3 numbered alternatives, each with Pro and Con".
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — § Decision names the trade-off comparatively, on both sides of one axis: "Alternative 2 buys byte-level control at the price of a second renderer that must be kept in step with every future TUI change, while Alternative 1's cost is mechanical breadth — one branch in each of ~20 components — that the existing per-component test files already cover and that Ink's ARIA vocabulary shrinks further", and disposes of Alternative 3 as "not a smaller version of the feature but a different, much smaller one". Its supporting citations check out: `render.tsx:134` is `toChannelOptions` with the ARCH-110 containment comment at :138-139, `render.tsx:196` is the `isInteractiveColorTerminal()` gate, `render.tsx:217` opens `render(<App …`, and `StatusBar.tsx:112-114` is `shouldShowPermissionMode` returning `permissionMode !== 'default'`. Verdict (e)'s "nine sites" defect is fixed — line 202 now reads "the eight component sites", matching the tree's eight `borderStyle` occurrences. ONE NON-DECIDING DEFECT REMAINS, not touching the trade-off: verdict (f) still calls `render-markdown.ts:115` "the single choke point" for a `renderer.table` override, but `:115` is `export function renderMarkdown(md: string, options: IRenderMarkdownOptions = {}): string {` — the renderer is constructed in `createTerminalRenderer` at `:97-109`, which § Solution item 9 names correctly. The prior NON-COMPLIANCE's required-action item 4 asked for this and it was not applied.
- GATE-WRITE — New-surface placement (conditional): PASS as N/A, evidenced rather than asserted. The conditional does not fire: no new package, app, presentation or interface surface, and no layer / product-family reclassification. The four new TUI modules (`screen-reader-context.tsx`, `screen-reader-labels.ts`, `terminal-marks.ts`, `attention-bell.ts`) are intra-package files in the existing `packages/agent-transport-tui/src`, and the three siblings the N/A names — `terminal-capabilities.ts`, `status-glyph.ts`, `use-terminal-title.ts` — were each confirmed present in that directory this run. The fifth new module, `packages/agent-cli/src/startup/screen-reader-enablement.ts`, mirrors `packages/agent-cli/src/startup/memory-enablement.ts`, confirmed present in the same directory. No new package dependency edge. The (a)/(b) sub-requirements are inapplicable for want of a new surface, not unanswered.
- GATE-WRITE — Every Completion Criteria item has a `TC-N` prefix: PASS (mechanical) — `gate.mjs` observed "19 criteria, all `TC-NN:` prefixed".
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: **FAIL** — the four sub-items that decided the prior FAIL are now covered, but a fifth adopted feature, not previously flagged, has no criterion at all. RESOLVED THIS ROUND, each verified: § Solution item 12 → TC-16, running the existing `src/__tests__/status-bar.test.tsx` against the `default`-hiding gate at `StatusBar.tsx:112-114`; banner suppression → TC-17, whose separate-criterion rationale is factually correct (`sed -n '454,460p' App.tsx | grep -c "[│─╭╮╰╯┌┐└┘]"` returns 0, so TC-11's box-drawing sweep genuinely cannot see the banner, whose glyphs are `_ | \ / <`); the advisory hint's positive case → TC-18, asserting the positive plus two negatives with the literal identical to § Solution item 4's `[Screen reader mode: off — run with --screen-reader]`; static spinners → TC-19, naming the existing `streaming-indicator.test.tsx` and `wave-text.test.tsx` (both present) against `WaveText.tsx:29`'s `setInterval(…, MOTION.waveIntervalMs)` with `waveIntervalMs: 400` at `tui-palette.ts:69`. Counts still agree: 19 criteria ↔ 19 Test Plan rows. OUTSTANDING: § Decision verdict (i) — "two tunable pacing waits | **Adapt** | Adopt both, tunable via `ROBOTA_SCREEN_READER_STARTUP_QUIET_MS` and `ROBOTA_SCREEN_READER_PREPARK_MS` with R1's caps (600000 / 5000) as sanity bounds, but Robota-measured defaults" — is an adopted feature with no criterion, no § Solution item, and no § Affected Files entry. Term search for `PREPARK|QUIET_MS|pacing|wait|delay` returns zero hits in § Solution (lines 267-314), zero in § Completion Criteria + § Test Plan (lines 348-452), and inside § Architecture Review only the Decision row itself plus Alternative 1's prose "labels, pacing, bell, OSC 133". It is not deferred: the § Architecture Review not-in-scope list names colourblind/reduced-motion, auto-detection beyond the hint, `--print`/headless, the VS Code/GUI surfaces and per-turn cost — not the pacing waits — and this document uses "Reject for v1, with reason" (verdict l) and "N/A" (verdict n) where it means non-delivery, so "Adapt" reads as delivered. Three candidates judged NOT uncovered, stated rather than skipped: verdict (g) (native scrollback) is declared already-true and its invariant is guarded by the existing `src/__tests__/pty/screen-010-scrollback.ptytest.ts`, which asserts committed history reaches native scrollback and which TC-11 exercises as its default-off control; `printHelp()` gaining a line is a sub-clause of § Solution item 2 whose behaviour — the flag turning the mode on — is asserted end to end by TC-11/TC-12; gutter/connector suppression (`ToolDiffBlock.tsx:24,31` `│`, `background-task-row-format.ts:7,33` `'├' | '└'`) needs no separate criterion because, unlike the banner, `│` and `└` are both inside TC-11's sweep set.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): PASS — the filter defect that decided the first FAIL stays fixed, and the four new criteria carry the correct filter. `pnpm --filter @robota-sdk/agent-transport-tui exec pwd` was run this session and resolves to `/private/tmp/robota-worktrees/cli-2004-screen-reader/packages/agent-transport-tui`; that package's `package.json` declares `"name": "@robota-sdk/agent-transport-tui"` and `"test:pty": "vitest run --config vitest.pty.config.ts"`. All eleven filter-bearing criteria name `-tui` (TC-02 :356, TC-04 :364, TC-05 :368, TC-06 :372, TC-08 :380, TC-10 :387, TC-11 :390, TC-13 :398, TC-16 :401, TC-17 :405, TC-19 :414), as does the § User Execution Test Scenarios automated equivalent (:462); TC-03, TC-07, TC-09, TC-12 and TC-18 inherit by "same file". Not one occurrence of the bare `@robota-sdk/agent-transport` survives in the document body — every remaining occurrence (lines 510, 522, 523, 561, 571, 577, 590, 597) sits inside § Evidence Log as a recorded finding. Every named EXISTING file exists: `status-bar.test.tsx`, `streaming-indicator.test.tsx`, `wave-text.test.tsx`, `render-markdown.test.ts`, `palette-consistency.test.ts`, `status-glyph.test.ts`, `safe-text-boundary.test.tsx`, and the two pty fixtures TC-11 models itself on; the six "new" files are correctly absent; `packages/agent-cli/src/startup/__tests__/` exists for TC-01; TC-14's two SPEC.md targets exist; TC-15's flags are parsed by `run-all-scans.mjs` (`--skip` :1758, `--context` :1782, `--affected` :1790) with the `--skip dist --skip build-contracts` pairing documented at :166. Each of the 19 criteria states an exit code or a concrete observable string. ONE NON-DECIDING IMPRECISION: TC-16's prose says "`SessionStatusBar` renders the permission mode", but the `default`-hiding gate is in `StatusBar.tsx:112-114` and the file TC-16 runs (`status-bar.test.tsx`) renders `<StatusBar>`; `SessionStatusBar.tsx:27` is a wrapper that passes `permissionMode` straight into `StatusBar`, so the stated observable is true at the composite level and the command is runnable — the criterion is imprecise about the component, not vague about the behaviour.
- GATE-WRITE — No criterion uses "works correctly"/"no errors"/"implemented"/"displays correctly": PASS (mechanical) — `gate.mjs` observed "none of \"works correctly\", \"no errors\", \"implemented\", \"displays correctly\" appears".
- GATE-WRITE — `## Test Plan` section present: PASS (mechanical) — `gate.mjs` observed "`## Test Plan` present".
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): PASS (mechanical) — `gate.mjs` observed "19 Test Plan rows = 19 TC criteria"; the four new criteria each gained a row (TC-16, TC-17, TC-18, TC-19).
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): PASS (mechanical) — `gate.mjs` observed "19 rows with Test Type and Tool, no TBD".
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry: PASS (mechanical, vacuous) — `gate.mjs` observed "0 manual row(s), each with Notes". Judged N/A on the merits: no Test Plan row names "manual" as its Tool/Approach (the 19 rows use vitest, `ink-testing-library`, `test:pty`, `grep` and `run-all-scans.mjs`); the manual confirmation described in § User Execution Test Scenarios is scoped there, not to a Test Plan row. Recorded rather than skipped.
- GATE-WRITE — Tasks section present with placeholder: PASS (mechanical) — `gate.mjs` observed "`## Tasks` present".
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): PASS (mechanical) — `gate.mjs` observed "`## Evidence Log` present with 3 prior entries (none from a later gate)"; the emptiness requirement is scoped by the criterion's own "(first GATE-WRITE run)" qualifier and this is the third run. Observation for the next gate, not a failure here: the third of those three is the `### [RECORD REPAIR] — 2026-09-07` note, which is not one of the catalogue's three declared entry forms; it self-labels "Not a gate verdict", alters no verdict, and `gate.mjs` parses the log around it without complaint.
- GATE-WRITE — No `## Status` or `## Classification` sections in the body: PASS (mechanical) — `gate.mjs` observed "no `## Status` / `## Classification` body sections".

**Failed criteria:**

- At least 1 criterion per distinct feature or sub-item: found § Decision verdict (i) — "two tunable pacing waits", verdict **Adapt**, adopting `ROBOTA_SCREEN_READER_STARTUP_QUIET_MS` and `ROBOTA_SCREEN_READER_PREPARK_MS` with caps 600000 / 5000 and locally measured defaults — carried by no Completion Criterion, no § Solution item and no § Affected Files entry, while not appearing in the § Architecture Review not-in-scope list and not carrying a "Reject for v1" or "N/A" verdict. Required was at least one criterion per adopted feature. The four sub-items that decided the previous FAIL (§ Solution item 12, banner suppression, the advisory hint's positive case, static spinners) are now covered by TC-16, TC-17, TC-18 and TC-19 with matching Test Plan rows, all verified.
  **Required action:** Either (a) add a § Solution item, the § Affected Files entries and at least one TC-N (with its Test Plan row) covering the two pacing waits — their env-var names, their caps, and their default values as observable behaviour — or (b) if they are not v1 work, change verdict (i) to the document's own non-delivery form ("Reject for v1, with reason", as verdict (l) does) and add them to the § Architecture Review not-in-scope list, so the Decision register and the criteria agree. Then re-run GATE-WRITE.

**Defects recorded but not gate-deciding** (fix alongside the above):

- § Decision verdict (f) still cites `render-markdown.ts:115` as "the single choke point" for a `renderer.table` override; `:115` is `export function renderMarkdown(…)`, and the renderer is constructed in `createTerminalRenderer` at `:97-109`, which § Solution item 9 names correctly. This was item 4 of the previous entry's required action and was not applied.
- TC-16 names `SessionStatusBar` for a behaviour whose gate is `StatusBar.tsx:112-114` and whose named test file renders `<StatusBar>`; `SessionStatusBar` is the wrapper at `SessionStatusBar.tsx:27`.
- § Affected Files (:323) still annotates `src/__tests__/screen-reader-render-options.test.ts` as "new (TC-02, TC-03)"; TC-17 and TC-18 now also target that file.

**Judged at:** HEAD `754c9e239eec0a1622334c9f7b022f9dd64f01c1` · base `origin/develop@754c9e239eec0a1622334c9f7b022f9dd64f01c1` · document `.agents/spec-docs/draft/CLI-2004-tui-screen-reader-mode.md` blob `1ac67f34893a680f0ae7df24f9ebc112706cec4b` (untracked)

### [GATE-WRITE] — ❌ FAIL | 2026-09-07

**Status remains:** draft

**Ordering check:** SATISFIED; the prior-gate half is exempt. GATE-WRITE is the entry gate
(gate-catalogue.md § Prior-gate map: "GATE-WRITE has no prior status gate (it is the entry gate)"), so no
prior-gate PASS is required and none was sought. Input state matches: `status: draft` and `lane: L2` in
frontmatter, document at `.agents/spec-docs/draft/CLI-2004-tui-screen-reader-mode.md`, and the log carries
GATE-WRITE material only — no entry from a later gate. No implementation preceded this gate: all fourteen
paths § Affected Files marks "new" (`screen-reader-enablement.ts` + its test, `screen-reader-render-options.test.ts`,
`screen-reader-context.tsx`, `screen-reader-labels.ts` + its test, `terminal-marks.ts`,
`screen-reader-pacing.ts` + its test, `attention-bell.ts`, `attention-bell-and-marks.test.ts`,
`screen-reader-menus.test.tsx`, `screen-reader-input.test.tsx`, `pty/screen-reader-mode.ptytest.ts`) were
each tested for existence and all fourteen are absent, and `git status --porcelain` reports exactly the two
untracked planning artifacts. No NON-COMPLIANCE trigger fired.

**Record-integrity check (the 2026-09-07 🔴 NON-COMPLIANCE, and this round's edit): all four prior entries
are byte-intact — re-verified here independently, not carried from the entry above.** (i) The repaired line
was round-tripped again from scratch: applying the known damaging substitution
(`@robota-sdk/agent-transport exec` → `…-tui exec`, `@robota-sdk/agent-transport test:pty` → `…-tui test:pty`)
to the ❌ FAIL entry's current per-criterion line for "Each criterion uses Command form or Observable behavior
form" reproduces, character for character, the damaged text the 🔴 NON-COMPLIANCE entry quotes in its
**Violation** paragraph; that line carries the bare `` `pnpm --filter @robota-sdk/agent-transport exec vitest
run src/__tests__/…` `` and `` `pnpm --filter @robota-sdk/agent-transport test:pty -- …` `` and no `-tui`
form. (ii) Every bare `@robota-sdk/agent-transport` occurrence in the document now sits at or below the
`## Evidence Log` heading (line 493) — none survives in the body. (iii) This round's two body edits were
checked for the same overreach and did not leak: § Decision verdict (f) and § Solution 9 now read
`render-markdown.ts:97-109`, while the three Evidence Log observations of the old `:115` citation
(🔴 NON-COMPLIANCE per-criterion line, its required-action item 4, and the ❌ FAIL entry's non-deciding defect
list) are preserved verbatim; likewise the seven "nine sites" observations remain inside the log although the
body reads "eight component sites", and the two older entries still record the superseded counts ("15 criteria
↔ 15 rows", "19 criteria ↔ 19 Test Plan rows") and the pre-renumbering label "§ Solution item 12 (StatusBar…)"
as observed. (iv) `gate.mjs` parses the log cleanly: "`## Evidence Log` present with 4 prior entries (none
from a later gate)". The `### [RECORD REPAIR] — 2026-09-07` note is still not one of the catalogue's three
declared entry forms; it self-labels "Not a gate verdict", alters no verdict, and is recorded here as an
observation for the next gate, not as a failure of this one.

**Per-criterion result (27 criteria — 20 mechanical from `node scripts/harness/gate.mjs judge --gate
GATE-WRITE --doc <this> --lane L2 --date 2026-09-07 --dry-run`, re-run this session, which reported
"gate GATE-WRITE (lane L2): 27 criteria judged — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN" and wrote no entry;
the 7 semantic criteria judged here independently, not carried over):**

- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS (mechanical) — `gate.mjs` observed "file begins with a `---` frontmatter block".
- GATE-WRITE — `status: draft` present in frontmatter: PASS (mechanical) — `gate.mjs` observed "`status: draft`".
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: PASS (mechanical) — `gate.mjs` observed "`type: SCREEN` is one of 11 allowed values".
- GATE-WRITE — `tags:` field present in frontmatter: PASS (mechanical) — `gate.mjs` observed "`tags:` present (2 value(s))"; the value is `[cli, a11y]`.
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): PASS — six numbered symptoms, each citation re-executed against this tree in this run. `grep -rn "borderStyle" packages/agent-transport-tui/src packages/agent-cli/src` returns exactly 8 lines and they are exactly the eight enumerated sites (`MenuSelect.tsx:93`, `ContextWarningBanner.tsx:17`, `PermissionPrompt.tsx:80`, `ConfirmPrompt.tsx:72`, `TextPrompt.tsx:66`, `ExecutionWorkspaceSwitcher.tsx:65`, `SlashAutocomplete.tsx:106`, `MultiSelectList.tsx:97`), matching the wording "eight component sites"; `App.tsx:450` opens `<Static items={staticItems}>` and the ASCII banner occupies `:454-460`, drawn from `_ | \ / < ( )` only; `StatusBar.tsx:112-114` is `shouldShowPermissionMode` returning `permissionMode !== 'default'`; `render-markdown.ts:97` is `function createTerminalRenderer(...)`, closing at `:109`, whose only renderer assignment is `renderer.code` (`renderer.table` untouched). Symptom 6's command was run exactly as published — `grep -rniE "screenreader|screen-reader|\ba11y\b|aria-" packages/agent-transport-tui/src packages/agent-cli/src` exits 1 with no output — and `grep -rn "133" packages/agent-transport-tui/src` also exits 1, so the OSC-133 negative holds.
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): PASS — "Start `robota` under any screen reader on any platform", followed by the ordered observable sequence (banner art announced; input area and status bar re-announced on every keystroke and every streaming delta; a bordered permission box answerable only with arrow keys; a markdown table read as a `│`/`─` grid; nothing ringing when a long tool finishes; jump-to-previous-prompt inert for want of an OSC 133 mark) and closing "There is no flag, env var or setting that changes any of it." No privileged environment or credential is required, and the closing negative is corroborated by the anchored grep above exiting 1.
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: PASS (mechanical) — `gate.mjs` observed "`## Problem` has no TBD/TODO; 3372 chars, 19 sentences".
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: PASS (mechanical) — `gate.mjs` observed "`## Prior Art Research` section present".
- GATE-WRITE — Section is substantiated (cites ≥1 documentation source, or states none found): PASS (mechanical) — `gate.mjs` observed "`scan-spec-research` reports the section substantiated or explicitly waived"; R1–R18 are cited and the section ends `PRIOR_ART_RESEARCH: FOUND`.
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present: PASS (mechanical, vacuous) — `gate.mjs` observed the same substantiated-or-waived result. Judged N/A on the merits: the opt-out branch does not apply, because the preceding substantiation criterion is met on its own (18 documentation references, no waiver claimed). Recorded rather than skipped.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): PASS — the load-bearing external claims were re-checked against the installed package this run. This worktree has no `node_modules`, so the check was made against the same pinned version in the main checkout: `pnpm-lock.yaml:16543` pins `ink@7.1.1` here, and `ink@7.1.1`'s `readme.md:3009` reads verbatim "To enable it, you can either pass the `isScreenReaderEnabled` option to the `render` function or set the `INK_SCREEN_READER` environment variable to `true`", `readme.md:2650` reads "Default: `process.env['INK_SCREEN_READER'] === 'true'`", `readme.md:2500` documents `useIsScreenReaderEnabled()`, `readme.md:2719-2722` gives `alternateScreen` "Default: `false`", and `build/components/Box.d.ts:17` declares exactly 18 `aria-role` values (button, checkbox, combobox, list, listbox, listitem, menu, menuitem, option, progressbar, radio, radiogroup, tab, tablist, table, textbox, timer, toolbar) beside `aria-label`, `aria-hidden` and `aria-state` — matching constraint 1 clause for clause. The feed is directional rather than decorative: § 3's convergence counts decide verdicts (a) (`--screen-reader` on the 2/3-vs-1/3 split), (d) (resolved from § 3's named auto-detection conflict), (i) and (p) (single-reference numbers demoted to locally-measured defaults / a named constant); § 5's recommendation is carried into Alternative 1; Alternative 3 exists only because Ink reads `INK_SCREEN_READER` itself. Verdict (a)'s divergence claim also checks out in-tree: `memory-enablement.ts:90-104` applies the env override last (env wins) and `agent-cli/docs/SPEC.md:583` states "**env wins over settings and flag**", which is the precedent the verdict says it inverts.
- GATE-WRITE — All 4 Architecture Review checklist items are `[x]`: PASS (mechanical) — `gate.mjs` observed "5/5 checklist items `[x]`".
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: PASS (mechanical) — `gate.mjs` observed "Sibling scan `[x]` with completion evidence".
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: PASS (mechanical) — `gate.mjs` observed "3 numbered alternatives, each with Pro and Con".
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — § Decision names the trade-off comparatively, on both sides of one axis: "Alternative 2 buys byte-level control at the price of a second renderer that must be kept in step with every future TUI change, while Alternative 1's cost is mechanical breadth — one branch in each of ~20 components — that the existing per-component test files already cover and that Ink's ARIA vocabulary shrinks further", and disposes of Alternative 3 as "not a smaller version of the feature but a different, much smaller one". The prior entry's one outstanding non-deciding defect is now CLOSED and was verified line by line: verdict (f) reads "`createTerminalRenderer` (`render-markdown.ts:97-109`, which today assigns only `renderer.code`); every caller reaches it through the single `renderMarkdown` entry point at `:115`", and in the file `:97` is `function createTerminalRenderer(color: boolean, codeBlockWidth: number | undefined): Renderer {`, `:109` is its closing brace, and `:115` is `export function renderMarkdown(md: string, options: IRenderMarkdownOptions = {}): string {` — so both halves of the citation are now exact, and § Solution 9 agrees. Verdict (e)'s "eight component sites" also still matches the tree's eight `borderStyle` occurrences. No defect remains against this criterion.
- GATE-WRITE — New-surface placement (conditional): PASS as N/A, evidenced rather than asserted. The conditional does not fire: no new package, app, presentation or interface surface is introduced and no layer / product-family boundary is reclassified. The five new TUI modules (`screen-reader-context.tsx`, `screen-reader-labels.ts`, `terminal-marks.ts`, `attention-bell.ts`, and this round's `screen-reader-pacing.ts`) are intra-package files in the existing `packages/agent-transport-tui/src`, and the three siblings the checklist names — `terminal-capabilities.ts`, `status-glyph.ts`, `use-terminal-title.ts` — were each confirmed present in that directory this run; `screen-reader-pacing.ts` is placed beside them under the same rule and needs no new placement argument. The sixth new module, `packages/agent-cli/src/startup/screen-reader-enablement.ts`, mirrors `packages/agent-cli/src/startup/memory-enablement.ts`, confirmed present in the same directory. No new package dependency edge. The (a)/(b) sub-requirements are inapplicable for want of a new surface, not unanswered.
- GATE-WRITE — Every Completion Criteria item has a `TC-N` prefix: PASS (mechanical) — `gate.mjs` observed "20 criteria, all `TC-NN:` prefixed".
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: **FAIL** — verdict (i) is resolved, but a full re-sweep of § Decision's verdict table (a)–(r) against § Solution, § Affected Files and § Completion Criteria finds one adopted behaviour still carried by nothing. RESOLVED THIS ROUND: § Decision verdict (i) ("two tunable pacing waits", **Adapt**) now has § Solution item 12 "Pacing waits" (`screen-reader-pacing.ts`, `resolvePacing(env)`, both env vars, `0` = immediate, the 600000 / 5000 bounds with the clamp reported on stderr, measured defaults), two § Affected Files entries (`src/screen-reader-pacing.ts` — new; `src/__tests__/screen-reader-pacing.test.ts` — new (TC-20)), and TC-20 with a matching Test Plan row asserting the defaults, an explicit `0`, both clamps, a non-numeric value and the mode-off case, with a RED condition; the renumbering to items 13/14 is consistent with TC-16 (StatusBar) and TC-14 (docs). Counts agree at 20 criteria ↔ 20 Test Plan rows. OUTSTANDING: § Decision verdict (j) ("changed characters only while typing", **Adapt**) states that in the mode "the mode omits the borders and **the status bar's volatile fields** so the changed region is the input line itself". The borders half is delivered (§ Solution 5, asserted by TC-10: "in the mode `InputArea` renders no `─` rule line and no `borderStyle`"). The status-bar half is delivered by nothing: a term sweep of § Solution + § Affected Files + § Completion Criteria + § Test Plan (document lines 260-470) for `volatile|activity|context (percent|window)|token|StatusActivity|ContextText` returns ZERO hits, and the two volatile fields in that bar are real — `StatusBar.tsx:61` `StatusActivityText` and `:84` `ContextText` both render inside the live region `App.tsx:581` that § Problem symptom 2 names as repainting. The only status-bar work the document plans runs the other way: § Solution item 13 and TC-16 make the bar render the permission mode **unconditionally** in the mode, and § Affected Files annotates `StatusBar.tsx` as "always render the mode" only. Nothing reconciles the two, so an implementer following § Solution would leave the volatile fields repainting — the exact symptom verdict (j) is adopted to remove — and no criterion would catch it. Judged NOT uncovered, stated rather than skipped: (b) → § Solution 1 + TC-01's `=0`-with-`screenReader:true` case; (c) → § Solution 4 + TC-03 + TC-12; (d) → § Solution 4 + TC-18 (positive) + TC-03 (negative); (e) → § Solution 5 + TC-10/TC-11/TC-13/TC-17/TC-19; (f) → § Solution 9 + TC-04; (g) is declared already-true ("not new work") and its invariant is guarded by the existing `src/__tests__/pty/screen-010-scrollback.ptytest.ts`, confirmed present, which § Decision's capability-preservation bullet binds TC-11 to; (h) → § Solution 6 + TC-05 + TC-11; (k) → § Solution 8 + TC-10; (l) → § Solution 13 + TC-16; (m)/(o) → § Solution 7 + TC-06/TC-07; (n) is a decided **N/A** with no delivery claim; (p) → § Solution 10 + TC-08; (q) → § Solution 11 + TC-09/TC-11/TC-14; (r) → § Solution 14 + TC-14; (a) → § Solution 1/2/14 + TC-01/TC-12/TC-14. Also judged non-deciding rather than skipped: § Solution 12's two runtime clauses — "a keypress ends the startup wait early" and the pre-write park "moves the cursor to column 0" — are asserted by no criterion (TC-20 exercises the pure resolver only), but they are clauses of a sub-item that now has a criterion and neither is a separate adopted line in the verdict table, so they are recorded below rather than counted here.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): PASS — every command was checked for runnability, not read. `pnpm --filter @robota-sdk/agent-transport-tui exec pwd` was executed this session and resolves to `/private/tmp/robota-worktrees/cli-2004-screen-reader/packages/agent-transport-tui`; that package's `package.json` declares `"name": "@robota-sdk/agent-transport-tui"` and `"test:pty": "vitest run --config vitest.pty.config.ts"`, so TC-11's script lookup succeeds. All twelve filter-bearing criteria name `-tui` (TC-02, TC-04, TC-05, TC-06, TC-08, TC-10, TC-11, TC-13, TC-16, TC-17, TC-19, TC-20) as does the § User Execution Test Scenarios automated equivalent; TC-03, TC-07, TC-09, TC-12 and TC-18 inherit by "same file"; TC-01 targets `@robota-sdk/agent-cli`, whose `src/startup/__tests__/` directory exists. Not one bare `@robota-sdk/agent-transport` survives in the body. Every named EXISTING file exists (`status-bar.test.tsx`, `streaming-indicator.test.tsx`, `wave-text.test.tsx`, `render-markdown.test.ts`, `palette-consistency.test.ts`, `status-glyph.test.ts`, `safe-text-boundary.test.tsx`, `pty/screen-006-no-color.ptytest.ts`, `pty/screen-010-scrollback.ptytest.ts`, both `docs/SPEC.md` targets of TC-14); all fourteen files marked "new" are correctly absent. TC-15's flags are parsed by `run-all-scans.mjs`, with the `--skip dist --skip build-contracts` pairing documented at `:166`. TC-20 is command-form and observable: a named command, `exits 0`, and five enumerated assertions with concrete values (`999999`→`600000`, `99999`→`5000`, stderr reporting, non-numeric handling, mode-off) plus a RED condition. Each of the 20 criteria states an exit code or a concrete observable string.
- GATE-WRITE — No criterion uses "works correctly"/"no errors"/"implemented"/"displays correctly": PASS (mechanical) — `gate.mjs` observed "none of \"works correctly\", \"no errors\", \"implemented\", \"displays correctly\" appears".
- GATE-WRITE — `## Test Plan` section present: PASS (mechanical) — `gate.mjs` observed "`## Test Plan` present".
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): PASS (mechanical) — `gate.mjs` observed "20 Test Plan rows = 20 TC criteria"; independently, the TC-ID sets extracted from § Completion Criteria and from the § Test Plan rows are both exactly TC-01…TC-20, so the new TC-20 gained its row.
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): PASS (mechanical) — `gate.mjs` observed "20 rows with Test Type and Tool, no TBD".
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry: PASS (mechanical, vacuous) — `gate.mjs` observed "0 manual row(s), each with Notes". Judged N/A on the merits: no Test Plan row names "manual" as its Tool/Approach (the 20 rows use vitest, `ink-testing-library`, `test:pty`, `grep` and `run-all-scans.mjs`); the manual confirmation described in § User Execution Test Scenarios is scoped there, not to a Test Plan row. Recorded rather than skipped.
- GATE-WRITE — Tasks section present with placeholder: PASS (mechanical) — `gate.mjs` observed "`## Tasks` present".
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): PASS (mechanical) — `gate.mjs` observed "`## Evidence Log` present with 4 prior entries (none from a later gate)"; the emptiness requirement is scoped by the criterion's own "(first GATE-WRITE run)" qualifier and this is the fourth run.
- GATE-WRITE — No `## Status` or `## Classification` sections in the body: PASS (mechanical) — `gate.mjs` observed "no `## Status` / `## Classification` body sections".

**Failed criteria:**

- At least 1 criterion per distinct feature or sub-item: found § Decision verdict (j) — "changed characters only while typing", verdict **Adapt** — claiming the mode "omits the borders and the status bar's volatile fields", where only the borders half is carried by § Solution (item 5) and by a criterion (TC-10). The status-bar half has no § Solution item, no § Affected Files entry describing it (the only `StatusBar.tsx` entry reads "always render the mode") and no criterion; the sweep of lines 260-470 for `volatile|activity|context (percent|window)|token|StatusActivity|ContextText` returns zero hits, while `StatusBar.tsx:61` `StatusActivityText` and `:84` `ContextText` are the volatile fields in question and sit in the live region `App.tsx:581` that § Problem symptom 2 names. § Solution item 13 and TC-16 move the same component the other way (render the permission mode unconditionally) without reconciling the two. Required was at least one criterion per adopted feature.
  **Required action:** Either (a) add the § Solution clause, the § Affected Files annotation and at least one TC-N with its Test Plan row asserting which status-bar fields the mode suppresses (naming them as observable output, and stating how that composes with TC-16's always-rendered permission mode), or (b) if suppressing them is not v1 work, narrow verdict (j)'s reason to the borders half that § Solution 5 and TC-10 do deliver, so the Decision register and the criteria agree. Then re-run GATE-WRITE.

**Defects recorded but not gate-deciding** (fix alongside the above):

- § Solution item 12's two runtime clauses are asserted by no criterion: "A keypress ends the startup wait early" and the pre-write park that "moves the cursor to column 0". TC-20 exercises `resolvePacing`'s numbers only, so neither observable would be caught.
- TC-16 names `SessionStatusBar` for a behaviour whose gate is `StatusBar.tsx:112-114` (`shouldShowPermissionMode`) and whose named test file renders `<StatusBar>`; `SessionStatusBar` is the wrapper. Carried over from the prior entry, still unapplied.
- § Affected Files still annotates `src/__tests__/screen-reader-render-options.test.ts` as "new (TC-02, TC-03)"; TC-17 and TC-18 now also target that file. Carried over from the prior entry, still unapplied.
- The `### [RECORD REPAIR] — 2026-09-07` note is not one of the three entry forms gate-catalogue.md § Evidence Log Entry Format declares. It self-labels "Not a gate verdict", alters no verdict, and `gate.mjs` parses the log around it; recorded so a later gate is not surprised by it.

**Judged at:** HEAD `754c9e239eec0a1622334c9f7b022f9dd64f01c1` · base `origin/develop@754c9e239eec0a1622334c9f7b022f9dd64f01c1` · document `.agents/spec-docs/draft/CLI-2004-tui-screen-reader-mode.md` blob `792c42334922581d8a469bc200df192ece9dc53f` (untracked)

### [GATE-WRITE] — ❌ FAIL | 2026-09-07

**Status remains:** draft

**Ordering check:** SATISFIED; the prior-gate half is exempt. GATE-WRITE is the entry gate
(gate-catalogue.md § Prior-gate map: "GATE-WRITE has no prior status gate (it is the entry gate)"), so no
prior-gate PASS is required and none was sought. Input state matches what this gate expects: `status: draft`
and `lane: L2` in frontmatter, document at `.agents/spec-docs/draft/CLI-2004-tui-screen-reader-mode.md`, and
the log carries GATE-WRITE material only — no entry from a later gate. No implementation preceded this gate:
each of the fourteen paths § Affected Files marks "new" was tested for existence and all fourteen are absent
(`screen-reader-enablement.ts` + its test, `screen-reader-render-options.test.ts`, `screen-reader-context.tsx`,
`screen-reader-labels.ts` + its test, `terminal-marks.ts`, `screen-reader-pacing.ts` + its test,
`attention-bell.ts`, `attention-bell-and-marks.test.ts`, `screen-reader-menus.test.tsx`,
`screen-reader-input.test.tsx`, `pty/screen-reader-mode.ptytest.ts`), and `git status --porcelain` reports
exactly the two untracked planning artifacts. No NON-COMPLIANCE trigger fired.

**Record-integrity check (the 2026-09-07 🔴 NON-COMPLIANCE, and this round's edit): all four gate entries
and the repair note are byte-intact — re-verified from scratch here, not carried from the entry above.**
(i) Structure: the log holds exactly five `### [` headings in recorded order (`❌ FAIL` :512, `🔴 NON-COMPLIANCE`
:569, `[RECORD REPAIR]` :619, `❌ FAIL` :646, `❌ FAIL` :727), four `**Judged at:**` lines, four
`**Status remains:** draft` lines, and exactly 27 `- GATE-WRITE — ` per-criterion lines in each of the four
gate entries. (ii) The repair was round-tripped mechanically once more: applying the known damaging
substitution (`@robota-sdk/agent-transport exec` → `…-tui exec`, `@robota-sdk/agent-transport test:pty` →
`…-tui test:pty`) to the first ❌ FAIL entry's per-criterion line for "Each criterion uses Command form or
Observable behavior form" yields a 218-character fragment that compares **byte-identical** to the fragment the
🔴 NON-COMPLIANCE entry quotes in its **Violation** paragraph. (iii) This round's five body edits were each
tested for the overreach that caused the original violation, and none leaked: every bare
`@robota-sdk/agent-transport` occurrence (lines 611, 624, 631, 663, 664, 666, 671, 746, 749, 750, 751), every
"nine sites" occurrence (530, 563, 590, 614, 638, 639, 673, 674, 700, 756) and every `render-markdown.ts:115`
occurrence (590, 614, 700, 721) sits at or below the `## Evidence Log` heading (line 510) while the body reads
"eight component sites" and `:97-109`. The two strings this round's edits would have hit under a global
substitution both survive in the log in their pre-edit form: `SessionStatusBar` at :722 and :805 (the two
entries' "TC-16 names `SessionStatusBar`" observations) although TC-16 now reads `StatusBar`, and
`new (TC-02, TC-03)` at :723 and :806 although § Affected Files :338 now reads `(TC-02, TC-03, TC-17, TC-18)`.
The superseded counts are likewise preserved as recorded ("15 criteria" :544/:547/:556, "19 criteria"
:702-:704, "20 criteria" :785-:787). (iv) `gate.mjs` parses the log cleanly: "`## Evidence Log` present with 5
prior entries (none from a later gate)". No record damage this round.

**Per-criterion result (27 criteria — 20 mechanical from `node scripts/harness/gate.mjs judge --gate
GATE-WRITE --doc <this> --lane L2 --date 2026-09-07 --dry-run`, re-run this session, which reported
"gate GATE-WRITE (lane L2): 27 criteria judged — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN" and wrote no entry;
the 7 semantic criteria judged here independently, not carried over):**

- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS (mechanical) — `gate.mjs` observed "file begins with a `---` frontmatter block".
- GATE-WRITE — `status: draft` present in frontmatter: PASS (mechanical) — `gate.mjs` observed "`status: draft`".
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: PASS (mechanical) — `gate.mjs` observed "`type: SCREEN` is one of 11 allowed values".
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): PASS (mechanical) — `gate.mjs` observed "`tags:` present (2 value(s))"; the value is `[cli, a11y]`.
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): PASS — six numbered symptoms, every citation re-executed against this tree in this run rather than carried from a prior entry. `grep -rn "borderStyle" packages/agent-transport-tui/src packages/agent-cli/src` returns exactly 8 lines and they are exactly the eight enumerated sites (`MenuSelect.tsx:93`, `ContextWarningBanner.tsx:17`, `PermissionPrompt.tsx:80`, `ConfirmPrompt.tsx:72`, `TextPrompt.tsx:66`, `SlashAutocomplete.tsx:106`, `ExecutionWorkspaceSwitcher.tsx:65`, `MultiSelectList.tsx:97`), matching the wording "eight component sites"; `InputArea.tsx:315` is `<Text color={borderColor}>{'─'.repeat(innerWidth)}</Text>` and `:290` is `<WaveText text="  Waiting for response... (ESC to interrupt)" />`; `ToolDiffBlock.tsx:24,31` carry the `│` gutter; `background-task-row-format.ts:7` declares `connector: '├' | '└'` with `:33` and `:40` assigning it; `App.tsx:450` opens `<Static items={staticItems}>` closing at `:467`, the ASCII banner occupies `:454-460`, and `SessionStatusBar` is at `:581`; `WaveText.tsx:29` is `}, MOTION.waveIntervalMs);` with `waveIntervalMs: 400` at `tui-palette.ts:69`; `key-hint-footer.tsx:33` is `export const SELECTION_INDICATOR = '> ';`; `ListPicker.tsx:98,104` are the `↑ … more above` / `↓ … more below` lines; `use-terminal-title.ts:24` is `process.stdout.write(\`\x1b]0;${title}\x07\`)`; `render-markdown.ts:97` is `function createTerminalRenderer(...)` closing at `:109`, whose only renderer assignment is `renderer.code` at `:101`. Symptom 6's published command was run exactly as published — `grep -rniE "screenreader|screen-reader|\ba11y\b|aria-" packages/agent-transport-tui/src packages/agent-cli/src` exits 1 with no output — as does `grep -rn "133" packages/agent-transport-tui/src`, so the OSC-133 negative holds; the playground announcer exists at the cited path with `SCREEN_READER_DELAY_MS = 100` (`:3`) and `aria-live` (`:29`).
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): PASS — "Start `robota` under any screen reader on any platform", followed by the ordered observable sequence (banner art announced; the whole input area and status bar re-announced on every keystroke and every streaming delta; a bordered permission box whose selected row differs only by a `> ` prefix and a colour, answerable only with arrow keys; a markdown table read as a `│`/`─` grid; nothing ringing when a long tool finishes; jump-to-previous-prompt inert for want of an OSC 133 mark) and closing "There is no flag, env var or setting that changes any of it." The when/where is unambiguous, needs no privileged environment or credential, and the closing negative is corroborated by the anchored grep above exiting 1.
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: PASS (mechanical) — `gate.mjs` observed "`## Problem` has no TBD/TODO; 3372 chars, 19 sentences".
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: PASS (mechanical) — `gate.mjs` observed "`## Prior Art Research` section present".
- GATE-WRITE — Section is substantiated (cites ≥1 documentation source, or states none found): PASS (mechanical) — `gate.mjs` observed "`scan-spec-research` reports the section substantiated or explicitly waived"; R1–R18 are cited and the section ends `PRIOR_ART_RESEARCH: FOUND`.
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present: PASS (mechanical, vacuous) — `gate.mjs` observed the same substantiated-or-waived result. Judged N/A on the merits: the opt-out branch does not apply because the preceding substantiation criterion is met on its own (18 documentation references, no waiver claimed). Recorded rather than skipped.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): PASS — the load-bearing external claims were re-checked against the installed package this run, not taken on the document's word. This worktree has no `node_modules`, so the check was made against the same pinned version in the main checkout: `pnpm-lock.yaml:16543` pins `ink@7.1.1` here, and that package's `readme.md:3009` reads verbatim "To enable it, you can either pass the `isScreenReaderEnabled` option to the `render` function or set the `INK_SCREEN_READER` environment variable to `true`", `readme.md:2650` reads "Default: `process.env['INK_SCREEN_READER'] === 'true'`", `readme.md:2500` documents `useIsScreenReaderEnabled()`, `readme.md:2719-2722` gives `alternateScreen` "Type: `boolean` / Default: `false`", and `build/components/Box.d.ts:17` declares exactly 18 `aria-role` values (button, checkbox, combobox, list, listbox, listitem, menu, menuitem, option, progressbar, radio, radiogroup, tab, tablist, table, textbox, timer, toolbar) — matching constraint 1's "18 values including `listbox`, `option`, `menu`, `progressbar`, `table`" clause for clause. The feed is directional rather than decorative: § 3's convergence counts decide verdicts (a) (`--screen-reader` on the 2/3-vs-1/3 split), (d) (resolved from § 3's named auto-detection conflict), (i) and (p) (single-reference numbers demoted to locally-measured defaults / a named constant); § 5's recommendation is carried into Alternative 1; Alternative 3 exists only because Ink reads `INK_SCREEN_READER` itself. Verdict (a)'s in-tree divergence claim also checks out: `memory-enablement.ts:90-104` applies the env override last, after the flag, and `agent-cli/docs/SPEC.md:583` states "**env wins over settings and flag**" — the precedent the verdict says it inverts.
- GATE-WRITE — All 4 checklist items are `[x]`: PASS (mechanical) — `gate.mjs` observed "5/5 checklist items `[x]`".
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: PASS (mechanical) — `gate.mjs` observed "Sibling scan `[x]` with completion evidence".
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: PASS (mechanical) — `gate.mjs` observed "3 numbered alternatives, each with Pro and Con".
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — § Decision names the trade-off comparatively, on both sides of one axis: "Alternative 2 buys byte-level control at the price of a second renderer that must be kept in step with every future TUI change, while Alternative 1's cost is mechanical breadth — one branch in each of ~20 components — that the existing per-component test files already cover and that Ink's ARIA vocabulary shrinks further", and disposes of Alternative 3 as "not a smaller version of the feature but a different, much smaller one". Its supporting citations were re-checked line by line and all hold: `render.tsx:134` is `export function toChannelOptions(` with the ARCH-110 containment comment at `:138-139` ("This hand-maintained projection can silently omit optional composition-root capabilities such as orgPolicy"), `render.tsx:196` is the `if (!isInteractiveColorTerminal()) {` gate, `render.tsx:217` opens `const instance = render(`, `StatusBar.tsx:112-114` is `shouldShowPermissionMode` returning `permissionMode !== 'default'`, and verdict (f)'s corrected citation is exact in both halves (`:97` `function createTerminalRenderer(...)`, `:109` its closing brace, `:115` `export function renderMarkdown(...)`), agreeing with § Solution 9. Verdict (e)'s "eight component sites" matches the tree's eight `borderStyle` occurrences. No defect remains against this criterion.
- GATE-WRITE — **New-surface placement (conditional):** PASS as **N/A**, evidenced rather than asserted. The conditional does not fire: no new package, app, presentation or interface surface is introduced and no layer / product-family boundary is reclassified. The five new TUI modules (`screen-reader-context.tsx`, `screen-reader-labels.ts`, `terminal-marks.ts`, `attention-bell.ts`, `screen-reader-pacing.ts`) are intra-package files in the existing `packages/agent-transport-tui/src`, and the three siblings the checklist names — `terminal-capabilities.ts`, `status-glyph.ts`, `use-terminal-title.ts` — were each confirmed present in that same directory this run. The sixth new module, `packages/agent-cli/src/startup/screen-reader-enablement.ts`, mirrors `packages/agent-cli/src/startup/memory-enablement.ts`, confirmed present in the same directory. This round added no module and no directory: `SessionStatusBar.tsx` is an existing file newly listed in § Affected Files, not a new surface. No new package dependency edge — every consumer already sits in a package depending on Ink and on the TUI package. The (a)/(b) sub-requirements are inapplicable for want of a new surface, not unanswered.
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …): PASS (mechanical) — `gate.mjs` observed "21 criteria, all `TC-NN:` prefixed".
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: **FAIL** — verdict (j) is resolved, but the exhaustive re-sweep of § Decision's verdict table (a)–(r) against § Solution, § Affected Files, § Completion Criteria and § Test Plan finds one adopted line whose named deliverable is carried by nothing. RESOLVED THIS ROUND, verified: verdict (j) now names the two volatile fields and states the reconciling rule ("Volatile vs stable is the line, not visible vs hidden"), and both halves are carried — § Solution 13 names `StatusActivityText` (`StatusBar.tsx:61`), `ContextText` (`:84`), `shouldShowPermissionMode` (`:112-114`), `PresetText`, and `SessionStatusBar.tsx:27` as the pass-through, all five citations exact in the tree; § Affected Files carries the rewritten `StatusBar.tsx` entry ("render the mode unconditionally; suppress `StatusActivityText` and `ContextText`") and the new `SessionStatusBar.tsx` entry; TC-21 asserts both halves in one test with a RED condition and has a matching Test Plan row; counts agree at 21 criteria ↔ 21 rows. The prior entry's non-deciding list is also cleared: TC-20 now asserts the keypress early-exit and the column-0 park, TC-16 reads `StatusBar` (reached through `SessionStatusBar`), and the `screen-reader-render-options.test.ts` annotation reads `(TC-02, TC-03, TC-17, TC-18)`. **OUTSTANDING: verdict (g)** — "native scrollback, no alternate screen | **Adopt (already true)** | Ink's `alternateScreen` defaults to `false` and nothing sets it; this becomes a guarded invariant **with a test**, not new work" (`:204`). The named deliverable is the guard, and no artifact carries it: a term sweep of § Solution + § Affected Files + § Completion Criteria + § Test Plan (lines 267-487) for `scrollback|alternateScreen|1049|screen-010` returns ZERO hits. The only claim of a guard is § Decision's capability-preservation bullet (`:226-227`), "every byte of today's output is unchanged, which TC-11 asserts against the existing `screen-010-scrollback` and `screen-006-no-color` pty fixtures" — but TC-11 (`:408-412`) names neither fixture and asserts only box-drawing absence, `assistant:`, `raw()` containing `\x1b]133;A`, and "the same fixture without the flag still contains the border characters"; its Test Plan row names `screen-006-no-color.ptytest.ts` as the file TC-11 is "modelled on", not as an assertion target. Nor can the existing fixture serve as the mode's guard implicitly: `src/__tests__/pty/screen-010-scrollback.ptytest.ts` spawns the binary with no flag (`spawnTui({ projectDir, homeDir, rows: 16 })`, `:39`) and its assertions depend on the boot banner (`:54`, `v\d+\.\d+\.\d+`) and on `StatusActivityText`'s `Idle` (`:42`, `:62`) — the two outputs TC-17 and TC-21 require the mode to suppress. Ink's own README states the stake at `readme.md:2725` ("The terminal's scrollback buffer is not available while in the alternate screen"), and § Prior Art constraint 2 names the risk as "regression, not absence" — which is precisely what a guard would catch and nothing here would. (g) is not deferred: the § Architecture Review not-in-scope list (`:154-159`) names colourblind/reduced-motion, auto-detection beyond the hint, `--print`/headless, the VS Code/GUI surfaces and per-turn cost — not (g) — and this document uses "Reject for v1, with reason" (l) and "N/A" (n) where it means non-delivery. The document's own convention makes the omission sharper: verdict (e) uses the identical "already met → becomes a regression assertion" construction and DOES get a criterion, TC-13, which names `palette-consistency.test.ts` and `status-glyph.test.ts` explicitly. Judged NOT uncovered, stated rather than skipped: (a) → § Solution 1/2/14 + TC-01/TC-12/TC-14; (b) → § Solution 1 + TC-01's `=0`-with-`screenReader:true` case; (c) → § Solution 4 + TC-03 + TC-12; (d) → § Solution 4 + TC-18 (positive) + TC-03 (negative); (e) → § Solution 5 + TC-07/TC-10/TC-11/TC-13/TC-17/TC-19; (f) → § Solution 9 + TC-04; (h) → § Solution 6 + TC-05 + TC-11; (i) → § Solution 12 + TC-20; (j) → § Solution 5/13 + TC-10/TC-16/TC-21; (k) → § Solution 8 + TC-10; (l) → § Solution 13 + TC-16; (m)/(o) → § Solution 7 + TC-06/TC-07; (n) is a decided **N/A** with no delivery claim; (p) → § Solution 10 + TC-08; (q) → § Solution 11 + TC-09/TC-11/TC-14; (r) → § Solution 14 + TC-14.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): PASS — every command was checked for runnability, not read. `pnpm --filter @robota-sdk/agent-transport-tui exec pwd` resolves to `/private/tmp/robota-worktrees/cli-2004-screen-reader/packages/agent-transport-tui`; that package's `package.json:2` declares `"name": "@robota-sdk/agent-transport-tui"` and `:46` declares `"test:pty": "vitest run --config vitest.pty.config.ts"`, so TC-11's script lookup succeeds. All thirteen filter-bearing criteria name `-tui` (TC-02, TC-04, TC-05, TC-06, TC-08, TC-10, TC-11, TC-13, TC-16, TC-17, TC-19, TC-20, TC-21) as does the § User Execution Test Scenarios automated equivalent; TC-03, TC-07, TC-09, TC-12 and TC-18 inherit by "same file"; TC-01 targets `@robota-sdk/agent-cli`, whose `src/startup/__tests__/` directory exists. Not one bare `@robota-sdk/agent-transport` survives in the body. Every named EXISTING file exists (`status-bar.test.tsx`, `streaming-indicator.test.tsx`, `wave-text.test.tsx`, `render-markdown.test.ts`, `palette-consistency.test.ts`, `status-glyph.test.ts`, `safe-text-boundary.test.tsx`, `pty/screen-006-no-color.ptytest.ts`, `pty/screen-010-scrollback.ptytest.ts`, both `docs/SPEC.md` targets of TC-14); all fourteen files marked "new" are correctly absent. TC-15's flags are parsed by `run-all-scans.mjs` with the `--skip dist --skip build-contracts` pairing documented at `:166`. The two criteria this round changed are both command-form and observable: TC-21 names the command, `exits 0`, four concrete field observables (`StatusActivityText`'s output and `ContextText`'s percentage absent; permission mode including `default` and the preset id present), the outside-the-mode control and a RED condition; TC-20 adds two concrete runtime observables ("a keypress delivered during the startup wait settles it before its deadline", "the pre-write park emits a column-0 move before the waited write") to its five numeric assertions. Each of the 21 criteria states an exit code or a concrete observable string.
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": PASS (mechanical) — `gate.mjs` observed "none of \"works correctly\", \"no errors\", \"implemented\", \"displays correctly\" appears".
- GATE-WRITE — `## Test Plan` section present: PASS (mechanical) — `gate.mjs` observed "`## Test Plan` present".
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): PASS (mechanical) — `gate.mjs` observed "21 Test Plan rows = 21 TC criteria"; independently, the TC-ID sets extracted from § Completion Criteria and from the § Test Plan rows are both exactly TC-01…TC-21, so the new TC-21 gained its row.
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): PASS (mechanical) — `gate.mjs` observed "21 rows with Test Type and Tool, no TBD".
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: PASS (mechanical, vacuous) — `gate.mjs` observed "0 manual row(s), each with Notes". Judged N/A on the merits: no Test Plan row names "manual" as its Tool/Approach (the 21 rows use vitest, `ink-testing-library`, `test:pty`, `grep` and `run-all-scans.mjs`); the manual confirmation described in § User Execution Test Scenarios is scoped there, not to a Test Plan row. Recorded rather than skipped.
- GATE-WRITE — Tasks section present with placeholder: PASS (mechanical) — `gate.mjs` observed "`## Tasks` present".
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): PASS (mechanical) — `gate.mjs` observed "`## Evidence Log` present with 5 prior entries (none from a later gate)"; the emptiness requirement is scoped by the criterion's own "(first GATE-WRITE run)" qualifier and this is the fifth run. Disposition of the `### [RECORD REPAIR] — 2026-09-07` note, asked of this gate rather than left silent: it is correctly retained and should NOT be reshaped into one of the three declared forms. gate-catalogue.md § Evidence Log Entry Format declares three forms for **gate verdicts**; this note self-labels "Not a gate verdict", records no criterion result and asserts no status transition, so rewriting it as `✅ PASS` / `❌ FAIL` / `🔴 NON-COMPLIANCE` would manufacture a fifth verdict that no gate run produced — a worse defect than the undeclared shape, and deleting it would destroy the audit trail of the very NON-COMPLIANCE it documents. One consequence is recorded for the next gate rather than charged here: `gate.mjs` counts it as an entry ("5 prior entries"), so a `[RECORD REPAIR]` note appearing LAST in a log would be read by the prior-gate ordering check's default last-entry rule; it is not last here, so nothing is affected. The catalogue's silence on a non-verdict annotation is a gap in the catalogue, and AGENTS.md's amendment path (a filed backlog item proposing a declared fourth, non-verdict form) is where it belongs — not an edit to this document.
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): PASS (mechanical) — `gate.mjs` observed "no `## Status` / `## Classification` body sections".

**Failed criteria:**

- At least 1 criterion per distinct feature or sub-item: found § Decision verdict (g) — "native scrollback, no alternate screen", verdict **Adopt (already true)**, whose stated deliverable is that the invariant "becomes a guarded invariant with a test" — carried by no § Solution item, no § Affected Files entry, no Completion Criterion and no Test Plan row (`scrollback|alternateScreen|1049|screen-010` returns zero hits across lines 267-487). The only guard claim is § Decision's capability-preservation bullet at `:226-227` asserting that TC-11 "asserts against the existing `screen-010-scrollback` and `screen-006-no-color` pty fixtures"; TC-11 at `:408-412` names neither and asserts only box-drawing absence, `assistant:`, `\x1b]133;A` and the border-characters-without-the-flag control. The existing `pty/screen-010-scrollback.ptytest.ts` cannot stand in: it spawns without the flag and asserts on the boot banner (`:54`) and on `StatusActivityText`'s `Idle` (`:42`, `:62`), the two outputs TC-17 and TC-21 require the mode to suppress. (g) is neither in the not-in-scope list nor marked "Reject for v1" or "N/A", so it reads as delivered. Required was at least one criterion per adopted feature.
  **Required action:** Either (a) add at least one TC-N with its Test Plan row asserting the invariant under the mode — the concrete form matching this document's own TC-13 convention is a criterion naming `src/__tests__/pty/screen-010-scrollback.ptytest.ts` and asserting, in a `--screen-reader` run, that `raw()` contains no `\x1b[?1049h` and that committed history still reaches native scrollback with the input pinned — and reconcile § Decision's capability-preservation bullet with what TC-11 actually asserts; or (b) if guarding it is not v1 work, narrow verdict (g)'s reason to the already-true observation without the "with a test" delivery claim and drop the fixture names from the capability-preservation bullet, so the Decision register and the criteria agree. Then re-run GATE-WRITE.

**Defects recorded but not gate-deciding** (the complete remaining list, swept in one pass so no further round-trip is spent finding them one at a time):

- § Test Plan row TC-16 (`:479`) still reads "Solution 12 — the permission mode is always spoken in the mode". After this round's renumbering § Solution 12 is "Pacing waits" and the status bar is § Solution 13; TC-21's row (`:483`) correctly reads "Solution 13 / verdict (j)". Stale pointer only — TC-16's own text names the behaviour correctly.
- § Solution 13 names "`PresetText` and the model id" as the stable fields kept; TC-21 asserts the preset id and says "outside the mode all four render exactly as today", so the model id (`ProviderText` / `modelName`, `StatusBar.tsx:132-145`) is a named-kept field asserted by no criterion.
- § Decision's capability-preservation bullet (`:226`) claims TC-11 asserts "every byte of today's output is unchanged"; TC-11's actual default-off assertion is only that the same fixture without the flag "still contains the border characters". Recorded separately from the failed criterion because it would remain even if verdict (g) were narrowed under route (b).
- Verdict (k) and § Solution 8 both say "word/line" deletion emits `[deleted: <text>]`; TC-10 asserts the word case only.
- § Solution 7 says "a non-numeric or out-of-range entry re-prints the same literal"; TC-06 asserts the out-of-range case (`9`) only.
- Verdict (p) says `LONG_TOOL_BELL_MS` is "documented as tunable", but § Solution 14's docs list does not include it and TC-14 does not require it.
- § Solution 14 lists the label vocabulary and the numbered-list contract as SPEC content; TC-14 requires only the grep match, the "Known limitations" subsection and the precedence/divergence.
- § Solution 2's "`printHelp()` gains a line" has no criterion (carried from prior entries; the flag's behaviour is asserted end to end by TC-11/TC-12).
- `background-task-row-format.ts:7`'s `├` connector is outside TC-11's sweep set `│ ─ ╭ ╮ ╰ ╯ ┌ ┐ └ ┘`; `│` and `└` are inside it, so the gutter/connector sub-item is partially covered.
- § Affected Files lists `TextPrompt.tsx` under "borderless + numbered-list branches", but § Solution 7's `NumberedList` consumer list excludes it — it is a bordered prompt, not a menu, so the annotation over-describes.
- Verdict (d) names two distinct advisory triggers (a non-`true` `INK_SCREEN_READER`, and an `NVDA`/`JAWS`/`VOICEOVER`-shaped env hint on a TTY); TC-18 asserts "a reader-shaped environment hint" without distinguishing them.

**Judged at:** HEAD `754c9e239eec0a1622334c9f7b022f9dd64f01c1` · base `origin/develop@754c9e239eec0a1622334c9f7b022f9dd64f01c1` · document `.agents/spec-docs/draft/CLI-2004-tui-screen-reader-mode.md` blob `9b323a6a70382b0e98f166669283ade69dc33501` (untracked)

### [GATE-WRITE] — ✅ PASS | 2026-09-07

**Status upgrade:** draft → review-ready

**Ordering check:** SATISFIED; the prior-gate half is exempt. GATE-WRITE is the entry gate (gate-catalogue.md § Prior-gate map: "GATE-WRITE has no prior status gate (it is the entry gate)"), so no prior-gate PASS is required and none was sought. Input state matches what this gate expects: `status: draft` and `lane: L2` in frontmatter, document at `.agents/spec-docs/draft/CLI-2004-tui-screen-reader-mode.md`, and the log carries GATE-WRITE material only — five `[GATE-WRITE]` verdicts and one `[RECORD REPAIR]` note, no entry from a later gate. No implementation preceded this gate: each of the fourteen paths § Affected Files marks "new" (`screen-reader-enablement.ts` + its test, `screen-reader-render-options.test.ts`, `screen-reader-context.tsx`, `screen-reader-labels.ts` + its test, `terminal-marks.ts`, `screen-reader-pacing.ts` + its test, `attention-bell.ts`, `attention-bell-and-marks.test.ts`, `screen-reader-menus.test.tsx`, `screen-reader-input.test.tsx`, `pty/screen-reader-mode.ptytest.ts`) was tested for existence this run and all fourteen are absent, and `git status --porcelain` over the whole worktree reports exactly the two untracked planning artifacts (`?? .agents/spec-docs/draft/CLI-2004-tui-screen-reader-mode.md`, `?? .agents/tasks/CLI-2004-tui-screen-reader-mode.md`). No NON-COMPLIANCE trigger fired.

**Record-integrity check (the 2026-09-07 🔴 NON-COMPLIANCE, and this round's edits): all five gate entries and the repair note are intact — re-verified from scratch here, not carried from the entry above.** (i) Structure: the log holds exactly six `### [` headings in recorded order (`❌ FAIL` :537, `🔴 NON-COMPLIANCE` :594, `[RECORD REPAIR]` :644, `❌ FAIL` :671, `❌ FAIL` :752, `❌ FAIL` :836), five `**Judged at:**` lines, five `**Status remains:** draft` lines, and exactly 27 `- GATE-WRITE — ` per-criterion lines in each of the five gate entries. (ii) Every position the previous entry recorded sits at exactly +25 lines — the five headings (:512→:537, :569→:594, :619→:644, :646→:671, :727→:752), all eleven bare `@robota-sdk/agent-transport` occurrences (611,624,631,663,664,666,671,746,749,750,751 → 636,649,656,688,689,691,696,771,774,775,776), all ten "nine sites" occurrences, all four `render-markdown.ts:115` occurrences and both `new (TC-02, TC-03)` occurrences (:723/:806 → :748/:831) — a uniform shift that only body insertions above the log produce; nothing inside the log moved relative to anything else. (iii) The repair was round-tripped mechanically once more: applying the known damaging substitution (`@robota-sdk/agent-transport exec` → `…-tui exec`, `@robota-sdk/agent-transport test:pty` → `…-tui test:pty`) to the first ❌ FAIL entry's per-criterion line for "Each criterion uses Command form or Observable behavior form" yields a fragment byte-identical to the one the 🔴 NON-COMPLIANCE entry quotes in its **Violation** paragraph (223 bytes each side). (iv) This round's five body edits did not leak into the log: the superseded capability-preservation wording "every byte of today's output is unchanged" survives only in the log (:896, :916) while the body bullet (:225-232) is rewritten; the previous entry's "`scrollback|alternateScreen|1049|screen-010` returns ZERO hits" observations survive at :811/:896 while the body now carries fifteen such hits (§ Decision :226-230, § Solution 15 :335-341, § Affected Files :378, TC-22 :473-480, Test Plan :511); and the previous entry's non-deciding observations (`Solution 12 — the permission mode` at :914, `SessionStatusBar` at :747/:830) are preserved as recorded. (v) `gate.mjs` parses the log cleanly: "`## Evidence Log` present with 6 prior entries (none from a later gate)". The previous entry's blob `9b323a6a…` is not in the object store (the document is untracked), so — as in every prior round — integrity is established structurally, not by diff. No record damage this round.

**Body edits this round, inventoried against the previous entry:** § Decision capability-preservation bullet rewritten (:225-232, +5 lines) to bind default-off to the two flagless pty fixtures and TC-11's border control, and native scrollback to TC-22; § Solution item 15 "Scrollback / alternate-screen invariant guard (verdict (g))" added (:334-343); § Affected Files entry for `src/__tests__/pty/screen-010-scrollback.ptytest.ts` — TC-22 case added (:378); TC-22 added (:473-480); Test Plan row TC-22 added (:511). None of the previous entry's ten non-deciding defects was applied (see below).

**Per-criterion result (27 criteria — 20 mechanical from `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this> --lane L2 --date 2026-09-07 --dry-run`, run this session, which reported "gate GATE-WRITE (lane L2): 27 criteria judged — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN" and wrote no entry (blob unchanged at `b434ea8b…` after the run); the 7 semantic criteria judged here independently, not carried over):**

- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS (mechanical) — `gate.mjs` observed "file begins with a `---` frontmatter block".
- GATE-WRITE — `status: draft` present in frontmatter: PASS (mechanical) — `gate.mjs` observed "`status: draft`".
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: PASS (mechanical) — `gate.mjs` observed "`type: SCREEN` is one of 11 allowed values".
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): PASS (mechanical) — `gate.mjs` observed "`tags:` present (2 value(s))"; the value is `[cli, a11y]`.
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): PASS — six numbered symptoms, every citation re-executed against this tree in this run rather than carried from a prior entry. `grep -rn "borderStyle" packages/agent-transport-tui/src packages/agent-cli/src` returns exactly 8 lines and they are exactly the eight enumerated sites (`MenuSelect.tsx:93`, `ContextWarningBanner.tsx:17`, `PermissionPrompt.tsx:80`, `ConfirmPrompt.tsx:72`, `TextPrompt.tsx:66`, `ExecutionWorkspaceSwitcher.tsx:65`, `SlashAutocomplete.tsx:106`, `MultiSelectList.tsx:97`), matching "eight component sites"; `InputArea.tsx:315` is `<Text color={borderColor}>{'─'.repeat(innerWidth)}</Text>` and `:290` is `<WaveText text="  Waiting for response... (ESC to interrupt)" />`; `ToolDiffBlock.tsx:24,31` carry the `│` gutter; `background-task-row-format.ts:7` declares `connector: '├' | '└'` with `:33` and `:40` assigning it; `App.tsx` is 602 lines, `:450` opens `<Static items={staticItems}>` closing at `:467`, the ASCII banner occupies `:454-460` (drawn from `_ | \ / < ( )`; `grep -c "[│─╭╮╰╯┌┐└┘]"` over those lines returns 0), the live region opens at `:468` and closes at `:599`, and `SessionStatusBar` is at `:581`; `WaveText.tsx:25-31` is the `setInterval(…, MOTION.waveIntervalMs)` effect with `waveIntervalMs: 400` at `tui-palette.ts:69`; `key-hint-footer.tsx:33` is `export const SELECTION_INDICATOR = '> ';`; `ListPicker.tsx:98,104` are the `↑ … more above` / `↓ … more below` lines; `use-terminal-title.ts:24` is `process.stdout.write(\`\x1b]0;${title}\x07\`)`; `render-markdown.ts:97` is `function createTerminalRenderer(...)` closing at `:109`, whose only renderer assignment is `renderer.code` at `:101`. Symptom 6's published command was run exactly as published — `grep -rniE "screenreader|screen-reader|\ba11y\b|aria-" packages/agent-transport-tui/src packages/agent-cli/src` exits 1 with no output — as does `grep -rn "133" packages/agent-transport-tui/src`, so the OSC-133 negative holds; the playground announcer exists at the cited path with `SCREEN_READER_DELAY_MS = 100` (`:3`) and `aria-live` (`:29`).
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): PASS — "Start `robota` under any screen reader on any platform", followed by the ordered observable sequence (banner art announced; the whole input area and status bar re-announced on every keystroke and every streaming delta; a bordered permission box whose selected row differs only by a `> ` prefix and a colour, answerable only with arrow keys; a markdown table read as a `│`/`─` grid; nothing ringing when a long tool finishes; jump-to-previous-prompt inert for want of an OSC 133 mark) and closing "There is no flag, env var or setting that changes any of it." The when/where is unambiguous, needs no privileged environment or credential, and the closing negative is corroborated by the anchored grep above exiting 1.
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: PASS (mechanical) — `gate.mjs` observed "`## Problem` has no TBD/TODO; 3372 chars, 19 sentences"; independently, no `TBD`/`TODO` token exists anywhere above `## Evidence Log`.
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: PASS (mechanical) — `gate.mjs` observed "`## Prior Art Research` section present".
- GATE-WRITE — Section is substantiated (cites ≥1 documentation source, or states none found): PASS (mechanical) — `gate.mjs` observed "`scan-spec-research` reports the section substantiated or explicitly waived"; R1–R18 are cited and the section ends `PRIOR_ART_RESEARCH: FOUND`.
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present: PASS (mechanical, vacuous) — `gate.mjs` observed the same substantiated-or-waived result. Judged N/A on the merits: the opt-out branch does not apply because the preceding substantiation criterion is met on its own (18 documentation references, no waiver claimed). Recorded rather than skipped.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): PASS — the load-bearing external claims were re-checked against the installed package this run, not taken on the document's word. This worktree has no `node_modules`, so the check was made against the same pinned version in the main checkout: `pnpm-lock.yaml:16543` pins `/ink@7.1.1(...)` here, and that package's `readme.md:3009` reads verbatim "To enable it, you can either pass the `isScreenReaderEnabled` option to the `render` function or set the `INK_SCREEN_READER` environment variable to `true`", `readme.md:2650` reads "Default: `process.env['INK_SCREEN_READER'] === 'true'`" (and `build/render.d.ts:52` carries the same `@default`), `readme.md:2500` documents `useIsScreenReaderEnabled()`, `readme.md:2719-2722` gives `alternateScreen` "Type: `boolean` / Default: `false`", and `build/components/Box.d.ts:17` declares exactly 18 `aria-role` values (button, checkbox, combobox, list, listbox, listitem, menu, menuitem, option, progressbar, radio, radiogroup, tab, tablist, table, textbox, timer, toolbar) — matching constraint 1's "18 values including `listbox`, `option`, `menu`, `progressbar`, `table`" clause for clause. Constraint 2's negative holds: the only `1049h` in either src tree is the input fixture string at `sec-019-terminal-sanitizer.test.ts:40`, not a write, and no `alternateScreen` option is set. The feed is directional rather than decorative: § 3's convergence counts decide verdicts (a) (`--screen-reader` on the 2/3-vs-1/3 split), (d) (resolved from § 3's named auto-detection conflict), (i) and (p) (single-reference numbers demoted to locally-measured defaults / a named constant); § 5's recommendation is carried into Alternative 1; Alternative 3 exists only because Ink reads `INK_SCREEN_READER` itself. Verdict (a)'s in-tree divergence claim also checks out: `memory-enablement.ts:90-104` applies the `ROBOTA_MEMORY` override last, after the flag, and `agent-cli/docs/SPEC.md:583` states "**env wins over settings and flag**" — the precedent the verdict says it inverts.
- GATE-WRITE — All 4 checklist items are `[x]`: PASS (mechanical) — `gate.mjs` observed "5/5 checklist items `[x]`".
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: PASS (mechanical) — `gate.mjs` observed "Sibling scan `[x]` with completion evidence". Substantively corroborated this run: SCREEN-004/005/006/007/008/009/010 all exist under `.agents/tasks/completed/` with titles matching the item's characterisations, SCREEN-006 and SCREEN-010 are `done` spec documents, and SCREEN-009's quoted "no color-only state found" is verbatim at `.agents/tasks/completed/SCREEN-009-tui-color-only-audit.md:14` with `status-glyph.test.ts` named as its floor at `:22`.
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: PASS (mechanical) — `gate.mjs` observed "3 numbered alternatives, each with Pro and Con".
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS — § Decision names the trade-off comparatively, on both sides of one axis: "Alternative 2 buys byte-level control at the price of a second renderer that must be kept in step with every future TUI change, while Alternative 1's cost is mechanical breadth — one branch in each of ~20 components — that the existing per-component test files already cover and that Ink's ARIA vocabulary shrinks further", and disposes of Alternative 3 as "not a smaller version of the feature but a different, much smaller one". Its supporting citations were re-checked line by line and all hold: `render.tsx:134` is `export function toChannelOptions(` with the ARCH-110 containment comment at `:138-139`, `render.tsx:196` is `if (!isInteractiveColorTerminal()) {`, `render.tsx:217` opens `const instance = render(` with `{ exitOnCtrlC: false }` at `:233`, `sanitize-terminal-text.ts:107` is the OSC-stripping regex, `scripts/harness/scan-tui-safe-text-boundary.mjs` exists, `docs/SPEC.md:199` opens "Color & Motion Contract (SCREEN-006)" and `:165` the footer-grammar body, `StatusBar.tsx:112-114` is `shouldShowPermissionMode` returning `permissionMode !== 'default'`, verdict (f)'s citation is exact in both halves (`:97` `function createTerminalRenderer(...)`, `:109` its closing brace, `:115` `export function renderMarkdown(...)`), verdict (e)'s "eight component sites" matches the tree, and the verdict (l)/(n) negatives hold (`grep -rniE "shift\+tab|cyclePermissionMode|slider"` over both src trees exits 1; `permission-mode-command-api.ts` exists under `packages/agent-framework/src/command-api/permissions/`). The rewritten capability-preservation bullet's new claims also check out: `screen-010-scrollback.ptytest.ts:39` and `screen-006-no-color.ptytest.ts:73-78,98-102` both spawn without any mode flag (the latter passes only `--session-log` and `env: { NO_COLOR: '1' }`), and the bullet now binds TC-11 to exactly what TC-11 asserts (the border characters in the flagless run) rather than to "every byte". No defect remains against this criterion.
- GATE-WRITE — **New-surface placement (conditional):** PASS as **N/A**, evidenced rather than asserted. The conditional does not fire: no new package, app, presentation or interface surface is introduced and no layer / product-family boundary is reclassified. The five new TUI modules (`screen-reader-context.tsx`, `screen-reader-labels.ts`, `terminal-marks.ts`, `attention-bell.ts`, `screen-reader-pacing.ts`) are intra-package files in the existing `packages/agent-transport-tui/src`, and the three siblings the checklist names — `terminal-capabilities.ts`, `status-glyph.ts`, `use-terminal-title.ts` — were each confirmed present in that directory this run. The sixth new module, `packages/agent-cli/src/startup/screen-reader-enablement.ts`, mirrors `packages/agent-cli/src/startup/memory-enablement.ts`, confirmed present in the same directory. This round added no module and no directory: § Solution 15 is declared "no code change" and its deliverable is a second `it()` in the existing `screen-010-scrollback.ptytest.ts`. No new package dependency edge. The (a)/(b) sub-requirements are inapplicable for want of a new surface, not unanswered.
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …): PASS (mechanical) — `gate.mjs` observed "22 criteria, all `TC-NN:` prefixed".
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: PASS — verdict (g), which decided the previous FAIL, is now carried end to end, and a fresh full sweep finds nothing else uncarried. RESOLVED THIS ROUND, each half verified: § Solution 15 names the guard as the deliverable, cites Ink's `alternateScreen` default (`readme.md:2719-2722`, exact) and the reason the existing case cannot serve — and that reason is true in the fixture: `screen-010-scrollback.ptytest.ts:54` asserts the boot banner (`v\d+\.\d+\.\d+`) and `:42`/`:62` assert `Idle`, the two outputs TC-17 and TC-21 require the mode to suppress; § Affected Files carries the fixture with "TC-22 case"; TC-22 names the command, `exits 0`, `rows: 16` and `/help` (matching the fixture's `:39`/`:45`), the `\x1b[?1049h` negative on `raw()`, the `Available commands|/exit` positive (matching `:47`/`:52`) and the `Type a message` pinned-input ordering (matching `:58-59`), plus the flagless case unchanged and a RED condition; its Test Plan row exists; and the capability-preservation bullet now points at TC-22 for the guard. Full sweep of § Decision verdicts (a)–(r), stated rather than summarised: (a) → § Solution 1/2/14 + TC-01/TC-12/TC-14; (b) → § Solution 1 + TC-01's `=0`-with-`screenReader:true` case; (c) → § Solution 4 + TC-03/TC-12; (d) → § Solution 4 + TC-18 (positive)/TC-03 (negative); (e) → § Solution 5 + TC-07/TC-10/TC-11/TC-13/TC-17/TC-19; (f) → § Solution 9 + TC-04; (g) → § Solution 15 + TC-22; (h) → § Solution 6 + TC-05/TC-11; (i) → § Solution 12 + TC-20; (j) → § Solution 5/13 + TC-10/TC-16/TC-21; (k) → § Solution 8 + TC-10; (l) → § Solution 13 + TC-16; (m)/(o) → § Solution 7 + TC-06/TC-07; (n) is a decided **N/A** with no delivery claim; (p) → § Solution 10 + TC-08; (q) → § Solution 11 + TC-09/TC-11/TC-14; (r) → § Solution 14 + TC-14. Sweep of § Solution 1–15: every item is carried by at least one of the above; item 3 (threading/context) by TC-02 plus every in-mode component test that reads `useScreenReader()`. Sweep of § Architecture Review > Affected Scope and § Affected Files: every listed path maps to a criterion above; `ToolDiffBlock.tsx` / `background-task-row-format.ts` (gutter/connector suppression, which § Solution never describes as its own item) are reached by TC-11's sweep set, which contains `│` and `└` but not `├` — a partial-coverage defect recorded below, not an uncarried sub-item. The not-in-scope list (:154-159) is unchanged and names nothing that is also claimed delivered.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): PASS — every command was checked for runnability, not read. `pnpm --filter @robota-sdk/agent-transport-tui exec pwd` resolves to `/private/tmp/robota-worktrees/cli-2004-screen-reader/packages/agent-transport-tui`; that package's `package.json:2` declares `"name": "@robota-sdk/agent-transport-tui"` and `:46` declares `"test:pty": "vitest run --config vitest.pty.config.ts"`, whose `include` is `src/**/*.ptytest.ts` (`vitest.pty.config.ts:11`), so TC-11 and TC-22 both resolve their script and their file. The new TC-22 is achievable with the existing driver, verified rather than assumed: `pty-driver.ts:79` declares `args?: readonly string[]` ("Extra CLI args appended after the binary"), `:85` `env?`, `:57` `snapshot()`, `:59` `raw()` — so `--screen-reader` can be passed and both `raw()` and `snapshot()` assertions exist as API. All fourteen filter-bearing criteria name `-tui` (TC-02, TC-04, TC-05, TC-06, TC-08, TC-10, TC-11, TC-13, TC-16, TC-17, TC-19, TC-20, TC-21, TC-22) as does the § User Execution Test Scenarios automated equivalent; TC-03, TC-07, TC-09, TC-12 and TC-18 inherit by "same file"; TC-01 targets `@robota-sdk/agent-cli`, whose `src/startup/__tests__/` directory exists. Not one bare `@robota-sdk/agent-transport` survives above `## Evidence Log`. Every named EXISTING file exists (`status-bar.test.tsx`, `streaming-indicator.test.tsx`, `wave-text.test.tsx`, `render-markdown.test.ts`, `palette-consistency.test.ts`, `status-glyph.test.ts`, `safe-text-boundary.test.tsx`, `pty/screen-006-no-color.ptytest.ts`, `pty/screen-010-scrollback.ptytest.ts`, both `docs/SPEC.md` targets of TC-14); all fourteen files marked "new" are correctly absent. TC-15's flags are parsed by `run-all-scans.mjs` (`--skip` :1758, `--context` :1782, `--affected` :1790) with the `--skip dist --skip build-contracts` pairing documented at `:166`. Each of the 22 criteria states an exit code or a concrete observable string, and none of the 22 uses vague language.
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": PASS (mechanical) — `gate.mjs` observed "none of \"works correctly\", \"no errors\", \"implemented\", \"displays correctly\" appears"; an independent case-insensitive grep over § Completion Criteria agrees.
- GATE-WRITE — `## Test Plan` section present: PASS (mechanical) — `gate.mjs` observed "`## Test Plan` present".
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): PASS (mechanical) — `gate.mjs` observed "22 Test Plan rows = 22 TC criteria"; independently, the TC-ID sequence extracted from § Completion Criteria and from the § Test Plan rows is identical in both content and order (TC-01…TC-13, TC-16, TC-17, TC-18, TC-19, TC-21, TC-20, TC-14, TC-15, TC-22), so the new TC-22 gained its row and no ID is duplicated or missing.
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): PASS (mechanical) — `gate.mjs` observed "22 rows with Test Type and Tool, no TBD".
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: PASS (mechanical, vacuous) — `gate.mjs` observed "0 manual row(s), each with Notes"; independently, the token `manual` does not occur anywhere in § Test Plan. Judged N/A on the merits: no Test Plan row names "manual" as its Tool/Approach (the 22 rows use vitest, `ink-testing-library`, `test:pty`, `grep` and `run-all-scans.mjs`); the manual confirmation described in § User Execution Test Scenarios is scoped there, not to a Test Plan row. Recorded rather than skipped.
- GATE-WRITE — Tasks section present with placeholder: PASS (mechanical) — `gate.mjs` observed "`## Tasks` present"; the placeholder names `.agents/tasks/CLI-2004-tui-screen-reader-mode.md` — todo, and that file exists (untracked).
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): PASS (mechanical) — `gate.mjs` observed "`## Evidence Log` present with 6 prior entries (none from a later gate)"; the emptiness requirement is scoped by the criterion's own "(first GATE-WRITE run)" qualifier and this is the sixth run. The `### [RECORD REPAIR] — 2026-09-07` note is retained as the previous entry disposed: it self-labels "Not a gate verdict", alters no verdict, is not the last entry, and `gate.mjs` parses around it.
- GATE-WRITE — No `## Status` or `## Classification` sections in the body (these are frontmatter fields): PASS (mechanical) — `gate.mjs` observed "no `## Status` / `## Classification` body sections"; an independent grep for `^## (Status|Classification)` returns nothing.

**Sections checked and result:** Frontmatter — PASS (4/4). Problem — PASS (3/3). Prior Art Research — PASS (4/4, one vacuous/N/A recorded). Architecture Review — PASS (5/5, New-surface placement N/A with evidence). Completion Criteria — PASS (4/4). Test Plan — PASS (4/4, manual-row criterion N/A recorded). Structure — PASS (3/3). TC-N count confirmed: 22 criteria in § Completion Criteria ↔ 22 rows in § Test Plan, identical ID sets.

**Defects recorded but not gate-deciding** (none blocks GATE-WRITE; all should be fixed before GATE-APPROVAL is sought, since the approver reads these sections as written):

- § Solution 15 cites `readme.md:2725` for "the terminal's scrollback buffer is not available while in the alternate screen"; in `ink@7.1.1` that sentence is at `readme.md:2726` (`:2725` is blank). The quoted words are verbatim.
- § Test Plan row TC-16 (:503) still reads "Solution 12 — the permission mode is always spoken in the mode"; after the renumbering § Solution 12 is "Pacing waits" and the status bar is § Solution 13 (TC-21's row at :507 is correct). Carried over from the previous entry, still unapplied.
- The rewritten capability-preservation bullet (:225-228) claims `screen-006-no-color.ptytest.ts` "keep[s] passing unchanged", but no criterion runs that file (TC-11 is only "modelled on" it, TC-22 runs `screen-010-scrollback` only); the claim is verifiable only if the pty project is run in full at GATE-VERIFY.
- Coverage is partial, not absent, for these sub-clauses: § Solution 13 keeps "the model id" but TC-21 asserts only the permission mode and preset id in-mode; verdict (k)/§ Solution 8 say word/line deletion but TC-10 asserts the word case only; § Solution 7 says a non-numeric entry re-prompts but TC-06 asserts the out-of-range case only; § Solution 9 says "blank line between rows" and TC-04 does not assert it; `background-task-row-format.ts`'s `├` connector is outside TC-11's sweep set (`│` and `└` are inside); verdict (d) names two advisory triggers and TC-18 asserts one unnamed "reader-shaped environment hint".
- Verdict (p) says `LONG_TOOL_BELL_MS` is "documented as tunable" and § Solution 14 lists the label vocabulary and numbered-list contract as SPEC content, but TC-14 requires only the grep match, the "Known limitations" subsection and the precedence/divergence.
- § Solution 2's "`printHelp()` gains a line" has no criterion (the flag's behaviour is asserted end to end by TC-11/TC-12).
- § Affected Files lists `TextPrompt.tsx` under "borderless + numbered-list branches", but § Solution 7's `NumberedList` consumer list excludes it.
- TC-20's "returns the documented defaults" is observable only once `agent-transport-tui/docs/SPEC.md` states the measured numbers; the criterion inherits its expected values from § Solution 14's docs deliverable rather than stating them.

**Observation for the next gates, not a GATE-WRITE finding:** the paired `.agents/tasks/CLI-2004-tui-screen-reader-mode.md` is still the generator placeholder (`status: todo`, `## Objective` TODO, `## Plan` `- [ ] TODO`, `SCENARIO DRAFTED: not-applicable | 0` with a TODO reason) while this document's § User Execution Test Scenarios records `SCENARIO DRAFTED: automatable | 1`; GATE-IMPLEMENT's Task criteria will read the Task, not this document.

**Judged at:** HEAD `754c9e239eec0a1622334c9f7b022f9dd64f01c1` · base `origin/develop@754c9e239eec0a1622334c9f7b022f9dd64f01c1` · document `.agents/spec-docs/draft/CLI-2004-tui-screen-reader-mode.md` blob `b434ea8bd1228018bb97b7d96fc0361169866cd1` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-07

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "#2004, #1990, #1994, #2054 모두 승인"
**Given:** 2026-09-07, this conversation
**Review fingerprint:** 20afaa2116b2 (review 7047507c, type/tags 64532463)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-07, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (20afaa2116b2) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `754c9e239eec` · base `origin/develop@754c9e239eec` · document `.agents/spec-docs/backlog/CLI-2004-tui-screen-reader-mode.md` blob `5cfeb794ebd2` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-07

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "#2004, #1990, #1994, #2054 모두 승인"
**Given:** 2026-09-07, this conversation
**Review fingerprint:** 20afaa2116b2 (review 7047507c, type/tags 64532463)

**Guardian judgement of the semantic set.** The `[GATE-APPROVAL] — ✅ PASS | 2026-09-07` entry immediately above is the record `gate.mjs approve` wrote for the mechanical set (`**Judged by:** gate.mjs mechanical evaluator`). This document is `lane: L2` (frontmatter line 5), so gate-catalogue.md § Gate Criteria dispatches the gate's three `semantic` criteria to `backlog-gate-guard`; this entry is that judgement, made against this document's own text and the tree read in this worktree. The route, instruction, date and fingerprint fields are restated above verbatim from that entry and each re-verified here, because `standingVerdict` (`scan-standing-delegation-evidence.mjs:244`, imported by `gate-operations.mjs:181`) reads the LAST `✅ PASS` GATE-APPROVAL entry as the one the document rests on — a field-less guardian entry would become a standing verdict naming no route. Re-run here read-only: `node scripts/harness/gate.mjs judge --gate GATE-APPROVAL --doc <this> --lane L2 --date 2026-09-07 --dry-run` → "gate GATE-APPROVAL (lane L2): 9 criteria judged — 6 PASS, 0 FAIL, 3 PENDING-GUARDIAN", "no entry written: pending criteria are the guardian's to judge and record", exit 2; document blob `79ee78d1…` unchanged before and after the run.

**Ordering check:** SATISFIED. (1) Prior gate: the LAST `[GATE-WRITE]` entry (line 930, 2026-09-07) is `✅ PASS` with `**Status upgrade:** draft → review-ready`; the four `❌ FAIL` entries, the one `🔴 NON-COMPLIANCE` entry and the `[RECORD REPAIR]` note all precede it, so the Prior-gate map's blank (default) last-entry rule holds. (2) Input state: frontmatter `status: review-ready` (line 2); document at `.agents/spec-docs/backlog/`, the folder `spec-workflow.md` § Spec-Document Status and Lifecycle Folders maps `review-ready` to (line 255). The move from `draft/`, where the GATE-WRITE PASS judged it, to `backlog/` is the transition that PASS authorised. (3) NON-COMPLIANCE trigger — implementation work before this gate — checked by measurement: `git log origin/develop..HEAD` is empty (HEAD = base = `754c9e239eec`); `git status --porcelain` over the whole worktree reports exactly `?? .agents/spec-docs/backlog/CLI-2004-tui-screen-reader-mode.md` and `?? .agents/tasks/CLI-2004-tui-screen-reader-mode.md`; each of the fourteen paths § Affected Files marks "new" was tested for existence and all fourteen are absent; `grep -rniE "screenreader|screen-reader|\ba11y\b|aria-" packages/agent-transport-tui/src packages/agent-cli/src` exits 1 with no output. No work this gate authorises has happened.

**Approved text is the current text, established rather than assumed.** `approve` hashes the document before appending its entry and recorded blob `5cfeb794ebd2`; lines 1–985 of the current file (everything above that entry) hash to `5cfeb794ebd21245bad20fe9a61c29e75092821c` under `git hash-object --stdin`, so the ONLY change since the approval was recorded is the entry `approve` itself appended. Between the GATE-WRITE PASS (blob `b434ea8b…`, not recoverable — the document is untracked) and the approval, the body changed in exactly the three places that PASS entry listed as defects to fix before approval, each verified: § Test Plan row TC-16 now reads "Solution 13" (line 505); § Solution 15 now cites `readme.md:2726` (line 338); TC-22 (lines 474–482) now runs both `screen-010-scrollback.ptytest.ts` and `screen-006-no-color.ptytest.ts`, and the § Decision capability-preservation bullet (lines 225–233) binds the flagless claim to that run. The TC set and order are as that PASS inventoried them (22 criteria ↔ 22 rows: TC-01…TC-13, TC-16, TC-17, TC-18, TC-19, TC-21, TC-20, TC-14, TC-15, TC-22). That entry's remaining non-deciding partial-coverage notes are unchanged; they are not GATE-APPROVAL criteria, and the user approved the document with them present.

- GATE-APPROVAL — User has provided explicit approval in the current conversation: PASS (mechanical, per `gate.mjs approve`, re-judged `--dry-run` this session: "route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-07, this conversation"). Observed on the record: the three Route-DIRECT fields of `backlog-execution.md` § Delegated Approval Classes are present in the exact form the rule specifies — `**Approval route:** \`DIRECT\``, a terminated leading-quoted `**Instruction (verbatim):**`, and `**Given:** 2026-09-07, this conversation` — and the date equals this gate's date and the GATE-WRITE PASS date. Boundary stated: the conversation is not observable from the tree; that the utterance occurred is what this mechanical criterion and the orchestrator that ran `approve` attest, and the guard judges the statement as recorded.
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS. (1) Direct: `승인` is verbatim on the catalogue's Route-DIRECT list of what counts; the statement is not an answer to a clarifying question and not silence, and its quantifier `모두` is not bare — it is restricted by a four-element enumeration carried inside the quoted instruction itself, so the referent sits on the record this criterion reads. (2) Unambiguous referent, from the tree: `#2004` denotes this item by a creation-time mechanical binding — the paired Task `.agents/tasks/CLI-2004-tui-screen-reader-mode.md` carries `issue: https://github.com/woojubb/robota/issues/2004`; `new-spec.mjs` requires a spec ID's trailing number to equal the Task's issue (`issueBackedId`, `:316-317`, absent `--legacy-id`) and gives the spec the Task's basename verbatim (`:330`); this document's line 10 names the same issue URL. Uniqueness: exactly one spec document and exactly one Task in this worktree carry `2004` in the ID or issue URL, and no artifact in the main checkout does. (3) No element of the enumeration competes for this document: `#1990` → `CLI-1990-deferred-tool-schemas-and-tool-search.md` (worktree `cli-1990-tool-search`), `#1994` → `CLI-1994-fork-the-conversation-into-a-background-session.md` (`cli-1994-session-fork`), `#2054` → `REFACTOR-025-file-size-enforcement.md` (`arch-2054-tui-ports`, a legacy ID whose text carries `issues/2054`). Four numbers, four distinct items; `#2004` selects this one. (4) Not a category instruction, so not a CLASS case: the catalogue routes to CLASS "any instruction authorizing a _category_ of items rather than this one … standing by construction"; this is a closed enumeration of four already-existing items with no category predicate and no future operator, authorising nothing beyond the four it names, and membership of #2004 was fixed by the user's own enumeration rather than argued by an agent afterwards. (5) Not a relay: the sibling specs for #1990 and #1994 record the identical string `"#2004, #1990, #1994, #2054 모두 승인"` with `**Given:** 2026-09-07, this conversation` — records of one utterance across the items it names, not a paraphrase copied from another document.
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval: N/A — route `DIRECT`, no class cited (mechanical; `gate.mjs` records the same). Recorded rather than skipped.
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: N/A as a Route-CLASS criterion — route `DIRECT` (mechanical; `gate.mjs` records the same); the DIRECT form's equivalent fields are present and verified under the first criterion above.
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: N/A — route `DIRECT`; no class and no evidence condition apply (mechanical; `gate.mjs` records the same).
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A — route `DIRECT`, no class cited. The fallback was checked so the N/A is not a convenience: `backlog-execution.md` § Delegated Approval Classes, read in this worktree, holds exactly two rows, both `Registered 2026-08-28`. `LANE-L0-L1` covers L0/L1 items as `scan-lane-declaration` accepts them; this document declares `lane: L2` (frontmatter line 5) — outside. `BACKLOG-ZERO-MIGRATION` covers documentation-only terminalization or issue handoff of the legacy population and "excludes package/app source, APIs/contracts"; § Affected Files changes source under `packages/agent-cli/src` and `packages/agent-transport-tui/src` — outside. No registered class covers this item, so CLASS is not an available route; DIRECT is satisfied on its own terms above.
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: PASS (mechanical, per `gate.mjs`; re-verified independently). `reviewFingerprint()` (`gate-operations.mjs:920`) recomputed on the current text in this session renders `20afaa2116b2 (review 7047507c, type/tags 64532463)`, identical in all three parts to the value `approve` recorded at approval; and the blob reconstruction above shows that nothing but the approval entry itself was appended after that record.
- GATE-APPROVAL — Independent architecture validation (conditional): N/A — the conditional is not triggered, judged from § Affected Scope / § Affected Files and the tree rather than from the checklist tick. (a) No new package or app: `packages/` holds no directory for any name the document introduces, `git status` is clean of anything but the two planning artifacts, and every `packages/<name>` token in the live sections resolves to an existing directory (`agent-transport-tui`, `agent-cli`). (b) No new presentation or interface surface: the mode is a flag/env/setting-selected branch of the existing TUI product inside its own package, behind the same binary and entry point; no subpath export and no new transport is added. (c) No layer or product-family reclassification: the five new TUI modules (`screen-reader-context.tsx`, `screen-reader-labels.ts`, `terminal-marks.ts`, `attention-bell.ts`, `screen-reader-pacing.ts`) sit in `packages/agent-transport-tui/src` beside the three siblings the checklist names, each confirmed present this run (`terminal-capabilities.ts`, `status-glyph.ts`, `use-terminal-title.ts`); `packages/agent-cli/src/startup/screen-reader-enablement.ts` mirrors `startup/memory-enablement.ts`, confirmed present in the same directory — a placement fixed by an existing precedent, not one that could plausibly live in more than one place. (d) No new dependency edge: `packages/agent-cli/package.json:113` already declares `"@robota-sdk/agent-transport-tui": "workspace:*"`. Accordingly no `proposal-reviewer` ENDORSE verdict and no `architecture-audit-fanout` structure-channel result is required; the Evidence Log contains neither, which is consistent with N/A and not itself a failure. § Architecture Review's New-surface placement item is `[x] N/A` on the same facts.

**Observations, none gate-deciding:** (i) the mechanical entry's criterion labels are cut at 110 characters by `gate-operations.mjs:1584` (`criterion.text…slice(0, 110)`), which is why one reads "`backlo"; a rendering rule, not record damage. (ii) The paired Task is `status: todo` (frontmatter observed this run); the GATE-WRITE PASS's observation that it is still the generator placeholder is GATE-IMPLEMENT's to re-read, not this gate's.

**Judged by:** `backlog-gate-guard` (semantic set)
**Judged at:** HEAD `754c9e239eec0a1622334c9f7b022f9dd64f01c1` · base `origin/develop@754c9e239eec0a1622334c9f7b022f9dd64f01c1` · document `.agents/spec-docs/backlog/CLI-2004-tui-screen-reader-mode.md` blob `79ee78d1a79857b74e2acf54dba2a5db3a884e98` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-07

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-07; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/CLI-2004-tui-screen-reader-mode.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/CLI-2004-tui-screen-reader-mode.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (22)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 2569 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 1`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/CLI-2004-tui-screen-reader-mode.md",
  "specPath": ".agents/spec-docs/todo/CLI-2004-tui-screen-reader-mode.md",
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
    },
    {
      "kind": "tc-id",
      "value": "TC-13"
    },
    {
      "kind": "tc-id",
      "value": "TC-16"
    },
    {
      "kind": "tc-id",
      "value": "TC-17"
    },
    {
      "kind": "tc-id",
      "value": "TC-18"
    },
    {
      "kind": "tc-id",
      "value": "TC-19"
    },
    {
      "kind": "tc-id",
      "value": "TC-21"
    },
    {
      "kind": "tc-id",
      "value": "TC-20"
    },
    {
      "kind": "tc-id",
      "value": "TC-14"
    },
    {
      "kind": "tc-id",
      "value": "TC-15"
    },
    {
      "kind": "tc-id",
      "value": "TC-22"
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 1
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/CLI-2004-tui-screen-reader-mode.md",
    ".agents/tasks/CLI-2004-tui-screen-reader-mode.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `754c9e239eec` · base `origin/develop@754c9e239eec` · document `.agents/spec-docs/todo/CLI-2004-tui-screen-reader-mode.md` blob `6397abb3c96b` (untracked)
