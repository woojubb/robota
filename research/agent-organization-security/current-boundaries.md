# Current Execution Boundaries

## Code flows examined

| Path                          | Where permission and isolation are applied                                                                                                                         | Interpretation and remaining checks                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CLI common startup            | `packages/agent-cli/src/cli-core.ts`: settings → `createProductSandbox` → startup problem check → pack/session composition                                         | Common composition for TUI, print, and serve. A startup failure is fatal only when `sandbox.failIfUnavailable` is true. Full-process verification per mode is still needed.                                            |
| print/headless                | `packages/agent-cli/src/modes/print-mode.ts`: HeadlessInteractionChannel, default permission mode, sandbox pass-through                                            | An ask with no approver is denied. Whether an arbitrary command is approved and whether command execution is isolated are different stages. Separate paths such as `shellExec` must also be subject to policy.         |
| serve                         | `packages/agent-cli/src/modes/serve-mode.ts`: `buildServeSessionOptions` passes the sandbox to the session                                                         | Checking the pass-through alone does not prove remote authentication or a hosted boundary.                                                                                                                             |
| Shell/Bash                    | `packages/agent-tools/src/builtins/shell-tool.ts`: a separate client uses `run`, a shared client uses `wrapCommand`, otherwise host spawn                          | A backend error during execution does not turn into a host retry. Disabled/unavailable/excluded can be an unconfined invocation from the start.                                                                        |
| Read/Write/Edit               | `packages/agent-tool-defaults/src/create-default-tools.ts`: with shared, the host root guard; with separate, the client file API                                   | Do not confuse injecting a shared client directly into the raw tool factory with the product's default-tools composition.                                                                                              |
| Glob/Grep and host-only tools | The separate filesystem branch of the same default-tools composition                                                                                               | With separate, some host-only tools are absent. It cannot be claimed that the functional scope of remote work is the same as local.                                                                                    |
| sandbox auto-approval         | `packages/agent-framework/src/assembly/sandbox-approval.ts`: only Shell/Bash look up sandbox auto-approval                                                         | deny and ask rules apply first. Background and model slash commands that the sandbox does not approve are also investigated as separate execution paths.                                                               |
| child-process subagent        | `packages/agent-cli/src/product/subagent-composition.ts`, `packages/agent-subagent-runner/src/worker-composition.ts`                                               | Requires type+snapshot and a factory; projections that cannot be restored are rejected. The OS sandbox is composed separately at the child's root and live settings are passed.                                        |
| E2B adapter                   | `packages/agent-tools/src/sandbox/e2b-sandbox-client.ts`                                                                                                           | Mediates the shell/file API and snapshot/pause/connect. Account identity, company approval, and egress policy are not enforced by this adapter. Verification of real service lifetime and SDK compatibility is needed. |
| Electron UI/daemon            | `apps/agent-app/electron/sidecar.ts`, `packages/agent-cli/src/session-inventory/daemon-command.ts`, `packages/agent-transport-ws/src/ws-transport-configurable.ts` | The sidecar accepts only a loopback+token URL and restricts the renderer CSP to that port. WS enforces loopback bind, a token, and Host/Origin guards. A remote UI is a separate contract.                             |

## Additional boundaries per mode

MCP stdio trusts the parent process's ownership of input and output, and `runMcpServeMode` builds the
session from the common startup options. Local HTTP uses a new 0600 token file and a loopback carrier,
and on exit removes only the inode it created. The remote HTTP path uses separate issuer/resource/scopes/subjects
verification and a trusted proxy contract. The local daemon token is not reused as a remote bearer.
This source cross-check is not itself evidence of a real issuer/JWK outage or of remote UI execution.
The separate HTTPS experiment below verifies only a local synthetic issuer and the real CLI remote gate.

The command expansion in `startup/shell-exec.ts` uses execSync and hostEnvironment directly and does
not receive an OsSandboxClient. The managed shell background runner in `agent-executor` is also a
separate spawn path. Sandbox auto-approval does not approve these tools, but once they are allowed by
some other policy, their filesystem/env/network boundary must not be assumed to be the same as that of
the OS Shell tool. Network execution such as hooks, MCP stdio processes, and HTTP/WebFetch is likewise
treated as a separate enforcement point in the hosted worker/broker design. The TUI uses the common
runtime session and shellExec, and the Electron renderer is not that execution boundary.

## Actual Linux observations

`poc/current-boundaries.mts` actually invokes the production `OsSandboxClient`, the default-tools
composition, and worker restoration. The current result is 16 observations in agreement.

| Observation                                   | Result                                                             | Constraint on the hosted design                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| default disabled                              | A command assumed to be approved ran on the host                   | The mandatory isolation of hosted cannot be left to the local default setting.                                                                                      |
| Reading a runtime file from the active shell  | Reading a synthetic runtime canary outside the workspace succeeded | A read-only host mount is not a confidentiality boundary.                                                                                                           |
| Reading runtime env from the active shell     | Inheritance of a synthetic environment variable confirmed          | If model and company API keys are placed in the runtime env and the shell is spawned in the same environment, there is no key boundary.                             |
| Workspace write                               | Succeeded                                                          | Per-task file writes are needed, but the task root and shared assets must be separated.                                                                             |
| Write to an existing `.git/config`            | Denied                                                             | Normal work such as a git commit can conflict with the current OS sandbox. In a remote task VM, only the task-owned `.git` must be handled under a separate policy. |
| Write outside the workspace and temp          | Denied                                                             | The host integrity restriction really works. It does not imply confidentiality of the entire host.                                                                  |
| Write to another synthetic task's `/tmp` file | Succeeded                                                          | The same host sandbox that allows a shared temp is not sufficient for isolation between tasks.                                                                      |
| Explicit denyRead file                        | Value exposure blocked                                             | Blacklisting does not guarantee a complete secret boundary. Env inheritance is a separate matter.                                                                   |
| Backend unsupported/absent                    | Calling only the client runs unconfined                            | The product startup must enforce an error for a missing required capability.                                                                                        |
| excluded program                              | Runs unconfined                                                    | In hosted, exclusions are not allowed, or are expressed as a separately approved broker operation.                                                                  |
| Backend execution failure                     | non-zero, no host retry                                            | The existing fail-closed property is also kept in hosted.                                                                                                           |
| network disabled                              | Access to a host loopback service denied                           | A separate net namespace + Unix-socket seccomp is the enforcement point. DNS/domain allowlists and verification of remote provider policy are separate.             |
| product-composed Read                         | Outside root denied                                                | The file tool's path guard and the shell's whole-filesystem policy are different boundaries.                                                                        |
| worker restore unknown type                   | Error                                                              | Keep the existing behavior of not turning a restore failure into an empty sandbox or host execution.                                                                |

This experiment did not reproduce a bypass of human approval or a successful prompt injection. It
measured the subsequent authority scope of an admitted shell. It did not read or attack any real
account or host secret. A Linux result does not prove Seatbelt or Windows behavior. The macOS backend
and unsupported platforms are cross-checked against the source and existing tests, and the absence of
real-environment observation is marked.

## CLI and daemon in a real KVM guest

After checking the Ubuntu 24.04 cloud image against the official SHA256, a KVM guest was started
without a host filesystem mount and without outbound network. Node 22.22.0 and the real CLI
dependencies from `pnpm --prod deploy` were transferred over SSH. The first attempt, which failed
because of an omitted external dependency and development-only replay/provider settings, is also kept
in `evidence/vm-initial.json`. The normal run uses a synthetic chat-completions provider on the
guest's loopback, and spends no real key or cost on a model API.

`poc/vm-smoke.py` checks the real headless result, the non-creation of a file by a shell with no
approver in default mode, and the creation of the file when `--allowed-tools Bash` is explicitly
specified, each by the CLI exit code and a separate filesystem observation. The model's "completed"
text is not used as evidence of tool execution.
[Result](evidence/vm-smoke-linux.json).

Running the real `daemon start --json` twice confirmed reuse of the same daemon. In the guest, a
wrong token, a missing token, and an untrusted Host/Origin did not receive session data, while the
correct token did. Afterwards, running the real `daemon stop` and `status` confirmed running=false.
The token-bearing URL and the session payload were not stored in the report.
[Authentication result](evidence/vm-daemon-auth-linux.json).

Because the runtime and the shell are in the same VM in this first guest, it is not used as evidence
of runtime/job separation. Separate worker and research broker observations are recorded separately
below, and production integration and provider behavior still need verification.

## Proposed hosted failure handling

A required sandbox is rechecked not only at startup but at every execution and resume. A missing
client, an unknown factory, a failed attestation, an invalid snapshot, a policy epoch mismatch, an
expired delegation, and the absence of an egress proxy all reject task admission. No host fallback,
replacement with an empty filesystem, or global permission widening is performed. The error states
which capability is required and has the company operator configure it. The opt-out of the local
personal mode is distinguished from the mandatory isolation of the hosted organizational mode.

## Separate task workers and parallel policy

From QMP, the actual process argv, and the drive list, KVM enablement and independent overlays of two
workers were confirmed, and while the host positive-control HTTP service was healthy, three direct TCP
connections from the guest, to the host gateway, a metadata address, and a public IP, failed. This
result does not prove provider DNS/redirect policy.
[Real VM manifest](evidence/vm-configuration-linux.json), [reproduction recipe](poc/vm-recipe.md).

The real CLI's Read/Write/Git worked normally in the worker. The first subagent experiment failed
because it asked the CLI for the SDK's Agent tool name. The CLI's actual model-invocation path is the
/agent command projection with a product prefix, and both the separate re-run result and the initial
failure are preserved. The model's completion sentence is not used for the success verdict.
[Initial result](evidence/vm-worker-tools-initial-linux.json),
[Result of the corrected path](evidence/vm-worker-tools-corrected-linux.json).

The [parallel organization experiment](parallel-results.md) verifies synthetic identity, parent
budget, approval, CAS, duplicate external effects, and real crash and revocation with a separate
broker. This prototype is not presented as a security feature of the production CLI.

Five observations were confirmed on real MCP stdio: initialize/catalog/submit, protocol-only stdout, and
normal signal termination. [MCP result](evidence/vm-mcp-linux.json). Four observations were also
made on the real VM: filesystem separation, pause/resume, non-resumption of descendants after an
offline disk restore, and termination. [VM lifecycle](evidence/vm-lifecycle-linux.json). The first
shutdown wait that exceeded 20 seconds is kept as a failure result, and a normal shutdown was
confirmed in a 60-second bounded retry. The subsequent [extended experiment](evidence/parallel-recovery-linux.json)
linked identity revocation in the local reference topology, VM/tunnel/child termination, disk restore,
rejection of the old identity, and reuse of a new key and the current journal. It is not evidence of a
production/cloud revoke→restore flow.

Review found that the initial Read/Git verdict could pass on an accumulated log and a past HEAD. That
[historical verdict](evidence/vm-worker-tools-stale-evidence-linux.json) is excluded from the
completion evidence. The corrected probe checks a per-run UUID and a new repository, the Read response
for that UUID, the unique new Git commit, and the exact content of the commit's files. The results of
two re-runs on the same guest are each preserved.
[Latest result](evidence/vm-worker-tools-corrected-linux.json), [repeat result](evidence/vm-worker-tools-repeat-linux.json).

In the negative controls that explicitly forbid Read and Git execution respectively, the latest file
predicate also failed. That failure means the control verdict that expected it passed, and it is not
counted as file-operation success.
[Read denied](evidence/vm-worker-files-deny-read-linux.json), [Git denied](evidence/vm-worker-files-deny-git-linux.json).

## Real CLI remote MCP and a temporary HTTPS issuer

The [14 observations](evidence/remote-mcp-https-linux.json) use the real CLI's remote MCP carrier, a
real HTTPS metadata/JWKS server, and a synthetic Ed25519 JWT. A valid token received the protocol
response to MCP initialize. A missing token and a wrong audience, scope, subject, signature, expiry,
and Host header were rejected with 401/403 before session admission. The CLI stdout was empty and the
experiment token was absent from diagnostics. No existing company key was read and no external issuer
was contacted.

An issuer outage is not a policy of immediately rejecting all tokens. The real CLI's still-young key
cache continues to accept valid tokens. In a separate production verifier, a cold cache is
keys-unavailable, and the hard-age observation, where only the monotonic clock dependency was
accelerated against the same real HTTPS server, was also keys-unavailable. The latter is not evidence
of a real one-hour elapse or of a CLI clock change. That a metadata redirect is not followed was
confirmed by an actual request count of 0 at the destination.

The public resource URL is a loopback HTTP listener expressed with a synthetic Host header. It must
not be interpreted as having verified a public TLS ingress, a trusted proxy, Electron remote pairing,
or provider egress. The TLS CA is specified only in NODE_EXTRA_CA_CERTS of that experiment child, and
the authentication key, settings, and HOME are placed in a temporary directory. The directory is
deleted after the experiment CLI and the HTTPS server exit. [Reproduction program](poc/remote-mcp.mts):

```sh
pnpm exec tsx research/agent-organization-security/poc/remote-mcp.mts /tmp/remote-mcp.json
```

It requires Linux/macOS, OpenSSL, the built CLI, and the repository dependencies. The verifier that
observed the cold/stale issuer outage is a production function but a different cache from the CLI
process. The network policy source was also cross-checked, and the resolve-then-validate in
`agent-core/src/utils/egress-policy.ts` does not pin the address at connect time, so a DNS rebinding
window remains. This risk must be verified separately in provider measurement of the hosted egress
enforcement point.

## Real terminal TUI

The [7 PTY observations](evidence/tui-pty-linux.json) run the existing terminal test driver and the
built real CLI in a temporary HOME/state. They confirmed prompt and Idle rendering, the command result
after `/help` input with 0 model requests, and the rendering of the response of a loopback model that
received a separate unique user prompt, with 1 request. The response marker is a value not present in
the input, so a prompt echo is not counted as evidence of model execution. After responding to the
real confirmation UI of `/exit`, process exit 0, server shutdown, and deletion of the temporary state
were confirmed.

At first, the experiment entry point could not be run because of `__dirname` in a Vitest-specific
convenience wrapper. [Setup failure](evidence/tui-initial-linux.json). In the next manual provider
profile, the wrong `baseUrl` field was not applied, so the provider's default API rejected the
synthetic-key request with 401 and the local model request count was 0.
[Initial model failure](evidence/tui-model-initial-linux.json). The normal reproduction configures
through the real CLI `--configure-provider` and first checks that the saved `baseURL` is its own
loopback server. Review reproduced that the request counter, by counting only requests that passed
the unique prompt, could miss a wrong additional request. The [pre-fix counter failure](evidence/tui-counter-initial-linux.json)
preserves that the counter stays 0 and the request-absence verdict is true even when a real `/help`
HTTP injection is rejected with 400. The corrected probe counts every HTTP request from callback entry
and counts matching-prompt requests separately. The same injection makes the request-absence verdict
false. The 1 request of the model turn is the increase after the injection. The product and the
existing PTY harness were not modified.

This result is an observation of a plain-text turn and a user slash command in a Linux terminal. It is
not evidence of malicious tool code run in the TUI, hosted worker isolation, or an Electron or macOS
UI. The [reproduction program](poc/tui-pty.mts) requires Node 22, the built CLI, and the repository's
existing PTY dependencies.

```sh
pnpm exec tsx research/agent-organization-security/poc/tui-pty.mts /tmp/tui-pty.json
```
