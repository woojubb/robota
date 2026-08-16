---
title: 'CORE-029: every diagnostic `agent-core` emits is discarded by construction, and the same silence pattern recurs at three layers above'
status: done
created: 2026-08-02
completed: 2026-08-16
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

## Implementation Outcome (2026-08-16)

### What was already done, and what was actually missing

The FOUNDATIONAL half — a settable sink — landed in PR #1594: `setGlobalLoggerSink` /
`getGlobalLoggerSink` exist, the sink resolves per call rather than being frozen at construction, and
both are reachable from `@robota-sdk/agent-core` (probed from a consumer, not assumed). The default
stays silent, which is correct: a library that writes to `console` because it was imported is a
different defect.

So this change is the part that was left: **the layers that had learned to swallow.** A destination
with nothing sent to it is the same silence.

### The streaming hot path

`session-run.ts` logs a `text_delta` per streamed token and `FileSessionLogger` answered each with a
blocking `appendFileSync` — one synchronous disk write, with its own open and close, per token, on
the path a user watches a response arrive on. Hot-path events are now buffered and written in one
call; **every other event flushes the buffer before writing itself**, so the file's order is the
order the events happened in and no semantic event is ever delayed behind a stream.

Buffering trades a write per token for a write per batch, and the price is a window in which the tail
of a stream exists only in memory. A normal shutdown closes it by itself (`session_shutdown` is not a
hot-path event, so it flushes), and an abnormal exit is covered by a process `exit` handler — a
replay log missing its last exchange would be a worse defect than the one being fixed.

### The swallows, each made observable

| Site                            | Was                                                                                                                                                       | Now                                                                                                                                |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `FileSessionLogger.log`         | `catch {}` — a log that stopped writing looked like a session with no events                                                                              | reports through the sink, still never throws                                                                                       |
| `FileSessionLogger` constructor | `catch {}` on `mkdirSync` — "no log file" and "logging never attempted" were one observation                                                              | says logging is disabled and why                                                                                                   |
| `BundlePluginLoader`            | `readManifest` threw, the throw escaped discovery, and the caller answered `catch {}` — **one malformed plugin silently disabled every installed plugin** | skips that plugin, by name, out loud; its neighbours load                                                                          |
| `interactive-session-init.ts`   | `catch { // No plugins dir or load failed }` — a normal case and an error, conflated, both silent                                                         | reports, with `allow-fallback:` declaring the deliberate degradation                                                               |
| `worktree-subagent-runner.ts`   | `.catch(() => undefined)` — a failed worktree hook looked like one that ran                                                                               | reports; still unawaited, because these are notifications rather than vetoes (`packages/agent-cli/docs/design/subagent-wiring.md`) |
| `background-task-hooks.ts`      | the identical discarded rejection, which the item had not found                                                                                           | same treatment                                                                                                                     |
| `playground-session-submit.ts`  | raw `console.log` with printf placeholders, while every sibling used `createLogger`                                                                       | goes through the logger, so an operator can configure or silence it                                                                |

### The process-wide log level

`config.logging` is a PER-AGENT setting and was applied with `setGlobalLogLevel`, which is
process-wide. Constructing one agent with `{ enabled: false }` silenced **every other agent and every
other package in the process**, from a constructor — and invisibly, because the other agent simply
stopped reporting, which looks exactly like an agent with nothing to report. It ran in both
directions: one agent could also make the whole process verbose.

`ConsoleLogger` already had a per-instance `level` field that nothing ever set. `createLogger` now
takes `ILoggerOptions { sink?, level? }` and `Robota` sets its own logger's level. The second
parameter changed shape rather than being added beside the old one, which is safe because **no call
site anywhere passed the old one** — measured, not assumed.

### The floor that stops it recurring

`scan-no-fallback.mjs` existed but deliberately covered only "catch that returns a bare default
literal", and explicitly excluded promise `.catch()` handlers — so neither shape this audit found was
scanned for. It gains `silent-catch` and `discarded-rejection`.

The tree already contained **49** of them, so they arrive behind a **burn-down baseline**, the same
ratchet `scan-file-size` uses: a new one fails, and the frozen set may shrink but never grow. Failing
on all 49 at once would have blocked every unrelated pull request until someone fixed 49 unrelated
files, which is how a floor teaches people to route around it. `unannotated-fallback` and
`reasonless-annotation` are untouched and still fail outright.

### Tests that pinned the defect

`bundle-plugin-loader.test.ts` asserted `rejects.toThrow()` for an invalid `plugin.json` — the
aborting behaviour written down as a contract. It is replaced by the property that matters: the
broken plugin is skipped by name and its neighbour still loads.

### Not done here

`session-run.ts` still logs a `text_delta` per token; this change makes that cheap rather than
removing it, because the log entry is part of the replay record that `session-log-replay` reads.

### Verification

- `pnpm harness:verify` green for all five scopes in this item's `area`: `packages/agent-core`,
  `packages/agent-session`, `packages/agent-framework`, `packages/agent-executor`,
  `apps/agent-server`.
- `pnpm build` clean; every workspace package's suite passes (`dag-adapters-sqlite` and `dag-worker`
  excluded — a missing `better-sqlite3` native binding locally, outside this change's file set).
- `pnpm harness:scan`: 111 passed, 2 skipped.
- Red-proof: reverting the hot-path batching and the `catch {}` turns 3 of 6 session-logger cases
  red; reverting the per-agent level turns 2 of 3 logging cases red.

## User Execution Test Scenarios — executed

**Applies**, as the item states. Surface: `BundlePluginLoader` from `@robota-sdk/agent-framework`
(what the interactive session uses) and `setGlobalLoggerSink` from `@robota-sdk/agent-core` (the
documented way a host turns diagnostics on). **No API key, no network** — the credential probe
recorded in CORE-042 still holds and this scenario needs none.

**Deviation from the drafted steps, stated.** The draft ran the built CLI and read startup output.
The scenario below drives the same loader through the public API instead, which observes strictly
more: it distinguishes _the broken plugin was skipped_ from _every plugin was disabled_, which
startup output alone cannot, and it checks the before/after of turning diagnostics on within one run.
The malformed bundle fixture the draft said "will be created by this work" is created and cleaned up
by the script.

**Invocation.** From `scratch/`:
`node ../node_modules/tsx/dist/cli.mjs --conditions=source src/core-029-s1.ts`

- Expected observable result: `SCENARIO 1 PASS`, `EXIT:0` — the working plugin loads despite its
  broken neighbour, the broken one is skipped rather than taking the rest down, the failure is
  reported and names the plugin, and diagnostics stay silent until a host asks for them.
- Evidence: executed 2026-08-16 against the completed implementation; **EXIT:0**. Full output:

```text
with diagnostics off — plugins loaded: ["working-plugin"]
with diagnostics off — messages: 0
with diagnostics on — plugins loaded: ["working-plugin"]
  reported: warn [2026-08-16T10:59:04.334Z] [WARN] [BundlePluginLoader] plugin manifest could not be read — skipping this plugin {"plugin":"broken-plugin@market","manifestP
PASS the working plugin still loads despite its broken neighbour
PASS the broken plugin is skipped rather than taking the rest down
PASS the failure is reported at all
PASS the report names the plugin that failed
PASS the report says what went wrong
PASS diagnostics stay silent until a host asks for them
SCENARIO 1 PASS
```

Behaviour pinned in the repository by
`packages/agent-framework/src/plugins/__tests__/bundle-plugin-loader.test.ts`,
`packages/agent-session/src/__tests__/session-logger-hot-path.test.ts` and
`packages/agent-core/src/core/__tests__/per-agent-logging.test.ts` (`scratch/src` is gitignored, so
the block below is this script's durable home).

```ts
// scratch/src/core-029-s1.ts
/**
 * CORE-029 Scenario 1 — a plugin that fails to load says so.
 *
 * The scenario the item specifies: put a malformed plugin bundle in the plugins directory and see
 * whether anything reports it. Before this change the answer was nothing at all, twice over —
 * `readManifest` threw, the throw escaped discovery, and the caller answered with a bare
 * `catch {}`. So one broken plugin silently disabled EVERY installed plugin, and the user's hooks
 * simply did not run with no message anywhere.
 *
 * Written against public exports: `BundlePluginLoader` from `@robota-sdk/agent-framework` is what
 * the interactive session uses, and `setGlobalLoggerSink` from `@robota-sdk/agent-core` is the
 * documented way a host turns diagnostics on. No API key, no network.
 */
import { setGlobalLoggerSink, type ILogger } from '@robota-sdk/agent-core';
import { BundlePluginLoader } from '@robota-sdk/agent-framework';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function writePlugin(pluginsDir: string, name: string, manifest: string): void {
  const dir = join(pluginsDir, 'cache', 'market', name, '1.0.0', '.claude-plugin');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'plugin.json'), manifest);
}

async function main(): Promise<void> {
  const pluginsDir = mkdtempSync(join(tmpdir(), 'core-029-plugins-'));

  try {
    // One deliberately malformed bundle, and one good neighbour beside it.
    writePlugin(pluginsDir, 'broken-plugin', '{ invalid json }');
    writePlugin(
      pluginsDir,
      'working-plugin',
      JSON.stringify({ name: 'working-plugin', version: '1.0.0', description: 'A good neighbour' }),
    );

    // Step 1: diagnostics OFF, which is the default a library must keep.
    const quiet: string[] = [];
    const loaderQuiet = new BundlePluginLoader(pluginsDir);
    const quietPlugins = await loaderQuiet.loadAll();
    console.log(
      'with diagnostics off — plugins loaded:',
      JSON.stringify(quietPlugins.map((p) => p.manifest.name)),
    );
    console.log('with diagnostics off — messages:', quiet.length);

    // Step 2: diagnostics ON through the documented consumer-facing entry point.
    const messages: string[] = [];
    // A host receives the message and its structured context separately, so a realistic sink
    // serializes both — the plugin's name arrives in the context, not in the message text.
    const render =
      (level: string) =>
      (...args: unknown[]) =>
        void messages.push(
          `${level} ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}`,
        );
    const sink: ILogger = {
      debug: render('debug'),
      info: render('info'),
      warn: render('warn'),
      error: render('error'),
      log: render('log'),
    };
    setGlobalLoggerSink(sink);

    const loader = new BundlePluginLoader(pluginsDir);
    const plugins = await loader.loadAll();

    console.log(
      'with diagnostics on — plugins loaded:',
      JSON.stringify(plugins.map((p) => p.manifest.name)),
    );
    for (const message of messages) {
      console.log('  reported:', message.slice(0, 160));
    }

    const reported = messages.join(' ');
    const checks: Array<[string, boolean]> = [
      [
        'the working plugin still loads despite its broken neighbour',
        plugins.map((p) => p.manifest.name).includes('working-plugin'),
      ],
      ['the broken plugin is skipped rather than taking the rest down', plugins.length === 1],
      ['the failure is reported at all', messages.length > 0],
      ['the report names the plugin that failed', reported.includes('broken-plugin')],
      ['the report says what went wrong', /manifest could not be read/.test(reported)],
      [
        'diagnostics stay silent until a host asks for them',
        quiet.length === 0 && quietPlugins.length === 1,
      ],
    ];

    let failed = 0;
    for (const [label, ok] of checks) {
      console.log(`${ok ? 'PASS' : 'FAIL'} ${label}`);
      if (!ok) failed += 1;
    }
    console.log(failed === 0 ? 'SCENARIO 1 PASS' : `SCENARIO 1 FAIL (${failed})`);
    process.exitCode = failed === 0 ? 0 : 1;
  } finally {
    setGlobalLoggerSink(undefined);
    rmSync(pluginsDir, { recursive: true, force: true });
  }
}

void main();
```

### [DONE-GATE-STAGE-2] — ✅ PASS | 2026-08-16

**Status upgrade:** in-progress → done

- The scenario was executed by the agent against the completed implementation, `EXIT:0`, output
  recorded above.
- The observed result matched the expected observable result, including the before-the-fix contrast
  the item asked for: with diagnostics off the loader is silent, which is the library default.
- Evidence references durable repository artifacts (the three test files named above).
- No engineering verification is cited as user-execution evidence — the suites and harness runs are
  recorded separately under _Verification_.
- No capability-absence claim is made; no credential was needed.
