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

## Coding-task baseline fixtures

`src/outcome-coding-tasks.ts` holds five small synthetic repository tasks (navigation, bug repair, feature,
multi-file change, test diagnosis) as data: prompt, initial file tree, protected files, a solved control and
an independent verifier program the model never sees. The contents are ported unchanged from a pinned
single-agent baseline and frozen by a SHA-256 over a canonical serialization (tasks in order, object keys
sorted, compact JSON).

- **Verifier observation.** One plain JSON record per finished tree: verifier exit code, protected files
  unchanged, no unexpected files, no symlinks or paths escaping the root, and a manifest of path, SHA-256 and
  mode. The tree is walked without following links. An observation file is written once; a second write to the
  same path fails.
- **Container.** `buildVerifierContainerArgs` returns the `docker run` arguments as pure data: read-only root
  filesystem and read-only tree mount, no network, all capabilities dropped, non-root, memory, CPU and process
  limits; the runner adds the timeout and removes the container. Golden tests pin the arguments.
- **Trusted local runner.** `runTrustedControl` runs only the exact broken and solved controls on the host. It
  refuses any task whose canonical serialization differs from the frozen entry with the same id, builds the tree
  itself from the frozen data, accepts no directory, and runs with a minimal environment (`PATH` and a temporary
  `HOME`), so model-written code never reaches it.
- **Scoring.** `scoreTrial` is pure: a trial passes only if it completed, was not interrupted, used tools, the
  verifier exited 0, and nothing protected was changed and nothing unexpected or escaping was added.

The default `test` script covers all of this without Docker. To run the controls in the locked-down container
(needs a local daemon and an image that already has Node):

```bash
ROBOTA_EVAL_DOCKER=1 ROBOTA_EVAL_DOCKER_IMAGE=node:22 \
  pnpm --filter robota-capability-agent-eval exec node --import tsx --test src/outcome-coding-docker.test.ts
```

`ROBOTA_EVAL_DOCKER_TMP` selects a host directory the daemon can mount (default: the home directory).

To change a task on purpose, edit `src/outcome-coding-tasks.ts`, print the new digest with
`createHash('sha256').update(serializeCodingTasks()).digest('hex')`, and replace the constant in
`src/outcome-coding-tasks.test.ts` in the same change, stating why the frozen baseline moved.

## Repository-work task from a real merged fix

Beside the five synthetic tasks there is a sixth, `repository-fix`, taken from a real merged fix in this
repository. It is frozen on its own (a separate digest in `src/outcome-coding-repository.test.ts`), so the five
keep theirs; `ALL_CODING_TASKS` lists the five and then this one, and both arms of a comparison use the same list.

- **Why this fix.** It changes one small pure function in one file (the set of characters that count as a line
  break when text a participant shares is quoted line by line). That is single-agent sized: the model reads one
  file and changes one line of code. Its behavior is checked by a deterministic script that needs no dependency, network
  or credential, and the unfixed behavior is something a reader can describe from outside.
- **Tree.** `src/outcome-coding-repository-build.ts` exports the fix's parent commit with `git archive` (a plain
  tree: no history, no pack objects) and keeps two files, the implementation and its package manifest. The kept
  files are byte for byte the repository's own, so their comments are too. The result is committed as
  `src/outcome-coding-tasks-repository-data.ts`; a test rebuilds it from the two commits when the checkout has
  them and compares (it is skipped in a shallow clone). Regenerate with
  `pnpm --filter robota-capability-agent-eval exec tsx src/outcome-coding-repository-build.ts`, then format the
  result with prettier.
- **Verifier.** It runs the implementation file directly (Node strips the types, so it needs Node 22.18 or
  later, and a fix written with syntax that is not erased, such as an `enum` or a constructor parameter property,
  fails to load and fails the task), and compares complete rendered outputs for the line breaks that already worked and for the ones the
  report is about. Any correct way of quoting passes; the fix's own text is not required. It never enters the
  image or the prompt. Broken (the parent tree) fails on the behavior and solved (parent plus fix) passes, both
  through the same trusted runner and, opt in, the verifier container.
- **Prompt.** It reports the symptom as a reader of the shared text would (a forged header after a form feed
  comes through unquoted) and states the rule the behavior must follow, every mandatory line break of the Unicode
  line-breaking rules. It names no file, function or constant, and not the second character the fix adds. The
  judgment: the rule is the stated requirement, so the verifier asks for nothing the prompt does not say, and
  naming the missing characters would hand over the change. A test pins that the prompt contains none of the
  code's names or the fix's lines.
- **Fix lines and the image.** The pinned checkout that the worker image is built from already contains the fix,
  in its own package and in sibling code and tests that repeat it. `leakNeedles` holds the lines the fix added
  that the parent lacks; the image build removes every file holding one and the context and image searches look
  for them like any other forbidden text. Whenever the pinned image revision moves, rerun the full-tree leak
  check as well: search the exported tree for the fixed behaviour in any form (the logic, not only the exact
  needles), because a later commit can repeat the fix in new files the needles do not match.
- **Limitation.** A public fix may be in a model's training data. A pass on this task is weaker evidence than a
  pass on a task nobody published, and it says nothing about unpublished work; both arms see the same task, which
  keeps their comparison fair but does not make the absolute score meaningful.

## Coding worker, validating relay and offline run

The worker runs one coding trial on the current runtime in a locked-down container. It has no network and no
credential: its model client relays every request over stdio (no retries) to the host, and the host's relay
decides what leaves the machine.

- **Worker.** `src/outcome-coding-worker.ts` reads one `init` line (prompt, model, endpoint, directories, the
  baseline's settings), then drives a headless session in a disposable `HOME` and product state directory. The
  task tree is the only host mount (`/work/project`); the throwaway git repository the trust check needs and the
  session state live in memory-backed scratch space, so the observed tree holds only what the agent wrote. The
  runtime declares session-control tools that no option turns off; the worker cuts the declaration down to the
  baseline's five file tools before a request leaves.
- **Relay.** `src/outcome-coding-relay.ts` validates every request (endpoint, model, text-only content, function
  tools from the allow-list, forced settings, authorized fields only, size, deadline) and makes exactly one
  upstream attempt per accepted request: a server error, a throw and a timeout are reported, never repeated. A
  refused request never reaches the reply source. The reply source is injected; offline it is a scripted one.
- **Settings.** `src/outcome-coding-settings.ts` carries the baseline's limits, sampling and tool tiers. The
  model, the endpoint and provider routing options are runtime values, never constants.
- **Image.** `src/outcome-coding-image.ts` builds from an export of a commit (no history, no pack objects),
  removes the example's tasks, verifiers and scoring and the `research/` tree, and searches the build context and
  the built image for every solved file, every verifier, the task identifiers and credential-like file names. A
  single hit fails the run. The search matches exact text: a solution that was re-encoded (compressed, base64,
  split or reformatted) is not detected, so the image's protection rests on never copying those files in.

The fast `test` script covers all of this without Docker, including the worker end to end through the relay with
a scripted reply source. The opt-in offline run needs a local Docker daemon and takes several minutes; run it
once per pinned commit (the source checkout must have no tracked changes):

```bash
pnpm --filter robota-capability-agent-eval coding:offline --out <result.json>
```

It runs every task's broken and solved controls in the verifier container, the isolation canaries (network and
name resolution refused, non-root, host path and credential-like variables invisible, writes outside the tree
refused, an escaping symlink detected), the image search, and scripted trials with known verdicts through the
worker and the relay, including one whose requests the relay must refuse without reaching the reply source.
Flags: `--source`, `--revision`, `--node-image`, `--verifier-image`, `--model`, `--endpoint`, `--base` (host
directory the daemon can mount, default the home directory), `--image` (reuse a built tag), `--keep-image`.

## Spend ledger and the live path (no paid call here)

The relay's reply source can be a live gateway, but only behind an append-only spend ledger. Nothing in the fast
tests reaches a real gateway or reads a real credential: they run against a loopback fake gateway with a fake
key, and the credential reader is tested with a temporary file.

- **Ledger.** `src/outcome-coding-ledger.ts` keeps integer micro-dollars in a hash-chained, fsynced file at a path
  given at runtime, outside the repository. Its header (ceiling, call cap, rate basis, commit, route, output cap,
  template allowance) is created exclusively and has no way to change; an edited header, a missing or reordered
  line, or a torn tail is refused, and the file is never repaired or truncated. The ceiling and the call cap are
  inputs; the defaults are the approved ceiling of two dollars and a cap of 400 calls. Only one process may hold a
  ledger.
- **Reservation and receipt.** Admission reserves a call's maximum cost durably before anything is sent: the bytes
  actually sent upstream plus a fixed per-request token allowance for provider templates, and the output cap, at the
  header's basis rates. The provider's receipt swaps in the real cost; a call without a receipt keeps its
  reservation. Admission refuses past the call cap and one micro-dollar over the ceiling.
- **Basis.** `src/outcome-coding-pricing.ts` reads the pinned provider's prices from the gateway's endpoint listing
  and takes the highest of each kind across all its regions, not the model's headline price. The header's basis is
  chosen at or above that, and `basisCovers` re-checks it before a run.
- **Stops.** `src/outcome-coding-gate.ts` stops the run, with no retry and no further admission, when a call gets no
  answer or no usable receipt (the reservation stays), when a receipt names another provider or model than the
  pinned route, when its output tokens exceed the cap, or when its cost exceeds its reservation (recorded at the
  real cost, against the ceiling). A stop is persisted; `resume` lifts it only when no call is unsettled, and calls
  left unsettled by an earlier process block admission until each is reconciled explicitly.
- **One request per admission.** `src/outcome-coding-gateway.ts` makes exactly one HTTP request per call: no retry,
  no redirects, no connection reuse; plain HTTP is accepted only for a loopback address. The worker's own client is
  built without retries, and the runtime's conversation service, which retries on rate limits and timeouts, is not
  on the session's chat path, so one admission is one upstream request end to end. A test runs the real worker
  against replies of 429 and 503 and counts the attempts.
- **Credential.** `src/outcome-coding-credential.ts` reads the value of one named line of a file the caller names,
  keeps it in memory in an object that prints as redacted, and passes it only to the host's upstream client. The
  worker container gets no environment variable and no mount for it. The leak scan counts occurrences of a secret
  (plain, base64, hex, URL-encoded) in evidence texts and directories and reports the count, never the secret.
- **Checks before a run.** `catalogListsModel` (the pinned model is still listed), `fetchEndpointListing` and
  `checkCredits` (the remaining credit covers the next reservation) read the gateway once each. The gateway shape
  they assume is `GET <base>/models`, `GET <base>/models/<model>/endpoints`, `GET <base>/credits` and
  `POST <base>/chat/completions`, with the receipt in the reply (`usage.cost` in dollars, `usage.completion_tokens`,
  `provider`, `model`). No real gateway has confirmed this shape. Before the first paid call the pre-run checks must
  succeed against the real gateway: the catalog lists the model, the endpoint listing parses with rates within the
  basis, the credits answer parses, and a reply carries `usage.cost`, `provider` and `model`.

## Delegation arm

A second arm runs the same tasks through a parent that delegates, to compare topologies at equal per-trial caps.
It runs inside the same worker, relay and verifier; nothing about scoring changes except what the arm adds.

- **Roles.** `src/outcome-delegation-roles.ts` defines three: a parent with the read tools and the subagent command
  and no write tool, an implementer with the baseline's file tools, and a reviewer with read tools only. The
  parent's session never registers a write tool; the children are lent theirs through the wrapped runner factory.
  The model sees the command as the function tool `command_agent` and waits for each job with
  `parallel --wait LABEL=AGENT:"PROMPT"`, so jobs run one at a time. Each request is trimmed by the worker to its
  role's tools, and the relay refuses a declaration or a call outside the role's set.
- **Child job limit.** `src/outcome-delegation-limits.ts` wraps the runtime's subagent runner factory inside the
  worker: at most three child jobs (an implementer, a reviewer and one revision), a fourth is refused before it
  starts and counted, and each job is timed so the idle time between jobs can be measured. A job for an agent type
  that is not a child role (a built-in type, for instance) is refused inside `start()` with a recorded failure,
  counted like a refused spawn, and does not use one of the three jobs.
- **Attribution.** The relay attributes every request to a role by the hash of its system message. The runtime
  assembles a child's system message itself, so each role's prompt carries a marker, and the first time a message
  is seen its hash is bound to the one role whose marker it contains. A message with no marker or several, and one
  that changed for a bound role, is unattributed: the run is stopped, the request is refused, and nothing more is
  sent.
- **Caps for every arm.** The relay refuses the upstream attempt past the trial's call cap (`DEFAULT_TRIAL_CALL_CAP`,
  the same for both arms) and refuses everything after it. A trial that reaches its cap ends as failed (`call-cap`)
  and stays in the denominator.
- **Measures by role.** Each relay log entry carries its role, the time its single upstream attempt took and the
  token counts the answer reported, failed attempts included. `src/outcome-delegation-measures.ts` sums them by role
  (calls, refused calls, failed calls, tokens, calls whose tokens are unknown, wall latency); coordination is what the
  parent and the reviewer spent plus the idle time between child jobs. Serial waiting is asked for in the parent's
  prompt, not enforced, and idle time counts an overlap as zero, so the measures also record the child jobs whose
  windows overlapped (a count and the pairs, by start order): an observation that makes a trial that was not serial
  visible, never part of the verdict. A job's window ends when its result resolves, which the runner does only after
  every turn the job accepted has run (input sent later is refused), so follow-up input sent to a running job is
  inside its window and the window needs no extra tracking. The measures are written into the trial's
  observation file next to the verifier's observation, before scoring.
- **Verdict.** Still the environment's: the verifier's exit code and the tree checks. The agent's completion and the
  reviewer's approval are data; a reviewer that approves broken code cannot make a trial pass. The arm adds two
  failures, `not-delegated` (no model call was attributed to a child role, so a parent that claims the work is done
  without delegating fails) and `run-stopped`.
- **Controls.** `src/outcome-delegation-scripts.ts` scripts a parent, an implementer and a reviewer in one flat
  script, because the jobs are waited for serially: a pass, a reviewer approving broken code, a parent that does not
  delegate, a parent and a reviewer that try to write, a fourth spawn, and the call past the cap. An unattributed call
  is exercised by a trial whose implementer prompt lacks its marker. The fast tests run them through the real worker
  as a plain process; the opt-in `coding:offline` run repeats them through the container, the relay and the
  verifier container.
