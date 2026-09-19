---
title: 'SCREEN-2002: Configure accessible TUI themes and reduced motion'
issue: https://github.com/woojubb/robota/issues/2002
status: in-progress
created: 2026-09-14
priority: high
urgency: now
area: packages/agent-interface-command, packages/agent-framework, packages/agent-command, packages/agent-cli, packages/agent-ui-terminal
depends_on: [STRUCT-012, REFACTOR-025, BEHAVIOR-2003]
---

# SCREEN-2002: Configure accessible TUI themes and reduced motion

## Objective

Turn the existing fixed semantic palette into a runtime theme registry with light, dark and daltonized
built-ins, user and plugin themes, an interactive picker, an orthogonal syntax-highlighting toggle and a
reduced-motion setting. Preserve text/glyph distinctions so color is never the only signal. One token
model drives every encoding through chalk — Ink, `marked-terminal` and `cli-highlight` — so the two
colour sources the repository does not own stop deciding colours the theme is supposed to own; the host
persists three flat settings keys and the TUI never writes them.

## Plan

Three work units under one design gate (the PR Unit Rule), delivered in order, each as its own PR.

- [ ] Unit 1 — TC-01, TC-02, TC-03, TC-04, TC-05, TC-06: the `ITuiTheme` token model and its chalk style
      builder, the four built-ins (daltonized in hex, CVD-guarded), the provider and hooks, the ~31-file
      `PALETTE` migration with the non-React consumers returning token keys, the deletion of
      `tui-palette.ts` and `tui-ansi-palette.ts`, the two consistency ratchets, `useMotion` with its two
      recorded carve-outs, and the SPEC § Color & Motion rewrite. Colour-identical output with four
      recorded byte exceptions.
- [ ] Unit 2 — TC-07, TC-08, TC-09, TC-10: the three settings keys with ONE framework reader and guard,
      the `appearance-settings-patch` host action, `/theme` behind `IThemeCataloguePort`, the
      settings ← env ← flag resolution with the override tier threaded into `renderApp`, and the picker
      with its `theme-picker` keybinding context, published schema and guide entry.
- [ ] Unit 3 — TC-11: user themes from `~/.robota/themes` and plugin themes from the plugin scopes, the
      whole-file-refusal validator with path-named diagnostics, and the visible skip lines.
- [ ] TC-13: the PTY scenario over the built CLI.
- [ ] TC-12: Engineering verification.

## Test Plan

Test token completeness (every `markdown` key marked-terminal colours, every one of cli-highlight's 17
coloured keys), the `dark` theme's colour identity with its four recorded byte exceptions, the CVD guard
on the daltonized built-ins (including its refusal to pass an unsimulable value), the two consistency
ratchets, motion's single owner and its two carve-outs, the settings precedence and the override tier,
the command with and without its port, the picker's preview/restore/toggles and screen-reader rows, and
the validator's whole-file refusal with a path-named diagnostic. Run a PTY scenario that switches
built-in, custom and plugin themes and cuts motion without restarting.

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: automatable | 2`

### Scenario 1: switch themes, load a custom and a plugin theme, and toggle syntax highlighting

- executability: agent-executable
- product surface: robota-tui
- surface rationale: shipped-entrypoint=robota
- prerequisites: affected packages are built; no live credential and no external service are required — the driver starts a local OpenAI-compatible stub HTTP server on 127.0.0.1 whose single canned reply contains a fenced ```ts code block, and an isolated temporary HOME holds an `openai`-type provider profile pointing at it, a `~/.robota/themes/mine.json` custom theme overriding `colors.text.accent`, a `~/.robota/themes/broken.json` whose `colors.text.accent` is `not-a-colour`, and `~/.robota/plugins/theme-fixture/themes/plugged.json` in an installed bundle plugin; a 100×32 xterm-256color PTY with `FORCE_COLOR=3` runs the command from a git-initialised project directory
- command: `pnpm exec robota --name theme-scenario`
- observable type: ui-state
- observable rationale: source=rendered-product-ui
- expected observable: visible=at startup one line reads `Skipped theme "broken.json": $.overrides.colors.text.accent …`; `/theme list` lists `dark`, `light`, `dark-daltonized`, `light-daltonized`, `custom:mine` and `custom:theme-fixture:plugged` with their sources; submitting `show me a snippet` renders the stub's reply and its code block carries syntax-highlight SGR; `/theme light` redraws the input frame and the status bar in the light theme's colours (their SGR values change) with no restart; `/theme` opens a picker whose highlighted row previews its theme in that same live region and whose `escape` leaves the previously applied theme in place; selecting `custom:mine` applies its overridden accent colour, and `broken.json` appears as a disabled row carrying its reason; pressing `s` in the picker and then submitting `show me a snippet` again renders a code block with no highlight SGR while the earlier block in the scrollback keeps its own (the transcript is `<Static>` and is not repainted)
- cleanup: exit the Robota process normally with Ctrl+C and confirm it exited, stop the stub server, then remove only the isolated HOME and project directories
- evidence: pending

### Scenario 2: cut motion without cutting colour

- executability: agent-executable
- product surface: robota-tui
- surface rationale: shipped-entrypoint=robota
- prerequisites: affected packages are built; no live credential and no external service are required — the same local stub as Scenario 1, configured to hold its reply for ~4 s so the waiting state is observable across at least ten 400 ms motion ticks; the same isolated temporary HOME and a 100×32 xterm-256color PTY with `FORCE_COLOR=3`
- command: `pnpm exec robota --name motion-scenario --reduced-motion`
- observable type: ui-state
- observable rationale: source=rendered-product-ui
- expected observable: visible=after submitting `show me a snippet`, while the stub holds its reply, successive frames of the `Waiting for response... (ESC to interrupt)` line carry SGR identical to each other, while the input frame, the status bar and the rendered reply are still coloured; the same run without `--reduced-motion` shows that line's SGR changing between frames
- cleanup: exit the Robota process normally with Ctrl+C and confirm it exited, stop the stub server, then remove only the isolated HOME and project directories
- evidence: pending

### [DONE-GATE-STAGE-1] — ✅ PASS | 2026-09-19

**Status upgrade:** scenario drafted → scenario written

Third Stage-1 run, pre-implementation. Ordering check: exempt — the prior-gate map records "DONE-GATE-STAGE-1
has no prior gate". Input state matches: Task `status: in-progress` with no `## Plan` item ticked, author
verdict `SCENARIO DRAFTED: automatable | 2`, both scenarios `evidence: pending`; paired spec
`.agents/spec-docs/active/SCREEN-2002-…` `status: in-progress` with GATE-WRITE / GATE-APPROVAL /
GATE-IMPLEMENT ✅ PASS and `**Delivery mode:** ` + `sequenced` over three work units. Nothing this gate
authorizes has run: `git status --porcelain` carries exactly two paths, the paired spec and this Task, and
`packages/agent-ui-terminal/src/theme/` does not exist. `node scripts/harness/scan-spec-user-execution-section.mjs`
exits 0 (450 governed documents); over this section `validateApplicableScenarioSection` returns ok and
`scenarioContract(body, "automatable")` returns a complete contract for each scenario — the JSON below is the
`stageOneScenarioPayload` derivation from those two contracts.

Per criterion, both scenarios:

1. **Fields complete.** Each carries its ten canonical field lines exactly once: Scenario 1 — command
   `pnpm exec robota --name theme-scenario`, prerequisites (built packages; a local OpenAI-compatible stub on
   127.0.0.1 whose canned reply holds a fenced ` ```ts ` block; an isolated HOME with an `openai`-type profile,
   `~/.robota/themes/mine.json`, the invalid `~/.robota/themes/broken.json`, and
   `~/.robota/plugins/theme-fixture/themes/plugged.json`; a 100×32 xterm-256color PTY with `FORCE_COLOR=3` in a
   git-initialised project), an expected observable, cleanup, `evidence: pending`; Scenario 2 — command
   `pnpm exec robota --name motion-scenario --reduced-motion`, its own prerequisites (the same stub holding its
   reply ~4 s so the waiting state spans at least ten 400 ms motion ticks, the same isolated HOME and PTY), its
   own expected observable, cleanup and `evidence: pending`. The PTY driver the prerequisites refer to does not
   exist yet; the Task `## Plan` folds building it into the work as `- [ ] TC-13: the PTY scenario over the
   built CLI.` (the spec's TC-13 names the same run), which is the rule's "build that environment as part of
   the backlog" route rather than an unmet environment — met.
2. **Executability decision.** Both record `executability: agent-executable`. Neither is `manual-only`, so the
   `automation barrier:` / `unavailable capability:` / `attempted automation:` trio is **N/A** — those three
   fields are required only of a `manual-only` scenario, and asserting them here would be inventing a barrier
   that is not claimed. The PTY-driven TUI claim is not novel in this repository: SCREEN-1993 executed a 100×32
   xterm-256color PTY TUI scenario at Stage 2 — met.
3. **Canonical surface, canonical invocation, product behaviour.** Both: `product surface: robota-tui` with
   `surface rationale: shipped-entrypoint=robota`; `observable type: ui-state` with
   `observable rationale: source=rendered-product-ui`, an allowed TUI pairing; expected values in the
   type-correct `visible=` shape. `productSurfaceInvocation('robota-tui', …)` returns
   `pnpm exec robota --name theme-scenario` and `pnpm exec robota --name motion-scenario --reduced-motion`
   verbatim — one canonical product invocation each, neither chaining nor substituting another command (the same
   checker returns `null` for an `&&`-chained form, so this is a real check, not a vacuous one). The run-2
   defect is gone: the `--reduced-motion` run is now `### Scenario 2` with its own command, prerequisites,
   observable, cleanup and evidence field, and Scenario 1's `command:` carries no parenthetical. Scenario 2's
   observable closes with an A/B baseline clause — "the same run without `--reduced-motion` shows that line's
   SGR changing between frames" — which is an observation of the same canonical surface under the flagless form
   of the same command with the same prerequisites, held in the single-valued `visible=` observable rather than
   substituted into the invocation field; Stage 2 must execute that control run as well as the flagged one.
   Both observables are rendered product UI, verified against the product: the animated line is
   `<WaveText text="  Waiting for response... (ESC to interrupt)" />` at
   `packages/agent-ui-terminal/src/InputArea.tsx:280`, `WaveText` is the package's only animation (its only
   non-test importer is `InputArea.tsx`), and `MOTION.waveIntervalMs = 400` at
   `packages/agent-ui-terminal/src/tui-palette.ts:69` makes "at least ten 400 ms motion ticks" over a ~4 s hold
   exact; Scenario 1's clauses are the startup skip line, `/theme list`, the live `/theme light` redraw, the
   picker's preview/escape/disabled row and the syntax toggle across a `<Static>` transcript. Neither observable
   is a build, typecheck, lint, test run, harness check, CI check, or an inspection of repository text —
   `guardian-observable-verdict=product-behavior` for both — met.
4. **Credential / external-service prerequisite.** Both prerequisites state it explicitly and identically —
   "no live credential and no external service are required" — and name the substitute: a local stub HTTP
   server on 127.0.0.1 started by the driver, reached through an isolated-HOME `openai`-type provider profile.
   An executor learns from the scenario, not from a failure, that nothing external is needed — met.

Field-completeness result: 2 of 2 scenarios complete under the canonical contract; 0 unwritten scenarios, so
the written-is-impossible exception is not invoked.

<!-- checkpoint-evidence:v1:start -->

```json
{
  "version": 1,
  "form": "doneGateStageOne",
  "outcome": "automatable",
  "scenarios": [
    {
      "name": "Scenario 1: switch themes, load a custom and a plugin theme, and toggle syntax highlighting",
      "surface": "robota-tui",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota --name theme-scenario",
      "observableType": "ui-state",
      "observable": "visible=at startup one line reads `Skipped theme \"broken.json\": $.overrides.colors.text.accent …`; `/theme list` lists `dark`, `light`, `dark-daltonized`, `light-daltonized`, `custom:mine` and `custom:theme-fixture:plugged` with their sources; submitting `show me a snippet` renders the stub's reply and its code block carries syntax-highlight SGR; `/theme light` redraws the input frame and the status bar in the light theme's colours (their SGR values change) with no restart; `/theme` opens a picker whose highlighted row previews its theme in that same live region and whose `escape` leaves the previously applied theme in place; selecting `custom:mine` applies its overridden accent colour, and `broken.json` appears as a disabled row carrying its reason; pressing `s` in the picker and then submitting `show me a snippet` again renders a code block with no highlight SGR while the earlier block in the scrollback keeps its own (the transcript is `<Static>` and is not repainted)",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "affected packages are built; no live credential and no external service are required — the driver starts a local OpenAI-compatible stub HTTP server on 127.0.0.1 whose single canned reply contains a fenced ```ts code block, and an isolated temporary HOME holds an `openai`-type provider profile pointing at it, a `~/.robota/themes/mine.json` custom theme overriding `colors.text.accent`, a `~/.robota/themes/broken.json` whose `colors.text.accent` is `not-a-colour`, and `~/.robota/plugins/theme-fixture/themes/plugged.json` in an installed bundle plugin; a 100×32 xterm-256color PTY with `FORCE_COLOR=3` runs the command from a git-initialised project directory",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota --name theme-scenario"
      },
      "expectedObservable": "visible=at startup one line reads `Skipped theme \"broken.json\": $.overrides.colors.text.accent …`; `/theme list` lists `dark`, `light`, `dark-daltonized`, `light-daltonized`, `custom:mine` and `custom:theme-fixture:plugged` with their sources; submitting `show me a snippet` renders the stub's reply and its code block carries syntax-highlight SGR; `/theme light` redraws the input frame and the status bar in the light theme's colours (their SGR values change) with no restart; `/theme` opens a picker whose highlighted row previews its theme in that same live region and whose `escape` leaves the previously applied theme in place; selecting `custom:mine` applies its overridden accent colour, and `broken.json` appears as a disabled row carrying its reason; pressing `s` in the picker and then submitting `show me a snippet` again renders a code block with no highlight SGR while the earlier block in the scrollback keeps its own (the transcript is `<Static>` and is not repainted)",
      "cleanup": "exit the Robota process normally with Ctrl+C and confirm it exited, stop the stub server, then remove only the isolated HOME and project directories",
      "evidence": "pending"
    },
    {
      "name": "Scenario 2: cut motion without cutting colour",
      "surface": "robota-tui",
      "surfaceRationale": "shipped-entrypoint=robota",
      "invocation": "pnpm exec robota --name motion-scenario --reduced-motion",
      "observableType": "ui-state",
      "observable": "visible=after submitting `show me a snippet`, while the stub holds its reply, successive frames of the `Waiting for response... (ESC to interrupt)` line carry SGR identical to each other, while the input frame, the status bar and the rendered reply are still coloured; the same run without `--reduced-motion` shows that line's SGR changing between frames",
      "observableRationale": "source=rendered-product-ui",
      "guardianObservableVerdict": "product-behavior",
      "executability": "agent-executable",
      "prerequisite": "affected packages are built; no live credential and no external service are required — the same local stub as Scenario 1, configured to hold its reply for ~4 s so the waiting state is observable across at least ten 400 ms motion ticks; the same isolated temporary HOME and a 100×32 xterm-256color PTY with `FORCE_COLOR=3`",
      "action": {
        "kind": "command",
        "value": "pnpm exec robota --name motion-scenario --reduced-motion"
      },
      "expectedObservable": "visible=after submitting `show me a snippet`, while the stub holds its reply, successive frames of the `Waiting for response... (ESC to interrupt)` line carry SGR identical to each other, while the input frame, the status bar and the rendered reply are still coloured; the same run without `--reduced-motion` shows that line's SGR changing between frames",
      "cleanup": "exit the Robota process normally with Ctrl+C and confirm it exited, stop the stub server, then remove only the isolated HOME and project directories",
      "evidence": "pending"
    }
  ]
}
```

<!-- checkpoint-evidence:v1:end -->

## Recommendation Evidence

**Depth triage (2026-09-19).** `finding-depth-triager` — `DEPTH VERDICT: LOCAL`: a scoped feature gap on the substrate SCREEN-006 built for it and deliberately deferred as an app-layer follow-up, now unblocked by CMD-004's host-owned settings; every mechanism needed has an in-repo precedent (the screen-reader resolved-boolean context, the statusline settings patch with refresh-on-result, the output-style list/switch command, the keybinding contexts, glyph+colour pairing, per-kind plugin loading). It also found the completeness item the spec carries: `marked-terminal`'s default chalk styles are a colour source the token inventory must drive.

**Prior art (2026-09-19).** `prior-art-researcher` — `PRIOR_ART_RESEARCH: FOUND`: Claude Code, Gemini CLI, GitHub Copilot CLI, OpenAI Codex CLI, Aider, VS Code, the GitHub theme family, Windows Terminal, iTerm2, bat, NO_COLOR, `prefers-reduced-motion` and WCAG 1.4.1, surveyed from product documentation. The block and its citations are in the spec's `## Prior Art Research`.

**Independent review (2026-09-19).** `proposal-reviewer` over three rounds against the live source:

- Round 1 — `REVIEW VERDICT: REVISE`, 7 findings: `cli-highlight`'s default theme was an untouched fifth colour source; `/theme` had no access to the registry it validates against; two value grammars; two validation policies; the two non-React palette consumers (`status-glyph`, `status-activity`) could not call a hook; the motion rule would have been copied to three sites; the reduced-motion switch did not follow the accessibility settings ← env ← flag precedent.
- Round 2 — `REVIEW VERDICT: REVISE`, 7 findings: the reader and guard were placed in a contract package whose own SPEC exports no runtime value; `useMotion` was wired to a spinner that does not exist and would have stripped content from a sighted user; the `syntax` map had to be complete, not illustrative; two more colour leaks (`execution-workspace-view-model.ts`, `CjkTextInput.tsx`) and a second ratchet; the override tier had to be env/flag only; the user theme directory belongs in the CLI's contribution source, ids are namespaced so precedence is moot, and the CVD metric had to be named; one PR conflicted with the PR Unit Rule.
- Round 3 — `REVIEW VERDICT: ENDORSE`, with one correction folded into the spec: unit 1's bar is colour identity with four measured byte exceptions (chalk's paired closers on diff rows, the builder's SGR chain order, `syntax.type` keeping `dim`, and `strong`/`em`/`listitem` staying untouched because they carry no colour today), `markdown.html` added, and one assertion that a themed `syntax` key reaches the rendered output.

Loop-run record: `.agents/loop-runs/backlog-execution-orchestrator.jsonl` run `r20260919074607`, `roundFindings: [7, 7, 0]`.
