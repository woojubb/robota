---
status: approved
type: SCREEN
tags: [tui, ink, color, palette, tokens, motion, accessibility, no-color]
---

# SCREEN-006: shared TUI semantic color palette and tokenized, accessible motion

Backlog: `.agents/backlog/SCREEN-006-tui-shared-palette-and-motion.md` (design review 2026-06-26
graded color B — scattered definitions; wave animation flagged as motion without purpose). Scope:
`packages/agent-transport-tui` only.

> ID check at GATE-WRITE: `ls .agents/spec-docs/*/SCREEN-*` → 001–005 and 010 in use; **SCREEN-006 is
> free** and matches the backlog item's own ID (no renumbering needed). Code comments citing
> "SCREEN-006" today refer to the backlog item's partial landings, not to a spec-doc.

## Problem

The backlog is **partially stale** — two of its three findings already landed and are NOT re-fixed
here:

- ~~"`render-markdown.ts` hardcodes raw ANSI escape strings"~~ → extracted to `src/tui-ansi-palette.ts`
  (its header cites SCREEN-006); `render-markdown.ts` now consumes the `ANSI` token map
  (`render-markdown.ts:6,49-69`) and gates color on `isInteractiveColorTerminal()`
  (`render-markdown.ts:36`).
- ~~"WaveText … no reduced-motion / non-TTY check"~~ → `WaveText.tsx:25` now gates ALL motion on
  `isInteractiveColorTerminal()` (`src/terminal-capabilities.ts`, the color+motion gate SSOT from
  SCREEN-008): NO_COLOR / `FORCE_COLOR=0` / non-TTY → static text, no interval.
- The "StatusBar … repeats hardcoded separators" claim is PARTIALLY live (GATE-APPROVAL review
  correction): SCREEN-004 fixed the `' · '` activity-segment separators, but `StatusBar.tsx` still
  repeats the `'  |  '` segment separator 6 times (lines 159, 165, 171, 177, 181, 183). Scope call:
  the adoption pass folds these into a single `SEP` constant in `StatusBar.tsx` (a one-line
  consolidation piggybacking on the same file's color tokenization — it is a string literal, not a
  color token, so it lives beside the component, not in `tui-palette.ts`).

What REMAINS broken at current `origin/develop` is the backlog's core finding: **there is no semantic
color token layer**. Four disjoint color systems coexist, and the largest one is 60+ ad-hoc literals:

**System 1 — `src/tui-ansi-palette.ts` (raw ANSI SGR tokens).** Sound token module, but scoped to the
markdown/diff renderer only (sole consumer: `render-markdown.ts`).

**System 2 — `src/status-glyph.ts` (`STATUS_GLYPH`, status → symbol+color SSOT, SCREEN-005/007/009).**
Sound semantic module, but its 7 color values (`yellow`/`green`/`red`/`yellowBright`/`gray`) are inline
literals, not sourced from any palette. Consumers: `StreamingIndicator.tsx`,
`background-task-row-format.ts`, `ExecutionWorkspaceDetailPane.tsx`, `execution-workspace-view-model.ts`,
`ToolCommandOutput.tsx`.

**System 3 — ad-hoc Ink named-color literals: 54 `color="…"` sites across 19 component files**
(mechanical enumeration, `grep -rn 'color="' src --include='*.tsx' --include='*.ts'`, tests excluded):

| File                                                                                                                                                                           | `color="…"` literal sites                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `MessageList.tsx`                                                                                                                                                              | 51, 57, 63, 69, 98, 102, 110, 128, 132, 139, 154, 159, 217, 241, 247, 268 |
| `StatusBar.tsx`                                                                                                                                                                | 99, 114, 172 (`magenta`), 230                                             |
| `TextPrompt.tsx`                                                                                                                                                               | 63, 68, 74, 76                                                            |
| `InputArea.tsx`                                                                                                                                                                | 275 (`black` on background), 283, 285, 300                                |
| `App.tsx`                                                                                                                                                                      | 466, 494, 505, 513                                                        |
| `StreamingIndicator.tsx`                                                                                                                                                       | 36, 44, 83                                                                |
| `ToolDiffBlock.tsx`                                                                                                                                                            | 20, 26                                                                    |
| `SessionPicker.tsx`                                                                                                                                                            | 30, 58 (`gray`)                                                           |
| `PermissionPrompt.tsx`                                                                                                                                                         | 76, 81                                                                    |
| `MenuSelect.tsx`                                                                                                                                                               | 90, 100                                                                   |
| `ExecutionWorkspaceDetailPane.tsx`                                                                                                                                             | 36, 45                                                                    |
| `ContextWarningBanner.tsx`                                                                                                                                                     | 15, 26                                                                    |
| `UsageSummaryEntry.tsx` / `UpdateNotice.tsx` / `TransportTUI.tsx` / `MultiSelectList.tsx` / `ExecutionWorkspaceSwitcher.tsx` / `ConfirmPrompt.tsx` / `BackgroundTaskPanel.tsx` | 25 / 11 / 112 / 94 / 62 / 69 / 27                                         |

Plus the derived-color helpers and border literals in the same dialect:

- `StatusBar.tsx:50-54` `getContextColor` → `'red' | 'yellow' | 'green'` literals.
- `MessageList.tsx:29-41` `getToolSummaryStatus`/`getToolSummaryColor` — a **hand-rolled duplicate of
  `STATUS_GLYPH` + `toolStateStatusKind`**: same glyphs (`⟳ ✗ ⊘ ✓`), re-derived colors, and one silent
  divergence — denied renders `yellow` here vs the SSOT's `yellowBright`. This is exactly the drift
  SCREEN-007 ("one glyph/symbol … everywhere. Single source of truth") was supposed to end.
- `status-activity.ts:27-63` — activity colors (`cyan`/`yellow`/`gray`) as literals in 5 branches.
- `SlashAutocomplete.tsx:68` `nameColor = isSelected ? 'cyan' : undefined`.
- `InputArea.tsx:242-249` `borderColor` state ternary → `'yellow' | 'cyan' | 'gray' | 'green'`.
- 8 `borderColor="…"` literals: `ContextWarningBanner.tsx:14` (`red`), `MenuSelect.tsx:89`,
  `PermissionPrompt.tsx:75`, `MultiSelectList.tsx:93`, `ConfirmPrompt.tsx:68`, `TextPrompt.tsx:62`
  (all `yellow`), `ExecutionWorkspaceSwitcher.tsx:61` (`cyan`), `SlashAutocomplete.tsx:104` (`gray`).

**System 4 — hex literals in `WaveText.tsx:13`** (`WAVE_COLORS = ['#666666', '#888888', '#aaaaaa',
'#888888']`) plus motion constants (`INTERVAL_MS = 400`, `CHARS_PER_GROUP = 4`, `WaveText.tsx:14-15`)
— inline in the component, outside any token module.

Concrete defects:

1. **Same meaning, no shared token.** "Warning/attention yellow" is independently spelled in ~20
   places; "accent cyan" in ~15; nothing states that `PermissionPrompt`'s border and
   `StatusBar`'s context-warning threshold mean the same thing. The next component re-picks colors
   freehand — the exact failure mode SCREEN-005 documented for footer strings ("re-diverged" without
   an SSOT) already happened for status colors (`MessageList` vs `STATUS_GLYPH`, defect 2 below).
2. **A live SSOT violation.** `MessageList.tsx:29-41` duplicates the status-glyph mapping and has
   already drifted (denied: `yellow` ≠ `yellowBright`). Color-only-consistency (SCREEN-009) was
   audited against `STATUS_GLYPH`; a parallel mapping silently escapes that audit.
3. **Motion values are untokenized.** WaveText's gate is correct now, but its color ramp and cadence
   are component-private hex/ms literals — the one animation in the package is invisible to any
   palette audit, and the backlog's perceptibility finding (`#666→#aaa` at 400ms is
   near-imperceptible) is still unaddressed.
4. **De-emphasis has two spellings.** 40 `dimColor` sites (the dominant idiom, incl. SCREEN-005's
   `KeyHintFooter` — its review noted the hardcoded `dimColor` as a tokenization candidate) coexist
   with literal `color="gray"` (`SessionPicker.tsx:58`, `status-activity.ts:61`, `STATUS_GLYPH.idle`)
   with no stated rule for which to use.
5. **No contract.** `packages/agent-transport-tui/docs/SPEC.md` has an Interaction Affordance
   Contract (SCREEN-005) but no color/motion contract, so none of the above is checkable against a
   stated rule, and no mechanical floor prevents literal re-accumulation.

## Prior Art Research

How shipped terminal products organize color/theming and motion accessibility (product documentation
only, fetched 2026-07-25):

- **Textual (Textualize)** — the design system is a fixed set of ~11 **semantic base variables**
  ("`$primary`, `$secondary`, `$accent`, `$foreground`, `$background`, `$surface`, `$panel`,
  `$boost`, `$warning`, `$error`, `$success`"), with derived shades and purpose tokens
  (`$text-primary`, `$primary-muted`); components reference the variables, never raw values, so a
  theme change propagates automatically. <https://textual.textualize.io/guide/design/>
- **Gemini CLI themes** — custom themes are a single `customThemes` block in settings with
  **semantic keys grouped by role**: text (`primary`/`secondary`/`link`/`accent`), background
  (`primary`, `diff.added`, `diff.removed`), border (`default`/`focused`), status
  (`success`/`warning`/`error`), ui (`comment`/`symbol`/`gradient`). Notably border and status are
  first-class token groups — the same split this package needs. Accessibility is a separate setting
  surface (`ui.accessibility.screenReader` renders plain text; `ui.loadingPhrases` can be turned
  off), i.e. motion/ornament has an off-switch distinct from color.
  <https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/themes.md>,
  <https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/settings.md>
- **Charm Lip Gloss** — styles/colors are defined centrally and degrade mechanically: profiles from
  true-color down to a "1-bit ASCII profile", "automatically downsampling colors to the best
  available profile" and "stripping colors (and ANSI) entirely when output is not a TTY";
  adaptive colors select values at runtime by terminal background. Degradation is the renderer's
  job, not each call site's. <https://github.com/charmbracelet/lipgloss>
- **k9s skins** — the presentation layer is a YAML skin file of semantic keys (`fgColor`, `bgColor`,
  `logoColor`, `errorColor`, `cursorColor`, …) grouped by surface (`body`, `frame`, `table`, `logs`);
  "Skins are YAML files, that enable a user to change the K9s presentation layer."
  <https://k9scli.io/topics/skins/>
- **NO_COLOR** — "Command-line software which adds ANSI color to its output by default should check
  for a `NO_COLOR` environment variable that, when present and not an empty string (regardless of
  its value), prevents the addition of ANSI color." <https://no-color.org/>

**Observed common behavior:** (a) colors live in ONE semantic token set, keyed by role
(text/border/status/diff), never per-view; (b) components consume tokens, and the token layer — not
the call site — owns degradation (NO_COLOR/non-TTY/low-color); (c) motion/ornament is separately
suppressible; (d) the token vocabulary is small (≈10–15 semantic slots), not a color-name free-for-all.
No comparable product keeps 4 parallel color systems in one UI package.

**Recommendation:** consolidate on the token-module mechanism this package already uses
(`tui-ansi-palette.ts` / `status-glyph.ts` are the local precedents; Textual/Gemini give the semantic
vocabulary) — do NOT introduce a theming framework, theme switching, or a config surface.

## Decision

All changes inside `packages/agent-transport-tui` (internal components; the only public-surface item
touched is none — token modules stay package-internal). **Extend the existing token-module pattern;
no parallel theming system** (no theme objects, no React context, no runtime switching, no user
config — that would be an app-layer follow-up, out of scope).

1. **New token module `src/tui-palette.ts`** — the Ink-side counterpart of `tui-ansi-palette.ts`,
   same mechanism (plain exported `const` maps), semantic vocabulary modeled on Gemini CLI's theme
   keys / Textual's base variables, **values = today's colors** (this is a consolidation, not a
   redesign — with the two deliberate exceptions in 3 and 4):

   - `PALETTE.text`: `accent: 'cyan'` (section labels, assistant name, focused option),
     `emphasis: 'white'` (bold labels), `success: 'green'`, `warning: 'yellow'`, `error: 'red'`,
     `session: 'magenta'` (`StatusBar.tsx:172`), `muted: 'gray'`.
   - `PALETTE.border`: `attention: 'yellow'` (prompts that demand a response), `focused: 'cyan'`,
     `active: 'green'`, `muted: 'gray'`, `error: 'red'`.
   - `PALETTE.status`: `running`/`waiting`/`cancelled: 'yellow'`, `success: 'green'`,
     `error: 'red'`, `denied: 'yellowBright'`, `idle: 'gray'` — consumed by `STATUS_GLYPH`.
   - `MOTION`: `waveColors` (hex ramp, see 4), `waveIntervalMs`, `waveCharsPerGroup`.

   Every value is an Ink/chalk color name or hex — mechanics only; token names are semantic slots
   (accent/muted/attention), **no product vocabulary** (neutrality: the package stays a
   content-neutral library ingredient; "Robota:"/"You:" strings remain caller content).

2. **Existing token modules keep their roles; colors flow one way.**
   - `status-glyph.ts` remains the status SSOT (kinds, symbols, `toolStateStatusKind`,
     `workspaceStatusKind`); its 7 color values become references to `PALETTE.status.*`
     (dep direction: `status-glyph` → `tui-palette`; no cycle).
   - `tui-ansi-palette.ts` remains the raw-SGR token set for the `marked-terminal` pipeline —
     different encoding, different consumer; its values are NOT derived from `PALETTE` (a
     name→SGR mapping layer would be invented complexity). The boundary between the two palettes is
     written into the SPEC contract (see 6).
   - `terminal-capabilities.ts` remains the single color+motion gate. No new env surface. (Noted,
     no behavior change: the local gate treats an EMPTY `NO_COLOR` as off, stricter than
     no-color.org's "present and not an empty string" — the strict direction is the safe one; the
     divergence is recorded in the SPEC contract.)
   - **Fallback declaration: none** — no new degradation branch is added; NO_COLOR/non-TTY handling
     stays owned by Ink + `terminal-capabilities.ts`.
3. **Adoption — every color call site consumes tokens.** The 54 `color="…"` literals, 8
   `borderColor="…"` literals, and the derived-color helpers (`getContextColor`,
   `formatStatusActivity`, `SlashAutocomplete.nameColor`, `InputArea.borderColor` ternary) map to
   `PALETTE.*` per the Problem tables. Specifics:
   - `MessageList.tsx:29-41` `getToolSummaryStatus`/`getToolSummaryColor` are **deleted**; the tool
     summary computes `kind = summaryError ? 'error' : toolStateStatusKind(tool)` and renders
     `STATUS_GLYPH[kind]` — removing the duplicate mapping. This unifies denied to the SSOT's
     `yellowBright` (a deliberate, visible fix of the drift; red-before-green catches it).
   - `InputArea.tsx:242-249` maps states to tokens: aborting → `border.attention`, pendingPrompt →
     `border.focused`, disabled → `border.muted`, ready → `border.active`; the mode chip
     (`InputArea.tsx:275`) keeps `color="black"` on the token background (chip-contrast constant,
     moved into the palette as `PALETTE.text.onAccent: 'black'`).
   - `SessionPicker.tsx:58`'s `color="gray"` becomes `dimColor` per the de-emphasis rule (5).
4. **WaveText: tokenize + make the motion perceptible (backlog option "make it meaningful").**
   `WAVE_COLORS`/`INTERVAL_MS`/`CHARS_PER_GROUP` move to `MOTION` in `tui-palette.ts`; the ramp
   widens from `#666666→#aaaaaa` to a 4-stop `#555555 → #777777 → #999999 → #bbbbbb` (calm but
   visible contrast span; cadence stays 400ms — perceptibility comes from the wider ramp, not faster
   flicker). The static (gated) frame renders `PALETTE.text.muted`. The existing
   `isInteractiveColorTerminal()` gate is unchanged and untouched — reduced-motion behavior stays:
   NO*COLOR / `FORCE_COLOR=0` / non-TTY ⇒ zero intervals, zero color churn. A user-facing
   reduced-motion \_setting* (Gemini's `ui.loadingPhrases`-style off-switch) is an app-layer
   follow-up candidate, not this library's config surface (mirrors SCREEN-005's "no config
   surface" stance).
5. **De-emphasis rule (the SCREEN-005 `KeyHintFooter` relationship):** the canonical muted treatment
   is Ink's `dimColor` — terminal-theme-relative, degrades for free. `PALETTE.text.muted` exists
   only where an actual color VALUE is required (static WaveText frame, `STATUS_GLYPH.idle`,
   `status-activity` idle). `KeyHintFooter`'s `dimColor` (noted by the SCREEN-005 review as the
   tokenization candidate) is hereby the documented canonical idiom — the module itself is
   **unchanged** (its grammar/constants stay the affordance SSOT; this spec only adds the rule that
   `dimColor` IS the muted token).
6. **`docs/SPEC.md` gains a "Color & Motion Contract (SCREEN-006)" section:** the three token
   modules and their boundary (Ink names in `tui-palette`, raw SGR in `tui-ansi-palette`, status
   symbol+color in `status-glyph` sourcing colors from the palette), the de-emphasis rule, the
   color+motion gate SSOT (`terminal-capabilities.ts`, incl. the NO_COLOR empty-string note), the
   no-literal-colors rule for components, and the motion tokens.

Out of scope: user-configurable themes / adaptive light-dark colors (needs an app-layer settings
surface first); changing any `tui-ansi-palette.ts` SGR value; key-hint grammar or any SCREEN-005
constant; `TransportTUI.tsx:108`'s hand-written hint string `'↑↓ select space toggle enter/esc
close'` (a SCREEN-005 affordance-contract violation observed during this survey — flagged for a
follow-up backlog item, not silently fixed here); the `?`-toggled shortcut panel.

## Test Plan

Red-before-green throughout (HARNESS-041 lesson: an assertion that passes pre-fix proves nothing).
Because this is a value-preserving consolidation, output-equality assertions would be
accidental-green — the RED tests are chosen so each fails against today's code:

- **Anti-drift consistency floor (the mechanical floor for this spec) —
  `src/__tests__/palette-consistency.test.ts` (new):** reads every `src/**/*.{ts,tsx}` source
  (excluding `tui-palette.ts`, `tui-ansi-palette.ts`, `__tests__`) and asserts zero `color="…"` /
  `borderColor="…"` / `backgroundColor="…"` literals and zero `#rrggbb` hex. **RED today: 60+
  findings** (54 + 8 + WaveText hex). Precedent: `key-hint-consistency.test.tsx`, the SCREEN-005
  floor. **Known limit (recorded decision):** the floor catches JSX attribute literals and hex, but
  not a future TS helper returning a bare color-name string (the `getContextColor` shape); today's
  instances of that shape are removed by the adoption pass, and extending the floor to bare strings
  is deferred until one actually recurs.
- **Unit — `src/__tests__/tui-palette.test.ts` (new):** every `PALETTE` leaf is a valid Ink color
  name (explicit allowlist) or hex; `MOTION` shape (4-stop ramp, positive interval);
  `STATUS_GLYPH[kind].color === PALETTE.status[kind]` for all 7 kinds (**RED today** — no palette
  module exists).
- **Status-SSOT unification — extend `message-list-rendering.test.tsx`:** a denied tool summary
  renders the `STATUS_GLYPH.denied` color (`yellowBright`). **RED today** (`getToolSummaryColor`
  returns `yellow`). Existing `status-glyph.test.ts` (every kind has symbol AND color, SCREEN-009)
  keeps passing.
- **WaveText — extend the render tests:** animated frames draw only from `MOTION.waveColors`; the
  gated/static frame uses `PALETTE.text.muted`; no interval is created when
  `isInteractiveColorTerminal()` is false (existing behavior, re-asserted against the token source).
  **RED today** for the token-source assertions (inline hex).
- **pty e2e — deliberate harness choice:** a **built-CLI `*.ptytest.ts` under `src/__tests__/pty/`,
  run by `pnpm --filter @robota-sdk/agent-transport-tui test:pty`** (`vitest.pty.config.ts`;
  requires `pnpm build:deps` for the `robota` binary) — NOT a `spawnPtyFixture` default-suite
  `*.test.ts`. Rationale: NO_COLOR/FORCE_COLOR/TTY handling is process-env + real-binary
  composition (Ink stdout detection, `terminal-capabilities` reading the real env) that a fixture
  driver would re-wire; per-SCREEN ptytest precedent exists (`screen-010-scrollback.ptytest.ts`,
  `screen-005-prompt-footers.ptytest.ts`). New file `screen-006-no-color.ptytest.ts`:
  - S1: spawn the built CLI with `NO_COLOR=1` on the replay fixture → captured frames contain **no
    SGR color sequences** (`ESC[3x`/`ESC[9x`/`38;5`/`48;5`) and repeated waiting-state frames show
    zero WaveText color churn.
  - S2: spawn with color forced on the same fixture → status/label colors match the palette tokens
    and the markdown diff block carries the `tui-ansi-palette` SGR pairs.
- Gate: `pnpm --filter @robota-sdk/agent-transport-tui build && … test` + `test:pty` + typecheck;
  `node scripts/harness/run-all-scans.mjs` clean; no new lint/scan suppressions.

## User Execution Test Scenarios

Agent-run via the package's pty harness (per the agent-run capability rule — the owner does NOT run a
terminal smoke):

1. **NO_COLOR legibility:** run the built CLI with `NO_COLOR=1` in a real pty through a replayed
   conversation → output is legible, zero raw color-escape artifacts, no animation (WaveText static).
   Evidence: `screen-006-no-color.ptytest.ts` S1 — _to fill at IMPLEMENT/VERIFY._
2. **Normal-run consistency:** run with color on → status colors across the streaming indicator,
   background panel, and workspace pane all come from `STATUS_GLYPH`→`PALETTE.status` (denied is
   `yellowBright` everywhere), markdown/diff styling from `tui-ansi-palette`.
   Evidence: `screen-006-no-color.ptytest.ts` S2 — _to fill at IMPLEMENT/VERIFY._

Evidence file (created at IMPLEMENT/VERIFY): `.agents/evals/scenarios/screen-006-palette-motion-agent-run.md`.

## Evidence Log

### [GATE-WRITE] — draft authored | 2026-07-25

- Problem grounded line-by-line in current `origin/develop` (backlog staleness called out: the
  raw-ANSI extraction and the WaveText motion gate already landed under this backlog ID). Remaining
  defect: no semantic token layer — 4 parallel color systems, 60+ literal sites (enumerated
  mechanically), one live `STATUS_GLYPH` duplication drift (`MessageList` denied `yellow` ≠
  `yellowBright`), untokenized motion constants.
- Prior Art Research substantiated with 5 product-doc citations (Textual design system, Gemini CLI
  themes + settings, Charm Lip Gloss, k9s skins, no-color.org), all fetched and quoted 2026-07-25 →
  `scan-spec-research` green.
- Frontmatter (`status: draft`, `type: SCREEN`, `tags`) → `check-spec-doc-frontmatter` green;
  SCREEN-006 ID verified free across `.agents/spec-docs/*/`.

### [GATE-APPROVAL] — REVISE → revisions folded → approved | 2026-07-25

- Independent proposal-reviewer verdict: **REVISE** — every code premise verified TRUE (54/19
  literal table, 8 borderColor sites, MessageList drift, boundary claims, harness precedents) and
  the core decision endorsed (placement correct, no-theming scope right for the
  responsibility-placement reason, deleting the MessageList fork correct), with two required
  revisions, both folded in this commit:
  1. The draft's claim that the StatusBar-separator finding was fully stale was **false** —
     `StatusBar.tsx` still repeats `'  |  '` 6× (lines 159–183). Corrected in Problem; scope call
     made explicit: a one-line `SEP` constant folds into the adoption pass.
  2. `dimColor` count corrected 41→40; the consistency floor's known limit (bare color-name strings
     in TS helpers not caught) recorded as a deliberate decision in the Test Plan.
- Approved on the reviewer's conditional ("after one factual correction... then approve");
  `status: approved`, moved draft → todo.
