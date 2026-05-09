# TypeScript Dev Pre-launch Report — Robota CLI (2026-05-10)

## Executive Summary

**Scope**: `packages/agent-cli/` (6,607 lines, ~60 source files) and `apps/agent-server/` (894 lines, 7 source files).

| Severity          | Count |
| ----------------- | ----- |
| Critical          | 3     |
| High              | 5     |
| Medium            | 6     |
| Low / Refactoring | 5     |

**Overall assessment**: The agent-cli codebase is architecturally sound — clean layer separation, proper event cleanup in React hooks, good type discipline throughout. The three critical issues are concentrated in `apps/agent-server/` (production security) and one structural design smell in the CLI hook layer. No memory leaks found. All event listeners registered in `useEffect` are properly unregistered in cleanup functions. `setInterval` in `useInteractiveSession` and `WaveText` are correctly cleared.

---

## Critical Issues (즉시 수정 필요)

### DEV-C-001: Firebase Function handler typed `any` — bypasses request/response type checking

**위치**: `apps/agent-server/src/index.ts:28`

**문제**: The `health` Firebase Function uses `req: any, res: any`, silently disabling TypeScript type checking for the handler. Any access to nonexistent properties or incorrect method calls on `req`/`res` will not be caught at compile time.

**코드 예시**:

```typescript
// BEFORE (problematic)
export const health = onRequest({
    cors: true,
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 60,
    maxInstances: 10
}, (req: any, res: any) => {
    res.json({ ... });
});
```

**수정 방향**: Use the types exported by `firebase-functions/v2/https`:

```typescript
import type { Request, Response } from 'firebase-functions/v2/https';

export const health = onRequest({ ... }, (req: Request, res: Response) => {
    res.json({ ... });
});
```

---

### DEV-C-002: Non-null assertion on unverified `client.sessionId` — runtime crash risk

**위치**: `apps/agent-server/src/websocket-server.ts:143`

**문제**: `client.sessionId!` is used inside the `playground_update` message handler after checking only `client.isAuthenticated`. However, `isAuthenticated` is set to `true` in `handleAuthentication` only after `client.sessionId = sessionId` is assigned (lines 196–197). The logic is actually correct today, but this non-null assertion pattern is fragile: if authentication logic is refactored, the assertion becomes a silent runtime crash (`Cannot read property of undefined`).

**코드 예시**:

```typescript
// apps/agent-server/src/websocket-server.ts:141-147
case 'playground_update':
    if (client.isAuthenticated) {
        // sessionId! — if authentication flow changes, this crashes at runtime
        this.broadcastToSession(client.sessionId!, message, clientId);
    } else {
        this.sendError(clientId, 'Authentication required');
    }
```

**수정 방향**: Add explicit null guard or encode the invariant in the type system:

```typescript
if (client.isAuthenticated && client.sessionId !== undefined) {
  this.broadcastToSession(client.sessionId, message, clientId);
}
```

Similarly, `this.userSessions.get(userId)!` at lines 203 and 226 should be guarded (line 203 has a `.has()` check immediately above it, so the `!` is safe today; line 226 is inside an `if (client.userId && this.userSessions.has(client.userId))` guard, so also safe today — but both should be refactored to avoid the pattern).

---

### DEV-C-003: `require.main === module` in an ESM-compiled file — always false in production

**위치**: `apps/agent-server/src/server.ts:72`

**문제**: `require.main === module` is a CJS idiom. The agent-server package has no `"type": "module"` in `package.json`, so it compiles to CJS — this works in development via `tsx` (which handles it). However, if the build output (`dist/server.js`) is ever compiled to ESM (e.g., via a tsup ESM target), this guard will silently be `false` and `startServer()` will never be called. The equivalent ESM idiom is `import.meta.url === new URL(process.argv[1], 'file://').href`.

**코드 예시**:

```typescript
// apps/agent-server/src/server.ts:71-73
if (require.main === module) {
  startServer();
}
```

**수정 방향**: The server is only called via `node dist/server.js` directly (see `"start"` script), so this guard is not needed. Either remove it and call `startServer()` unconditionally (since `index.ts` handles the Firebase export separately), or use the ESM-safe form if ESM output is ever intended.

---

## High Issues (출시 전 수정 권장)

### DEV-H-001: `as unknown as ISideEffects` cast — reads nonexistent properties off `InteractiveSession`

**위치**: `packages/agent-cli/src/ui/hooks/useSideEffects.ts:239-240`

**문제**: `getHostSideEffects` casts `InteractiveSession` to `ISideEffects` via `as unknown as`. The `ISideEffects` interface declares `_pendingModelId`, `_resetRequested`, `_exitRequested`, `_triggerResumePicker`, `_sessionName`, `_statusLinePatch`. None of these properties exist on `InteractiveSession`. Reading nonexistent optional properties in JavaScript returns `undefined`, so the `if (sideEffects._pendingModelId)` checks at lines 118–148 will always evaluate to falsy — meaning these side-effect paths are dead code in practice.

The `sideEffects` object is also used as a write target (`sideEffects._statusLinePatch = effect.patch` in `command-effect-handler.ts:66`) — this silently writes to a property on the `InteractiveSession` instance. The property may be garbage-collected or cause unexpected behavior if the session ever checks for it.

**코드 예시**:

```typescript
// useSideEffects.ts:239-240
function getHostSideEffects(interactiveSession: InteractiveSession): ISideEffects {
  return interactiveSession as unknown as ISideEffects;
}

// useSideEffects.ts:115-148 — reading always-undefined fields
const sideEffects = getHostSideEffects(interactiveSession);
if (sideEffects._pendingModelId) { ... }   // always false
if (sideEffects._resetRequested) { ... }   // always false
```

**수정 방향**: The `CommandEffectQueue` (which already exists) should be the SSOT for pending effects. Eliminate the `getHostSideEffects` pattern entirely. Route all side effects through `commandEffectQueue` / `applyCommandEffects` using the `deps` callbacks. The `_statusLinePatch` write in `command-effect-handler.ts` should be moved to a `deps.applyStatusLinePatch(effect.patch)` callback (which already exists at line 67).

---

### DEV-H-002: `sendError` always sends `type: 'auth'` for non-auth errors — incorrect protocol

**위치**: `apps/agent-server/src/websocket-server.ts:250-259`

**문제**: All error messages (including "Invalid message format", "Unknown message type", "Authentication required") are sent with `type: 'auth'` regardless of context. Clients that check `message.type` to route incoming messages will misinterpret runtime errors as authentication responses.

**코드 예시**:

```typescript
private sendError(clientId: string, error: string): void {
    this.sendMessage(clientId, {
        type: 'auth',   // always 'auth' — wrong for non-auth errors
        timestamp: new Date().toISOString(),
        data: { success: false, error },
    });
}
```

**수정 방향**: Add an `error` message type to `TPlaygroundWebSocketMessageKind` and send `type: 'error'` for runtime errors. Reserve `type: 'auth'` for auth responses only.

---

### DEV-H-003: `parseInt(process.env.RATE_LIMIT_MAX || '100')` — missing radix, NaN possible

**위치**: `apps/agent-server/src/app.ts:53`

**문제**: `parseInt` without a radix argument is ambiguous. If `RATE_LIMIT_MAX` is set to a string like `"0x10"` or starts with `0`, the result is implementation-defined. More critically, if `RATE_LIMIT_MAX` is set to a non-numeric string (misconfiguration), the result is `NaN`. The `express-rate-limit` `max` option receiving `NaN` silently disables rate limiting.

**코드 예시**:

```typescript
max: parseInt(process.env.RATE_LIMIT_MAX || '100'),  // no radix, NaN if misconfigured
```

**수정 방향**:

```typescript
const rateLimitMax = parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10);
if (!Number.isFinite(rateLimitMax) || rateLimitMax <= 0) {
  throw new Error(`Invalid RATE_LIMIT_MAX: "${process.env.RATE_LIMIT_MAX}"`);
}
```

---

### DEV-H-004: `onToolEnd` deduplication uses `toolName` only — breaks with concurrent identical tool calls

**위치**: `packages/agent-cli/src/ui/tui-state-manager.ts:90`

**문제**: When a tool completes, the active tool is matched by `toolName` and `isRunning`. If the same tool runs twice concurrently (e.g., two simultaneous `Bash` calls), `findIndex` returns the first matching entry, so the wrong state entry gets updated. The second entry never transitions to completed.

**코드 예시**:

```typescript
onToolEnd = (state: IToolState): void => {
    const idx = this.activeTools.findIndex(
        (t) => t.toolName === state.toolName && t.isRunning  // matches first, not the specific call
    );
    ...
};
```

**수정 방향**: Identify tool invocations by a stable `toolCallId` (if `IToolState` exposes one) or by insertion order. If the SDK does not provide a call ID, use an index-based approach tracked at `onToolStart`.

---

### DEV-H-005: `--system-prompt` flag silently ignored with only a warning

**위치**: `packages/agent-cli/src/cli.ts:351-354`

**문제**: The `--system-prompt` flag is parsed, shown in `IParsedCliArgs`, but deliberately not wired:

```typescript
// TODO: wire --system-prompt once IInteractiveSessionStandardOptions adds systemPrompt field
if (args.systemPrompt) {
  process.stderr.write('Warning: --system-prompt is not yet functional and will be ignored.\n');
}
```

This means a user who passes `--system-prompt "..."` gets a warning but no error — and no effect. This is a broken API surface in a beta release. It should either be removed from the CLI entirely until implemented, or throw an error to prevent user confusion.

**수정 방향**: Remove the flag from `parseCliArgs` and the `IParsedCliArgs` interface, or throw `process.exit(1)` with a clear "not yet implemented" message.

---

## Medium Issues

### DEV-M-001: `substr` is deprecated — use `slice`

**위치**: `apps/agent-server/src/websocket-server.ts:297`

**문제**: `String.prototype.substr` is deprecated since ES2015 and removed in the Annex B specification. Should use `slice`.

**코드 예시**:

```typescript
return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
//                                                              ^^^^^^
```

**수정 방향**:

```typescript
return `client_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
```

---

### DEV-M-002: `useInteractiveSession` initializes session outside `useEffect` in render body

**위치**: `packages/agent-cli/src/ui/hooks/useInteractiveSession.ts:197-200`

**문제**: Session initialization runs during render (not in `useEffect`) via:

```typescript
if (stateRef.current === null) {
  stateRef.current = initializeSession(props, permissionHandler);
}
```

This is a React anti-pattern in strict mode because render functions may be called multiple times. Since Ink does not run in strict mode, this works today — but it is a fragile pattern that will cause double-initialization bugs if strict mode is ever enabled.

**수정 방향**: Use `useRef` with lazy initialization via a factory argument: `useRef<IInitState | null>(null)` with `useMemo` (stable across renders) or `useState(initializeSession)` for one-time initialization.

---

### DEV-M-003: `promptInput` in `cli.ts` leaks stdin listener on Ctrl+C path

**위치**: `packages/agent-cli/src/cli.ts:133-136`

**문제**: When the user presses Ctrl+C (`\x03`) inside `promptInput`, the function calls `process.exit(0)` directly without first removing the `onData` listener from `stdin` or resetting stdin raw mode. In a test environment or if `process.exit` is mocked, this causes a listener leak.

**코드 예시**:

```typescript
} else if (ch === '\x03') {
    process.stdout.write('\n');
    process.exit(0);  // stdin listener never removed, raw mode never restored
}
```

**수정 방향**:

```typescript
} else if (ch === '\x03') {
    stdin.removeListener('data', onData);
    stdin.setRawMode(wasRaw ?? false);
    stdin.pause();
    process.stdout.write('\n');
    process.exit(0);
}
```

---

### DEV-M-004: `App.tsx` — `language` prop accepted but never consumed

**위치**: `packages/agent-cli/src/ui/render.tsx:26`, `packages/agent-cli/src/ui/App.tsx`

**문제**: `IRenderOptions` declares `language?: string` and `cli.ts:395` passes `language: args.language` to `renderApp`. However, `IProps` in `App.tsx` does not declare `language` and it is never passed down to `InteractiveSession`. The language argument is silently dropped.

**수정 방향**: Either wire `language` into `InteractiveSession` construction (if it supports runtime language override) or remove it from `IRenderOptions` and `renderApp` until it is implemented.

---

### DEV-M-005: `type` cast in `broadcastToUser` is unnecessary and masks type mismatch

**위치**: `apps/agent-server/src/websocket-server.ts:314`

**문제**: `message.type as TPlaygroundWebSocketMessageKind` is needed because `Omit<IPlaygroundWebSocketMessage, 'timestamp'>` still retains `type` from the original type but TypeScript infers it as `TPlaygroundWebSocketMessageKind` already. The cast suggests the types are misaligned or the `Omit` is not removing the right field.

**코드 예시**:

```typescript
const messageWithTimestamp: IPlaygroundWebSocketMessage = {
  ...message,
  type: message.type as TPlaygroundWebSocketMessageKind, // cast should not be needed
  timestamp: new Date().toISOString(),
};
```

**수정 방향**: Verify that `IPlaygroundWebSocketMessage.type` is `TPlaygroundWebSocketMessageKind` and that `Omit` is correct. The cast should be removable if types are well-defined.

---

### DEV-M-006: Server shutdown doesn't close WebSocket connections before HTTP server close

**위치**: `apps/agent-server/src/server.ts:50-61`

**문제**: In the shutdown handler:

```typescript
server.close(() => { ... process.exit(0); });
wsServer.close();
```

`wsServer.close()` is called after `server.close()`. `server.close()` stops accepting new connections but the callback fires only after existing connections drain. Active WebSocket connections keep the HTTP server from draining, creating a race where the 30s timeout fires first and forces `process.exit(1)`.

**수정 방향**: Close WebSocket connections first, then call `server.close()`:

```typescript
wsServer.close();
server.close(() => {
  process.exit(0);
});
```

---

## Low Issues / Refactoring Opportunities

### DEV-L-001: `readVersion()` in `cli.ts` is overly defensive — could use build-time injection

**위치**: `packages/agent-cli/src/cli.ts:75-96`

`readVersion()` parses `package.json` at runtime via two candidate paths and falls back to `'0.0.0'`. Since the build process (tsup) controls output paths, the version could be injected at build time via `define: { __VERSION__: JSON.stringify(pkg.version) }` in `tsup.config.ts`, eliminating the filesystem read and the fallback path entirely.

---

### DEV-L-002: `pollingInterval` in `useInteractiveSession` is a 200ms `setInterval` for one-time init

**위치**: `packages/agent-cli/src/ui/hooks/useInteractiveSession.ts:236-254`

The `initCheck` interval polls every 200ms to detect when `interactiveSession.getContextState()` stops throwing. This is a polling hack. If `InteractiveSession` exposed an `onReady` event or a `isReady()` predicate, this could be replaced with a single event subscription. Consider adding that to the SDK.

---

### DEV-L-003: `TuiStateManager` has public mutable fields — breaks encapsulation

**위치**: `packages/agent-cli/src/ui/tui-state-manager.ts:54-66`

Fields like `history`, `streamingText`, `activeTools`, `isThinking`, `isAborting`, etc. are all `public` (no access modifier = public in TypeScript classes). External code can mutate these directly without triggering `notify()`. The React hook reads these fields directly (`manager.history`, `manager.streamingText`). Consider making them `readonly` getters.

---

### DEV-L-004: `generateClientId()` uses `Math.random()` — not cryptographically secure

**위치**: `apps/agent-server/src/websocket-server.ts:296-298`

WebSocket client IDs are used as authentication correlation tokens in maps. `Math.random()` is not cryptographically secure. Use `crypto.randomUUID()` (available in Node.js 14.17+):

```typescript
private generateClientId(): string {
    return `client_${randomUUID()}`;
}
```

---

### DEV-L-005: `App.tsx` has 6 `useEffect` calls — component has too many concerns

**위치**: `packages/agent-cli/src/ui/App.tsx`

`AppInner` manages: update notice async loading, terminal title sync, ESC abort input, Ctrl+B toggle, Ctrl+C shutdown, SIGINT/SIGTERM signal handlers, execution detail page loading — all via separate `useEffect` calls directly in the component. Signal handlers and terminal title management could be extracted into dedicated custom hooks for testability and clarity.

---

## Package Distribution Audit

### `packages/agent-cli/` — npm package (`@robota-sdk/agent-cli`)

**`"files"` field** (`package.json:36-39`):

```json
"files": ["dist", "bin"]
```

| Item               | Status   | Notes                                      |
| ------------------ | -------- | ------------------------------------------ |
| `dist/`            | Included | Contains all compiled JS and `.d.ts` files |
| `bin/robota.cjs`   | Included | CJS wrapper correctly in `bin/`            |
| `src/`             | Excluded | Correct — source not needed in npm package |
| `node_modules/`    | Excluded | Correct (npm default)                      |
| `CHANGELOG.md`     | Excluded | Acceptable                                 |
| `README.md`        | Excluded | Acceptable (auto-included by npm)          |
| `tsup.config.ts`   | Excluded | Correct                                    |
| `vitest.config.ts` | Excluded | Correct                                    |

**bin field** (`package.json:6-8`):

```json
"bin": { "robota": "./bin/robota.cjs" }
```

`bin/robota.cjs` is present and in the `files` list. Correct.

**Missing**: No `peerDependencies` declaration for `react` (currently a direct `dependency`). React is a peer concern for consumers who may embed the CLI's exported API. Since this is a CLI package (not a library), this is a low-priority concern — but `react: 19.2.4` as a hard dep is unusual for a package that also exports via `./index`.

**`engines` field**:

- `packages/agent-cli`: `"node": ">=22.0.0"` — matches `bin/robota.cjs` runtime check (line 7)
- `apps/agent-server`: `"node": ">=18.0.0"` — inconsistent, server uses Node 22+ APIs implicitly via dependencies

**Overall distribution assessment**: The CLI package is correctly configured for distribution. The `bin` wrapper, `files` field, and `dist` output structure are all correct.
