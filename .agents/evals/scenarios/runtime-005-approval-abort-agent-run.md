# RUNTIME-005 — abort a parked approval and run the next prompt (agent-run)

This scenario drives the exported `InteractiveSession` framework testing surface with a deterministic
local provider. It parks a real turn on a transport-neutral permission request, verifies that a public
blocking command is rejected without consuming the queued prompt, aborts the turn, and observes both
bounded settlement and successful reuse of the same session for the next prompt.

## Executability

`agent-executable` — the flow is non-interactive Bash over the public framework testing SDK. It uses
the shipped scripted provider, needs no credentials or external service, and does not invoke a test
runner.

## Prerequisites

- Run from the repository root with workspace dependencies installed.
- Bash, Node.js, and pnpm must be available.
- `scratch/src/` must be writable; the command materializes its disposable SDK consumer there.
- No model-provider key or network service is required.

## Exact Bash

```bash
set -euo pipefail

scenario_root="$(mktemp -d /tmp/robota-runtime005.XXXXXX)"
scenario_script="scratch/src/runtime-005-approval-abort-agent-run.ts"

cleanup() {
  rm -f -- "$scenario_script"
  case "$scenario_root" in
    /tmp/robota-runtime005.*) rm -rf -- "$scenario_root" ;;
    *) printf 'refusing unexpected cleanup path: %s\n' "$scenario_root" >&2; return 1 ;;
  esac
}
trap cleanup EXIT

mkdir -p "$(dirname "$scenario_script")"
tee "$scenario_script" >/dev/null <<'TYPESCRIPT'
import assert from 'node:assert/strict';

import { scriptedSession } from '@robota-sdk/agent-framework/testing';

async function bounded<T>(label: string, work: Promise<T>, timeoutMs = 5_000): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

const harness = scriptedSession({
  permissionMode: 'default',
  turns: [
    {
      toolCalls: [
        {
          name: 'Bash',
          args: { command: 'printf forbidden > {{cwd}}/must-not-exist.txt' },
        },
      ],
    },
    { text: 'NEXT_PROMPT_OK' },
  ],
});

let permissionRequests = 0;
const permissionParked = new Promise<void>((resolve) => {
  harness.session.on('permission_request', () => {
    permissionRequests += 1;
    resolve();
  });
});

try {
  const firstSubmission = harness.session.submit('request a permission-gated command');
  await bounded('permission request', permissionParked);
  assert.equal(harness.session.isExecuting(), true, 'approval wait did not retain execution');

  const queued = await bounded(
    'queued prompt admission',
    harness.session.submit('queued while approval is parked'),
  );
  const queuedSettlement = queued.completed.then(
    () => 'resolved',
    (error: unknown) => {
      assert.equal(error instanceof Error && error.name === 'TurnNotRunError', true);
      assert.equal((error as { reason?: unknown }).reason, 'cancelled');
      return 'cancelled';
    },
  );
  assert.equal(harness.session.getPendingCount(), 1, 'prompt was not queued');

  const busy = await bounded(
    'busy command refusal',
    harness.session.executeCommand('compact', ''),
  );
  assert.deepEqual(busy, {
    success: false,
    message: 'Another prompt or command is already running. Wait for it to finish.',
  });
  assert.equal(harness.session.getPendingCount(), 1, 'busy command consumed the queued prompt');

  harness.session.abort();
  const first = await bounded('aborted submission unwind', firstSubmission);
  await bounded('aborted turn settlement', first.completed);
  const queuedOutcome = await bounded('queued prompt cancellation', queuedSettlement);
  const idleAfterAbort = !harness.session.isExecuting();
  const pendingAfterAbort = harness.session.getPendingCount();
  const deniedToolRan = harness.exists('must-not-exist.txt');

  assert.equal(queuedOutcome, 'cancelled');
  assert.equal(idleAfterAbort, true, 'session stayed busy after abort');
  assert.equal(pendingAfterAbort, 0, 'abort did not clear the pending queue');
  assert.equal(deniedToolRan, false, 'aborted approval was interpreted as permission');

  const next = await bounded('next prompt submission', harness.session.submit('next prompt'));
  const nextResult = await bounded('next prompt settlement', next.completed);
  assert.equal(nextResult.response, 'NEXT_PROMPT_OK');

  process.stdout.write(
    `${JSON.stringify({
      phase: 'runtime-005-approval-abort-recovery',
      permissionRequests,
      busyRejected: busy?.success === false,
      queuePreservedUntilAbort: true,
      queuedOutcome,
      abortedTurnSettled: true,
      idleAfterAbort,
      pendingAfterAbort,
      deniedToolRan,
      nextResponse: nextResult.response,
    })}\n`,
  );
} finally {
  await bounded('session cleanup', harness.dispose());
}
TYPESCRIPT

pnpm --dir scratch run run -- src/runtime-005-approval-abort-agent-run.ts \
  | tee "$scenario_root/result.log"

grep -F '"phase":"runtime-005-approval-abort-recovery"' "$scenario_root/result.log"
grep -F '"permissionRequests":1' "$scenario_root/result.log"
grep -F '"busyRejected":true' "$scenario_root/result.log"
grep -F '"queuePreservedUntilAbort":true' "$scenario_root/result.log"
grep -F '"queuedOutcome":"cancelled"' "$scenario_root/result.log"
grep -F '"abortedTurnSettled":true' "$scenario_root/result.log"
grep -F '"idleAfterAbort":true' "$scenario_root/result.log"
grep -F '"pendingAfterAbort":0' "$scenario_root/result.log"
grep -F '"deniedToolRan":false' "$scenario_root/result.log"
grep -F '"nextResponse":"NEXT_PROMPT_OK"' "$scenario_root/result.log"
```

## Bounded waits

Every permission, submission, command, turn-settlement, queue-settlement, next-prompt, and cleanup
await is raced against a 5-second timeout. Any timeout rejects the script and makes the Bash block
exit non-zero.

## Expected observable result

- The Bash block exits with status `0`.
- It prints one JSON object with phase `runtime-005-approval-abort-recovery`, one permission request,
  `busyRejected:true`, `queuePreservedUntilAbort:true`, `queuedOutcome:"cancelled"`,
  `abortedTurnSettled:true`, `idleAfterAbort:true`, `pendingAfterAbort:0`, `deniedToolRan:false`, and
  `nextResponse:"NEXT_PROMPT_OK"`.
- The busy command neither starts nor drains the queued prompt. Abort fail-closes the pending
  approval, settles the active turn, cancels the queued prompt, releases execution ownership, and
  leaves the same public session able to complete the next prompt.
- A hanging approval, foreign/stale release, changed busy/queue policy, executed unapproved tool,
  unusable next prompt, or cleanup hang makes a TypeScript assertion, bounded wait, or final `grep`
  exit non-zero.

## Cleanup

The fixture always shuts down the public session and removes its isolated workspace. The Bash `EXIT`
trap removes the command-materialized script and only the `mktemp` directory matching
`/tmp/robota-runtime005.*`.

## Observed evidence

PASS — 2026-08-13. The exact Bash block exited `0` and printed:

```json
{
  "phase": "runtime-005-approval-abort-recovery",
  "permissionRequests": 1,
  "busyRejected": true,
  "queuePreservedUntilAbort": true,
  "queuedOutcome": "cancelled",
  "abortedTurnSettled": true,
  "idleAfterAbort": true,
  "pendingAfterAbort": 0,
  "deniedToolRan": false,
  "nextResponse": "NEXT_PROMPT_OK"
}
```

All ten exact `grep -F` assertions passed. The `EXIT` trap removed the scratch consumer and its
`/tmp/robota-runtime005.*` directory.
