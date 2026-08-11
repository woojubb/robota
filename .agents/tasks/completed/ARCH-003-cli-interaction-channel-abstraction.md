---
title: 'ARCH-003: Interaction Channel Abstraction — master overview'
status: done
created: 2026-05-30
completed: 2026-05-31
priority: high
urgency: soon
area: packages/agent-framework, packages/agent-transport, packages/agent-cli
depends_on: []
---

## Problem

The current `agent-cli` / `agent-transport/tui` stack conflates four responsibilities inside
Ink React components, making the command-processing pipeline untestable without a real PTY:

1. **Input parsing** — slash detection, tokenisation, history (in `InputArea.tsx`)
2. **Command dispatch** — routing to `InteractiveSession` (in `useInteractiveSession` / `App.tsx`)
3. **Output presentation** — Ink rendering of messages, tool streams (in all `*.tsx`)
4. **Dialog coupling** — slash commands needing disambiguation call TUI picker/confirm directly
   via `command-interaction-registry.ts`, which is hardcoded inside `agent-transport/tui`

`CLI-040-tui-mode-tests.md` and `CLI-041-missing-test-coverage.md` are direct symptoms.

---

## Goal

Define **`IInteractionChannel`** in `agent-framework`. The framework owns the contract;
transport packages implement it. `agent-cli` becomes a thin composition shell.

```
agent-framework (IInteractionChannel + createInteractiveRuntime)
       +
agent-transport/tui (TuiInteractionChannel — Ink adapter)
       =
agent-cli (wires the two, reads CLI args, resolves provider)
```

---

## Architecture (after)

```
┌──────────────────────────────────────────────────────────┐
│                        agent-cli                          │
│  parseCliArgs → assembleCommands                          │
│       ↓ new TuiInteractionChannel(...)                   │
│       ↓ createInteractiveRuntime(channel, ...)           │
└──────────────────────────────────────────────────────────┘

agent-framework                       agent-transport/tui
┌──────────────────────────┐          ┌──────────────────────────┐
│ IInteractionChannel      │◄─────────│ TuiInteractionChannel     │
│ TActionRequest           │  impls   │  write()  → React state   │
│ TActionResponse          │          │  requestAction() → Ink    │
│ InteractionEvent         │          │    picker / confirm       │
│ ICommandInfo / IPickItem │          └──────────────────────────┘
│ TCommandInteractionHint  │
│ input-parser             │          agent-transport/web (future)
│ createInteractiveRuntime │          ┌──────────────────────────┐
└──────────────────────────┘          │ WebInteractionChannel     │
                                      │  requestAction() → modal  │
                                      └──────────────────────────┘

                                      Tests
                                      ┌──────────────────────────┐
                                      │ MockInteractionChannel    │
                                      │  requestAction() → preset │
                                      └──────────────────────────┘
```

### Key design: dialog actions are surface-agnostic

Slash commands do **not** call TUI dialogs directly. When disambiguation is needed, the
framework calls `channel.requestAction(action)`. Each transport decides how to fulfil it:

- `TuiInteractionChannel` → Ink `<CommandPicker />` / `<CommandConfirm />`
- `WebInteractionChannel` → web modal API
- `MockInteractionChannel` → preset response (test)

`command-interaction-registry.ts` (hardcoded TUI dialog mapping) is **deleted**. Dialog
config moves into command module `interactionHints` in `agent-command`, owned by the
framework contract.

### Test layer separation

| Layer                 | Tool                              | Tests                                                         |
| --------------------- | --------------------------------- | ------------------------------------------------------------- |
| `agent-framework`     | vitest + `MockInteractionChannel` | when/what logic: requestAction triggers, event order, routing |
| `agent-transport/tui` | `ink-testing-library`             | dialog rendering, keyboard, Promise resolution                |

---

## Sub-tasks

| Phase | File                                                        | Title                                                               |
| ----- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| p1    | [ARCH-003-p1](ARCH-003-p1-interaction-channel-contracts.md) | Define `IInteractionChannel` + types in `agent-framework`           |
| p2    | [ARCH-003-p2](ARCH-003-p2-input-parser-extraction.md)       | Extract input parsing into `agent-framework`                        |
| p3    | [ARCH-003-p3](ARCH-003-p3-interaction-hints-migration.md)   | Migrate interaction hints; delete `command-interaction-registry.ts` |
| p4    | [ARCH-003-p4](ARCH-003-p4-create-interactive-runtime.md)    | `createInteractiveRuntime` factory in `agent-framework`             |
| p5    | [ARCH-003-p5](ARCH-003-p5-tui-interaction-channel.md)       | `TuiInteractionChannel` in `agent-transport/tui`                    |
| p6    | [ARCH-003-p6](ARCH-003-p6-wire-agent-cli.md)                | Wire `agent-cli` composition root                                   |
| p7    | [ARCH-003-p7](ARCH-003-p7-headless-interaction-channel.md)  | `HeadlessInteractionChannel` in `agent-transport/headless`          |
| p8a   | [ARCH-003-p8a](ARCH-003-p8a-framework-interaction-tests.md) | Framework interaction tests (no PTY)                                |
| p8b   | [ARCH-003-p8b](ARCH-003-p8b-tui-dialog-tests.md)            | TUI dialog tests (`ink-testing-library`)                            |
| p9    | [ARCH-003-p9](ARCH-003-p9-spec-docs-sync.md)                | SPEC.md + docs sync                                                 |

---

## Cross-cutting constraints

- `agent-transport/tui` must NOT import from `agent-cli`
- Ink components must NOT be imported by `agent-framework`
- No transport may hardcode command-name → dialog mappings
- Input parsing lives in `agent-framework` only — no duplication in transports
- No new npm packages introduced
- No breaking changes to CLI binary UX

## Overall done gate

- [ ] All phase done gates pass
- [ ] `command-interaction-registry.ts` deleted
- [ ] `pnpm typecheck && pnpm lint && pnpm test` green across affected packages
- [ ] `CLI-040`, `CLI-041` closed
- [ ] SPEC.md updated: `agent-framework`, `agent-transport`, `agent-cli`, `agent-command`
