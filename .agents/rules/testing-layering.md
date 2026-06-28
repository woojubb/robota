# Testing Layering (mandatory)

The CLI is a thin wrapper. Feature behaviour is verified at the framework level, never skipped for
lack of a CLI E2E path.

## Rules

1. **The CLI owns no feature logic.** `agent-cli` parses args, wires transports, and renders the TUI.
   Every capability it exposes is really **`agent-framework` (`InteractiveSession`) + the feature**.
2. **CLI tests cover only thin-wrapper / TUI concerns** — argument parsing, flag→option mapping,
   TUI rendering and interaction. They must not be the place feature behaviour is proven.
3. **Feature behaviour MUST have a framework-level functional test** using the functional harness
   `@robota-sdk/agent-framework/testing` (`scriptedSession()` / `ScriptedSessionHarness`), which
   drives a real `InteractiveSession` (real loop, builtin tools, persistence, events) through the
   deterministic scripted provider (`@robota-sdk/agent-core/testing`). No CLI, no network, no live
   LLM is required.
4. **"The CLI can't be E2E'd" and "it needs a live LLM" are rejected** as reasons to skip functional
   verification. The scripted harness makes the real loop deterministic and automatable; use it.
5. **A backlog's Test Plan / User Execution gate is satisfiable at the framework level.** A
   product-surface scenario that depends on a live model is recorded as such, but the functional
   proof is the harness-based test, run by the agent and recorded as evidence.
6. **New framework capabilities are registered in the capability manifest** and must have a
   kit-based functional test; the `functional-coverage` check in `pnpm harness:scan` fails otherwise.

## Why

Verifying at the CLI surface (or claiming it can't be verified) is how functional E2E gets skipped.
The product surface that must be tested is `InteractiveSession`. This harness exists so the agent can
prove a capability actually works — deterministically, without a model — and so that proof is
mechanically required, not optional.
