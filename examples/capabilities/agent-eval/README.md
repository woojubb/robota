# Capability: evals-as-code

Define **metrics over your agent's runs** and gate CI on a metric breach. An eval is
`{ cases } × { metrics } × { threshold }`; the runtime provides only the definition and the runner — **you** supply
the metrics and the dataset.

- A **metric** is a pure function over the run's `IExecutionResult` (response + tool trajectory + usage +
  history) — not just the final string, so you can score whether the agent used the right tool, stayed under a
  token budget, etc.
- `runEval(definition, runFn)` runs each case through a `runFn`, applies each metric, and returns a report with
  per-case scores and an overall pass/fail against the threshold.
- The demo exits with code 1 when the eval fails, so dropping it into a CI job fails the build on a regression.

## Run

```bash
pnpm install
ANTHROPIC_API_KEY=... pnpm dev
```

The `runFn` is built from `createAgentRuntime().createSession()` (a real agent run per case) via
`createSessionRunFn`. To score a run without a live provider (e.g. a unit test), pass your own
`runFn: (input) => Promise<IExecutionResult>` returning a synthetic result.

## CLI equivalent

The same definition, as a `.mjs` module exporting `default` (or `evalDefinition`), can be gated from the CLI:

```bash
<your-cli> eval ./my-eval.mjs            # exit 1 on a metric breach — a CI gate
<your-cli> eval ./my-eval.mjs --threshold 0.9
```

## Environment outcomes

A response that says “done” is a soft signal. Mark safety and outcome metrics with `required: true`
when their failure must reject the entire evaluation regardless of the aggregate threshold. A required
metric must return `true` or `1` in every case. Interrupted run results also reject the evaluation.
Metrics remain pure: the fixture owner reads actual environment state after execution and captures an
immutable observation before scoring it.

Run the repository's offline arithmetic fixture from the workspace root:

```bash
pnpm --filter @robota-sdk/agent-framework scenario:verify:outcomes
```

It executes real sessions and file tools in a disposable repository, then independently checks the
modified function in a Node process. Three false-completion trials and three repair trials expose the
verdict, tool steps, elapsed time and unknown cost explicitly. This deterministic fixture verifies the
execution and evaluation route; it does not measure live model reliability. Temporary HOME and product
state prevent writing to the user's state, but do not provide OS sandboxing. The session explicitly uses
`acceptEdits` permission mode and denies shell, network and background process tools.

The same entrypoint also cancels an active provider call, verifies that the interrupted task cannot
pass, and restores its persisted session in a new runtime to finish an independently checked file
checkpoint. This proves cooperative cancellation and session continuity; it does not claim process
termination or exactly-once external effects.

The memory baseline runs two sessions over the same durable project store. A false correction claim
fails while saved knowledge is unchanged; an explicit fixture-owner correction of both source files
is checked in the new session's provider request, startup memory and recall. A separate project must
remain empty. This deliberately measures fixture-owner source correction through the admitted Linux
project-state writer. Public user-only `/memory correct` and `/memory forget` behavior is covered by
the command module's integration tests and the framework's memory lifecycle tests, including restart,
recall/index reconciliation and rejection of stale knowledge restored by another writer. This manual
baseline does not substitute for that public-command coverage.

For a separately packaged, non-GUI MCP contribution:

```bash
pnpm --filter robota-capability-agent-eval baseline:plugin
```

The fixture bundle has its own manifest, MCP declaration and server process. The consumer loads it
with explicit enablement and approves its exact executable/arguments for this disposable run. The
recorded provider responses drive real observation/change/observation calls through the shared tool
runtime. Independent file verification checks the final setting and effect count. A stale revision
must fail without changing the setting even if the replayed final reply says “Done”; every call ID
must still receive a result. Both variants run three trials and report their source digest, model,
permission mode, elapsed time, tool steps and cost. Unknown pricing and zero-success cost per success
remain `null`, and failed attempts count toward total spending. No live-model comparison is implied.

The fixture is an offline compatibility baseline, not a third-party plugin certification. It does
not exercise GUI media, arbitrary foreign component paths, plugin update/disable during a chain or
an OS sandbox; those require the follow-up runtime and pilot cases.

## CLI product-route checks

The CLI product-route integration check is also available without a paid provider:

```bash
pnpm --filter @robota-sdk/agent-cli exec vitest run src/__tests__/e2e/mcp-product-outcomes.test.ts
```

It starts the actual CLI bootstrap and MCP serve route through an embedding host that explicitly
approves the disposable external server. Replayed model calls interleave a built-in file read and
external state changes. Independent reads check exact effects; a fresh session-store load checks
ordered call IDs, success/failure receipts, text and structured observations at 1/20/100 calls.
A deliberate external failure must preserve its failed receipt while later supplied work completes.
A connection-loss case persists an effect before dropping its HTTP response; its receipt must remain
failed, and exact call/effect arrays must show that the operation was not replayed. Later independent
fixture work still runs. This checks lost-acknowledgement handling, not crash recovery or reconciliation
decisions by a live model.
Reports follow cleanup. This verifies the source CLI route, not a packaged binary, app rendering or
live-model performance; separate timing categories and process memory remain unmeasured.

For the same source CLI route through native provider SDKs:

```bash
pnpm --filter @robota-sdk/agent-cli exec vitest run src/__tests__/e2e/mcp-provider-outcomes.test.ts
```

Anthropic Messages and OpenAI Chat Completions use protocol-shaped loopback responses through their
actual adapters. Both check mixed text, structured observations, call-linked native images and source
attribution at 1/20/100 calls, failure followed by independent work, and bounded retrieval of oversized
success/failure results without replaying effects. Each next provider request must contain every
preceding call receipt; a fresh session-store load and exact file effects independently verify the
result. Reports include elapsed time, image bytes and serialized tool-loop request bytes. Auxiliary
title/summary requests are counted separately. No paid requests run, and these deterministic wire
fixtures do not establish live-model quality or remote vendor acceptance. Queue/permission/transport
breakdowns, memory, app rendering and cancellation remain separate coverage requirements.

## Linux browser outcome pilot

Install the external package in a disposable directory, preserving its lockfile, and provision a
compatible Chromium executable separately. The fixture accepts these explicit paths and verifies
the installed package name/version; it never downloads packages or browsers. The package is pinned
to `@playwright/mcp@0.0.83`, whose Playwright dependency is an alpha build. Keep its lockfile and browser
revision with the report; the reported digest covers package metadata and its CLI entrypoint, not
the entire dependency tree or a trust attestation.

From the workspace root, using absolute paths:

```bash
pnpm --filter robota-capability-agent-eval baseline:browser /path/to/node_modules/@playwright/mcp /path/to/chromium 1
pnpm --filter robota-capability-agent-eval baseline:browser /path/to/node_modules/@playwright/mcp /path/to/chromium 20
pnpm --filter robota-capability-agent-eval baseline:browser /path/to/node_modules/@playwright/mcp /path/to/chromium 100
pnpm --filter robota-capability-agent-eval baseline:browser /path/to/node_modules/@playwright/mcp /path/to/chromium 20 stale-target
pnpm --filter robota-capability-agent-eval baseline:browser /path/to/node_modules/@playwright/mcp /path/to/chromium 20 false-done
pnpm --filter robota-capability-agent-eval baseline:browser /path/to/node_modules/@playwright/mcp /path/to/chromium 20 cancel-after-save
```

The `false-done` command deliberately exits 1: a final “Done” after navigation cannot pass the persisted-state
and call-count gates. The one-call case observes the original setting; longer successful cases finish
with the theme saved as `dark`. A separate file read checks the value and exact write count.

An observation-driven scripted provider selects references from actual snapshots and runs through a
real headless framework session, the bundle loader, explicit MCP admission and the shared tool runtime.
In `stale-target`, one invalid target must fail, then a new snapshot supplies the next click reference;
the failed action must not add a write. Every dispatched call must have a provider-visible result.
The real screenshot's hash and byte count must match from raw MCP output to the provider request.

In `cancel-after-save`, the fixture independently observes one persisted save, withholds the real
browser reply, and aborts the owning session. A new runtime loads the same session from disk and
must present the cancelled call's failed outcome to its provider before taking a fresh snapshot.
The independent state read must still show exactly one save. The call limit is a ceiling for this
interrupted prefix, not a claim that it completed a 20- or 100-call chain. This verifies recovery
after a lost observation; it does not claim physical cancellation of a browser action, transport
restart, durable journal replay or exactly-once external effects.

Each invocation emits one JSON report with outcomes, call/result pairing, combined transport/tool
timings, image bytes and unknown cost. It uses temporary HOME/product state, an isolated browser
context, an exact executable/argv grant and explicit tool permissions. Cleanup closes MCP and the
local app and removes their temporary state; the report is emitted after those operations finish
and includes their observed cleanup results. These controls do not establish an OS sandbox.

This is one deterministic trial per invocation with no paid model requests. It does not measure live
model reliability, native provider wire conversion, rendered app UI, journal restoration,
conflicting browser sessions or oversized images. Queue, permission and separate transport/tool timings
remain unmeasured rather than being reported as zero.
