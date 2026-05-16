# @robota-sdk/agent-command — Package Specification

## 1. Purpose

Consolidated command module for the Robota SDK CLI. Provides all slash-command implementations as a single importable package, replacing 20 individual `agent-command-*` packages.

## 2. Scope

**In scope:**

- All CLI command handlers (agent, background, compact, context, exit, help, language, memory, mode, model, permissions, plugin, provider, reset, rewind, session, settings, skills, statusline, user-local)
- Command registration contracts with agent-framework
- Unit tests for each command module

**Out of scope:**

- Transport layer (WebSocket, TUI, headless) — owned by `agent-transport-*`
- CLI entry point and argument parsing — owned by `agent-cli`
- Agent runtime and session management — owned by `agent-core` / `agent-framework`

## 3. Dependencies

```
@robota-sdk/agent-core      workspace:*   (core types, interfaces)
@robota-sdk/agent-framework workspace:*   (ICommandHostContext, command registration)
```

No circular dependencies. This package does not depend on any other `agent-command-*` package.

## 4. Public API

Single root entry point:

```typescript
import { AgentCommand, BackgroundCommand, CompactCommand, ... } from '@robota-sdk/agent-command';
```

All 20 command modules are re-exported from the root `src/index.ts`.

### Command Modules

| Module      | Export path              | Description                   |
| ----------- | ------------------------ | ----------------------------- |
| agent       | `./agent/index.js`       | Agent creation and management |
| background  | `./background/index.js`  | Background task execution     |
| compact     | `./compact/index.js`     | Conversation compaction       |
| context     | `./context/index.js`     | Context window management     |
| exit        | `./exit/index.js`        | Session exit / quit           |
| help        | `./help/index.js`        | Help display                  |
| language    | `./language/index.js`    | Language switching            |
| memory      | `./memory/index.js`      | Memory read/write commands    |
| mode        | `./mode/index.js`        | Interaction mode switching    |
| model       | `./model/index.js`       | AI model selection            |
| permissions | `./permissions/index.js` | Permission management         |
| plugin      | `./plugin/index.js`      | Plugin enable/disable         |
| provider    | `./provider/index.js`    | AI provider configuration     |
| reset       | `./reset/index.js`       | Session reset                 |
| rewind      | `./rewind/index.js`      | Conversation history rewind   |
| session     | `./session/index.js`     | Session lifecycle commands    |
| settings    | `./settings/index.js`    | Settings management           |
| skills      | `./skills/index.js`      | Skill activation and listing  |
| statusline  | `./statusline/index.js`  | Status line configuration     |
| user-local  | `./user-local/index.js`  | User-local configuration      |

## 5. Build Output

- Format: ESM + CJS dual output via tsdown
- Output directory: `dist/node/`
- Files: `index.js` (ESM), `index.cjs` (CJS), `index.d.ts` (types)
- Treeshake: enabled (consumers pay only for what they import)
- External: `@robota-sdk/*` packages are never bundled

## 6. Invariants

1. All command modules must export their handler via a named export (no default exports).
2. Commands must not import from `agent-cli` or any transport package — dependency must flow down only.
3. The `src/index.ts` must re-export every command module; no command may be left out.
4. Tests live within each command subdirectory (`src/<command>/__tests__/`).

## 7. Migration

Consolidated from 20 individual packages (v3.0.0-beta.63):

- `@robota-sdk/agent-command-agent` → `@robota-sdk/agent-command`
- `@robota-sdk/agent-command-background` → `@robota-sdk/agent-command`
- ... (all 20 packages merged)

Consumers replace all 20 individual imports with a single dependency:

```json
"dependencies": {
  "@robota-sdk/agent-command": "workspace:*"
}
```

And update imports:

```typescript
// Before
import { X } from '@robota-sdk/agent-command-model';
import { Y } from '@robota-sdk/agent-command-provider';

// After
import { X, Y } from '@robota-sdk/agent-command';
```

## 8. Testing

Run:

```bash
pnpm --filter @robota-sdk/agent-command test
```

Expected: 20 test files, 143+ tests, all passing.
