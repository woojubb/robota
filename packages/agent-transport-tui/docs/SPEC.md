# agent-transport-tui Specification

## Scope

Terminal UI transport for the Robota SDK — the React + Ink interactive renderer. Split out of the
former consolidated `agent-transport` package (DQ-AUDIT-005) so that React/Ink/node-pty are isolated
to this package and never enter the dependency graph of non-TUI consumers.

## Boundaries

- Owns the Ink/React rendering pipeline, the TUI interaction channel, and the default TUI CLI adapter.
- Depends on `agent-interface-tui` for interaction contracts and `agent-framework` for the
  interactive-session runtime; does **not** depend on the other transport implementation packages.
- No other transport package depends on this one (verified: zero cross-transport runtime imports).

## Architecture Overview

```
agent-transport-tui
  ├── TuiTransport            ← ITransportAdapter implementation (Ink app)
  ├── renderApp              ← mounts the Ink <App/>
  ├── TuiInteractionChannel  ← IInteractionChannel for TUI mode
  └── createDefaultTuiCliAdapter ← wires command/provider UX into the renderer
```

## Channel Lifecycle & Teardown

`TuiInteractionChannel` owns the interactive session and its render state; its teardown contract is
authoritative for how the TUI releases resources on session switch and process exit.

- **`start()`** wires the session event listeners (13 `session.on(...)` bindings) and begins the
  init poller. It is idempotent (a `sessionStarted` guard).
- **`stop()`** is the full, idempotent channel teardown (a `stopped` guard makes repeat calls
  no-ops). It **unwires every session listener** it registered (each binding is retained and removed
  with `session.off(...)` — no handler may stay bound to a discarded session), drains the permission
  and user-action queues (see below), stops the init poller, disposes the `TuiStateManager`, stops
  transports, and — unless the channel was already gracefully shut down — **shuts the underlying
  session down** (bounded by `SHUTDOWN_TIMEOUT_MS`) so a discarded or switched-away channel releases
  its background tasks, subagent child processes, and timers. A channel that leaves listeners bound
  or its session running after `stop()` is a defect.
- **`shutdown({ reason, timeoutMs? })`** is the graceful process-exit path (first Ctrl+C, `/exit`,
  signal). It marks `isShuttingDown`, drains both queues, renders `Shutting down...`, then awaits the
  session shutdown **bounded by a timeout** (`SHUTDOWN_TIMEOUT_MS`, overridable) so a wedged subsystem
  can never block process exit. It is idempotent (`isShuttingDown` guard).
- **Session switch policy.** The old channel is `stop()`-ed _before_ the new channel becomes active,
  so it can never receive events addressed to the new session and its session is shut down as part of
  that teardown. This is the single owner of old-session shutdown on switch.

### Queue drain on abort / shutdown

The channel serves two independent request queues. Both must be drained on `abort()`, `cancelQueue()`,
`shutdown()`, and `stop()` so no promise dangles:

- `cancelAllUserActions()` — resolves every queued/in-flight CMD-004 ask as `{ type: 'cancelled' }`.
- `cancelAllPermissions()` — resolves every queued/in-flight permission request as `false` (deny):
  aborting or shutting down must never leave a tool's permission promise unresolved (the tool would
  hang) nor grant it. The two drains are symmetric; a permission queue with no cancel path is a defect.

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
- The only legacy `result.effects` still consumed (`command-result-handler.ts`) are the two
  notification kinds pending their Stage-E carriers: `conversation-history-cleared` and
  `plugin-registry-reload-requested` (local registry/autocomplete refresh only — the semantic
  plugin reload already ran host-side). Everything else in `effects` is ignored by design.
- `ITuiCliAdapter` is **read-only toward settings** (`readSettings`/`getUserSettingsPath`); the
  write/delete/statusline-apply members were removed with the legacy effect handler.

## Type Ownership

Owns the TUI rendering/adapter types (`IRenderOptions`, `ITuiCliAdapter`,
`IDefaultTuiCliAdapterOptions`). Re-exports the `agent-interface-tui` interaction contracts for
convenience at the transport boundary.

## Public API Surface

| Export                                                                      | Kind     | Description                                                             |
| --------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| `TuiTransport`                                                              | class    | Ink-based interactive transport adapter                                 |
| `renderApp`                                                                 | function | Mount the Ink application                                               |
| `createDefaultTuiCliAdapter`                                                | function | Default CLI adapter for the renderer                                    |
| `ITuiCliAdapter` + option types                                             | types    | Adapter contracts                                                       |
| `ITuiPickerItem`                                                            | type     | One selectable item in a TUI picker interaction                         |
| `ITuiCommandInteraction`, `ITuiPickerInteraction`, `ITuiConfirmInteraction` | types    | Command/picker/confirm interaction contracts (`command-interaction.ts`) |
| `TAnyTuiCommandInteraction`, `TOnMissingArgsAction`                         | types    | Union of interaction contracts; missing-args action discriminator       |

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

## Color & Motion Contract (SCREEN-006)

Colors and motion values live in exactly three token modules; components never spell color names
or hex inline (mechanical floor: `src/__tests__/palette-consistency.test.ts` fails on any
`color="…"` / `borderColor="…"` / `backgroundColor="…"` JSX string literal or `#rrggbb` hex
outside the token modules). Token names are semantic slots (accent/muted/attention) — never
product vocabulary; values are plain constants (no theming framework, no runtime switching, no
config surface).

**Token-module boundary (three modules, one-way color flow):**

- `src/tui-palette.ts` — the Ink-side semantic palette: `PALETTE.text` (accent/emphasis/success/
  warning/error/session/muted/onAccent), `PALETTE.border` (attention/focused/active/muted/error),
  `PALETTE.status` (the 7 status kinds), and `MOTION` (WaveText ramp + cadence + grouping).
  Values are Ink/chalk color names (hex only in `MOTION.waveColors`).
- `src/status-glyph.ts` — remains the status SSOT (kinds, symbols, `toolStateStatusKind`,
  `workspaceStatusKind`); its colors are sourced from `PALETTE.status.*` (dependency direction:
  `status-glyph` → `tui-palette`, never the reverse).
- `src/tui-ansi-palette.ts` — raw SGR escapes for the `marked-terminal` markdown/diff pipeline —
  a different encoding with a different consumer. Its values are deliberately NOT derived from
  `PALETTE` (a name→SGR mapping layer would be invented complexity).

**De-emphasis rule.** The canonical muted treatment is Ink's `dimColor` (terminal-theme-relative,
degrades for free) — including `KeyHintFooter`'s footers. `PALETTE.text.muted` exists only where an
actual color VALUE is required (the static WaveText frame, `STATUS_GLYPH.idle`, the
`status-activity` idle color).

**Color+motion gate.** `terminal-capabilities.ts` (`isInteractiveColorTerminal()`) is the single
degradation gate: NO_COLOR / `FORCE_COLOR=0` / non-TTY ⇒ markdown color off and WaveText static
(zero intervals, zero color churn). Components add no per-call-site degradation branches. Noted
divergence: the gate treats an EMPTY `NO_COLOR` as set (off), stricter than no-color.org's
"present and not an empty string" — the strict direction is the safe one.

**Motion tokens.** WaveText is the package's one animation; its ramp (`MOTION.waveColors`,
4-stop `#555555→#bbbbbb`), cadence (`MOTION.waveIntervalMs`, 400ms) and grouping
(`MOTION.waveCharsPerGroup`) are tokens so motion is visible to palette audits. Perceptibility
comes from the ramp's contrast span, not faster flicker.

**Known floor limit (recorded decision).** The consistency floor catches JSX attribute literals
and hex, but not a future TS helper returning a bare color-name string (the old `getContextColor`
shape); today's instances of that shape were removed by the SCREEN-006 adoption pass, and
extending the floor to bare strings is deferred until one actually recurs.

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

## Extension Points

New TUI components/flows live under `src/`. The adapter seam (`ITuiCliAdapter`) lets the CLI inject
command/provider UX without the transport knowing CLI specifics.

## Error Taxonomy

Rendering/runtime errors surface through the interactive-session event stream; this package adds no
new error classes.

## Test Strategy

Component/flow unit tests (ink-testing-library) under `src/__tests__`; a real-terminal PTY suite
(`*.ptytest.ts`, `vitest.pty.config.ts`) runs against the built CLI via `pnpm test:pty`.

## Dependencies

- `@robota-sdk/agent-interface-tui`, `@robota-sdk/agent-interface-transport` — contracts.
- `@robota-sdk/agent-framework`, `@robota-sdk/agent-core` — runtime + primitives.
- External: `react`, `ink`, `ink-*`, `marked`, `marked-terminal`, `chalk`, `string-width`.
