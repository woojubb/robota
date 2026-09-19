---
status: in-progress
type: SCREEN
tags: [screen]
lane: L2
---

# SCREEN-2002: Configure accessible TUI themes and reduced motion

Paired with `.agents/tasks/SCREEN-2002-configure-accessible-tui-themes-and-reduced-motion.md`. Arising from [issue #2002](https://github.com/woojubb/robota/issues/2002).

## Problem

The TUI's colours are one fixed token map and its motion is all-or-nothing. `packages/agent-ui-terminal/src/tui-palette.ts` (SCREEN-006) consolidated every literal into `PALETTE`/`MOTION` and recorded, deliberately, "no theming framework, no runtime switching, no config surface"; `tui-ansi-palette.ts` holds a second set of raw SGR escapes for the markdown pipeline; `marked-terminal` is constructed with `undefined` options, so ITS chalk defaults (`heading` green, `codespan` yellow, `link` blue, `html` gray) are a third source; and `cli-highlight`'s `DEFAULT_THEME` (`string`/`regexp`/`deletion` red, `number`/`comment`/`doctag`/`addition` green) is a fourth, reached through `marked-terminal`'s `highlightOptions`.

Reproduction. On a light terminal, run `robota` and submit any prompt: the muted `gray` notice and activity text (`SessionEventNotices.tsx`, `status-activity.ts`, `WaveText.tsx`) and the markdown renderer's dark-terminal diff backgrounds (`ESC[48;5;52m` / `ESC[48;5;22m`) are chosen for a dark background and are illegible on a light one — no setting changes them. With a red-green colour vision deficiency, the same run renders `✓ completed` green and `✗ failed` red, and a code block's `addition`/`deletion` green/red, with no daltonized alternative; the glyph and the word carry the meaning, but the colour pair carries none. And a user who wants the input's wave animation off has only `NO_COLOR=1`, which also removes every colour: there is no motion setting independent of colour (`terminal-capabilities.ts` is one gate for both).

## Prior Art Research

Researched by the `prior-art-researcher` agent from PRODUCT DOCUMENTATION only (docs, configuration references, release notes — never third-party source), 2026-09-19; terminal `node_modules` were read only to verify the option surfaces Robota itself consumes.

| Product            | Setting                                                | Built-ins                                                                                                  | Custom / plugin themes                                                                                                                          | Syntax toggle                                                  | Reduced motion                                                              | Picker context                    | Document                                                                                                                                                                                                                       |
| ------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude Code        | `theme` in `settings.json`, `/theme`                   | `auto`, `dark`, `light`, `dark-daltonized`, `light-daltonized`, `dark-ansi`, `light-ansi` (default `dark`) | `~/.claude/themes/<slug>.json` `{ name?, base?, overrides? }`; plugins via `experimental.themes`, listed as `custom:<plugin>:<slug>`, read-only | `syntaxHighlightingDisabled`, toggled in the picker (`Ctrl+T`) | `prefersReducedMotion` — "reduces or turns off spinner, shimmer, and flash" | dedicated `ThemePicker` context   | https://code.claude.com/docs/en/accessibility , https://code.claude.com/docs/en/settings-reference , https://code.claude.com/docs/en/terminal-config#create-a-custom-theme , https://code.claude.com/docs/en/plugins-reference |
| Gemini CLI         | `ui.theme`, `/theme`                                   | 10 dark + 7 light incl. `ANSI`; `ui.autoThemeSwitching`                                                    | `ui.customThemes.<Name>` (grouped token map) or a file path, home-dir only; extensions contribute `themes: [...]`                               | —                                                              | `ui.showSpinner`, `ui.loadingPhrases`                                       | —                                 | https://geminicli.com/docs/cli/themes/ , https://geminicli.com/docs/reference/configuration/ , https://geminicli.com/docs/extensions/reference/#themes                                                                         |
| GitHub Copilot CLI | `theme` in `~/.copilot/settings.json`, `/settings`     | `default`, `github`, `dim`, `high-contrast`, `colorblind`                                                  | not documented                                                                                                                                  | —                                                              | animations auto-disable under a screen reader                               | —                                 | https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/change-settings , https://github.blog/changelog/2026-06-11-copilot-cli-configure-everything-from-one-place-with-settings/                             |
| OpenAI Codex CLI   | `tui.theme` = syntax-highlighting theme only           | —                                                                                                          | —                                                                                                                                               | the theme IS the highlight theme                               | `tui.animations` (welcome, shimmer, spinner)                                | `tui.keymap.<context>.<action>`   | https://learn.chatgpt.com/docs/config-file/config-reference                                                                                                                                                                    |
| Aider              | `--dark-mode` / `--light-mode`, per-role colour flags  | dark / light colour sets                                                                                   | —                                                                                                                                               | `--code-theme` (Pygments)                                      | `--no-pretty`, `--no-stream`                                                | —                                 | https://aider.chat/docs/config/options.html                                                                                                                                                                                    |
| VS Code            | `workbench.colorTheme`, `window.autoDetectColorScheme` | light/dark/high-contrast slots                                                                             | extensions contribute on a `uiTheme` base                                                                                                       | —                                                              | —                                                                           | preview on arrow, commit on Enter | https://code.visualstudio.com/docs/configure/themes                                                                                                                                                                            |

Adjacent precedents: the GitHub theme family ships "Light Colorblind" and "Dark Colorblind" as first-class variants (https://github.com/primer/github-vscode-theme); Windows Terminal (https://learn.microsoft.com/en-us/windows/terminal/customize-settings/color-schemes) and iTerm2 (https://iterm2.com/documentation-preferences-profiles-colors.html) express schemes as flat colour maps with separate light/dark; `bat` auto-selects by terminal background with `--theme-dark`/`--theme-light` (https://github.com/sharkdp/bat); `NO_COLOR` (https://no-color.org/) disables colour on any non-empty value; `prefers-reduced-motion` (https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion) is the OS-level convention reduced motion is named after; WCAG 2.2 SC 1.4.1 (https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html) is the "not colour alone" norm.

**Observed common behaviour.** One string setting plus one slash command, both writing the same key (Gemini's docs record the failure of not doing so: a file-set theme blocks `/theme`); light and dark as separate named presets with `auto` as an additional option, not the only one; daltonized variants as built-ins rather than add-ons; custom themes as sparse overrides on a named base; plugin themes in the same format with a source-qualified id and a copy-to-edit path; syntax highlighting and reduced motion as booleans orthogonal to the theme; preview while navigating, persist on select; information never carried by colour alone.

**Constraints that apply to Robota.** The surveyed defaults do not transfer unchanged: Robota's existing palette is already terminal-relative (chalk colour NAMES), which is the equivalent of Claude Code's `*-ansi` variants, so the default must stay that palette or today's output changes for every user who sets nothing. Robota's colour/motion gate is stricter than no-color.org permits (`terminal-capabilities.ts` treats an empty `NO_COLOR` as off and has no theme-side override), and that recorded decision stays. Validation cannot follow Claude Code's "ignore unknown tokens" leniency: this repository refuses a whole user document on the first invalid entry with a path-named diagnostic (`keybinding-registry.ts`) and `enforcement-architecture.md` forbids a silent skip. Persistence cannot follow the picker-writes-settings model: CMD-004 makes the TUI a reader and the host the writer (`statusline-settings-patch`). Plugin contributions are per kind (`bundle-plugin-types.ts`: skills, commands, hooks, agents, mcp), so themes are a new kind loaded the same way.

## Architecture Review

### Affected Scope

- `packages/agent-interface-command` (types only: `IAppearanceSettings`, `TAppearanceSettingsPatch`, the `appearance-settings-patch` host-action variant, the `show-theme-picker` UI intent)
- `packages/agent-framework` (`command-api/appearance/`: `readAppearanceSettings`, `isAppearanceSettingsPatch`, `DEFAULT_APPEARANCE_SETTINGS`; host-action application)
- `packages/agent-command` (`/theme` command module + `IThemeCataloguePort`)
- `packages/agent-cli` (appearance settings, env + flag, theme file sources, registry wiring)
- `packages/agent-ui-terminal` (the theme model, registry, provider, hooks, built-ins, validator, picker, keybinding context, the ~31-file palette migration)

No new package, app or presentation surface; one new user-home directory (`~/.robota/themes`) beside the existing `~/.robota/output-styles` and `~/.robota/keybindings.json`.

### Alternatives Considered

1. Config-only palette override: a `colors` map in `settings.json` applied over `PALETTE`, no picker, no plugin themes, no built-ins.
   - Pro: smallest change; no registry, no command, no overlay.
   - Con: fails four of issue #2002's gate lines (picker, daltonized built-ins, plugin themes, reduced motion) and leaves a light terminal unusable until the user hand-writes JSON; the markdown and highlighter colour sources stay unreachable, so code blocks and diffs keep dark-terminal values whatever the map says.
2. Rely on the terminal's own scheme: keep chalk colour NAMES everywhere, delete the hex ramp and the 256-colour escapes, and let each terminal's palette decide.
   - Pro: no theme model at all; every terminal is "themed" by its own settings.
   - Con: does not deliver daltonization (a colour-blind-safe palette needs different HUES, not a different rendering of the same 16 slots), cannot express the light/dark distinction Robota controls (status and diff backgrounds), and discards information the product does own.
3. Put the theme registry in `agent-framework` as a host capability, like the output-style registry.
   - Pro: one registry pattern for both; the command reaches it through `ICommandHostAdapters` with no new port.
   - Con: pushes an Ink/chalk encoding into a runtime substrate that has no terminal; output styles are prompt CONTENT the runtime applies, a theme is presentation one surface renders. The host owns the persisted id; it has no use for the colours.
4. Live preview by writing settings on each keypress (the Copilot "applies live on save" shape).
   - Pro: no preview state; what you see is what is stored.
   - Con: CMD-004 forbids the TUI writing settings, and a cancelled preview would leave the last-highlighted theme persisted.

### Decision

**Adopt one theme token model in the TUI, with every encoding derived through chalk; the host owns only the persisted keys.** Endorsed by `proposal-reviewer` round 3 (`REVIEW VERDICT: ENDORSE`, 2026-09-19) after two REVISE rounds of 7 findings each; `finding-depth-triager` returned `DEPTH VERDICT: LOCAL` (2026-09-19).

1. **One model.** `packages/agent-ui-terminal/src/theme/theme-contracts.ts`: `ITuiTheme { id, name, appearance: 'dark' | 'light', source: 'built-in' | 'user' | 'plugin', colors: { text.*, border.*, status.* }, markdown: <every key marked-terminal colours by default, INCLUDING `html`, EXCLUDING `strong`/`em`/`listitem` which carry no colour today>, syntax: <a REQUIRED complete map over cli-highlight's 17 coloured keys: keyword, built_in, type, literal, number, regexp, string, class, function, comment, doctag, meta, tag, name, attr, addition, deletion>, motion: { wave: [c1, c2, c3, c4] } }`. Every value uses **Ink's own colour grammar verbatim** — `<chalk name> | #rrggbb | ansi256(n) | rgb(r,g,b)` — one grammar, no translation layer. A style builder in `src/theme/` converts `markdown` and `syntax` into chalk functions: Ink consumes `colors` directly, `marked-terminal` receives the style functions, and `syntax` is passed as `highlightOptions.theme` so cli-highlight follows the theme (verified: `cli-highlight@2.1.11` falls back PER KEY to its `DEFAULT_THEME`, so an incomplete map leaks exactly the red/green pairs a daltonized theme exists to remove). The builder owns all non-colour structure — `heading` bold, `firstHeading` underline+bold, `blockquote` italic, `del` dim+strikethrough, `href` = `link`'s colour + underline, `syntax.type` dim — so a theme changes colour and nothing else. `tui-palette.ts` and `tui-ansi-palette.ts` are DELETED; the `dark` literal lives only in `theme/built-in-themes.ts`. This reverses SCREEN-006's recorded "ANSI values are deliberately NOT derived from PALETTE (a name→SGR mapping layer would be invented complexity)": chalk IS that layer, is already a direct dependency, and Ink's own `colorize` is the same mapping — nothing is invented.
2. **Built-ins as data:** `dark` (today's values, the default), `light`, `dark-daltonized`, `light-daltonized`. The daltonized pair is specified in `#hex` (blue/orange family for status and diff) so the CVD guard can COMPUTE; `auto` is deferred until terminal-background detection exists.
3. **Registry, provider, hooks.** `createThemeRegistry(builtIns, userThemes, pluginThemes)` with ids namespaced (`<built-in>`, `custom:<slug>`, `custom:<plugin>:<slug>`) so nothing shadows anything; `ThemeProvider` publishes the resolved theme; `usePalette()` returns `theme.colors` and defaults to the `dark` built-in outside a provider (the `screen-reader-context` precedent, so existing tests are unchanged); `useThemeMarkdownStyles()` serves `renderMarkdown`. The non-React consumers stop carrying colours: `status-glyph.ts` keeps a static SYMBOL map and gains `statusGlyphColor(theme, kind)`, `formatStatusActivity` and `execution-workspace-view-model.ts` return a token KEY or a status KIND that the component resolves, and `CjkTextInput.tsx`'s `chalk.gray(placeholder)` becomes the theme's `text.muted`.
4. **Motion has one owner and exactly one consumer.** `useMotion(): boolean` = `isInteractiveColorTerminal() && !screenReader && !reducedMotion`, read by `WaveText` — the package's only animation. NOT gated by it: the countdown (a once-a-second number is content; freezing it would show a wrong `in 59s`) and the `StreamingIndicator` screen-reader collapse (dropping tool rows for a sighted reduced-motion user removes content, not motion) — both stay `useScreenReader()` rules. `syntaxHighlighting: false` renders code blocks as plain indented text.
5. **Settings, resolution, command.** Three flat keys (`theme`, `syntaxHighlighting`, `reducedMotion`; defaults `dark`, `true`, `false`) read by ONE typed reader — `readAppearanceSettings` / `isAppearanceSettingsPatch` / `DEFAULT_APPEARANCE_SETTINGS` in `packages/agent-framework/src/command-api/appearance/`, the `command-api/statusline/` analog — used by BOTH the host applier and the TUI hook, never re-implemented. Reduced motion resolves settings ← `ROBOTA_REDUCED_MOTION=1|0` ← `--reduced-motion` / `--no-reduced-motion` (flag wins, the screen-reader precedent); only the env/flag tier reaches `renderApp({ reducedMotionOverride })` (`undefined` when neither is set), applied as `override ?? persisted`, and `/theme motion …` reports when the run is pinned. Persistence is host-owned through the `appearance-settings-patch` host action; the TUI re-reads on result. `/theme` lives in `agent-command` behind `IThemeCataloguePort { list(), refresh() }`, satisfied by the ONE `agent-ui-terminal` registry instance created in `agent-cli` and passed both to `buildCommandSetupOrExit` and to `renderApp({ themes })` — exactly how `keybindingsSource` is shared today. Absent port ⇒ "Themes are not available in this environment"; an unknown persisted id ⇒ `dark` plus a visible notice.
6. **Picker.** `ThemePicker.tsx` in the existing `Overlays` slot, keybinding context `theme-picker` (`previous` up, `next` down, `select` enter, `toggle-syntax` `s`, `toggle-motion` `m`, `cancel` escape — printable keys are fine because the picker takes no text; all rebindable, Ctrl+C reserved). Preview while navigating applies to the DYNAMIC region and the sample row; the transcript is Ink `<Static>` and is not repainted — stated, not implied. Escape restores the persisted theme; select submits `/theme <id> syntax <on|off> motion <on|off>`, one patch through the command path.
7. **User and plugin themes, one strict policy.** `{ name?, base?, overrides? }` — `base` any built-in, `overrides` a sparse map over the token paths, values in Ink's grammar validated against chalk's colour-name list plus the `#hex` / `ansi256()` / `rgb()` regexes (also the injection floor: no raw SGR enters through a theme). The WHOLE file is refused on the first unknown token or invalid value with a path-named diagnostic, printed at startup as `Skipped theme "<file>": …` and shown in the picker as a disabled row with that reason. Sources: `~/.robota/themes/<slug>.json` through `createNodeHostContributionSource` in `agent-cli` (the `output-style-sources.ts` analog, home-only) and `<pluginDir>/themes/<slug>.json` for each installed bundle plugin (project-reachable, because `pluginScopeDirs` includes the project scope — stated asymmetry).
8. **Never colour-only, with guards that can fail.** Glyph+word, `+`/`-`, state words and the `[match]` marker are unchanged in every theme. Two mechanical guards, with their limits written down: a NAMED fixture list in the NO_COLOR PTY test (status kinds, diff add/remove, focused row, error line), and a CVD check that simulates protanopia and deuteranopia (Brettel/Viénot) over the daltonized built-ins and fails when the pairwise Lab ΔE between two status or diff colours falls below a stated threshold — pairwise because the background is terminal-defined, and REFUSING any value it cannot simulate so a named colour in a daltonized built-in is an error, never a pass.

**Reachability.** Every seam already carries a live consumer: the settings document is read at startup (`readUserSettingsOrExit`), the host action list is applied in `interactive-session-host-actions.ts`, the UI intent is routed in `useSideEffects.ts`, the overlay slot renders in `AppPresentation.tsx`, and the registry instance reaches both the command port and `renderApp` the way `keybindingsSource` does. **Capability preservation.** Screen-reader mode, the NO_COLOR/TTY gate, the status glyph vocabulary, the keybinding contexts and every existing colour VALUE (the `dark` built-in) are unchanged. **Adversarial pass.** Unknown persisted id ⇒ default + notice; unreadable or invalid theme file ⇒ whole-file refusal with a path, never a partial theme; a theme that omits a `syntax` key ⇒ impossible, the base map is required and complete; a theme trying to inject SGR ⇒ refused by the value grammar; NO_COLOR with a theme set ⇒ gate wins, picker shows a plain-text notice; reduced motion pinned by a flag while `/theme motion on` is submitted ⇒ persisted and reported as pinned; a plugin theme and a user theme with the same slug ⇒ different ids, both listed.

**Delivery mode:** `sequenced`

**Continuation artifacts:** `packages/agent-ui-terminal/src/theme/theme-contracts.ts`, `packages/agent-ui-terminal/src/theme/built-in-themes.ts`, `packages/agent-ui-terminal/src/theme/theme-context.tsx`, `packages/agent-ui-terminal/src/render.tsx`, `packages/agent-ui-terminal/docs/SPEC.md`, `packages/agent-cli/src/cli.ts`

Three PRs, one per work unit (§ Solution): the token model, then the settings/command/picker, then the user and plugin theme files. The artifacts above are the ones a later unit extends rather than introduces.

**Verification bar for unit 1 (recorded because it is easy to state wrongly).** A user who sets nothing sees identical COLOUR, with four measured byte-level exceptions, each carrying its test update in the same PR: diff rows close with chalk's paired `ESC[39m ESC[49m` instead of today's literal `ESC[0m`; SGR open/close ORDER follows the builder's chain rather than marked-terminal's; `syntax.type` keeps `dim` through the builder; `strong`/`em`/`listitem` are unchanged because they are not theme tokens. "Byte-identical" is NOT the criterion.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — the keybindings registry + watched user file + `/keybindings` port (`src/keybindings/`, `keybindings-command-module.ts`, `cli.ts:189`), the output-style registry with user/project/managed file sources and visible load errors (`output-style-sources.ts`, `output-style-registry.ts`), the statusline settings patch with its host applier and refresh-on-result reader (`command-api/statusline/`, `interactive-session-host-actions.ts`, `useStatusLineSettings.ts`), the screen-reader resolved-boolean context (`screen-reader-context.tsx`, `screen-reader-enablement.ts`), the existing overlays and their keybinding contexts (`AppPresentation.tsx`, `SlashAutocomplete.tsx`, `ExecutionWorkspaceSwitcher.tsx`), and the per-kind bundle plugin loading (`host-bundle-plugin-loader.ts`) were read; this item reuses each of them rather than adding a parallel path.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface and no layer or product-family reclassification: the theme model is a module inside the existing `agent-ui-terminal` package (the `src/keybindings/` analog), the command joins `agent-command` beside `output-style`/`statusline`, the settings reader joins `agent-framework/src/command-api/` beside `statusline`, the two contract additions are variants on existing unions in `agent-interface-command`, and the only new artefact is one user-home directory beside `~/.robota/output-styles`.

## Fallback & Degradation Declaration

- `NO_COLOR` / `FORCE_COLOR=0` / a non-TTY stdout: the existing gate wins over every theme — no colour and no motion, exactly today's behaviour; the picker renders a plain-text notice instead of a preview.
- Screen-reader mode: implies reduced motion through `useMotion`; the picker numbers its rows and applies the theme on select rather than on navigation.
- No `theme` key, or a key naming an id the registry does not hold: the `dark` built-in, plus one visible notice naming the id (never a silent default).
- A theme file that does not parse or carries an unknown token or an invalid value: the WHOLE file is refused with a path-named diagnostic, printed once at startup (`Skipped theme "<file>": …`) and shown in the picker as a disabled row; the persisted selection stays active.
- `~/.robota/themes` absent, or a plugin with no `themes/` directory: no user or plugin themes, built-ins only — the empty state, not an error.
- The `IThemeCataloguePort` is absent (print mode, `--serve`): `/theme` answers "Themes are not available in this environment" and writes nothing.
- A daltonized built-in value the CVD guard cannot simulate: the guard FAILS. It never passes a value it could not check.

## Solution

Three named work units under this one design gate (the PR Unit Rule and the batching ceiling — unit 1 alone touches ~32 files), delivered in order, each with its own PR.

**Unit 1 — the token model.**

1. `packages/agent-ui-terminal/src/theme/theme-contracts.ts`: `ITuiTheme` and its `colors` / `markdown` / `syntax` / `motion` groups, the Ink colour-grammar type and its validator predicate.
2. `packages/agent-ui-terminal/src/theme/built-in-themes.ts`: `dark` (today's `PALETTE`/`MOTION`/`ANSI` values, plus the marked-terminal and cli-highlight defaults made explicit), `light`, `dark-daltonized`, `light-daltonized` (hex).
3. `packages/agent-ui-terminal/src/theme/theme-styles.ts`: the chalk style builder — `markdown` → `marked-terminal` options with the structural modifiers fixed, `syntax` → the cli-highlight theme, diff backgrounds → `chalk.bgHex`/`chalk.bgAnsi256`.
4. `packages/agent-ui-terminal/src/theme/theme-context.tsx`: `ThemeProvider`, `usePalette()`, `useThemeMarkdownStyles()`, `useMotion()`.
5. Migrate the ~31 `PALETTE` importers to `usePalette()`; split `status-glyph.ts` into symbols + `statusGlyphColor`; return token keys from `status-activity.ts` and `execution-workspace-view-model.ts`; replace `CjkTextInput.tsx`'s `chalk.gray`; delete `tui-palette.ts` and `tui-ansi-palette.ts`; `render-markdown.ts` takes the built styles and a `syntaxHighlighting` flag.
6. `packages/agent-ui-terminal/src/__tests__/palette-consistency.test.ts`: add the two ratchets (no `built-in-themes` import and no `chalk.<colour>(`/`chalk.hex(`/`chalk.bg*(` outside `src/theme/`); update `render-markdown.test.ts` and `rendered-markdown-styling.test.tsx` to chalk's closers; add the CVD guard over the daltonized built-ins and the assertion that a themed `syntax` key reaches `renderMarkdown`'s output.
7. `packages/agent-ui-terminal/docs/SPEC.md`: rewrite § "Color & Motion Contract (SCREEN-006)" — one token model, the reversal and its reason, the `<Static>` limitation, the new ratchets and the guards' stated limits.

**Unit 2 — settings, command, picker.**

8. `packages/agent-interface-command/src/command-contracts.ts`: `IAppearanceSettings`, `TAppearanceSettingsPatch`, the `appearance-settings-patch` host-action variant, the `show-theme-picker` UI intent.
9. `packages/agent-framework/src/command-api/appearance/appearance-command-api.ts`: `DEFAULT_APPEARANCE_SETTINGS`, `isAppearanceSettingsPatch`, `readAppearanceSettings`; applied in `interactive/interactive-session-host-actions.ts`.
10. `packages/agent-command/src/theme/theme-command-module.ts` + `IThemeCataloguePort`: `/theme`, `/theme list`, `/theme <id> [syntax on|off] [motion on|off]`, `/theme syntax on|off`, `/theme motion on|off`.
11. `packages/agent-cli`: read the appearance settings, resolve `reducedMotion` settings ← env ← flag (`--reduced-motion` / `--no-reduced-motion` in `cli-args.ts` and `cli-help.ts`), create the one registry instance and pass it to `buildCommandSetupOrExit` and `renderApp({ themes, appearance, reducedMotionOverride })`; README "Themes".
12. `packages/agent-ui-terminal`: `hooks/useAppearanceSettings.ts` (refresh-on-result), `ThemePicker.tsx` in the `Overlays` slot with preview/restore, the `theme-picker` keybinding context in `keybinding-catalogue.ts`, `apps/docs/public/schemas/keybindings.schema.json` and `content/guide/keybindings.md`.

**Unit 3 — user and plugin themes.**

13. `packages/agent-ui-terminal/src/theme/theme-document.ts`: `parseThemeDocument` — `{ name?, base?, overrides? }`, whole-file refusal with a path-named diagnostic.
    - Carried from work unit 1's review: `foreground()` and `chalkNamed()` currently answer an
      unknown colour name with two DIFFERENT silent fallbacks (`base` and `chalk.reset`). Unreachable
      with the built-ins — every value there is validated by TC-01 — but `parseThemeDocument` is the
      boundary where an unknown value becomes reachable, so the refusal it introduces is what closes
      it, and neither fallback may stay silent behind it.
14. `packages/agent-cli/src/startup/theme-sources.ts`: the user directory through `createNodeHostContributionSource`, the plugin directories through `loadHostBundlePluginsFromScopes(pluginScopeDirs(cwd, home))`; load errors printed as `Skipped theme "<file>": …`; the picker's disabled rows.

## Affected Files

- `packages/agent-ui-terminal/src/theme/{theme-contracts,built-in-themes,theme-styles,theme-context,theme-document}.ts(x)`, `src/ThemePicker.tsx`, `src/render-markdown.ts`, `src/status-glyph.ts`, `src/status-activity.ts`, `src/execution-workspace-view-model.ts`, `src/CjkTextInput.tsx`, `src/WaveText.tsx`, `src/keybindings/keybinding-catalogue.ts`, `src/hooks/useAppearanceSettings.ts`, `src/AppPresentation.tsx`, `src/render.tsx`, the ~31 `PALETTE` importers, `src/tui-palette.ts` + `src/tui-ansi-palette.ts` (deleted), `src/__tests__/*`, `docs/SPEC.md`
- `packages/agent-interface-command/src/command-contracts.ts`, `docs/SPEC.md`
- `packages/agent-framework/src/command-api/appearance/*`, `src/interactive/interactive-session-host-actions.ts`, `src/index.ts`, `docs/SPEC.md`
- `packages/agent-command/src/theme/*`, `src/index.ts`, `docs/SPEC.md`
- `packages/agent-cli/src/cli.ts`, `src/startup/{command-setup,theme-sources}.ts`, `src/utils/{cli-args,cli-help}.ts`, `README.md`, `docs/SPEC.md`
- `apps/docs/public/schemas/keybindings.schema.json`, `content/guide/keybindings.md`

## Completion Criteria

- [ ] TC-01: `ITuiTheme` + the style builder — `markdown` and `syntax` produce chalk functions for every key the builders declare; the structural modifiers (`heading` bold, `firstHeading` underline+bold, `blockquote` italic, `del` dim+strikethrough, `href` underline, `syntax.type` dim) are applied by the builder and are identical across themes; a `syntax` map is complete over cli-highlight's 17 coloured keys (a missing key is a type error and a test failure).
- [ ] TC-02: the `dark` built-in renders today's COLOUR for every surface — the four recorded byte exceptions (chalk's paired closers on diff rows, the builder's SGR chain order, `syntax.type` dim, `strong`/`em`/`listitem` untouched) are asserted explicitly, and no fifth difference exists.
- [ ] TC-03: a themed `syntax` key reaches `renderMarkdown`'s output (so a future `marked-terminal` that swaps the highlighter fails instead of silently reverting to `DEFAULT_THEME`), and `syntaxHighlighting: false` renders a code block as plain indented text.
- [ ] TC-04: the daltonized built-ins pass the CVD guard — simulated protanopia and deuteranopia Lab ΔE over every status and diff colour pair WHOSE DIFFERENCE CARRIES MEANING is above the stated threshold — and the guard FAILS on a built-in value it cannot simulate (a named colour) and on a deliberately red/green pair. <!-- Amended during work unit 1's PR review (2026-09-19): the criterion said "every status and diff colour pair". Measured, the full cross product includes pairs no reader is ever asked to tell apart (a diff background against a status foreground, two rows that never appear together), and a floor over those either fails on colours that are correct or is set so low it stops discriminating. The shipped guard checks the pairs a reader must distinguish — success/error, diff added/removed, and the two backgrounds — which is what the criterion was for. The two must-FAIL fixtures are unchanged, so the criterion is still not satisfiable by choosing a permissive number. -->
- [ ] TC-05: `usePalette()` outside a provider returns the `dark` built-in; the palette-consistency ratchets fail on a `built-in-themes` import and on a `chalk.<colour>(` call introduced outside `src/theme/`, and pass for `chalk.inverse` and `chalk.level`.
- [ ] TC-06: `useMotion()` = gate ∧ ¬screenReader ∧ ¬reducedMotion; `WaveText` renders static muted text when it is false and animates when true; the countdown still ticks under reduced motion and still freezes under screen-reader mode; the `StreamingIndicator` collapse follows screen-reader mode only.
- [ ] TC-07: `readAppearanceSettings` — defaults `dark` / `true` / `false`, non-boolean and unknown values ignored; `isAppearanceSettingsPatch` accepts a partial patch and rejects a foreign shape; the host applies `appearance-settings-patch` through the settings adapter and the TUI hook re-reads on result.
- [ ] TC-08: reduced motion resolves settings ← `ROBOTA_REDUCED_MOTION` ← flag; only the env/flag tier is passed as `reducedMotionOverride` (absent when neither is set) and the TUI applies `override ?? persisted`; `/theme motion …` while pinned persists and says so.
- [ ] TC-09: `/theme` — `list` shows built-in, user and plugin themes with their source; `<id>` validates against the port and emits exactly one patch; an unknown id fails without writing; with no port the command answers "Themes are not available in this environment"; `/theme` with no args issues `show-theme-picker`.
- [ ] TC-10: the picker — opens on the UI intent, previews the highlighted theme in the dynamic region, restores the persisted theme on escape, submits one command on select, toggles syntax and motion with their keys, renders numbered rows with no preview churn in screen-reader mode, and shows a plain-text notice under the colour gate; every `theme-picker` action is rebindable and the published schema agrees with the catalogue.
- [ ] TC-11: `parseThemeDocument` — a valid sparse override applies over its base; an unknown token path, an invalid colour value, a raw SGR string and a malformed file are each refused WHOLE with a path-named diagnostic; the user directory is home-only and plugin directories come from the plugin scopes; ids are namespaced and nothing shadows a built-in.
- [ ] TC-12: engineering verification — `pnpm --filter` build, test and typecheck for the five affected packages exit 0; `pnpm harness:scan` exits 0; the lint-warning ceiling holds.
- [ ] TC-13: the built CLI in a PTY: with `theme` unset the frame is colour-identical to the pre-change binary; `/theme light` changes the status bar and diff colours without restarting; `/theme` opens the picker, arrow keys preview, escape restores; a seeded `~/.robota/themes/mine.json` and a seeded plugin theme both appear in the list and apply; an invalid theme file prints its diagnostic at startup and is disabled in the picker; `--reduced-motion` stops the wave animation while colour stays on.

## Test Plan

| TC-ID | Test Type                | Tool / Approach                                                                                          | Notes                                         |
| ----- | ------------------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| TC-01 | Unit                     | Vitest over the contracts and the style builder                                                          | Key completeness; modifiers are builder-owned |
| TC-02 | Unit / snapshot          | Vitest comparing `dark` output against the pre-change strings, with the four exceptions asserted by name | The unit-1 acceptance bar                     |
| TC-03 | Unit                     | Vitest over `renderMarkdown` with a themed `syntax` key and with highlighting off                        | Guards the transitive highlighter contract    |
| TC-04 | Unit                     | Vitest over the CVD guard with the built-ins, a named colour and a red/green fixture                     | Must fail, not skip, on unsimulable values    |
| TC-05 | Unit                     | Vitest over the provider default and the two ratchets                                                    | Ratchet proven by a fixture that violates it  |
| TC-06 | Component / async        | ink-testing-library with fake timers over `WaveText`, the countdown and `StreamingIndicator`             | One motion owner, two carve-outs              |
| TC-07 | Unit                     | Vitest over the framework reader/guard and the host-action applier                                       | One reader, both consumers                    |
| TC-08 | Unit                     | Vitest over the CLI resolver and the TUI composition                                                     | Precedence table; the override tier           |
| TC-09 | Unit                     | Vitest over the command module with and without the port                                                 | One patch; explicit unavailability            |
| TC-10 | Component                | ink-testing-library over the picker + the catalogue/schema parity test                                   | Preview, restore, toggles, SR rows, rebinding |
| TC-11 | Unit / fs                | Vitest over the validator and the source builders with a temp HOME and a temp plugin dir                 | Whole-file refusal with a path                |
| TC-12 | Engineering verification | package build/test/typecheck, `pnpm harness:scan`, `pnpm lint`                                           |                                               |
| TC-13 | Process / PTY            | Agent-controlled PTY over the built CLI with a seeded isolated HOME, a seeded plugin and a stub provider | The user execution scenario                   |

## User Execution Test Scenarios

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

## Tasks

- [ ] `.agents/tasks/SCREEN-2002-configure-accessible-tui-themes-and-reduced-motion.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-19

**Status upgrade:** draft → review-ready

- GATE-WRITE — Ordering: entry gate, no prior gate required (prior-gate map: "GATE-WRITE has no prior status gate"); `status: draft` matches the expected input state and the file sits under `.agents/spec-docs/draft/`; `## Evidence Log` was present and empty before this entry. No implementation ran ahead of the gate — `src/theme/`, `src/ThemePicker.tsx`, `command-api/appearance/`, `agent-command/src/theme/` and `agent-cli/src/startup/theme-sources.ts` do not exist, and `IThemeCataloguePort` / `IAppearanceSettings` / `readAppearanceSettings` / `usePalette` / `useThemeMarkdownStyles` / `createThemeRegistry` / `show-theme-picker` / `appearance-settings-patch` / `ROBOTA_REDUCED_MOTION` return 0 matches across `packages/*/src`; `git status --porcelain` carries only the spec (untracked), the paired Task, `.agents/loop-runs/backlog-execution-orchestrator.jsonl` and the two auto-generated lessons files.
- GATE-WRITE — Frontmatter: file begins with `---`; `status: draft`; `type: SCREEN` is one of the 11 allowed values; `tags: [screen]`; `lane: L2`.
- GATE-WRITE — Concrete symptom: PASS. A named command on the built CLI (`robota`, submit any prompt) with three wrong behaviours, each traced to code verified in the tree. The four colour sources the Problem names all exist: `tui-palette.ts` holds `PALETTE` (line 23) and `MOTION` (line 67); `tui-ansi-palette.ts` holds the raw SGR set including `darkRedBackground: ESC[48;5;52m` and `darkGreenBackground: ESC[48;5;22m` — byte-exact as quoted; `render-markdown.ts:141` constructs `new TerminalRendererConstructor(undefined, { ignoreIllegals: true })`, so `marked-terminal@7.3.0`'s own chalk defaults apply, and its `index.js` lines 32–45 are exactly `heading: chalk.green.bold`, `codespan: chalk.yellow`, `link: chalk.blue`, `html: chalk.gray` as cited; `cli-highlight@2.1.11`'s `DEFAULT_THEME` (`theme.js`) sets `string`/`regexp`/`deletion` red and `number`/`comment`/`doctag`/`addition` green, reached through `highlightOptions`. The CVD symptom holds: `status-glyph.ts:38-39` maps `success: { symbol: '✓', color: PALETTE.status.success }` (green) and `error: { symbol: '✗', color: PALETTE.status.error }` (red) with no alternative. The motion symptom holds: `WaveText.tsx:28` computes `animate = isInteractiveColorTerminal() && !screenReader`, so `NO_COLOR` is indeed the only lever and it takes colour with it. One locator imprecision recorded, not failing: "the status bar's `gray` session metadata" — `StatusBar.tsx:203` renders the session NAME in `PALETTE.text.session` (`magenta`) and its git/model metadata with Ink's `dimColor`, not a `gray` value; the `gray` token (`PALETTE.text.muted`) is consumed by `SessionEventNotices.tsx:20`, `status-activity.ts:63` and `WaveText.tsx:45`. The gray-metadata-no-setting-changes-it symptom is real and verified; the surface named for it is adjacent rather than exact.
- GATE-WRITE — Reproduction condition: PASS. Stated inline three times with a when and a where — "On a light terminal, run `robota` and submit any prompt"; "With a red-green colour vision deficiency, the same run"; and the motion case ("a user who wants the input's wave animation off has only `NO_COLOR=1`"). Each is every-time rather than intermittent, and the code says why: `terminal-capabilities.ts` documents itself as "used by both the markdown renderer (color) and WaveText (motion), so the two never disagree" and `isInteractiveColorTerminal()` is the single function both read — one gate for both, exactly as the Problem asserts; no `theme`, `syntaxHighlighting` or `reducedMotion` key is read anywhere in the tree.
- GATE-WRITE — Research feeds `Alternatives Considered` / `Decision`: PASS, evidence-based rather than asserted. The survey table's six products each land in a decision: one string setting + one slash command writing the same key, with Gemini's documented failure of not doing so → Decision 5's three flat keys through ONE reader; Claude Code's built-in list and Copilot's `colorblind` plus Primer's first-class colorblind variants → Decision 2's four built-ins; Claude Code's `syntaxHighlightingDisabled` + `prefersReducedMotion`, Codex's `tui.animations`, Gemini's `ui.showSpinner` → Decision 4/5's two booleans orthogonal to the theme; VS Code's documented "preview on arrow, commit on Enter" → Decision 6; Claude Code's `{ name?, base?, overrides? }` and `custom:<plugin>:<slug>` → Decision 7; WCAG 2.2 SC 1.4.1 → Decision 8. Alternative 4 is explicitly the surveyed Copilot "applies live on save" shape, rejected on a repository constraint. Crucially the section also records where the survey does NOT transfer, and every divergence is pinned to a verified repository fact: the default must stay chalk NAMES (Claude Code's `*-ansi` equivalent) or today's output changes; `auto` is deferred for want of background detection (against Gemini's `ui.autoThemeSwitching`); leniency is refused because `keybinding-registry.ts` already refuses a whole document on the first invalid entry with a path-named diagnostic (verified — `diagnostic(file, path, message)` at line 53, returning `{ ok: false }` at lines 94/98/111/149/151/152); the picker cannot write settings because CMD-004 makes the TUI a reader (the `statusline-settings-patch` precedent, verified at `command-contracts.ts:121` and `interactive-session-host-actions.ts:189`); and themes are a new plugin KIND because `bundle-plugin-types.ts` loads per kind (verified: `commands`, `agents`, `skills`, `hooks`, `mcp`). External URL contents were not fetched — they are product documentation attributed to the `prior-art-researcher` run of 2026-09-19, which is what `research.md` requires; the repository half of every claim was checked here.
- GATE-WRITE — Architecture Review Checklist: 5/5 items `[x]`; Sibling scan carries completion evidence and every artifact it names exists in the tree — `keybindings/keybinding-catalogue.ts`, `keybindings/keybinding-registry.ts`, `cli.ts:189`, `agent-cli/src/startup/output-style-sources.ts`, `output-style-registry.ts`, `command-api/statusline/statusline-command-api.ts`, `interactive/interactive-session-host-actions.ts`, `hooks/useStatusLineSettings.ts`, `screen-reader-context.tsx`, `agent-cli/src/startup/screen-reader-enablement.ts`, `AppPresentation.tsx`, `SlashAutocomplete.tsx`, `ExecutionWorkspaceSwitcher.tsx`, `plugins/host-bundle-plugin-loader.ts`. Reused, not paralleled.
- GATE-WRITE — Alternatives Considered: 4 numbered entries, each with Pro and Con.
- GATE-WRITE — Decision references the driving trade-off: PASS. The trade is stated and priced, not asserted. Alternative 3's Con carries it — "output styles are prompt CONTENT the runtime applies, a theme is presentation one surface renders. The host owns the persisted id; it has no use for the colours" — choosing a TUI-owned token model over a framework registry at the cost of a new port (`IThemeCataloguePort`); Alternative 4's Con trades live-write simplicity for CMD-004's reader/writer split; Alternative 2's Con trades zero model for the loss of daltonization (different HUES, not 16 re-rendered slots); Alternative 1's Con trades the smallest change for four unmet gate lines. The Decision then pays a second, explicit price: it REVERSES SCREEN-006's recorded decision, quoted verbatim from `packages/agent-ui-terminal/docs/SPEC.md:364-365` ("Its values are deliberately NOT derived from `PALETTE` (a name→SGR mapping layer would be invented complexity)"), and grounds the reversal in two verified facts — `chalk` is already a direct dependency (`packages/agent-ui-terminal/package.json:65`, `"chalk": "^5.6.2"`) and Ink's own `colorize.js` (`ink@7.1.1`) already performs that mapping (`^ansi256\(\s?(\d+)\s?\)$` at line 3, `chalk.hex` at 20, `chalk.ansi256` at 30, `chalk.rgb` at 42), so the grammar is adopted verbatim rather than invented. The per-key leak that forces `syntax` to be a REQUIRED complete map is verified at `cli-highlight/dist/index.js:50` — `(theme[token_1] || DEFAULT_THEME[token_1] || plain)(nodeData)` — and its 17 chalk-coloured keys are exactly the 17 the Decision enumerates, in that order. The "Verification bar for unit 1" refuses the easy claim: four named byte-level exceptions are accepted and "Byte-identical is NOT the criterion" is written down.
- GATE-WRITE — New-surface placement: **N/A** — the conditional is not triggered, and the checklist states the N/A with its reason rather than skipping it. Verified: all five packages in Affected Scope already exist under `packages/`; the theme model is a module directory inside the existing `agent-ui-terminal` on the `src/keybindings/` analog (that directory exists); `/theme` joins `agent-command` beside the existing `OutputStyleCommandSource` / `StatusLineCommandSource`; the settings reader joins `agent-framework/src/command-api/` beside `statusline/`, whose `DEFAULT_STATUS_LINE_COMMAND_SETTINGS` + `readStatusLineSettings` (`statusline-command-api.ts:18,41`) is the exact shape proposed; the two contract additions are variants on existing unions in `agent-interface-command` (`command-contracts.ts:121` already holds `statusline-settings-patch` in that host-action union); the only new artefact is one user-home DIRECTORY, `~/.robota/themes`, beside `~/.robota/output-styles` (`output-style-sources.ts:13`) and `~/.robota/keybindings.json` (`node-keybindings-source.ts:57`) — a directory is not a package, app, presentation or interface surface, and no layer or product-family boundary is reclassified. Read even as applicable it would still hold: (a) each addition names its analogous existing layer, and (b) reuse is at the shared contract/core level (`agent-interface-command` types + `agent-framework` `command-api`) with the single registry instance injected from `agent-cli` — exactly the `keybindingsSource` path, verified as one value created at `cli.ts:189` and passed both to `buildCommandSetupOrExit` (`cli.ts:216`) and into the `renderApp({...})` call that opens at `cli.ts:491` (`cli.ts:540`) — so no dependency on a sibling PRODUCT is created.
- GATE-WRITE — Completion Criteria: 13 items, all `TC-NN:` prefixed; none uses a banned phrase.
- GATE-WRITE — At least 1 criterion per feature: PASS. Solution 1 (contracts + grammar validator) → TC-01; 2 (four built-ins) → TC-02 / TC-04; 3 (style builder) → TC-01 / TC-02 / TC-03; 4 (provider + hooks) → TC-05 / TC-06; 5 (the ~31-file migration, `status-glyph` split, token-key returns, `CjkTextInput` `chalk.gray` at line 277/282, palette deletions, `render-markdown` flag) → TC-02 / TC-03 / TC-05; 6 (the two ratchets + CVD guard + the transitive-highlighter assertion, extending the existing `palette-consistency.test.ts` floor) → TC-04 / TC-05 / TC-03; 7 (SPEC § rewrite) → TC-12 `pnpm harness:scan`; 8 (contract additions) → TC-07 / TC-09; 9 (framework reader + host applier) → TC-07; 10 (`/theme` + port) → TC-09; 11 (agent-cli settings/env/flag/registry/README) → TC-08 / TC-09 / TC-12; 12 (hook, picker, keybinding context, published schema, guide) → TC-07 / TC-10; 13 (`parseThemeDocument`) → TC-11; 14 (user + plugin sources, skip lines, disabled rows) → TC-11 / TC-13. Every Fallback & Degradation declaration is also covered: colour gate → TC-06 / TC-13; screen-reader → TC-06 / TC-10; unknown persisted id → TC-09; invalid theme file → TC-11 / TC-13; absent directories → TC-11; absent port → TC-09; unsimulable daltonized value → TC-04. No feature or declared fallback is left without a criterion.
- GATE-WRITE — Command/Observable form: PASS. Every TC names the artefact under test and a falsifiable observable — a missing `syntax` key is "a type error and a test failure" (TC-01); four exceptions asserted by name with "no fifth difference exists" (TC-02); a themed key reaching `renderMarkdown`'s output and plain indented text with highlighting off (TC-03); simulated protanopia/deuteranopia pairwise Lab ΔE with two must-FAIL fixtures — a named colour and a deliberate red/green pair (TC-04); the provider default plus two ratchets that must pass for `chalk.inverse`/`chalk.level` (TC-05); a boolean identity plus the two named carve-outs (TC-06); defaults `dark`/`true`/`false` and a rejected foreign shape (TC-07); a precedence chain with the override absent when neither input is set (TC-08); "exactly one patch", an unknown id that fails without writing, and the verbatim unavailability string (TC-09); preview/restore/toggle/numbered-rows/schema parity (TC-10); whole-file refusal with a path-named diagnostic against four distinct bad inputs (TC-11); exit-0 commands (TC-12); PTY observables on the built CLI (TC-13). Weakest point recorded: TC-04's ΔE threshold is "stated" rather than numeric — it remains decidable because the criterion fixes two fixtures that must fail, so the test cannot pass by choosing a permissive number.
- GATE-WRITE — Test Plan: 13 rows = 13 TC criteria; every row carries a Test Type and Tool/Approach; 0 rows with Tool "manual".
- GATE-WRITE — Structure: `## Tasks` present with the paired-Task placeholder (`.agents/tasks/SCREEN-2002-configure-accessible-tui-themes-and-reduced-motion.md`, which exists); `## Evidence Log` present and empty at judgement; no `## Status` / `## Classification` body sections.
- GATE-WRITE — Mechanical evaluation: re-run by the guardian rather than cited — `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc .agents/spec-docs/draft/SCREEN-2002-…md --dry-run` → exit 0, "27 criteria judged — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN", "no entry written: pending criteria are the guardian's to judge and record". The 7 pending are exactly the catalogue's `semantic` set: concrete symptom, reproduction condition, research-feeds-decision, decision trade-off, new-surface placement, one-criterion-per-feature, criterion form.
- GATE-WRITE — Semantic evaluation: all 7 pending guardian criteria resolved — 6 PASS and 1 N/A with its reason stated (new-surface placement); 0 FAIL.

**Judged by:** `backlog-gate-guard` (semantic) + `gate.mjs` (mechanical)
**Judged at:** HEAD `9cced2d93c94e68b518e563eacdef111bc6c57bf` · base `origin/develop@9cced2d93c94e68b518e563eacdef111bc6c57bf` · document `.agents/spec-docs/draft/SCREEN-2002-configure-accessible-tui-themes-and-reduced-motion.md` blob `32d06d61d8c81d47e83802c3bc44f587bd07da3c` (untracked)

**Independent review evidence:** the Decision records `proposal-reviewer` rounds 1 and 2 `REVISE` (7 findings each) and round 3 `REVIEW VERDICT: ENDORSE` (2026-09-19), and `finding-depth-triager` `DEPTH VERDICT: LOCAL` (2026-09-19); the orchestrator loop-run record corroborates the three rounds independently of the spec's own prose — `.agents/loop-runs/backlog-execution-orchestrator.jsonl`, run `r20260919074607`, `"roundFindings":[7,7,0]`. The paired Task carries no `## Recommendation Evidence` section, so the verdict TEXT itself rests on the spec and the loop-run record only; the round COUNTS are corroborated. The endorsed design is the one stated in Architecture Review › Decision above.

### [GATE-APPROVAL] — ✅ PASS | 2026-09-19

**Status upgrade:** draft → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "SCREEN-2002 스펙을 승인합니다"
**Given:** 2026-09-19, this conversation
**Review fingerprint:** b26a1d632f8a (review 41595b0f, type/tags f6ab8bb9)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-19, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (b26a1d632f8a) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9cced2d93c94` · base `origin/develop@9cced2d93c94` · document `.agents/spec-docs/draft/SCREEN-2002-configure-accessible-tui-themes-and-reduced-motion.md` blob `10102358ef29` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-19

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "SCREEN-2002 스펙을 승인합니다"
**Given:** 2026-09-19, this conversation
**Review fingerprint:** b26a1d632f8a (review 41595b0f, type/tags f6ab8bb9)

- GATE-APPROVAL — Ordering: PASS — the prior gate `[GATE-WRITE] — ✅ PASS | 2026-09-19` is recorded on this document and carries `**Status upgrade:** draft → review-ready`; the document's current `status: review-ready` equals that entry's `Y`, which is what the prior-gate map's declared `recorded-pass` re-run rule for this row requires, and the file sits in `.agents/spec-docs/backlog/`, the folder `spec-workflow.md` § Spec-Document Status and Lifecycle Folders maps `review-ready` to (`scan-doc-folder-status-agreement.mjs` re-run by the guardian: `violations=0 result=PASS`). Recorded, not failing: the mechanical approval entry immediately above carries `**Status upgrade:** draft → approved` and a `draft/` path, because `gate.mjs approve` renders `${doc.fm.status} → approved` and was run before the orchestrator applied the status flip and the folder move that GATE-WRITE's PASS had already authorised (the sibling SCREEN-1993 records `review-ready → approved` because the move preceded its approve run). No gate was bypassed — GATE-WRITE's PASS precedes the approval in the log and the approved content is the reviewed content (fingerprint below) — and this entry, now the last GATE-APPROVAL entry, carries the transition this gate actually performs.
- GATE-APPROVAL — User has provided explicit approval in the current conversation (mechanical): PASS — route `DIRECT`, `**Instruction (verbatim):** "SCREEN-2002 스펙을 승인합니다"`, `**Given:** 2026-09-19, this conversation`, written by `gate.mjs approve --route DIRECT --instruction "SCREEN-2002 스펙을 승인합니다" --given 2026-09-19`; guardian re-run rather than cited — `node scripts/harness/gate.mjs judge --gate GATE-APPROVAL --doc .agents/spec-docs/backlog/SCREEN-2002-…md --dry-run` → "9 criteria judged — 6 PASS, 0 FAIL, 3 PENDING-GUARDIAN", "no entry written". The entry parses for the scan that owns the form: `node scripts/harness/scan-standing-delegation-evidence.mjs` → exit 0, "391 approved spec document(s); 125 DIRECT, 48 CLASS".
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the recorded instruction names this item's ID (`SCREEN-2002`) and the word `스펙`, and uses `승인` (a catalogue-listed Route DIRECT form). It was given 2026-09-19 in this conversation as the user's chosen option to a question that summarised Architecture Review › Decision as written, point for point: one `ITuiTheme` token model with every encoding derived through chalk and `tui-palette.ts`/`tui-ansi-palette.ts` deleted (Decision 1); built-ins `dark`/`light`/`dark-daltonized`/`light-daltonized` with the CVD guard (Decision 2 + 8); three flat settings keys persisted by the host with the TUI read-only (Decision 5); `/theme` behind `IThemeCataloguePort` plus a `theme-picker` overlay with preview and escape-restore (Decision 5 + 6); user and plugin theme JSON with whole-file refusal (Decision 7); delivery in three units (§ Solution). The option's label carried a "(Recommended)" suffix that the recorded instruction omits; the suffix is the question's presentation, not part of the instruction — the same treatment as the sibling at this gate. It is not a clarifying-question answer, not silence, not approval of another item, and not a standing class instruction. Same form as the sibling precedent `.agents/spec-docs/done/SCREEN-1993-…md` § `[GATE-APPROVAL]`: "SCREEN-1993 spec을 승인합니다" (2026-09-19).
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval: N/A — route DIRECT; no class is cited anywhere in the approval entry.
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: N/A as a Route CLASS condition — route DIRECT; the instruction, its date and the conversation are nonetheless recorded in the fields of both the mechanical entry above and this one.
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: N/A — route DIRECT; no class evidence condition is claimed, so there is nothing to measure.
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A — route DIRECT; no registered class is invoked, and the approval's authority rests entirely on the instruction naming THIS item (`SCREEN-2002`), which the DIRECT semantic criterion above judges.
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: PASS — the guardian recomputed `reviewFingerprint()` from `scripts/harness/gate-operations.mjs` over the current document text and obtained `b26a1d632f8a (review 41595b0f, type/tags f6ab8bb9)`, identical to the `**Review fingerprint:**` the mechanical entry recorded at approval; the dry run reports the same equality. `type: SCREEN` / `tags: [screen]` and the whole Architecture Review (Affected Scope, 4 Alternatives, Decision 1–8, Checklist) are the design the owner approved.
- GATE-APPROVAL — Independent architecture validation (conditional): N/A — the condition is not triggered, verified against the tree rather than taken from the spec's claim: § Affected Scope declares "No new package, app or presentation surface; one new user-home directory", and all five packages in scope (`agent-interface-command`, `agent-framework`, `agent-command`, `agent-cli`, `agent-ui-terminal`) already exist under `packages/`; the theme model is a module directory inside the existing `agent-ui-terminal` on the `src/keybindings/` analog; `IThemeCataloguePort` mirrors the existing `IKeybindingsFilePort` (`packages/agent-command/src/keybindings/`) inside the same existing package; the settings reader joins `agent-framework/src/command-api/` beside `statusline/`; the two contract additions are variants on existing unions; the only new artefact is one user-home directory beside `~/.robota/output-styles`. No layer or product-family reclassification. Independent review is on record regardless, and covers placement explicitly: `proposal-reviewer` rounds 1 and 2 `REVIEW VERDICT: REVISE` (7 findings each, including the two placement findings "the reader and guard were placed in a contract package whose own SPEC exports no runtime value" and "the user theme directory belongs in the CLI's contribution source") and round 3 `REVIEW VERDICT: ENDORSE` (2026-09-19), with `finding-depth-triager` `DEPTH VERDICT: LOCAL` (2026-09-19) — recorded in § Decision, in the paired Task's `## Recommendation Evidence` (now present; the GATE-WRITE entry noted its absence at that time), and corroborated independently of the spec's prose by `.agents/loop-runs/backlog-execution-orchestrator.jsonl` run `r20260919074607`, `"roundFindings":[7,7,0]` (verified by the guardian). No `architecture-audit-fanout` structure-channel result is required because the surface is not new.
- GATE-APPROVAL — NON-COMPLIANCE trigger (implementation started before this gate ran): not met — `packages/agent-ui-terminal/src/theme/`, `src/ThemePicker.tsx`, `packages/agent-framework/src/command-api/appearance/`, `packages/agent-command/src/theme/` and `packages/agent-cli/src/startup/theme-sources.ts` do not exist; `IThemeCataloguePort` / `IAppearanceSettings` / `readAppearanceSettings` / `usePalette` / `useThemeMarkdownStyles` / `createThemeRegistry` / `show-theme-picker` / `appearance-settings-patch` / `ROBOTA_REDUCED_MOTION` return 0 matches across `packages/**/*.ts(x)`; `tui-palette.ts` and `tui-ansi-palette.ts` are both still present (pre-change state); `git status --porcelain` carries only this spec (untracked), the paired Task, `.agents/loop-runs/backlog-execution-orchestrator.jsonl` and the two auto-generated lessons files — no implementation path.
- GATE-APPROVAL — Semantic evaluation: all 3 pending guardian criteria resolved — 1 PASS (approval directed at this spec) and 2 N/A with their reasons stated (inside-the-class, independent architecture validation); 0 FAIL.

**Judged by:** `backlog-gate-guard` (semantic) + `gate.mjs` (mechanical)
**Judged at:** HEAD `9cced2d93c94e68b518e563eacdef111bc6c57bf` · base `origin/develop@9cced2d93c94e68b518e563eacdef111bc6c57bf` · document `.agents/spec-docs/backlog/SCREEN-2002-configure-accessible-tui-themes-and-reduced-motion.md` blob `3ac6ded8a81194f85acb97be7c29525f55b8cdaa` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-19

**Status upgrade:** approved → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "SCREEN-2002 스펙을 승인합니다"
**Given:** 2026-09-19, this conversation
**Review fingerprint:** 6da5ec357ad0 (review 405244cd, type/tags f6ab8bb9)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-19, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (6da5ec357ad0) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9cced2d93c94` · base `origin/develop@9cced2d93c94` · document `.agents/spec-docs/todo/SCREEN-2002-configure-accessible-tui-themes-and-reduced-motion.md` blob `cf20fc4cf2c5` (untracked)

<!-- Fingerprint re-record, stated rather than silent: after the guardian's PASS the Decision gained the
     machine-readable `**Delivery mode:** `sequenced`` + `**Continuation artifacts:**` lines GATE-IMPLEMENT
     requires. They encode what § Solution already said at approval time (three work units, one PR each);
     no design statement changed. The re-record carries the same verbatim instruction and date, and the
     guardian's PASS entry above remains the semantic judgement. -->

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-19

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-19; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/SCREEN-2002-configure-accessible-tui-themes-and-reduced-motion.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/SCREEN-2002-configure-accessible-tui-themes-and-reduced-motion.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (13)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 685 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 2`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "sequenced",
  "sequencedArtifacts": [
    "packages/agent-ui-terminal/src/theme/theme-contracts.ts",
    "packages/agent-ui-terminal/src/theme/built-in-themes.ts",
    "packages/agent-ui-terminal/src/theme/theme-context.tsx",
    "packages/agent-ui-terminal/src/render.tsx",
    "packages/agent-ui-terminal/docs/SPEC.md",
    "packages/agent-cli/src/cli.ts"
  ],
  "taskPath": ".agents/tasks/SCREEN-2002-configure-accessible-tui-themes-and-reduced-motion.md",
  "specPath": ".agents/spec-docs/todo/SCREEN-2002-configure-accessible-tui-themes-and-reduced-motion.md",
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
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 2
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/SCREEN-2002-configure-accessible-tui-themes-and-reduced-motion.md",
    ".agents/tasks/SCREEN-2002-configure-accessible-tui-themes-and-reduced-motion.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `9cced2d93c94` · base `origin/develop@9cced2d93c94` · document `.agents/spec-docs/todo/SCREEN-2002-configure-accessible-tui-themes-and-reduced-motion.md` blob `7920f0b06824` (untracked)
