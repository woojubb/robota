# RUNTIME-003 — one owner advances each DAG queue (agent-run)

This scenario drives the exported in-process DAG framework with twelve concurrent prompt submissions.
Every submitted prompt executes one deliberately slow custom node over the same framework queue. The
observable `maximumConcurrentExecutions` value therefore proves whether one queue has one advancement
actor or whether the prompt backend and background driver race the same worker step.

## Executability

`agent-executable` — both flows are non-interactive Bash over shipped public surfaces. The primary flow
uses the exported `createDagFramework` SDK API and a credential-free custom node. The companion smoke
uses the built `robota-dag` CLI. Neither flow calls a test runner or requires a provider key or network
service.

## Prerequisites

- Run from the repository root with workspace dependencies installed.
- Bash, Node.js, pnpm, and the GNU coreutils `timeout` executable must be available.
- `scratch/src/` must be writable; the command materializes a disposable SDK consumer there.
- `packages/dag-cli/dist/node/bin.js` must exist from the ordinary package build.
- No model-provider key or external service is required.

## Scenario 1 — concurrent public-SDK prompts share one advancement actor

### Exact command

```bash
set -euo pipefail

scenario_root="$(mktemp -d /tmp/robota-runtime003.XXXXXX)"
scenario_script="scratch/src/runtime-003-dag-advancement-agent-run.ts"

cleanup() {
  rm -f -- "$scenario_script"
  case "$scenario_root" in
    /tmp/robota-runtime003.*) rm -rf -- "$scenario_root" ;;
    *) printf 'refusing unexpected cleanup path: %s\n' "$scenario_root" >&2; return 1 ;;
  esac
}
trap cleanup EXIT

mkdir -p "$(dirname "$scenario_script")"
tee "$scenario_script" >/dev/null <<'TYPESCRIPT'
import assert from 'node:assert/strict';

import { createDagFramework } from '../../packages/dag-framework/src/index.ts';
import type { IDagNodeDefinition } from '../../packages/dag-core/src/index.ts';

const scenarioRoot = process.argv[2];
if (scenarioRoot === undefined) {
  throw new Error('usage: runtime-003-dag-advancement-agent-run.ts <scenario-root>');
}

const PROMPT_COUNT = 12;
let activeExecutions = 0;
let maximumConcurrentExecutions = 0;
let executionCount = 0;
let unhandledRejections = 0;

const onUnhandledRejection = (): void => {
  unhandledRejections += 1;
};
process.on('unhandledRejection', onUnhandledRejection);

const slowNode: IDagNodeDefinition = {
  nodeType: 'scenario/slow',
  displayName: 'Scenario slow node',
  category: 'scenario',
  inputs: [],
  outputs: [{ key: 'text', type: 'string', required: true }],
  configSchemaDefinition: null,
  defaultOutputPort: 'text',
  taskHandler: {
    async execute() {
      executionCount += 1;
      activeExecutions += 1;
      maximumConcurrentExecutions = Math.max(maximumConcurrentExecutions, activeExecutions);
      try {
        await new Promise<void>((resolve) => setTimeout(resolve, 40));
        return { ok: true, value: { text: 'RUNTIME003_OK' } };
      } finally {
        activeExecutions -= 1;
      }
    },
  },
};

const framework = await createDagFramework({
  executionRoot: scenarioRoot,
  nodes: [slowNode],
  paths: {
    storageRoot: `${scenarioRoot}/storage`,
    assetRoot: `${scenarioRoot}/assets`,
  },
  autoStart: true,
});

async function bounded<T>(label: string, work: Promise<T>, timeoutMs: number): Promise<T> {
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

try {
  const submissions = await bounded(
    'concurrent prompt submission',
    Promise.all(
      Array.from({ length: PROMPT_COUNT }, (_, index) =>
        framework.internals.promptBackend.submitPrompt({
          prompt_id: `runtime003-${index}`,
          prompt: { '1': { class_type: 'scenario/slow', inputs: {} } },
        }),
      ),
    ),
    10_000,
  );
  assert.equal(submissions.filter((result) => result.ok).length, PROMPT_COUNT);

  await bounded(
    'prompt history completion',
    (async () => {
      for (;;) {
        const history = await framework.internals.promptBackend.getHistory();
        if (!history.ok) throw new Error(history.error.message);
        const entries = Object.values(history.value);
        if (
          entries.length === PROMPT_COUNT &&
          entries.every((entry) => entry.status.completed && entry.status.status_str === 'success')
        ) return;
        await new Promise<void>((resolve) => setTimeout(resolve, 20));
      }
    })(),
    15_000,
  );

  await bounded('framework stop', framework.stop(), 5_000);
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(executionCount, PROMPT_COUNT);
  assert.equal(maximumConcurrentExecutions, 1);
  assert.equal(activeExecutions, 0);
  assert.equal(unhandledRejections, 0);

  process.stdout.write(
    `${JSON.stringify({
      phase: 'runtime-003-single-advancement-owner',
      accepted: submissions.length,
      completed: executionCount,
      maximumConcurrentExecutions,
      activeAfterStop: activeExecutions,
      unhandledRejections,
    })}\n`,
  );
} finally {
  await bounded('framework cleanup stop', framework.stop(), 5_000);
  process.off('unhandledRejection', onUnhandledRejection);
}
TYPESCRIPT

pnpm --dir scratch run run -- src/runtime-003-dag-advancement-agent-run.ts "$scenario_root" \
  | tee "$scenario_root/sdk-result.log"

grep -F '"phase":"runtime-003-single-advancement-owner"' "$scenario_root/sdk-result.log"
grep -F '"accepted":12' "$scenario_root/sdk-result.log"
grep -F '"completed":12' "$scenario_root/sdk-result.log"
grep -F '"maximumConcurrentExecutions":1' "$scenario_root/sdk-result.log"
grep -F '"activeAfterStop":0' "$scenario_root/sdk-result.log"
grep -F '"unhandledRejections":0' "$scenario_root/sdk-result.log"
```

### Expected observable result

- The Bash block exits with status `0`.
- It prints one JSON object containing `accepted:12`, `completed:12`,
  `maximumConcurrentExecutions:1`, `activeAfterStop:0`, and `unhandledRejections:0` under phase
  `runtime-003-single-advancement-owner`.
- All twelve public prompt submissions complete successfully, but at most one custom node is active
  at any instant on their shared queue.
- A competing driver, floating prompt loop, unowned rejection, early stop, or incomplete prompt makes
  the TypeScript assertions or a final `grep` exit non-zero.

### Observed evidence

PASS — 2026-08-13 19:43 KST. Executed the exact command block from the repository root after
building the affected packages. Exit status was `0`; the emitted JSON was
`{"phase":"runtime-003-single-advancement-owner","accepted":12,"completed":12,"maximumConcurrentExecutions":1,"activeAfterStop":0,"unhandledRejections":0}`.
Every final `grep` assertion matched, and the cleanup trap removed the scratch script and bounded
temporary root.

## Scenario 2 — shipped CLI execution remains observable

### Exact command

```bash
set -euo pipefail

test -f packages/dag-cli/dist/node/bin.js
cli_output="$({
  timeout 15s node packages/dag-cli/dist/node/bin.js run \
    --pipeline 'input | text-output' \
    --input text=RUNTIME003_OK \
    --result \
    --no-progress
} 2>/tmp/robota-runtime003-cli.stderr)"
test "$cli_output" = 'RUNTIME003_OK'
printf '%s\n' "$cli_output"
rm -f -- /tmp/robota-runtime003-cli.stderr
```

### Expected observable result

- The Bash block exits with status `0`.
- Standard output is exactly `RUNTIME003_OK` followed by one newline.
- The command neither hangs nor prints progress or unrelated text into the result channel.

### Observed evidence

PASS — 2026-08-13 19:43 KST. Executed the exact command block against the freshly built
`packages/dag-cli/dist/node/bin.js`. Exit status was `0`; stdout was exactly `RUNTIME003_OK` followed
by one newline, and the stderr capture was removed.

## Cleanup

Scenario 1 always calls `framework.stop()`, removes its materialized TypeScript file, and removes only
the `mktemp` directory matching `/tmp/robota-runtime003.*`. Scenario 2 removes its fixed stderr capture
after the exact-output assertion. A failed Scenario 2 may leave that one diagnostic file for inspection;
it is safe to remove with `rm -f -- /tmp/robota-runtime003-cli.stderr`.
