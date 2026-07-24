---
status: draft
type: SCREEN
tags: [tui, ink, affordance, key-hints, footer, microcopy, discoverability]
---

# SCREEN-004: standardize TUI prompt footers, key-hint affordance, and selection microcopy

Backlog: `.agents/backlog/SCREEN-004-tui-prompt-footers-and-affordance.md` (design review 2026-06-26
graded affordance/discoverability C). Scope: `packages/agent-transport-tui` only.

## Problem

The backlog is **partially stale** — three of its five findings already landed since 2026-06-26 and are
NOT re-fixed here:

- `ListPicker.tsx:38` now ships a default footer (`' ↑↓ Navigate  Enter Select  Esc Cancel'`, overridable
  via the `footerHint` prop).
- `SlashAutocomplete.tsx` now renders a footer (line 100) and uses the `> ` indicator (line 52) — the `▸`
  glyph is gone from selection rows.
- `SessionPicker.tsx` delegates to `ListPicker` and therefore inherits its default footer.

What REMAINS broken at current `origin/develop` is exactly the failure mode the backlog predicted:
without a single source of truth, footer dialects re-diverged. Three incompatible footer grammars now
coexist across nine call sites:

**Dialect A — keycap-verb pairs, two-space separator (the de-facto template):**

| File:line                       | Footer                                                              |
| ------------------------------- | ------------------------------------------------------------------- |
| `src/ListPicker.tsx:38`         | `' ↑↓ Navigate  Enter Select  Esc Cancel'`                          |
| `src/MenuSelect.tsx:101`        | `' ↑↓ Navigate  Enter Select  Esc Back'`                            |
| `src/MultiSelectList.tsx:86-90` | `' ↑↓ Navigate  Space Toggle  Enter Confirm[ (min N)]  Esc Cancel'` |

**Dialect B — keycap-verb pairs, single-space run-on (unparseable without prior knowledge):**

| File:line                               | Footer                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `src/SlashAutocomplete.tsx:100`         | `' ↑↓ Navigate Tab Complete Enter Select Esc Close'` — reads as "Navigate Tab", "Complete Enter"              |
| `src/TextPrompt.tsx:70`                 | `' Enter Submit Esc Cancel'`                                                                                  |
| `src/ExecutionWorkspaceSwitcher.tsx:66` | `'Ctrl+B Close ↑↓ Navigate Enter Switch Esc Close'` — no leading pad, dismiss-key first, `Close` listed twice |

**Dialect C — prose:**

| File:line                     | Footer                                      |
| ----------------------------- | ------------------------------------------- |
| `src/ConfirmPrompt.tsx:67`    | `' arrow keys to select, Enter to confirm'` |
| `src/PermissionPrompt.tsx:83` | `' left/right to select, Enter to confirm'` |

Concrete defects beyond the dialect split:

1. **Inaccurate microcopy for the same interaction.** `ConfirmPrompt` and `PermissionPrompt` render the
   _same_ horizontal option row driven by the _same_ reducer (`getDirectionalSelectionInputAction`,
   `src/flows/selection-flow.ts:44-52` — left/up = previous, right/down = next), yet one says
   "arrow keys" and the other "left/right". Adjacent prompts imply different keybindings that are in
   fact identical.
2. **Esc suppression is real but invisible.** Both prompt flows deliberately disable Esc
   (`src/flows/confirm-prompt-flow.ts:17` and `src/flows/permission-prompt-flow.ts:29` pass
   `{ ...key, escape: false }`) so a permission/confirm ask can only resolve explicitly — a correct
   hard-stop (an Esc-dismissal would be an implicit deny). But nothing documents this invariant, and the
   prose footers neither list Esc nor establish the convention "the footer lists exactly the keys that
   work", so Esc silently doing nothing reads as a bug.
3. **No SSOT.** Every component hand-rolls its footer string literal. Dialect B _is_ the drift that
   re-accumulated after the first cleanup; nothing prevents a fourth dialect tomorrow.
4. **Selection indicator is uniform by luck, not by contract.** All seven prompt-row call sites
   (`ListPicker` consumers, `MenuSelect.tsx:93`, `ConfirmPrompt.tsx:61`, `PermissionPrompt.tsx:77`,
   `MultiSelectList.tsx:80`, `SessionPicker.tsx:41`, `PendingActionPrompt.tsx:91`) independently spell
   `'> '` / `'  '` as literals. (`ExecutionWorkspaceDetailPane.tsx:75` uses `▸` as a _group-summary
   disclosure glyph_, not a selection cursor — it is intentionally out of scope; noted so a future pass
   does not "fix" it into the selection convention.)
5. `packages/agent-transport-tui/docs/SPEC.md` has no interaction-affordance contract, so none of the
   above is checkable against a stated rule.

## Prior Art Research

How shipped terminal products surface key-hint affordances (product documentation only):

- **Claude Code** — the interactive-mode reference is a per-context keyboard-shortcut table, and the
  product surfaces discoverability in-UI: "In fullscreen rendering, press `?` in the transcript viewer
  to see available shortcuts there." Contextual hints are dim, bottom-adjacent, and list only the keys
  active in the current context. <https://code.claude.com/docs/en/interactive-mode>
- **Gemini CLI** — dedicated keyboard-shortcuts reference with uniform dialog conventions
  (`nav.dialog.up/down` = arrows, `basic.confirm` = Enter, `basic.cancel` = Esc, `suggest.accept` =
  Tab/Enter); `?` toggles a shortcuts panel above the input which "auto-hides while the agent is
  running/streaming or when action-required dialogs are shown" — i.e. the full inventory lives in a
  panel/doc, not in every footer.
  <https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/keyboard-shortcuts.md>
- **Charm Bubbles (Bubble Tea component library)** — ships a dedicated `help` bubble: "A customizable
  horizontal mini help view that automatically generates itself from your keybindings", paired with the
  `key` package that binds keys _together with_ their help text (e.g. `↑/k` + "move up"). The footer is
  **generated from a single keymap SSOT**, never hand-written per view.
  <https://github.com/charmbracelet/bubbles>
- **fzf** — deliberately renders no default key legend; the documented affordance channel is the
  `--header` sticky line ("The given string will be printed as the sticky header"), which users populate
  with key hints. Affordance text is a first-class, single, dedicated slot — not scattered strings.
  <https://junegunn.github.io/fzf/reference/>

**Observed common behavior:** (a) hints are dim, bottom-adjacent `key → verb` pairs with a visible
separator, listing only the 2–4 keys active in the current context; (b) the strings are _generated from
one keymap definition_, not hand-authored per view (Bubbles is the direct architectural precedent);
(c) the exhaustive shortcut inventory lives in a separate panel or reference doc, not in the footer.

**Recommendation:** adopt the Bubbles pattern scaled down — one shared hint formatter + footer component
as the package-local SSOT, per-context verbs supplied by callers. A `?`-toggled full shortcut panel
(Claude Code / Gemini CLI) is a worthwhile _separate_ follow-up, out of scope here.

## Decision

All changes inside `packages/agent-transport-tui` (internal components — none are in the public API
surface listed in `docs/SPEC.md`, so no external breaking change).

1. **New shared SSOT module `src/key-hint-footer.tsx`:**
   - `interface IKeyHint { keys: string; label: string }` — e.g. `{ keys: '↑↓', label: 'Navigate' }`.
   - `formatKeyHints(hints: readonly IKeyHint[]): string` — pure; joins `` `${keys} ${label}` `` pairs
     with the single exported separator constant `KEY_HINT_SEPARATOR = ' · '` (the backlog's own
     template `↑↓ Navigate · Enter <verb> · Esc <cancel>`; matches the Bubbles/Claude Code bullet-dot
     idiom and is unambiguous where single-space ran together). Changing the separator later is a
     one-constant edit.
   - `KeyHintFooter({ hints })` — renders `<Text dimColor>` with the leading pad; renders nothing for an
     empty list.
   - `SELECTION_INDICATOR = '> '` and `SELECTION_INDICATOR_NONE = '  '` exported constants.
   - Glyph note: `·` introduces no new degradation path — `↑↓` already ships unconditionally, and
     `terminal-capabilities.ts` gates color/motion only. **No ASCII fallback branch is added**
     (no-fallback: none needed, none declared).
2. **Adoption — every footer call site consumes the SSOT:**

   | Component                    | Hints (rendered via `formatKeyHints`)                                                            |
   | ---------------------------- | ------------------------------------------------------------------------------------------------ |
   | `ListPicker` (default)       | `↑↓ Navigate · Enter Select · Esc Cancel`                                                        |
   | `SlashAutocomplete`          | `↑↓ Navigate · Tab Complete · Enter Select · Esc Close`                                          |
   | `TextPrompt`                 | `Enter Submit · Esc Cancel`                                                                      |
   | `MenuSelect`                 | `↑↓ Navigate · Enter Select · Esc Back`                                                          |
   | `MultiSelectList`            | `↑↓ Navigate · Space Toggle · Enter Confirm[ (min N)] · Esc Cancel` (dynamic min segment kept)   |
   | `ConfirmPrompt`              | `←→ Navigate · Enter Confirm`                                                                    |
   | `PermissionPrompt`           | `←→ Navigate · Enter Confirm`                                                                    |
   | `ExecutionWorkspaceSwitcher` | `↑↓ Navigate · Enter Switch · Ctrl+B/Esc Close` (normalized order: navigate → primary → dismiss) |

   `ListPicker`'s `footerHint?: string` prop becomes `footerHints?: readonly IKeyHint[]` (internal
   contract; `SessionPicker`/`PendingActionPrompt` keep inheriting the default).

3. **Esc-suppression convention (the "unexplained Esc" fix):** the footer lists **exactly the keys that
   do something** — absence of Esc IS the affordance. `ConfirmPrompt`/`PermissionPrompt` keep their
   deliberate `escape: false` hard-stop and simply render no Esc hint; no "(Esc disabled)" noise text.
   The invariant is written into `docs/SPEC.md` (see 5) so it is a stated contract, not folklore.
   `ConfirmPrompt`/`PermissionPrompt` footers become identical and name the real keys (`←→` — the reducer
   also accepts ↑↓ as aliases per `selection-flow.ts:48-49`; the footer names the canonical pair for a
   horizontal row).
4. **Config/toggle story: none added.** Footers render always; per-call-site suppression stays possible
   (`footerHints={[]}`). No env flag, no global config — dim styling and NO_COLOR degradation are
   already owned by Ink + `terminal-capabilities.ts`, and a config surface for microcopy would be creep.
5. **`docs/SPEC.md` gains an "Interaction affordance contract" section:** footer grammar
   (`key label` pairs joined by `KEY_HINT_SEPARATOR`, order navigate → modify → primary → dismiss),
   the SSOT module, the selection-indicator constants, and the Esc-suppression invariant ("a prompt that
   must resolve explicitly suppresses Esc in its flow AND omits it from its footer").
6. **Neutrality (TRANS-001 rescope principle; `.agents/project-structure.md` library-tier rules):** the
   shared module ships mechanics only — no verb vocabulary, no product strings; callers supply
   keys/labels. The package stays a content-neutral library ingredient.

Out of scope: `ExecutionWorkspaceDetailPane`'s `▸` disclosure glyph (content, not a cursor); the inline
`(Backspace to cancel)` parenthetical in `InputArea.tsx:294` (mid-line status idiom, not a footer); a
`?`-toggled shortcut panel (follow-up backlog candidate); keybinding remapping.

## Test Plan

Red-before-green throughout — each new assertion is written against the CURRENT strings first and must
FAIL before the component is migrated (per the HARNESS-041 accidental-green lesson: an assertion that
passes pre-fix proves nothing).

- **Unit — `src/__tests__/key-hint-footer.test.tsx` (new):** `formatKeyHints` grammar (separator
  constant, pair order, single hint, empty list → empty string); `KeyHintFooter` renders dim and renders
  nothing when empty.
- **Unit — per-component footer assertions** extending the existing suites (`ListPicker.test.tsx`,
  `MenuSelect.test.tsx`, `SlashAutocomplete.test.tsx`, `TextPrompt.test.tsx`, `confirm-prompt.test.tsx`,
  `PendingActionPrompt.test.tsx`): the rendered footer equals `formatKeyHints(<declared hints>)`. These
  FAIL red against today's Dialect-B/C literals.
- **Anti-drift consistency guard (the mechanical floor for this spec):** a unit test that imports every
  component's declared hint set and asserts (a) all footers round-trip through `formatKeyHints`, (b) the
  navigate → modify → primary → dismiss ordering, so a fourth dialect cannot re-appear silently.
- **Selection indicator:** row-render assertions use `SELECTION_INDICATOR`, not a literal.
- **Esc-suppression regression:** existing flow tests (`confirm-permission-flow.test.ts`) keep asserting
  Esc yields no action for confirm/permission; new assertion that their footers omit `Esc`.
- **pty e2e (`pnpm --filter @robota-sdk/agent-transport-tui test:pty`, `vitest.pty.config.ts`):** extend
  the existing pty harness (`spawnPtyFixture` from `@robota-sdk/agent-testing`, as used by
  `command-handoff-pty-e2e.test.ts`) — type `/` in the real pty and assert the autocomplete frame
  contains the unified footer and the `> ` indicator on the selected row.
- Gate: `pnpm --filter @robota-sdk/agent-transport-tui build && pnpm --filter @robota-sdk/agent-transport-tui test`
  plus typecheck; no new lint/scan suppressions.

## User Execution Test Scenarios

Agent-run via the package's pty fixture (per the agent-run capability rule — the owner does NOT run a
terminal smoke):

1. **Slash autocomplete affordance:** spawn the pty fixture, type `/` → the popup shows
   `↑↓ Navigate · Tab Complete · Enter Select · Esc Close` and the highlighted row starts with `> `.
   Evidence: recorded pty frames.
2. **Prompt-family parity:** drive a CMD-004 ask through the fixture for each shape (single-select,
   multi-select, free-text) → all three footers share the grammar; the multi-select shows the dynamic
   `(min N)` segment until satisfiable.
3. **Explicit-resolve prompts:** open the permission prompt → footer reads `←→ Navigate · Enter Confirm`;
   pressing Esc changes nothing (prompt still displayed, no resolution) — the suppression is now a
   documented, footer-consistent behavior.

Evidence file (created at IMPLEMENT/VERIFY): `.agents/evals/scenarios/screen-004-prompt-footers-agent-run.md`.

## Evidence Log

### [GATE-WRITE] — draft authored | 2026-07-24

- Problem grounded line-by-line in current `origin/develop` (backlog staleness called out: 3/5 findings
  already landed; the remaining defect is the dialect drift + missing SSOT + undocumented Esc hard-stop).
- Prior Art Research substantiated with 4 product-doc citations (Claude Code, Gemini CLI, Charm Bubbles,
  fzf) → `scan-spec-research` green.
- Frontmatter (`status: draft`, `type: SCREEN`, `tags`) → `check-spec-doc-frontmatter` green (known
  non-blocking warning: the SCREEN-004 ID is also used by the done activity-count-separator spec; this
  file keeps the backlog item's slug).
- Awaiting GATE-APPROVAL (independent proposal-reviewer) before any implementation.
