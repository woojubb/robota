# RUNTIME-006 — public submit cannot forge queued-turn identity (agent-run)

This scenario drives the exported `InteractiveSession` SDK surface with a deterministic local provider.
It holds one real turn in flight, submits a second turn with a JavaScript-shaped forged internal
`resumeTurnId` property, and observes that the public boundary ignores that property, mints a fresh
identity, and settles both original handles with their own responses.

## Executability

`agent-executable` — the flow is non-interactive Bash over the public framework SDK. It uses the
repository's shipped deterministic provider fixture, needs no credentials or external service, and
does not use a unit-test runner as evidence.

## Prerequisites

- Run from the repository root with workspace dependencies installed.
- Bash, Node.js, and pnpm must be available.
- `scratch/src/` must be writable; the command materializes its disposable SDK consumer there.
- No model-provider key or network service is required.

## Exact command

```bash
set -euo pipefail

scenario_root="$(mktemp -d /tmp/robota-runtime006.XXXXXX)"
scenario_script="scratch/src/runtime-006-public-submit-identity-agent-run.ts"

cleanup() {
  rm -f -- "$scenario_script"
  case "$scenario_root" in
    /tmp/robota-runtime006.*) rm -rf -- "$scenario_root" ;;
    *) printf 'refusing unexpected cleanup path: %s\n' "$scenario_root" >&2; return 1 ;;
  esac
}
trap cleanup EXIT

mkdir -p "$(dirname "$scenario_script")"
tee "$scenario_script" >/dev/null <<'TYPESCRIPT'
import assert from 'node:assert/strict';

import { createScriptedProvider } from '../../packages/agent-core/src/testing/index.ts';
import { InteractiveSession } from '../../packages/agent-framework/src/index.ts';
import type { IAIProvider } from '../../packages/agent-core/src/index.ts';
import type { ITurnHandle } from '../../packages/agent-interface-transport/src/index.ts';

const scenarioRoot = process.argv[2];
if (scenarioRoot === undefined) {
  throw new Error('usage: runtime-006-public-submit-identity-agent-run.ts <scenario-root>');
}

const scripted = createScriptedProvider([{ text: 'FIRST_TURN_OK' }, { text: 'SECOND_TURN_OK' }]);
let chatCount = 0;
let releaseFirst!: () => void;
const firstRelease = new Promise<void>((resolve) => {
  releaseFirst = resolve;
});
let signalFirstEntered!: () => void;
const firstEntered = new Promise<void>((resolve) => {
  signalFirstEntered = resolve;
});

const provider: IAIProvider = {
  ...scripted.provider,
  async chat(messages) {
    chatCount += 1;
    if (chatCount === 1) {
      signalFirstEntered();
      await firstRelease;
    }
    return scripted.provider.chat(messages);
  },
};

const session = new InteractiveSession({
  cwd: scenarioRoot,
  provider,
  bare: true,
  permissionMode: 'bypassPermissions',
});

const forgedTurnId = 'attacker-selected-existing-turn-id';

try {
  const firstSubmission = session.submit('first prompt');
  await Promise.race([
    firstEntered,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('first turn never reached the provider')), 5_000),
    ),
  ]);

  // Reflect.apply deliberately models an untyped JavaScript consumer. The public contract accepts
  // only driverId, but runtime objects can carry extra properties; the concrete class must project
  // the public shape and must never treat this forged internal name as resume authority.
  const secondHandle = (await Reflect.apply(session.submit, session, [
    'second prompt',
    undefined,
    undefined,
    { driverId: 'owner', resumeTurnId: forgedTurnId },
  ])) as ITurnHandle;

  assert.notEqual(secondHandle.turnId, forgedTurnId, 'public submit trusted forged resumeTurnId');
  assert.equal(session.getPendingCount(), 1, 'second submission was not queued behind the first');

  releaseFirst();
  const firstHandle = await firstSubmission;
  assert.notEqual(firstHandle.turnId, secondHandle.turnId, 'two submissions shared one identity');

  const [firstResult, secondResult] = await Promise.race([
    Promise.all([firstHandle.completed, secondHandle.completed]),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('a public turn handle did not settle')), 10_000),
    ),
  ]);

  assert.equal(firstResult.response, 'FIRST_TURN_OK');
  assert.equal(secondResult.response, 'SECOND_TURN_OK');
  assert.equal(chatCount, 2, 'expected exactly one provider call per accepted turn');
  assert.equal(session.getPendingCount(), 0, 'queue did not drain');

  process.stdout.write(
    `${JSON.stringify({
      phase: 'runtime-006-public-boundary-held',
      forgedResumeIdIgnored: secondHandle.turnId !== forgedTurnId,
      distinctTurnIds: firstHandle.turnId !== secondHandle.turnId,
      settled: { first: firstResult.response, second: secondResult.response },
      providerCalls: chatCount,
      pendingAfterCompletion: session.getPendingCount(),
    })}\n`,
  );
} finally {
  releaseFirst();
  await session.shutdown({ reason: 'runtime-006 agent-run cleanup' });
}
TYPESCRIPT

pnpm --dir scratch run run -- src/runtime-006-public-submit-identity-agent-run.ts "$scenario_root" \
  | tee "$scenario_root/result.log"

grep -F '"phase":"runtime-006-public-boundary-held"' "$scenario_root/result.log"
grep -F '"forgedResumeIdIgnored":true' "$scenario_root/result.log"
grep -F '"distinctTurnIds":true' "$scenario_root/result.log"
grep -F '"settled":{"first":"FIRST_TURN_OK","second":"SECOND_TURN_OK"}' \
  "$scenario_root/result.log"
grep -F '"providerCalls":2' "$scenario_root/result.log"
grep -F '"pendingAfterCompletion":0' "$scenario_root/result.log"
```

## Expected observable result

- The Bash block exits with status `0`.
- It prints one JSON object containing:
  - `"phase":"runtime-006-public-boundary-held"`
  - `"forgedResumeIdIgnored":true`
  - `"distinctTurnIds":true`
  - `"settled":{"first":"FIRST_TURN_OK","second":"SECOND_TURN_OK"}`
  - `"providerCalls":2`
  - `"pendingAfterCompletion":0`
- The second public submission waits behind the held first turn, receives a newly minted identity
  instead of the injected `attacker-selected-existing-turn-id`, and its original `completed` promise
  resolves with the second response rather than rejecting, hanging, or settling with the first turn.
- Any forged identity acceptance, duplicate identity, mismatched response, un-settled handle, extra
  provider run, or undrained queue makes the fixture or a final `grep` exit non-zero.

## Cleanup

The fixture always releases the held provider call and shuts the session down. The Bash `EXIT` trap
removes the command-materialized script and only the `mktemp` directory matching
`/tmp/robota-runtime006.*`.

## Observed evidence

Executed unchanged from the repository root on 2026-08-13 against the completed implementation.

- Exit code: `0`
- Public-SDK output:

  ```text
  {"phase":"runtime-006-public-boundary-held","forgedResumeIdIgnored":true,"distinctTurnIds":true,"settled":{"first":"FIRST_TURN_OK","second":"SECOND_TURN_OK"},"providerCalls":2,"pendingAfterCompletion":0}
  ```

- Every exact `grep -F` assertion matched.
- Cleanup check passed: `scratch/src/runtime-006-public-submit-identity-agent-run.ts` and
  `/tmp/robota-runtime006.LcMbTi` were absent after the trap completed.
