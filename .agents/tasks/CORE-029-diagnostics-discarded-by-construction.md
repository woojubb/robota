---
title: 'CORE-029: every diagnostic `agent-core` emits is discarded by construction, and the same silence pattern recurs at three layers above'
status: todo
created: 2026-08-02
priority: high
urgency: soon
area: packages/agent-core, packages/agent-session, packages/agent-executor, packages/agent-framework, apps/agent-server
depends_on: []
---

# CORE-029: the diagnostic sink is an un-settable constructor parameter defaulting to a no-op

## Problem

A broken path is indistinguishable from a working one for the life of the process. The only record of
a swallowed failure goes nowhere: `agent-core`'s logger forwards to an injected sink that defaults to
silence, **no call site in the repo passes one**, and there is no global setter — so a consumer cannot
turn diagnostics on at all. That silences 157 `logger.*` calls in `agent-core` alone, including the
only trace of the failures the code deliberately swallows.

The foundation's error reporting is off by construction, and every layer above learned to swallow
instead. This directly violates AGENTS.md's _"Silence is not success"_.

## Evidence

Observed by **L0, L1, L2 and L4** — four layers saw the class.

- L0 F2 — `packages/agent-core/src/utils/logger.ts:85-93`: `ConsoleLogger` never writes to a console;
  it forwards to an injected sink that defaults to `SilentLogger` (`:90-93`).
  `createLogger(packageName, logger?)` is the only way to supply one, and **no call site in the repo
  passes it** — there is no global sink setter either, so a consumer cannot turn them on. That
  silences 157 `logger.*` calls in `agent-core` alone, including the only trace of swallowed failures:
  `src/plugins/event-emitter-helpers.ts:77-85`, `src/utils/periodic-task.ts:22-27`,
  `src/core/robota-initializer.ts:166`, `src/services/execution-round-streaming.ts:132` (the provider
  failure filed as CORE-027). The level knob is dead _and_ global: `robota.ts:97-100` mutates
  `setGlobalLogLevel` process-wide from the constructor.
- L1 #16 — `session-run.ts:188-193` logs **every** text delta and `session-logger.ts:82-101` answers
  with a blocking `appendFileSync` per streamed token, wrapped in `catch { }` at `:98-100`.
- L1 18a — `agent-executor/src/subagents/worktree-subagent-runner.ts:238`
  `void runHooks(...).catch(() => undefined)`: `WorktreeCreate`/`WorktreeRemove` hook failures are
  invisible and the result is discarded before the worktree is used.
- L2 F12 — `agent-framework/src/interactive/interactive-session-init.ts:107-122` `} catch { // No
plugins dir or load failed }` — a malformed plugin bundle means the user's hooks silently do not
  run, and the comment conflates a normal case with an error. No `allow-fallback:` marker, unlike
  sibling degradations in the same layer (`runtime-host.ts:63,67`).
- L4 L11 — `apps/agent-server/src/routes/handlers/playground-session-submit.ts` uses raw
  `console.log('[SSE] …')` while its sibling modules use `createLogger`.

The synthesis re-verified, read-only: 37 `createLogger(` call sites exist; the only match for
`createLogger\([^)]*,` is the declaration itself at `logger.ts:183`.

The cause in one sentence, from the synthesis: _the diagnostic sink is an un-settable constructor
parameter defaulting to a no-op, so the foundation's error reporting is off by construction and every
layer above learned to swallow instead._

## Why this is foundational (or not)

**FOUNDATIONAL** (L0) — the sink cannot be set from anywhere, so no layer above can make the
foundation's diagnostics observable.

**LOCAL** for the L1, L2 and L4 instances: the per-token `appendFileSync` in a `catch {}`, the
discarded worktree-hook result, the plugin-load `catch {}`, and the raw `console.log`s are each
fixable in place. The synthesis carries both verdicts rather than collapsing them.

The synthesis files this whole entry under theme T10 — _a degraded, skipped or failed path must be
observable; a swallowed error must never be indistinguishable from a working path_ — and cross-lists
several of the audit's other silent seams there.

## Direction

The invariant is T10's, quoted above, and it is already a stated repo rule: AGENTS.md's
_"Silence is not success"_, which the synthesis says this finding **directly violates**.

The specific defects the evidence names, each of which constrains the fix:

- `createLogger(packageName, logger?)` is the **only** way to supply a sink and **no call site passes
  one**; there is **no global sink setter**, so a consumer cannot turn diagnostics on. Whatever the
  design, it must be settable by a consumer of the published package.
- The default sink is `SilentLogger` (`logger.ts:90-93`) — a no-op default is what makes the silence
  automatic.
- The level knob is **dead and global**: `robota.ts:97-100` mutates `setGlobalLogLevel` process-wide
  from a constructor, which is also an instance of theme T5 (context-dependent state on a module).
- The plugin-load `catch {}` (`interactive-session-init.ts:107-122`) has **no `allow-fallback:`
  marker, unlike sibling degradations in the same layer** (`runtime-host.ts:63,67`) — so the repo's
  existing marker convention is the model for how a deliberate degradation should be declared.

The synthesis does not choose a specific logger API.

Risk it names: 157 `logger.*` calls in `agent-core` are currently silent; turning the sink on without
first fixing the hot-path logging will surface `session-run.ts:188-193`'s **per-text-delta** logging,
which `session-logger.ts:82-101` answers with a blocking `appendFileSync` per streamed token. Enabling
diagnostics before that is fixed converts a silent defect into a performance one.

## Test Plan

- **Required red-first regression:** from a consumer of the published package, set a diagnostic sink
  and assert an `agent-core` failure path (e.g. `plugins/event-emitter-helpers.ts:77-85` or
  `utils/periodic-task.ts:22-27`) reaches it. Against current code this must FAIL — there is no global
  setter and `createLogger`'s second parameter is passed by no call site
  (verified: 37 call sites, zero with a second argument).
- Red-first: a malformed plugin bundle must produce an observable diagnostic rather than being
  swallowed at `interactive-session-init.ts:107-122`.
- Red-first: a failing `WorktreeCreate`/`WorktreeRemove` hook must be observable and must not be
  discarded before the worktree is used
  (`worktree-subagent-runner.ts:238`).
- Assert the streaming hot path does not perform a blocking `appendFileSync` per token
  (`session-run.ts:188-193` → `session-logger.ts:82-101`), and that its `catch {}` at `:98-100` no
  longer swallows.
- Assert `setGlobalLogLevel` is not mutated process-wide from a constructor
  (`robota.ts:97-100`).
- A scan for bare `catch {}` / `.catch(() => undefined)` in the covered packages without the repo's
  `allow-fallback:` marker (the convention already used at `runtime-host.ts:63,67`).
- Replace raw `console.log` in `apps/agent-server` handlers with `createLogger`
  (`playground-session-submit.ts`).
- `pnpm harness:verify-like-ci` green.

## User Execution Test Scenarios

**Applies.** After the fix a user can see a failure that is invisible today — specifically, a plugin
that fails to load.

- **Prerequisites:** built `robota` CLI. The scenario needs a deliberately malformed plugin bundle in
  the user plugins directory; that fixture does not exist and **will be created by this work** (a
  single directory containing an unparseable manifest).
- **Steps:**
  1. Place the malformed plugin bundle in the user plugins directory.
  2. Start the CLI normally and observe startup output.
  3. Attempt to use a hook the plugin was supposed to provide.
  4. Separately, enable diagnostics through the documented consumer-facing setting and repeat step 2.
- **Expected observable result (after the fix):** step 2 reports that the plugin failed to load, with
  the plugin named — distinctly from the normal "no plugins directory" case. Step 3 fails visibly
  rather than silently doing nothing. Step 4 additionally shows the underlying diagnostic.
- **Expected observable result (before the fix, for contrast):** startup is silent, the hook simply
  does not run, and enabling diagnostics is not possible at all.
- **Cleanup:** remove the malformed plugin bundle from the plugins directory.
- **Evidence (fill in after implementation):** startup output for steps 2 and 4, and the observed
  behaviour for step 3.
