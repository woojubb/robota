# agent-ui-terminal Specification

## Transport Admission (SEC-008)

transport-admission: none — the peer is this process's own terminal. There is no remote party and nothing to authenticate; the OS user who started the process is the boundary.

## Scope

Terminal UI presentation for the Robota SDK — the React + Ink interactive renderer. Split out of the
former consolidated `agent-transport` package (DQ-AUDIT-005) so that React/Ink/node-pty are isolated
to this package and never enter the dependency graph of non-TUI consumers.

## Boundaries

- Owns the Ink/React rendering pipeline, the TUI interaction channel, and the default TUI CLI adapter.
- Owns its PTY test support under `src/__tests__/pty/`; all consumers are internal relative
  imports, not a public test-support barrel. The owner-approved BOUNDARY-2655 disposition
  relocates and removes the private, recorded-never-published `agent-testing` package,
  superseding that package's historical published-intent charter. The PTY driver and isolated
  HOME helpers retain their existing lifecycle and environment behavior; `node-pty` and `tsx`
  are explicit development dependencies, not additions to the TUI public API.
- Depends on `agent-interface-tui` for interaction contracts and `agent-framework` for the
  interactive-session runtime; does **not** depend on the other transport implementation packages.
- No other transport package depends on this one (verified: zero cross-transport runtime imports).
- ARCH-011: this package exports no `ITransportAdapter`. The removed `TuiTransport` ignored the
  borrowed session passed to `attach()` and constructed a different session through the renderer,
  so it was not an honest implementation of that port. `renderApp` and `TuiInteractionChannel` are
  the supported session-owning presentation surfaces.

## Architecture Overview

```
agent-ui-terminal
  ├── renderApp              ← mounts the Ink <App/>
  ├── TuiInteractionChannel  ← session-owning TUI presentation surface
  │   ├── TuiChannelLifecycleCoordinator ← idempotent start/stop/shutdown
  │   ├── TuiSessionEventProjector       ← exact listener ownership + state projection
  │   ├── TuiPermissionQueue             ← permission FIFO + deny drains
  │   └── TuiUserActionQueue             ← action FIFO + cancellation drains
  ├── ITuiAppChannelPort     ← bounded React-facing channel projection
  ├── App                    ← React shell receiving only narrow channel ports
  ├── AppView/controller     ← terminates the channel port and assembles a view model
  ├── AppPresentation        ← pure bounded-view-model render tree
  └── createDefaultTuiCliAdapter ← wires command/provider UX into the renderer
```

`TuiInteractionChannel` does not implement `IInteractionChannel`. It owns the real interactive session
and subscribes to `IInteractiveSessionEvents` directly, because the narrower `InteractionEvent` stream
cannot carry the full TUI state. `IInteractionChannel` remains the port for
`createInteractiveRuntime`-wired in-process channels such as `ProgrammaticInteractionChannel`.
Both `IRenderOptions` and `ITuiInteractionChannelOptions` carry the composition root's optional
`TWorkspaceProjectAccess` decision unchanged. A bare `cwd` is provenance only; omission produces the
framework's explicit Restricted decision and cannot enable project contribution discovery.
The same surfaces forward an optional `EditCheckpointStore`; trusted project access alone never
creates checkpoint mutation authority inside the TUI.

REFACTOR-025 keeps `TuiInteractionChannel` as the public session-owning facade and preserves its
`getSession()`, `getRegistry()`, and `stateManager` compatibility surfaces for non-React
consumers. `renderApp` is the sole concrete-channel creation boundary and narrows every instance
immediately to `ITuiAppChannelPort`; the entire React tree is concrete-channel-free. `AppView`
terminates that port in `useAppController`, and `AppPresentation` receives only an explicit
`IAppViewModel`. Downstream hooks and components receive immutable channel snapshots, narrow UI-event
and command-query ports, and explicit actions only. The host's real plugin command adapter is projected
separately into the controller; an embedding host without that capability receives explicit rejected
operations rather than successful no-ops.

The status bar renders the active model-effort selection (`auto` or a concrete tier) beside the
provider/model identity when the live session exposes it. This is a read-only projection of
`Session.getModelEffort()`; it does not infer or change effort from thinking-display settings or
ordinary prompt wording.

Plan lifecycle, context-file refresh, and checkpoint/branch events are projected by the pure
`createTuiSessionEventNotice` function into a bounded, append-only notice list owned by
`TuiStateManager`. `<SessionEventNotices>` renders that list separately from canonical conversation
history, so history synchronization cannot erase operational notices. Every channel-owned listener
isolates projection/render-state failures and reports them through
`onSessionEventDeliveryError(error, event)` without reversing a committed session operation; a
diagnostic callback failure is isolated too. When an embedding owner does not inject that optional
observer, the channel appends a visible `delivery-error` notice instead of failing silently.

## Channel Lifecycle & Teardown

`TuiInteractionChannel` owns the interactive session and its render state; its teardown contract is
authoritative for how the TUI releases resources on session switch and process exit.

- **`start()`** delegates idempotency to `TuiChannelLifecycleCoordinator`, shares one in-flight start
  across concurrent callers, and marks the channel started only after startup succeeds. A failed start
  unwires its listeners, stops its init poller and rolls back any partially started transports before
  remaining retryable; the App renders an input-blocking error with an Enter-to-retry action and
  unmounts overlay input handlers until recovery succeeds. Startup wires the session
  event listeners selected by the exhaustive
  `TUI_SESSION_EVENT_CLASSIFICATION` map (currently 20 channel-owned bindings) and begins the init
  poller. It is idempotent. Tests compare the actual `on`/`off` keys and
  handler identities with the map so a new shared event cannot silently miss the TUI. Listener wiring
  itself is inside the rollback boundary, and a transport rollback failure is reported together with
  the original startup failure. Only a fully rolled-back start remains retryable; rollback failure
  permanently closes the start path so live transport resources cannot be duplicated.
- **`stop()`** is the full channel teardown. Concurrent callers share one in-flight stop; repeat calls
  after success are no-ops. A stop requested during startup waits for that attempt and its rollback to
  settle before teardown, while a cleanup failure still attempts bounded session shutdown and leaves
  stop retryable rather than claiming success. `TuiSessionEventProjector` **unwires every session listener** it registered (each binding is retained and removed
  with `session.off(...)` — no handler may stay bound to a discarded session), drains the permission
  and user-action queues (see below), stops the init poller, disposes the `TuiStateManager`, stops
  transports, and — unless the channel was already gracefully shut down — **shuts the underlying
  session down** (bounded by `SHUTDOWN_TIMEOUT_MS`) so a discarded or switched-away channel releases
  its background tasks, subagent child processes, and timers. A channel that leaves listeners bound
  or its session running after `stop()` is a defect. Because transport teardown is best-effort at its
  own boundary, every returned transport error is promoted to a channel teardown failure before the
  coordinator can mark the channel stopped. Session shutdown has one shared completion across stop
  retries and concurrent graceful shutdown. Neither stop nor graceful shutdown can report completion
  while the other teardown path is already pending. When graceful shutdown joins an existing stop, the
  stop caller remains the owner of any teardown error; the process-exit path observes completion without
  reporting the same error a second time.
- **Render ownership.** React effects start channels and release subscriptions, but do not fire-and-forget
  asynchronous teardown. `renderApp()` tracks the active channel, awaits its `stop()` after Ink exits,
  and propagates teardown failure to the embedding caller. An App unmounted during a session switch may
  not construct a replacement channel after the in-flight old-channel stop settles. UI-event
  subscriptions are installed before the passive startup effect, so synchronous startup intents and
  rename events are observable.
- **`shutdown({ reason, timeoutMs? })`** is the graceful process-exit path (first Ctrl+C, `/exit`,
  signal). The lifecycle coordinator marks `isShuttingDown`, drains both queues, renders
  `Shutting down...`, then awaits the
  session shutdown **bounded by a timeout** (`SHUTDOWN_TIMEOUT_MS`, overridable) so a wedged subsystem
  can never block process exit. Concurrent callers share the same completion, and an in-flight start
  settles before session shutdown begins.
- **Session switch policy.** The old channel is `stop()`-ed _before_ the new channel becomes active,
  so it can never receive events addressed to the new session and its session is shut down as part of
  that teardown. On failure, the old stopped channel remains selected but input is disabled and the
  rendered error offers Enter-to-retry for the same target; no replacement is created until retrying
  stop succeeds. This is the single owner of old-session shutdown on switch.

### Queue drain on abort / shutdown

The channel delegates two independent request queues to separate package-local owners. Both must be
drained on `abort()`, `cancelQueue()`, `shutdown()`, and `stop()` so no promise dangles:

- `TuiUserActionQueue.cancelAll()` — resolves every queued/in-flight CMD-004 ask as
  `{ type: 'cancelled' }`.
- `TuiPermissionQueue.cancelAll()` — resolves every queued/in-flight permission request as `false` (deny):
  aborting or shutting down must never leave a tool's permission promise unresolved (the tool would
  hang) nor grant it. The two drains are symmetric; a permission queue with no cancel path is a defect.

Remote dismissal may promote the next queued request while the old prompt still holds a callback.
Both queues bind responses to the exact displayed entry and ignore stale callbacks; dismissing a
non-current permission must also preserve the active request object and its local selection state.
Normal queued prompts retain their advertised Backspace cancellation while ordinary input is disabled;
coordination recovery, screen overlays and teardown disable that cancellation independently.

### Stall-hint suppression during tool execution (ERR-001 G3)

`TuiStateManager` arms a dead-air hint (`isStalled`) after `STALL_HINT_MS` of no provider activity
while thinking. A running tool is legitimate activity, not a stalled connection, so the hint is
**suppressed while any tool is running**: `onToolStart` clears the stall timer, and it is re-armed
only when the last running tool ends and the turn is still thinking. `TuiStateManager.dispose()`
releases the stall timer and the streaming-debounce timer and nulls `onChange`.

## Pure Renderer Contract (CMD-004 Phase 2 Stage C)

The TUI executes **no command semantics**. The session layer (the host) applies every command host
action via `ICommandHostAdapters` BEFORE the command result returns — language change, settings
reset, exit/restart, rename, statusline patch, remote control. The renderer only reflects outcomes:

- **UI screens** (plugin manager, settings, session picker, agent switcher) open from the
  requester-routed `ui_intent` session event. The TUI renders an intent only when
  `requesterDriverId` is the local operator (`OWNER_DRIVER_ID`); intents stamped with another
  surface's id — or unattributed — are ignored (`useSideEffects`).
- **Session title** follows the broadcast `session_renamed` event; the TUI never calls
  `setName` in response to a command result.
- **Statusline** refreshes on result: when a slash-command result arrives, the TUI RE-READS the
  persisted settings document (`useStatusLineSettings` `refresh()`) — it never writes settings.
- **Transcript** follows the broadcast `history_cleared` event (CMD-004 Stage E): a clear
  performed by ANY surface — a co-driving remote `/clear` included — empties the rendered
  history (`TuiInteractionChannel` binds the event to `TuiStateManager.clearHistory`).
- The only result-carried hint consumed by `command-result-handler.ts` is
  `data.pluginRegistryReloaded` — the requester-local registry/autocomplete refresh (the
  semantic plugin reload already ran host-side). The legacy `result.effects` field is deleted.
- `ITuiCliAdapter` is **read-only toward settings** (`readSettings`/`getUserSettingsPath`); the
  write/delete/statusline-apply members were removed with the legacy effect handler.

## Terminal Text Boundary (issue #2222)

`src/SafeText.tsx` is the ONLY module in this package that imports `Text` from `ink`. It exports
`SafeText` (and the alias `Text` every render site imports from `./SafeText.js`), which passes every
string child through `sanitizeTerminalText` before Ink sees it; nested elements sanitize their own
children on their own render. A render site therefore cannot put a string on the terminal without
passing the boundary — the property SEC-019's per-site sanitizing could not hold (three unguarded
sites found across six review rounds).

The one deliberate pass-through is `RenderedText`, exported from the same module: Ink's `Text`
without the sanitizing step, for a string this package's OWN renderer produced from input it already
sanitized. `renderMarkdown` runs `sanitizeTerminalText` on the markdown BEFORE `marked-terminal`
styles it, so the SGR in its output (the theme's diff pairs) is the renderer's, and
routing it through `SafeText` would strip exactly that styling. `MessageList` uses it for the
assistant markdown branch only; every other string still goes through `SafeText`.

The load-bearing half is the required scan `tui-safe-text-boundary`
(`scripts/harness/scan-tui-safe-text-boundary.mjs`): it refuses a `Text` import from `ink` in any
production module — plain, aliased (`Text as T`) and namespace (`* as ink`) forms — and reports
`::examined::`. Tests and fixtures are exempt so the boundary's own suite can render raw Ink `Text`
to prove a leak. That suite (`src/__tests__/safe-text-boundary.test.tsx`) asserts against the bytes
Ink writes to a stream that claims to be a tty, never against `lastFrame()`, which drops most
markers on its own.

## Type Ownership

Owns the TUI rendering/presentation types (`IRenderOptions`, `ITuiInteractionChannelOptions`,
`ITuiCliAdapter`, `IDefaultTuiCliAdapterOptions`). The two session-construction option types carry
`projectAccess?: TWorkspaceProjectAccess` and `editCheckpointStore?: EditCheckpointStore`;
`renderApp` forwards the same explicit capabilities into the channel and then the real
`InteractiveSession`. Re-exports the `agent-interface-tui` interaction contracts for convenience at
the transport boundary.

| Type                        | Location                      | Purpose                                                                       |
| --------------------------- | ----------------------------- | ----------------------------------------------------------------------------- |
| `ITuiAppChannelPort`        | `src/tui-app-channel-port.ts` | Complete bounded channel surface accepted by the non-composition React tree   |
| `ITuiChannelSnapshot`       | `src/tui-app-channel-port.ts` | Immutable render-state projection; excludes unrestricted `TuiStateManager`    |
| `ITuiCommandQueryPort`      | `src/tui-app-channel-port.ts` | Autocomplete-only command and subcommand lookup                               |
| `ITuiSessionUiEventPort`    | `src/tui-app-channel-port.ts` | Typed subscription surface for `ui_intent` and `session_renamed` only         |
| `ITuiRuntimeStatusSnapshot` | `src/tui-app-channel-port.ts` | Permission, preset, effort and session-id projection used by status rendering |
| `IAppViewModel`             | `src/app-view-model.ts`       | Data and callbacks accepted by the pure presentation tree                     |

## Public API Surface

| Export                          | Kind     | Description                                                                                                                                                                                          |
| ------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `renderApp`                     | function | Mount the Ink application                                                                                                                                                                            |
| `IRenderOptions`                | type     | Options interface for `renderApp`                                                                                                                                                                    |
| `createDefaultTuiCliAdapter`    | function | Default CLI adapter for the renderer                                                                                                                                                                 |
| `IDefaultTuiCliAdapterOptions`  | type     | Options interface for `createDefaultTuiCliAdapter`                                                                                                                                                   |
| `TuiInteractionChannel`         | class    | Session-owning TUI surface and its delivery-error callback seam                                                                                                                                      |
| `ITuiInteractionChannelOptions` | type     | Options interface for `TuiInteractionChannel`                                                                                                                                                        |
| `ITuiCliAdapter`                | type     | Adapter contracts for TUI CLI integration                                                                                                                                                            |
| `ITuiPickerItem`                | type     | One selectable item in a TUI picker interaction                                                                                                                                                      |
| `ITuiCommandInteraction`        | type     | Command interaction contract                                                                                                                                                                         |
| `ITuiPickerInteraction`         | type     | Picker interaction contract                                                                                                                                                                          |
| `ITuiConfirmInteraction`        | type     | Confirmation interaction contract                                                                                                                                                                    |
| `TAnyTuiCommandInteraction`     | type     | Union of interaction contracts                                                                                                                                                                       |
| `TOnMissingArgsAction`          | type     | Missing-arguments action discriminator                                                                                                                                                               |
| `TScreenReaderChannel`          | type     | Which input turned screen-reader mode on (`flag`/`env`/`settings`) — declared here because this package PRINTS it, and imported by the surface that resolves it, so one union exists for one concept |
| `createNodeKeybindingsSource`   | function | Watched user-file capability creating an `IKeybindingsSource`                                                                                                                                        |
| `DEFAULT_KEYBINDINGS_DOCUMENT`  | const    | The canonical default keybindings document structure                                                                                                                                                 |
| `KEYBINDINGS_SCHEMA_URL`        | const    | The canonical documentation URL for the keybindings JSON schema                                                                                                                                      |
| `IKeybindingsFilePort`          | type     | Minimal file resolution capability interface for keybindings                                                                                                                                         |
| `IKeybindingsSource`            | type     | Watched user-file keybinding source contract providing reactive snapshots and disposal                                                                                                               |
| `INodeKeybindingsSourceOptions` | type     | Options interface for `createNodeKeybindingsSource`                                                                                                                                                  |
| `IKeybindingDiagnostic`         | type     | Diagnostic error contract for invalid keybinding replacements                                                                                                                                        |
| `IKeybindingSnapshot`           | type     | Immutable effective keybinding map snapshot                                                                                                                                                          |
| `IKeybindingWarning`            | type     | Non-fatal warning contract for keybinding limitations                                                                                                                                                |
| `TKeybindingAction`             | type     | Semantic action identifier union per context                                                                                                                                                         |
| `TKeybindingContext`            | type     | Interaction context identifier union                                                                                                                                                                 |
| `createThemeRegistry`           | function | SCREEN-2002: the catalogue of themes this surface can render, built from the built-ins                                                                                                               |
| `createThemeCataloguePort`      | function | SCREEN-2002: the catalogue as the `/theme` command asks it — ids and the persisted appearance, never colours                                                                                         |
| `IThemeRegistry`                | type     | Return type of `createThemeRegistry`: list, get, and resolve-with-a-named-miss                                                                                                                       |
| `IThemeResolution`              | type     | A resolved theme, plus the id it could not find when it fell back                                                                                                                                    |
| `IThemeCataloguePortOptions`    | type     | Options interface for `createThemeCataloguePort`                                                                                                                                                     |
| `ITuiTheme`                     | type     | SCREEN-2002: one theme's colour, markdown, syntax and motion tokens                                                                                                                                  |
| `listBuiltInThemes`             | function | SCREEN-2002: the built-ins, for a composition root that must put them in a registry beside user and plugin themes — the accessor, never the colour data                                              |
| `parseThemeDocument`            | function | SCREEN-2002: one theme FILE, applied whole or refused whole with a `$.`-path diagnostic                                                                                                              |
| `quoteThemeText`                | function | SCREEN-2002: the escaping policy for untrusted text in a diagnostic a terminal will print — both spellings of every control character, escaped rather than stripped                                  |
| `escapeThemeText`               | function | SCREEN-2002: the same escaping without the surrounding quotes, for a field whose consumer quotes it                                                                                                  |
| `sanitizeThemeProse`            | function | SCREEN-2002: the same policy for a sentence (a dependency's message, a path from the environment), which is sanitized rather than quoted                                                             |
| `IThemeDocumentInput`           | type     | Parameter interface for `parseThemeDocument`: the minted id, the file name, and which source read it                                                                                                 |
| `TThemeDocumentResult`          | type     | Return type of `parseThemeDocument`: a theme, or the refusal's reason                                                                                                                                |
| `IThemeSkip`                    | type     | A theme file that was found and refused — carried beside the themes so a surface can show it without ever resolving to it                                                                            |
| `TThemeSource`                  | type     | Where a theme came from (`built-in` / `user` / `plugin`), which every catalogue row reports                                                                                                          |

## Interaction Affordance Contract (SCREEN-005)

`src/key-hint-footer.tsx` is the package-local SSOT for prompt-footer key hints and the
selection-row cursor. It ships mechanics only (grammar, separator, indicator constants); verb
vocabulary is supplied by the calling component, keeping the module content-neutral.

**Footer grammar.** A footer is a dim, bottom-adjacent line of `key label` pairs joined by
`KEY_HINT_SEPARATOR` (`' · '`), rendered via `formatKeyHints(hints)` / `<KeyHintFooter hints/>`
(the footer component adds a single leading pad and renders nothing for an empty list — per-call-site
suppression is `footerHints={[]}`; there is no config surface). Hint order is
**navigate → modify → primary → dismiss** (e.g. `↑↓ Navigate · Space Toggle · Enter Confirm ·
Esc Cancel`). Every footer call site declares its hints as an exported `IKeyHint[]` constant and the
`key-hint-consistency` test asserts the full inventory round-trips through `formatKeyHints` in that
order — a new footer dialect cannot re-appear silently.

### Contextual keybindings (BEHAVIOR-2003)

`src/keybindings/` is the sole owner of terminal context/action identifiers, default bindings,
normalization, validation, chord state, effective hint projection, the published JSON Schema and the
Node file source. The version-1 user document is a sparse override at `~/.robota/keybindings.json`:
each known context maps known actions to one binding, a binding list, or `null` to remove that action's
defaults. Modifier aliases and uppercase spelling normalize to one canonical representation. Unknown
contexts/actions, malformed bindings, reserved controls, duplicates, and single-key/chord-prefix
collisions reject the whole replacement with a path-bearing diagnostic. Multiplexer and modifier
delivery limitations are warnings and preserve the otherwise-valid snapshot.

The Node source watches the parent directory so atomic editor replacement is observed, publishes
immutable effective snapshots, retains and visibly diagnoses the last valid snapshot after an invalid
replacement, and releases the watcher on renderer exit or failed initialization. React input owners
consume semantic actions from the current context; printable text, paste and IME composition stay on
the existing text pipeline. Pending chords reset on timeout, mismatch, Escape, context change, or
snapshot replacement, and a mismatching stroke is evaluated once as a fresh input. Ctrl+C and
screen-reader numeric entry remain reserved product controls. Footer hints are derived from the same
effective action map and omit unbound actions.

**Esc-suppression invariant.** The footer lists **exactly the keys that do something** — the absence
of Esc IS the affordance; no "(Esc disabled)" noise text. A prompt that must resolve explicitly
suppresses Esc in its flow AND omits it from its footer: `ConfirmPrompt` and `PermissionPrompt`
(flows pass `{ ...key, escape: false }` — an Esc-dismissal of a permission ask would be an implicit
deny) render the identical footer `←→ Navigate · Enter Confirm`.

**Directional aliases.** Confirm/permission rows are horizontal; their reducer
(`getDirectionalSelectionInputAction`, `src/flows/selection-flow.ts`) also accepts **↑↓ as aliases**
for previous/next. The footer names the canonical pair for a horizontal row (`←→`) — a documented
choice, not an omission of a broken key.

**Selection indicator.** The focused row cursor is `SELECTION_INDICATOR` (`'> '`), non-focused rows
render `SELECTION_INDICATOR_NONE` (`'  '`, same width). All selection-row call sites use the
constants, never literals. Two look-alike glyphs are deliberately **not** selection cursors and stay
out of this contract:

- `InputArea.tsx` / `TextPrompt.tsx` render a `> ` **input-prompt glyph** in front of the text-entry
  caret — an input affordance, not a selection cursor; it must not be converted to the constants.
- `ExecutionWorkspaceDetailPane.tsx` uses `▸` as a **group-summary disclosure glyph** (content, not a
  cursor); a future pass must not "fix" it into the selection convention.

**Conditional hints (CLI-1994).** `EXECUTION_WORKSPACE_ATTACH_HINT` (`a Attach`) is appended to the
workspace switcher's footer **only while the focused entry offers the `attach` control**. This is the
Esc-suppression invariant applied to a key that exists on some rows and not others: a footer must
list exactly the keys that do something, so a hint for a key most rows ignore would read as a broken
key rather than an unused one. The key is likewise inert on a row without the control.

## Attaching to a Forked Session (CLI-1994)

`/fork` copies a live conversation into a background session. Its task carries a `resumeSessionId`,
which is why the framework's projection offers that entry the `attach` control, and the switcher
renders the conditional hint above.

**Attaching is a view switch, not a merge.** Pressing `a` calls `attachToForkedSession`
(`src/flows/fork-attach-flow.ts`), which asks the framework's `resolveExecutionAttach` — the owner of
the decision, beside the projection that offers the control, so this surface cannot invent a second
answer — and on approval takes the **same session-switch path the session picker uses**: `App`'s one
`onSessionSwitch`, a new channel from the factory with the previous one stopped first. One switch
path, reached by both, because both call the same function. The session the terminal leaves and the
one it opens stay separate records; nothing is read from one into the other, and a fork is a **copy**
that never merges back.

Attach is deliberately NOT routed through a `ui_intent` session event. It starts at a keypress in
this surface's own background panel rather than at a command, so the requester-routed intent bus
would add a hop with no second consumer at the end of it.

**What attach currently shows.** The record it opens is the fork copy, including turns completed by
the forked job after `/fork` was run. The runner reuses the copied record's `resumeSessionId` and
session store for resumed fork jobs, so `Session.run()` writes each completed turn back to that
record. Ordinary background jobs remain transient; their output lives in the background task's
transcript, which `/background` shows. The parent and fork records remain separate.

**Refusals are stated, never silent.** Attach declines — with the reason written into the transcript
as a system entry, and no intent emitted — when the entry is not a fork, when the task reached a
terminal status (the reason names the status), when the record is gone from the session store, or
when this surface was composed without a session store at all. Leaving the terminal pointed at
nothing is the one outcome the operator could not diagnose.

## Color & Motion Contract (SCREEN-006, SCREEN-2002)

One theme decides every colour this package emits, and components never spell a colour. The
mechanical floor is `src/__tests__/palette-consistency.test.ts`: it fails on any `color="…"` /
`borderColor="…"` / `backgroundColor="…"` JSX string literal or `#rrggbb` hex outside `src/theme/`,
on any import of the built-in theme data from outside `src/theme/`, and on any `chalk.<colour>(`
call outside it (`chalk.inverse`, the drawn cursor, and `chalk.level`, the colour gate, choose no
colour and are exempt). Token names are semantic slots (accent/muted/attention) — never product
vocabulary.

**The token model** (`src/theme/theme-contracts.ts`). `ITuiTheme` carries `colors` (`text`,
`border`, `status`), `markdown` (every key `marked-terminal` colours by default, including `html`),
`syntax` (a REQUIRED complete map over `cli-highlight`'s seventeen coloured keys) and `motion` (the
WaveText ramp). Every value is a colour in **Ink's own grammar** — `<chalk name> | #rrggbb |
ansi256(n) | rgb(r,g,b)` — one grammar for built-ins, user files and components alike, which
doubles as the injection floor: no raw escape can enter through a theme.

**Every encoding is derived, through chalk** (`src/theme/theme-styles.ts`). Ink reads `colors`
directly; `marked-terminal` receives chalk style functions; `cli-highlight` receives the `syntax`
map as `highlightOptions.theme`. SCREEN-006 recorded the opposite ("`tui-ansi-palette.ts` values are
deliberately NOT derived from `PALETTE` — a name→SGR mapping layer would be invented complexity");
SCREEN-2002 reverses it, because chalk IS that layer, is already a direct dependency, and Ink's own
`colorize` performs the same mapping. `tui-palette.ts` and `tui-ansi-palette.ts` are gone; the
`dark` literal lives only in `src/theme/built-in-themes.ts`.

Deriving them is also what makes the theme complete. Left to their defaults, `marked-terminal`
(`heading` green, `codespan` yellow, `link` blue, `html` gray) and `cli-highlight` (`string`,
`regexp`, `deletion` red; `number`, `comment`, `doctag`, `addition` green — applied PER KEY, so one
missing key restores them) would keep deciding colours a theme is supposed to own, and a daltonized
theme would still render red/green code blocks.

**Structure is not themed.** The style builder fixes each token's non-colour chain in the
dependency's own order — `heading` bold, `firstHeading` underline+bold, `blockquote` italic, `del`
dim+strikethrough, `href` underline, `syntax.type` dim — so a theme changes colour and nothing else.
`strong`, `em`, `listitem` and `hr` are NOT theme tokens: they carry no colour today
(`chalk.bold` / `chalk.italic` / `chalk.reset`), and giving them one would change rendering rather
than theme it.

**Built-ins.** `dark` (today's values — a user who sets nothing sees the same colours), `light`,
`dark-daltonized`, `light-daltonized`. The daltonized pair is specified in hex rather than colour
names so the guard can COMPUTE it: `src/theme/color-vision.ts` simulates protanopia and
deuteranopia (a Viénot-style linear-RGB projection) and `color-vision.test.ts` requires every pair
whose colour difference carries meaning — success/error, diff added/removed, syntax
addition/deletion — to stay at least 50 CIE76 units apart under both. The floor is empirical for
that projection, not a published perceptual constant, and is recorded as such; the shipped pairs sit
at 56–88, while the green/red pair the default theme uses for the same distinction measures 41.7.
The guard REFUSES a value it cannot simulate (a colour name, a system ANSI index) rather than
passing it.

**Reading the theme.** `ThemeProvider` publishes the resolved theme; components call `usePalette()`
(the former `PALETTE`), `useTheme()` (for `renderMarkdown`) and `useMotionTokens()` (the former
`MOTION`). Outside a provider the hooks return the `dark` built-in, so a component rendered in a
test behaves exactly as it did before themes existed. Pure modules never hold a colour: `status-glyph.ts`
keeps `STATUS_SYMBOL` and offers `statusGlyphColor(colors, kind)`, `status-activity.ts` returns a
token key, and `execution-workspace-view-model.ts` returns a status KIND the component resolves.

**Motion has one owner and one consumer.** `useMotion()` = the colour gate ∧ not screen-reader mode
∧ not the reduced-motion setting, read by `WaveText` — the package's only animation. Deliberately
NOT gated by it: the background countdown (a once-a-second number is content; freezing it would show
a stale `in 59s`) and the `StreamingIndicator` screen-reader collapse (it drops content, which a
sighted reduced-motion user still wants) — both remain `useScreenReader()` rules. Cadence
(400 ms) and grouping are the component's, not the theme's: a theme changes colour, not how often
the terminal repaints.

**Colour+motion gate.** `terminal-capabilities.ts` (`isInteractiveColorTerminal()`) remains the
single degradation gate and wins over every theme: NO_COLOR / `FORCE_COLOR=0` / non-TTY ⇒ markdown
colour off and WaveText static. Components add no per-call-site degradation branches. Noted
divergence, unchanged: the gate treats an EMPTY `NO_COLOR` as set (off), stricter than
no-color.org's "present and not an empty string" — the strict direction is the safe one. The diff
rows are the one exception to chalk's ambient detection: they are this package's own output and
their caller decides with its `color` flag, so when chalk detects NO colour at all they are styled
through a level-forced instance, exactly as the hand-written escapes behaved. Only the OFF case is
overridden — a DETECTED level is kept, because forcing truecolor over a 256-colour terminal would
emit a depth for these rows that the rest of the frame downsamples away. Their byte difference from
the hand-written escapes is recorded: chalk closes each style with its own paired closer rather
than the blanket `ESC[0m` — `ESC[39m ESC[49m` for a background+foreground pair, `ESC[39m` for the
hunk header, `ESC[22m` for the dim `diff `/`index ` metadata rows.

**The anti-drift floor matches the SYMBOL, not the module path.** `palette-consistency.test.ts`
refuses any file outside `src/theme/` that NAMES a built-in theme constant, however it is imported:
matching the `built-in-themes.js` path alone would leave the `src/theme/index.js` barrel — the route
every migrated component already imports through — as a way around the floor. A non-React caller
that must render without a resolved theme (`renderMarkdown`) asks `resolveTheme()`, which is where
"no theme was resolved" is answered, rather than reaching for the data itself.

**A theme change does not repaint scrollback.** Committed transcript entries go through Ink's
`<Static>` (see "Architecture Overview") and are emitted once; the terminal owns them from then on.
So a theme applies to the live region — input, status bar, streaming text, overlays — and to
everything rendered after it, while entries already in scrollback keep the theme they were written
in. This is the same property that makes the transcript survivable at all (SCREEN-1993), and it is
the reason a picker previews against the live region rather than the transcript.

**User and plugin themes: one strict policy** (`src/theme/theme-document.ts`). A theme FILE is
`{ name?, base?, overrides? }`: `base` names a built-in, and `overrides` is a sparse map over the
same token paths the built-ins use. The paths are not listed in the parser — they are WALKED from
the base theme, so `ITuiTheme` gaining a key makes it overridable and losing one makes it refused,
and there is no second declaration of the token model to drift from the first. Values go through
`isThemeColor`, the one place the grammar is decided.

**The diagnostic is part of the boundary, not a report on it.** A refused file's message is the one
thing that reaches the terminal, and it quotes what was wrong — so interpolating the rejected value
raw defeats the injection floor with the message that reports a violation of it. `quoteThemeText`
and `sanitizeThemeProse` are that policy, exported because `agent-cli` builds diagnostics of its own
(an unusable file name, an unreadable plugin scope) and a second copy is how the two drift.
`JSON.stringify` alone is not the policy: it escapes U+0000–U+001F and leaves U+007F and the C1
range literal, including the single-byte spellings of CSI and OSC that a terminal accepts exactly as
it accepts `ESC [`.

A theme's NAME goes further than a diagnostic: it is APPLIED, and drawn on every `/theme list` row
and picker row until the setting changes. A name carrying a control character, or longer than the
box it is drawn in (60 characters), refuses the file — and the minted id used when a document
supplies no name is held to BOTH bounds, because "the caller already made it safe" is the assumption
that puts an unchecked string on a row. `agent-cli` sizes the id segments so the composite fits that
same 60.

The file is applied WHOLE or not at all. The first unknown token path, non-colour value, wrong shape
or parse failure refuses the entire file with a `$.`-prefixed diagnostic naming what was wrong — the
keybindings document's contract, for the same reason: a partially-applied theme is the state where a
reader cannot tell which colours are theirs and which the base's. A refused file is carried in the
registry BESIDE the themes (`IThemeSkip`), never among them, so a surface can SHOW it without ever
being able to resolve to it; `agent-cli` prints it once at startup and the picker renders it as a
row that carries the same reason and cannot be chosen. Its neighbours still load — one unreadable
file does not take the rest down with it (the CORE-029 lesson, applied here).

The document never names itself. The `id` is minted by the loader from WHERE the file was found
(`custom:<slug>`, `custom:<plugin>:<slug>`), the `source` is which loader read it, and the
`appearance` follows the base it extends — so no file can claim a built-in's id whatever it is
called, and `id` is not a thing a theme author can get wrong.

**An unencodable colour throws, and says which one.** `foreground()` and `background()` REFUSE a
value outside the grammar rather than answering with a default style. Before SCREEN-2002's third
work unit they gave two different silent answers to the same question — the caller's base, and
`chalk.reset` — so one bad value rendered as unstyled text in one place and as a reset in another.
The value is unreachable in practice (built-ins are checked by the TC-01 tests, files are refused
whole above), which is exactly why reaching it is a defect in this package and not something to
paper over: the one behaviour it must not have is rendering a theme nobody can see is wrong.

**De-emphasis rule.** The canonical muted treatment is Ink's `dimColor` (terminal-theme-relative,
degrades for free) — including `KeyHintFooter`'s footers. `colors.text.muted` exists only where an
actual colour VALUE is required (the static WaveText frame, the idle status, the idle activity, the
composer's placeholder).

**Known floor limit (recorded decision).** The two SCREEN-2002 ratchets closed the case SCREEN-006
deferred ("a future TS helper returning a bare color-name string"), which recurred twice
(`getContextColor`, `STATUS_GLYPH[...].color`). What the floor still cannot see is a colour-name
string returned by a helper that neither imports the theme data nor calls chalk — a literal `'cyan'`
returned from a pure function. The type system covers the tokens such a value would flow into; the
gap is recorded rather than claimed away.

## Screen Reader Mode (CLI-2004)

An explicit, opt-in plain-text mode. **Default off**: with no flag, environment variable or setting,
not one byte of today's output changes — the `screen-006-no-color` and `screen-010-scrollback` PTY
fixtures spawn the binary flagless and are asserted to keep passing unchanged.

**Activation and precedence** are owned by `agent-cli` (`startup/screen-reader-enablement.ts`, and
that package's SPEC). This package receives ONE resolved boolean plus the channel that set it.

**How it is threaded.** `IRenderOptions.screenReader` → Ink's own `isScreenReaderEnabled` option AND
a React context (`screen-reader-context.tsx`). Every component reads it through `useScreenReader()`;
no component takes it as a prop. The field is also carried in `toChannelOptions`, the hand-maintained
projection ARCH-110 records as able to drop an option silently.

**Confirmation line.** The first line `renderApp` prints in the mode is
`[Screen reader mode: on via flag|env|settings]` — first of the TUI's own output, though `agent-cli`
may have printed a welcome or a memory notice before handing over. When the mode is OFF and the
environment looks like a reader is running, one advisory line instead:
`[Screen reader mode: off — run with --screen-reader]`, and not even that when the operator turned
the mode off explicitly. The mode is never enabled by detection — a false positive prints one line,
it does not reshape a sighted user's interface.

**What the mode changes.**

| Surface           | Off                                                                                                                                 | On                                                                                                            |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Chrome            | `borderStyle` boxes, hand-drawn rules, the `│` diff gutter, `├`/`└` task connectors, the ASCII banner, the framed first-run welcome | all omitted (the border props are DROPPED, never restyled — the palette floor forbids substituting a literal) |
| Motion            | `WaveText` colour ramp on a 400 ms interval; multi-line streaming indicator                                                         | text written once, no interval scheduled; one static status line                                              |
| Transcript labels | `You:` / `Robota:` / `System:` / `Tool:`                                                                                            | the role-derived vocabulary below                                                                             |
| Menus             | arrow keys + `> ` cursor                                                                                                            | `N. <option>` rows and `Enter selection (1-<n>)`                                                              |
| Yes/no prompts    | two-option arrow menu                                                                                                               | `Answer y or n and press Enter` (`y`/`n`/`yes`/`no`)                                                          |
| Markdown tables   | `marked-terminal`'s box-drawn grid                                                                                                  | one `Header: value` line per cell, blank line between rows                                                    |
| Status line       | activity text and context percentage shown; `default` permission mode hidden                                                        | activity and context suppressed (volatile); permission mode always shown (stable anchor)                      |
| Deletion          | `Ctrl+W` deletes the word before the cursor, `Ctrl+U` the line, both silently                                                       | the same edit, plus `[deleted: <text>]` once                                                                  |
| Attention         | none                                                                                                                                | terminal bell on reply completion, on a prompt/dialog, and on a tool that ran past `LONG_TOOL_BELL_MS` (5000) |
| Turn boundaries   | none                                                                                                                                | OSC 133 `A`/`B`/`C`/`D`                                                                                       |

**Label vocabulary** (`screen-reader-labels.ts`, SSOT — nine entries, all lowercase):
`you:` `assistant:` `thinking:` `tool:` `tool error:` `error:` `warning:` `permission required:`
`cost:`. Derived from the message ROLE, never the vendor, so the transcript is identical under every
`agent-provider-*`; a test asserts no value matches a provider or vendor name.

**Numbered-list contract** (`numbered-list.tsx` — the menu counterpart of the footer grammar above).
Rows are `N. <option>` starting at 1. The prompt literal is `Enter selection (1-<n>)`, suffixed
` or Escape to cancel` where the menu is cancellable. A non-numeric or out-of-range entry re-prints
the SAME literal and selects nothing — the range is the correction. The selection itself stays owned
by `flows/selection-flow.ts` (`applyNumericSelection`), so a menu resolves identically however it was
driven. `SlashAutocomplete` takes the numbering but not the prompt: it is a completion popup driven
by the input line, which owns those keystrokes.

**Pacing** (`screen-reader-pacing.ts`, `screen-reader-stdout.ts`). Two waits, tunable, `0` when the mode is off:

| Variable                                | Default | Bound    | Purpose                                                                                                                                                    |
| --------------------------------------- | ------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ROBOTA_SCREEN_READER_STARTUP_QUIET_MS` | `900`   | `600000` | let the reader finish the confirmation line before the first prompt frame; any keypress ends it early                                                      |
| `ROBOTA_SCREEN_READER_PREPARK_MS`       | `50`    | `5000`   | park once in front of each printable COMMIT after the first, so a diff-based reader's snapshot can fall between two commits (SCREEN-2670); `0` disables it |

The default is measured against THIS render loop, not copied: `900` is this binary's observed
boot-to-first-prompt interval doubled. `0` means "no wait" exactly; a value above the bound is
clamped **and reported on stderr**; a non-numeric value is refused with a note and the default
stands — nothing is silently substituted. "Any keypress" is literal because the wait puts a TTY
stdin into raw mode for its duration and restores it; in canonical mode the terminal would deliver
nothing until Enter.

**The pre-write park (SCREEN-2670).** In the mode Ink runs unthrottled and writes one commit as up
to four synchronous chunks (synchronized-output begin, a `<Static>` erase, the frame, the end). The
park owns Ink's `stdout` through its documented option and treats those chunks as ONE batch, parked
once in front and released contiguously, so a synchronized-output window and a `<Static>` erase are
never split and no torn frame is ever on screen for the interval. The interval is measured from the
previous printable release: a commit that arrives after a natural pause of at least the interval is
not delayed at all. No cursor sequence is written (CLI-062 invariant I3 holds literally):
`eraseLines` already ends in `cursorLeft`, so time is the only separation added. Never parked: the
first printable release of a session, a batch with no printable content (Ink's exit barrier, the OSC
133 marks — which travel through the same path because they are positional), and a composer
keystroke. That exemption is a boolean the composer's key handler arms for TEXT-MUTATING keys only
(never submit or execute, whose commit appends the prompt line to the transcript), read when the
batch opens and carried on it, and expired on `setImmediate`. **Nothing is ever dropped:** Ink's
erase bookkeeping and its once-only `<Static>` writes both assume every frame landed, so when a
newer printable commit closes behind a parked one the older one is released at once — at most one
batch ever waits. A terminal handoff drains the queue before the child gets the TTY, and teardown
drains it before the terminal is restored, so the last frame of a session is never the one lost.
With the mode off no proxy is constructed and `stdout` is not passed at all. **The default is
PROVISIONAL:** the mode runs unthrottled, so no frame interval derives it, and the governing
timescale — the reader's own sampling cadence — cannot be measured from this harness; `50` matches
the sole product precedent. Open item: measure the park against a real screen reader and re-derive
the default.

**Native scrollback is a guarded invariant.** Ink's `alternateScreen` defaults to `false` and nothing
here sets it. The alternate screen has no scrollback, and reviewing earlier output is how a reader
uses a long session, so `screen-010-scrollback.ptytest.ts` asserts `\x1b[?1049h` never appears — in
the mode as well as out of it.

**OSC 133 support table.** The marks are emitted unconditionally in the mode wherever
`supportsTurnMarks()` allows; an emulator that does not implement OSC 133 discards the sequence.

| Terminal                    | Behaviour                                                                                                                               |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code integrated terminal | navigates between marks (`Ctrl`/`Cmd`+`Up`/`Down`)                                                                                      |
| iTerm2                      | prompt marks in the left margin; `Cmd-Shift-Up`/`Down`                                                                                  |
| WezTerm                     | **not emitted** — it owns OSC 133 for the shell, and a second emitter corrupts its prompt tracking. Override with `ROBOTA_TURN_MARKS=1` |
| macOS Terminal.app          | emitted, ignored — no navigation results                                                                                                |
| Any other emulator          | unknown sequence, discarded silently                                                                                                    |
| Non-TTY stdout              | **not emitted** — nothing consumes the marks in a pipe                                                                                  |

`ROBOTA_TURN_MARKS` overrides the whole table in either direction: `=1` emits where this package
would withhold, `=0` withholds where it would emit.

**Known limitations.**

- Ink 7.1.1 self-describes its screen-reader support as "basic"; its output shape is not a contract
  this package controls. Labels, pacing, the bell and the OSC 133 marks are written here for that
  reason.
- The marks do nothing in the terminals listed above as ignoring them, and are withheld in WezTerm.
- The mode never turns itself on. A reader-shaped environment gets one advisory line, nothing more.
- Cost is not announced per turn.
- There is no permission-mode-cycling announcement, because no key-based cycling exists in this
  repository; the mode is changed by command. The mode is instead rendered permanently in the status
  line so a reader can find it. If key cycling is added, the announcement is added with it.
- The pre-write park's default interval is provisional (see **The pre-write park** above); it has
  not been measured against a real screen reader.
- Because at most one batch ever waits, a stream of commits faster than the interval is separated
  only at its final commit — the intermediate ones go out back to back rather than being paced.
  The measurement above should account for that before the default is re-derived.

## Attention & Interval Recap (SCREEN-1992)

The TUI knows whether the user is at the terminal and, when they come back, says in one line what
happened while they were away. Attention is observed here — the terminal is this package's — and
the recap is derived from channel events the TUI already receives; the session is never asked to
summarize and no provider call is made. A recap does not survive a restart, by design.

**Attention sources** (`src/attention/attention-tracker.ts`). Two sources feed one level-triggered
`attended` boolean, and the tracker records which one is deciding (`source: 'focus' | 'idle'`) so a
degraded run is never a silent default:

| Source  | When                                                               | Away means                                           | Back means                |
| ------- | ------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------- |
| `focus` | the first `CSI I`/`CSI O` has arrived after `DECSET 1004` was sent | the terminal sent `CSI O`                            | the terminal sent `CSI I` |
| `idle`  | until then, and wherever the mode is off                           | no keystroke for `DEFAULT_IDLE_THRESHOLD_MS` (5 min) | the next keystroke        |

Requested is not confirmed: a terminal that does not implement mode 1004 discards the request and
never answers, so the idle source stays armed until the first focus event, and from that event on
focus is the **sole** source — a focused reader who typed nothing must not receive a recap of what
they watched. Repeated `CSI O` is one interval. A focus event while the mode is off is an invariant
violation and throws rather than being absorbed.

**Focus reporting** (`src/terminal-focus-reporting.ts`, `src/terminal-capabilities.ts`).
`supportsFocusReporting({ override })` is on for an interactive TTY pair, and the override the
product shell injects (`renderApp({ focusReporting })`) forces it either way — this package reads no
product-named environment literal for it. The `DECSET 1004` request is written outside Ink (the
`terminal-marks.ts` carve-out; the two sequences are constants), `DECRST 1004` on exit and around a
terminal handoff (`TerminalHandoffController.setTerminalModeHooks`: released after the App
suspends, re-negotiated after it resumes, so a child never receives focus sequences and a child that
reset the mode leaves nothing blind).

| Terminal                                                                                          | Behaviour                                                                                                    |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Alacritty, foot, Ghostty, iTerm2, Kitty, Konsole, VTE, WezTerm, Windows Terminal, xterm, xterm.js | focus events reported; attention follows terminal focus                                                      |
| tmux                                                                                              | needs `set -g focus-events on` (off by default); without it the request is absorbed and the idle source runs |
| Zellij ≥ 0.33                                                                                     | focus synthesized per pane                                                                                   |
| macOS Terminal.app, PuTTY, GNU Screen                                                             | request discarded; no events arrive, so the idle source is the only one that ever fires                      |
| Non-TTY stdin or stdout                                                                           | **not requested** — nothing sends the sequences in a pipe                                                    |

The shell's `ROBOTA_FOCUS_EVENTS` (agent-cli) overrides the table in either direction: `=1` requests
where this package would not, `=0` is the kill switch.

**The stdin proxy** (`src/attention/focus-input-filter.ts`). Ink tokenizes `ESC [ I` as a keypress
and every `useInput` listener would receive `[I`, so the composer would type it. `renderApp` hands
Ink a `FocusReportingStdin` in `render({ stdin })`: it strips `CSI I`/`CSI O` only while mode 1004 is
negotiated, reports them and every other keystroke to the tracker, and forwards the rest
byte-identical (a split escape sequence and a bracketed paste are Ink's to parse). It forwards
`isTTY`, `setRawMode`, `ref` and `unref` to the real stdin and is attached only after the startup
quiet period, which consumes its own keystroke.

**Interval recap** (`src/attention/interval-recap.ts`, `attention-coordinator.ts`). While
unattended the coordinator counts, from the channel events the projector already binds: `complete`
by the preceding `turn_source` (a wake is `agent-wakeup`), `permission_request`/`ask_request` as
needs-input, `error`, and background entries (never the main thread, whose turns are already
counted) whose `state` REACHED `completed`/`failed`/`stopped` during the interval — the states at
the moment attention was lost are the baseline, so an entry that was already finished is old news
and one that left the terminal state again is dropped. On return it pushes one bounded line into the notice store under the
TUI-originated `attention-recap` kind, or nothing for an empty interval:

```
While away 12m: 2 turns finished (1 wake) · 1 needs input · 1 failed
```

`turn_source` is therefore classified `channel` in `TUI_SESSION_EVENT_CLASSIFICATION`.

**Rows** (`src/background-task-row-format.ts`). Every row renders the entry's five-word `state`
beside the glyph (`⟳ working`, `◴ needs-input`, `✓ completed`, `✗ failed`, `⊗ stopped`), the
`headline` when it says more than the preview (`? Allow Bash?` for a question), and for a sleeping
schedule a countdown from `nextFireAt` (`in 59s`, `in 4m 59s`, `now`) that `useCountdownTick`
advances once a second while such an entry exists — never in screen-reader mode, where the row is
read once and the recap is a plain notice line. `accessibleText` carries the same words.

**Known limitation.** A background task's `needs-input` is defined in the state mapping but
unreachable today: no runtime path fires `background_task_permission_request` or enters
`waiting_permission`, and a subagent's permission routes through the parent registry as a plain
`permission_request` (recorded on issue #2670).

## Prompt History Search (SCREEN-1993)

`Ctrl+R` in the composer opens a reverse search over the prompts the user has typed — in this
session, in this project, or in every project — and puts the chosen one back in the composer or
runs it. The stored prompts come from `~/.robota/history.jsonl`, the user-level append-only
projection the interactive session writes on every owner turn (`@robota-sdk/agent-session`
`NodePromptHistoryFile`; the append rules are the framework's, see its SPEC). This package only
reads it, through the `IPromptHistorySource` the product shell injects (`IRenderOptions`
`promptHistorySource` + `promptHistoryProject`); the session-side writer travels the same route as
`memoryStore` (`IRenderOptions.promptHistory` → `ITuiInteractionChannelOptions.promptHistory` →
`buildTuiSessionOptions`). Absent the source, `ctrl+r` is inert and nothing else changes.

**Keys.** `chat-input.history-search` (`ctrl+r`) opens the overlay. Inside it, context
`history-search`: `previous` (`up`), `next` (`down`, `ctrl+r`), `cycle-scope` (`ctrl+s`), `insert`
(`enter`, `tab`), `execute` (`ctrl+e`), `cancel` (`escape`). Every one of them is rebindable through
`~/.robota/keybindings.json`; Ctrl+C stays reserved. Any other printable key appends to the query and
Backspace removes from it — the query is a search string, not a composer, so it has no cursor. The
footer is derived from the effective bindings (`HISTORY_SEARCH_FOOTER_HINTS` is the default
rendering) and lists exactly the live keys.

**Scopes.** `all → session → project → all` on each `cycle-scope`; a search opens in `all`. `session`
is the composer's own live prompt list (the same list Up/Down recall walks) and never reads the
file; `project` keeps entries whose `project` equals the injected key; `all` keeps everything.

**Ordering, dedup, loading.** The file is read backwards in blocks and rendered newest-first as
each block lands, so the first frame shows the newest prompts before the rest of the file is read
(`loading…` stays in the state line until the read ends). In every scope an entry equal to an
earlier (newer) one after trimming is dropped — the newest occurrence wins. Matching is a
case-insensitive substring; every occurrence in a row is highlighted, and under the colour gate
(`NO_COLOR`, non-TTY) the highlight is a visible `[match]` marker rather than an SGR attribute
nothing would render. Exactly one loader runs per open under one `AbortController`; insert,
execute and cancel all abort it, and a cancel mid-load is a cancel, not a wait.

**Insert, execute, cancel.** `insert` closes the overlay and replaces the composer text with the
match (cursor at the end); `execute` closes it and submits the match through the composer's normal
submit path, so it joins the live prompt list like any typed prompt; `cancel` closes it. The
composer is never written while the overlay is open — that is what makes cancel restore the draft
byte-identically, including its cursor, with nothing copied and nothing restored.

**Fallbacks.** A missing file is the empty state (`no stored prompts yet` in `all`/`project`;
`session` is unaffected). Any other read failure is rendered in the overlay
(`History could not be read: …`) — never an empty list. A malformed line is skipped and counted
(`N unreadable line(s) skipped` in the state line). While another overlay or a disabled composer
takes the keys, an open search closes.

**Screen-reader mode.** The `SlashAutocomplete` precedent, not the switcher's: the keys stay
active, rows are numbered for announcement only, and digits are query text — not a selection.
Streaming blocks are not published while loading; the list is re-rendered per keystroke and once at
load end, so a reader is not interrupted by every block that lands.

**The transcript decision.** The item also asked for conversation-transcript search. No in-app
transcript viewer ships: every committed message is emitted through Ink's `<Static>` into the
terminal's native scrollback, the TUI never enters the alternate screen (which has no scrollback),
so a resumed session's whole transcript is already readable and searchable with the terminal's own
tools. That reason is proven on the real binary, not asserted
(`src/__tests__/pty/screen-1993-scrollback.ptytest.ts` resumes a 120-message session and finds
every message in the capture with no key pressed and no `ESC [ ? 1049 h`).

## IME Real-Cursor Contract (CLI-062)

During focused text entry, `CjkTextInput` positions the REAL terminal cursor at the composition
point so the OS IME window appears at the input position (contract:
`.design/investigations/2026-07-25-cli-062-ime-cursor-design.md`). Mechanism: a `<Box ref>` yoga
parent-chain walk yields the input's absolute frame-space origin
(`src/hooks/useRealCursorPosition.ts`); the cell math and the crash-avoidance guard are pure
(`src/flows/real-cursor-flow.ts`, reusing the input's own wrap-aware `displayOffset`); the cell
rides ink's `useCursor` inside the synchronized frame write. Five invariants (I1 never a guessed
row; I2 never into a frame ≥ viewport or a y outside it; I3 never out-of-band writes; I4 guard
fail/blur/unmount → exactly today's drawn-cursor rendering; I5 Apple_Terminal off by default,
`ROBOTA_IME_CURSOR=1` opt-in / `=0` kill switch via
`supportsImeCursorPositioning()`) each exist as a code comment AND a test; the drawn inverse
cursor is suppressed only while real positioning is active.

**Terminal.app hardware evidence (2026-09-22).** On macOS 27.0 (build 26A428) with Terminal.app
2.15 (488) and the 2-Set Korean input source, both `pnpm exec robota` and
`ROBOTA_IME_CURSOR=1 pnpm exec robota` survived a mid-line `한` composition followed by Left and Right.
The opt-in cell did **not** place its initial composition display at the mid-line input point: it appeared
below the input line at its left edge. That is an incorrect placement even without a crash, so the I5
Apple_Terminal default-off branch remains required. The full per-cell evidence, including screenshot
paths and process checks, is recorded in `SCREEN-2442`.

## Extension Points

New TUI components/flows live under `src/`. The adapter seam (`ITuiCliAdapter`) lets the CLI inject
command/provider UX without the transport knowing CLI specifics.

## Error Taxonomy

Provider/runtime errors surface through the interactive-session event stream. A TUI-owned event
projection failure is reported through `onSessionEventDeliveryError`; it never mutates the canonical
turn-error state and never escapes back into the already-committed domain operation. This package adds
no new error classes.

## Test Strategy

`src/__tests__/pty/spawn-pty.test.ts` retains the six PTY harness/HOME-isolation self-tests:
marker/exit-code observation, paced input, default isolated HOME, explicit isolated HOME,
empty HOME contents and environment overrides. The default `*.test.ts` project discovers this
file and the two handoff suites; the dedicated PTY project continues to use the local
`pty-driver.ts`. The relocation preserves these characterization tests; runtime verification
belongs to owning CI when local PTY/HOME execution is prohibited.

Component/flow unit tests (ink-testing-library) under `src/__tests__`; a real-terminal PTY suite
(`*.ptytest.ts`, `vitest.pty.config.ts`) runs against the built CLI via `pnpm test:pty`. The IME
terminal/override capability matrix is exhaustive in the pure unit suite. PTY coverage proves the
binary boundary with representative supported-default, Terminal.app-default-off,
Terminal.app-force-on, and supported-force-off cells, both viewport geometries when positioning is
enabled, plus the dedicated real-tmux suite; it does not repeat every pure capability cell through a
fresh process.

SCREEN-1992's attention modules are pure and tested under `src/attention/__tests__` (fake timers
for the idle source and the countdown tick, fixture event streams for the recap, byte fixtures for
the stdin filter); the terminal-mode bracket is pinned in `terminal-handoff-controller.test.ts`.

SCREEN-1993's search flow is pure (`src/history-search/history-search-flow.ts`, unit-tested); the
overlay is exercised through `InputArea` with a gated async source whose blocks the test releases
one at a time (`history-search-overlay.test.tsx`: one loader per open, first block before the second
lands, insert/execute/cancel, read error, screen-reader publish gating); the keybinding surface is
covered by the catalogue/schema parity test, a document-rebinding case and the footer inventory; the
product-level scenario and the scrollback proof run in the PTY project.

`TuiInteractionChannel.lifecycle.test.ts` mechanically compares actual listener registration and
teardown with the exhaustive classification and forces a notice projection failure. The notice
component suite proves deterministic plan/context/branch rendering independently of canonical history.
REFACTOR-025 adds negative compile-time probes for the React-facing port, focused queue and lifecycle
tests, channel event-projection coverage, App session-switch/controller coverage, and a deterministic
public SDK example. The existing built-CLI PTY `/help` plus `/exit` flow remains the product-level
startup and shutdown check.

## Class Contract Registry

| Class/component                  | Contract or dependency                                                                     | Responsibility                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `TuiInteractionChannel`          | implements `ITuiAppChannelPort`; owns concrete `InteractiveSession` and `CommandRegistry`  | Public compatibility facade and session-owning implementation                 |
| `TuiChannelLifecycleCoordinator` | receives explicit start, stop and bounded-shutdown callbacks                               | Owns start/stop/shutdown idempotency and graceful-state transitions           |
| `TuiSessionEventProjector`       | consumes the existing session event capability and `TuiStateManager`                       | Owns exhaustive event binding, projection error isolation and exact unbinding |
| `AttentionTracker`               | `IAttentionSource`; injected clock; focus or idle source                                   | Level-triggered attended/away, one change per transition (SCREEN-1992)        |
| `AttentionCoordinator`           | `IAttentionSource` + the channel events the projector feeds it                             | Counts one unattended interval and pushes the recap line (SCREEN-1992)        |
| `FocusReportingStdin`            | wraps the real stdin; `Readable` handed to `render({ stdin })`                             | Strips focus sequences while negotiated, reports focus and keystrokes         |
| `TuiPermissionQueue`             | no framework-class dependency                                                              | Owns permission FIFO, prompt dismissal and deny drains                        |
| `TuiUserActionQueue`             | no framework-class dependency                                                              | Owns unified-action FIFO, prompt dismissal and cancelled drains               |
| `App`                            | receives an `ITuiAppChannelPort` factory from `renderApp`                                  | Owns active narrowed-port selection and awaits old-session stop on switch     |
| `useAppController` / `AppView`   | compose focused lifecycle, screen, workspace, input and overlay hooks into `IAppViewModel` | Terminate the channel port and assemble bounded presentation data             |
| `AppPresentation`                | consumes only `IAppViewModel`                                                              | Render the presentation tree without channel or framework escape hatches      |

## Dependencies

- `@robota-sdk/agent-interface-tui`, `@robota-sdk/agent-interface-transport` — contracts.
- `@robota-sdk/agent-framework`, `@robota-sdk/agent-core` — runtime + primitives.
- External: `react`, `ink`, `ink-*`, `marked`, `marked-terminal`, `chalk`, `string-width`.
