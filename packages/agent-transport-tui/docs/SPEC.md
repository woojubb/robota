# @robota-sdk/agent-transport-tui SPEC

## Scope

Ink/React terminal UI transport for `InteractiveSession`. Implements `IConfigurableTransport` so the transport lifecycle is owned by the assembler (`agent-cli`) rather than by the UI itself.

## Boundaries

- Does NOT own `InteractiveSession` — the TUI creates one internally via `useInteractiveSession`; the session is local to the render tree.
- Does NOT depend on `@robota-sdk/agent-cli` — all CLI-specific I/O is injected via `ITuiCliAdapter`.
- Does NOT call `process.exit()` — returns `Promise<void>` from `renderApp()`; the caller owns lifecycle termination.
- OWNS: Ink render tree, React component hierarchy, TUI state management, slash command routing, command effect application.

## Architecture

```
agent-cli (assembler)
  │ constructs ITuiCliAdapter
  │ constructs TuiTransport({ cliAdapter, ...options })
  ↓
TuiTransport implements IConfigurableTransport
  └── renderApp(options)
        └── Ink render tree
              ├── TuiCliAdapterProvider   (React context for ITuiCliAdapter)
              ├── useInteractiveSession   (creates + drives InteractiveSession)
              ├── useSlashRouting         (slash command dispatch)
              ├── useSideEffects          (CLI effect application via cliAdapter)
              └── TransportTUI / App      (UI components)
```

## Dependency Direction

```
agent-cli → agent-transport-tui → agent-sdk → agent-sessions → agent-core
                                ↘ agent-interface-transport
```

No reverse imports. `agent-transport-tui` must never import from `agent-cli`.

## Public API

### `TuiTransport`

```typescript
import { TuiTransport } from '@robota-sdk/agent-transport-tui';

const transport = new TuiTransport(options);
await transport.start(); // blocks until TUI exits
```

Implements `IConfigurableTransport`:

- `name = 'tui'`
- `defaultEnabled = true`
- `start()` — renders the Ink TUI, resolves when the user exits
- `stop()` — no-op (Ink exits from within the TUI on user action)
- `attach()` — no-op (session created internally by `useInteractiveSession`)

### `ITuiCliAdapter`

Injectable interface that carries CLI-specific I/O dependencies into the TUI. Implemented by the assembler (`agent-cli`).

```typescript
interface ITuiCliAdapter {
  getUserSettingsPath(): string;
  readSettings(path: string): Record<string, TUniversalValue>;
  writeSettings(path: string, settings: Record<string, TUniversalValue>): void;
  deleteSettings(path: string): boolean;
  applyStatusLineSettings(
    path: string,
    patch: TStatusLineCommandSettingsPatch,
  ): IStatusLineCommandSettings;
  reloadPluginCommandSource(registry: CommandRegistry): void;
  applyActiveModelChange(
    cwd: string,
    modelId: string,
    options?: { providerOverride?: string },
  ): { applied: boolean };
  getGitBranch(cwd: string): string | undefined;
}
```

### `IRenderOptions`

Passed to `TuiTransport` constructor. Carries all session configuration plus the `cliAdapter` and optional transport registry.

## Key Invariants

1. **`ITuiCliAdapter` injection is mandatory** — `TuiCliAdapterProvider` wraps the root component; any component that needs CLI I/O calls `useTuiCliAdapter()`.
2. **`renderApp()` is async** — resolves when Ink's `instance.waitUntilExit()` resolves. No `process.exit()` calls inside.
3. **`catch` clauses require `// allow-fallback: <reason>` on the same line** — enforced by pre-commit hook.
4. **`moduleResolution: bundler`** — required in `tsconfig.json` for Ink's ESM package exports to resolve correctly.

## Test Strategy

- Unit tests for hooks (`useSlashRouting`, `useSideEffects`, `command-effect-handler`) cover effect dispatch without rendering.
- Component tests use `ink-testing-library` for render assertions.
- PTY e2e tests (`provider-setup-pty-e2e.test.ts`) spawn a real pseudo-terminal via `@homebridge/node-pty-prebuilt-multiarch` to validate interactive flows end-to-end.
