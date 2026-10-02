# agent runtime GUI (web app)

Private Vite application: the GUI as a web page. The desktop app (`apps/agent-app`) loads its
build, the configured CLI serves it with `--serve --open`, and `pnpm gui:dev` runs it in a browser against the CLI with
hot reload. It finds its sidecar through one host seam — the desktop bridge, or the address in the page. This
package has no public import API and is not published to npm.

## Develop

```bash
pnpm gui:dev                                      # page and configured CLI --serve from source, hot reload
pnpm gui:dev --scripted                           # deterministic sidecar, no model
pnpm --filter @robota-sdk/agent-gui-web test:e2e  # user scenarios in headless Chromium
```

The sidecar runs where the command was started (or the configured development working directory), which must be a trusted workspace.

The opt-in runtime outcome fixture uses the built GUI, actual source CLI bootstrap, authenticated
WebSocket runtime and an admitted loopback MCP server. Supply an existing absolute Chromium executable
path; it downloads no browser and makes no paid model calls:

```bash
pnpm --filter @robota-sdk/agent-gui-web test:e2e:runtime /absolute/path/to/chromium 20
pnpm --filter @robota-sdk/agent-gui-web test:e2e:runtime /absolute/path/to/chromium 1 allow
pnpm --filter @robota-sdk/agent-gui-web test:e2e:runtime /absolute/path/to/chromium 1 deny
pnpm --filter @robota-sdk/agent-gui-web test:e2e:runtime /absolute/path/to/chromium 1 cancel
pnpm --filter @robota-sdk/agent-gui-web test:e2e:runtime /absolute/path/to/chromium 1 cancel-permission
pnpm --filter @robota-sdk/agent-gui-web test:e2e:runtime /absolute/path/to/chromium 100 success anthropic
pnpm --filter @robota-sdk/agent-gui-web test:e2e:runtime /absolute/path/to/chromium 1 cancel openai
pnpm --filter @robota-sdk/agent-gui-web test:e2e:runtime /absolute/path/to/chromium 1 restore-deny anthropic
pnpm --filter @robota-sdk/agent-gui-web test:e2e:runtime /absolute/path/to/chromium 1 restore-allow openai
pnpm --filter @robota-sdk/agent-gui-web test:e2e:runtime /absolute/path/to/chromium 100 success anthropic packaged
```

Counts are 1, 20 or 100. The fixture checks actual image decoding, source attribution, call-linked
success/failure receipts, persisted effects, permission suspension and fresh-runtime restoration
without effect replay. The optional final argument selects `replay` (default), `anthropic` or `openai`.
Native modes use the actual provider SDK with deterministic loopback wire responses and check the
outgoing call IDs, failure flags, source captions and screenshot bytes; OpenAI uses Chat Completions.
All counts and permission/cancellation cases support both native modes. Reports include request bytes
and follow cleanup. These are deterministic runtime checks; they do not measure live-model quality,
remote vendor acceptance or the Electron shell.
Cancellation cases use one call: stop after an effect was persisted but its acknowledgement withheld,
or stop while permission is pending before dispatch. Both require an interrupted outcome, a failed
receipt and no false completion; a new runtime restores the outcome and accepts a new read-only
re-observation turn that verifies persisted effects without replaying the mutation. The report records
Stop-to-interrupted latency. On Linux it also samples the owned CLI process tree's summed RSS, excluding
the browser and fixture host; the sampled maximum is not a whole-product memory peak. Unsupported
memory measurements and unknown cost/timing components remain explicit nulls.

Set `PRODUCT_FIXTURE_MEASURE_TIMING=1` to capture the initial turn through the product's existing
content-free console traces and decision logs. The report checks call IDs and expected observation
counts, then includes SDK/replay invocation time, canonical awaited tool-body time, fixture-observed
GUI permission wait, and acknowledged MCP body time minus contained fixture service work. The last
quantity includes client processing and is not pure network latency. Duration sums may overlap;
these measurements do not establish live-vendor speed or cost. Queue time measures batch submission
until selection for pre-dispatch admission or refusal, excluding journal admission, permission and
body execution. Admission-started does not attest an effect. Valid provider/tool/queue interval totals
cover the full turn while detailed traces retain their existing bound; invalid measurements and
omitted details remain explicit. The transport residual uses only acknowledged retained MCP details.
The report records both the main fixture and timing summarizer hashes. For example:

```bash
PRODUCT_FIXTURE_MEASURE_TIMING=1 pnpm --filter @robota-sdk/agent-gui-web test:e2e:runtime /absolute/path/to/chromium 100 success openai packaged
```

The one-call `restore-deny` and `restore-allow` cases first persist a successful operation under an
explicit allowlist, then restore it in a new runtime whose current allowlist permits only Read.
A newly requested MCP operation must wait for a new GUI permission decision, with no effect while
waiting. Denial leaves the original effect unchanged; explicit approval adds only the new effect.
Both retain the original receipt/image, persist the new call's own status/source, and check the
corresponding native provider observations when a native mode is selected.

The optional sixth argument selects `standalone` (default) or `packaged` MCP contributions. Packaged
mode creates a name-only Claude-style manifest with an inline MCP declaration and an explicit
installed revision beside an unselected cache revision. The fixture owner initializes and grants
trust to its disposable Git workspace through the persistent product trust service. The stock host
inspects that grant and approves only the named fixture MCP source through its normal control plane.
The runtime preserves the package namespace and receipt source, and restoration reads the actual
project or user session store chosen for that host. It does not claim disable/update or active-call
lifecycle coverage from installation alone.

The Linux call-graph fixture uses native loopback SDK responses, the built GUI, the source CLI and
a pinned installed MCP source alongside a built-in read. Its disposable embedding host declares
dependencies, independent resources and a shared write resource through the existing scheduling
policy. It verifies bounded parallel roots, out-of-order acknowledgements, fan-in, serialized
writes and a later argument derived from an actual observation. Failure, permission allow/deny,
active-call cancellation and permission cancellation preserve every receipt through fresh process
restoration and observation without replay. Both SDKs are deterministic; this is not a live model
performance comparison. The reported MCP server acknowledgement intervals include fixture-held
waits. Product traces measure all queue intervals, including members refused after a failed dependency
or cancellation; the queue ends before journal admission and permission. Model and transport timing
remain unmeasured in this fixture.
An optional `mixed` source argument installs two separately named and approved packages. Independent
roots and the dependent fan-in cross their source boundary; both packages write the same declared
resource in order. Executed, refused and skipped receipts retain the declared installed source.

```bash
pnpm --filter @robota-sdk/agent-gui-web test:e2e:graphs /absolute/path/to/chromium anthropic success
pnpm --filter @robota-sdk/agent-gui-web test:e2e:graphs /absolute/path/to/chromium openai cancel
pnpm --filter @robota-sdk/agent-gui-web test:e2e:graphs /absolute/path/to/chromium anthropic failure mixed
```

The oversized-image fixture returns a real seeded Chromium screenshot whose image alone exceeds
result admission. It checks the root receipt's opaque reference and preserved success/failure,
retrieves bounded pages through the product reader, and verifies the reconstructed bytes and source.
The built GUI displays the attributed reference without an inline oversized image. Both native SDK
routes preserve every call/result ID, using standalone MCP or a pinned name-only plugin manifest.
After shutdown, persisted receipts restore without repeating the mutation. The session-lifetime spill
reference is explicitly unavailable in the new process, which independently reads the existing effect.
This verifies retrieval and cleanup; it does not establish native vision inference or durable artifact
recovery. Requests are loopback fixtures with no paid model calls.

```bash
pnpm --filter @robota-sdk/agent-gui-web test:e2e:images /absolute/path/to/chromium anthropic standalone success
pnpm --filter @robota-sdk/agent-gui-web test:e2e:images /absolute/path/to/chromium openai packaged failure
```

## Build

The plugin lifecycle fixture runs the built shared GUI with the source CLI and a pinned packaged
MCP source. Disable and uninstall are real GUI commands issued while a call's effect has happened
and its acknowledgement is held. The active call keeps its actual outcome; a subsequent call in
the chain is refused, and an independent built-in read completes. Fresh process restoration must
preserve receipts without replay and revalidate current enablement. The update case replaces only
the disposable installed-revision record as the fixture owner, proves the old chain cannot use
the new revision, and explicitly approves that current revision in the fresh embedding host; it
does not exercise a product update command. Both adapters use deterministic loopback SDK responses.

```bash
pnpm --filter @robota-sdk/agent-gui-web test:e2e:plugins /absolute/path/to/chromium anthropic disable
pnpm --filter @robota-sdk/agent-gui-web test:e2e:plugins /absolute/path/to/chromium openai uninstall
pnpm --filter @robota-sdk/agent-gui-web test:e2e:plugins /absolute/path/to/chromium anthropic update
```

The opt-in Linux memory fixture submits real GUI commands to the stock source CLI with memory
explicitly enabled in disposable trusted projects. It checks correction and forgetting in current
native SDK model requests and after fresh process startup, rejects ordinary additions to forgotten
topics, and verifies project isolation. Choose a deterministic loopback adapter; no vendor request
is made. This complements semantic-index and adversarial-restoration library tests; it does not
configure a semantic index or erase historical transcripts.

```bash
pnpm --filter @robota-sdk/agent-gui-web test:e2e:memory /absolute/path/to/chromium anthropic
pnpm --filter @robota-sdk/agent-gui-web test:e2e:memory /absolute/path/to/chromium openai
```

Run `pnpm build` from the repository root to build the complete dependency graph. The CLI and the desktop
app each copy this package's `dist` into their own output; do not edit generated `dist`. The package
contract is in [docs/SPEC.md](docs/SPEC.md).
