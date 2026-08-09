# CORE-027 — a provider failure exits non-zero as itself (agent-run evidence)

The user-execution scenarios from
[CORE-027](../../tasks/CORE-027-failure-contract-destroys-the-failure.md), run by the agent against
the built CLI on 2026-08-09.

## S-CORE027-1 — print mode against a failing provider endpoint

**Fixture:** a local endpoint (`net`/`http` server) the provider profile's `--base-url` points at,
exercised in three failure shapes: refuse-after-accept (socket destroyed), mid-stream destroy
(SSE headers then `res.destroy()`), and an HTTP 400 whose error message contains "abort"
(`connection aborted by peer`). Isolated `HOME` with a `qwen`-type (OpenAI-compatible) profile:

```bash
node drop-server.mjs &   # listens on 127.0.0.1:45123
robota --configure-provider qwen --type qwen --base-url http://127.0.0.1:45123/v1 \
  --model qwen-test --api-key-env FAKE_KEY --set-current
robota -p "say hi"; echo $?
```

**Observed (after the fix), all three shapes:**

| Endpoint behaviour         | Printed failure                         | Exit code |
| -------------------------- | --------------------------------------- | --------- |
| accept then destroy socket | `Qwen stream failed: Connection error.` | **1**     |
| SSE headers then destroy   | `Premature close`                       | **1**     |
| 400 body saying "aborted"  | failure text surfaced, not swallowed    | **1**     |

No run was reported as a successful interrupted run; no empty response with exit 0 was observed.
The abort-PROSE classification itself is pinned where the SDK cannot normalize the message away:
`execution-service.test.ts` drives `connection aborted by peer` through the real execute path
(failed, original error by identity), and
`headless-provider-failure.integration.test.ts` drives it through a real `InteractiveSession` +
headless transport (exit 1, failure on stderr). Both are red-proved against the pre-fix services.

## S-CORE027-2 — a thrown tool and a denied tool are distinct outcomes

Backed by the `IToolResult` outcome tests added with the branch's session commits
(crashed / denied / hook-blocked / succeeded are four distinguishable states at `IToolResult`;
`onToolExecution` no longer reports `success: true` for a throw). Run via
`pnpm --filter @robota-sdk/agent-core test`.

**Cleanup:** the fixture server is killed by PID after each run; the isolated `HOME` lives in the
session scratchpad and is discarded with it.
