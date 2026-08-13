# ARCH-012 — cast-free public session capability host over HTTP (agent-run)

This scenario compiles and runs an external-style TypeScript consumer against the built public exports
of `@robota-sdk/agent-interface-transport` and `@robota-sdk/agent-transport-http`. It constructs a host
with exactly the seven capabilities required by HTTP, submits through the public Hono HTTP surface, and
distinguishes an absent capability from one whose value is explicitly empty.

## Executability

`agent-executable` — bounded, non-interactive Bash and Node.js. It requires no provider, credentials,
network service, private import, source-condition export, or test runner.

## Prerequisites

- Run from the repository root with workspace dependencies installed.
- Bash, Node.js 22+, pnpm, TypeScript, GNU coreutils `timeout`, `mktemp`, and local symbolic-link
  permission.
- Writable `${TMPDIR:-/tmp}`.
- The interface-transport and HTTP transport packages must build.
- No model-provider key or external network access is required.

The existing `scratch/` workspace is not used because its source-condition runner would bypass the built
public package exports. The command creates and removes an isolated external-style consumer.

## Exact command

```bash
set -euo pipefail

repo_root="$(pwd -P)"
scenario_root="$(mktemp -d "${TMPDIR:-/tmp}/robota-arch012.XXXXXX")"

cleanup() {
  case "$(basename -- "$scenario_root")" in
    robota-arch012.*)
      node -e "require('node:fs').rmSync(process.argv[1], { recursive: true, force: true })" \
        "$scenario_root"
      ;;
    *)
      printf 'refusing unexpected cleanup path: %s\n' "$scenario_root" >&2
      return 1
      ;;
  esac
}
trap cleanup EXIT

timeout 180s pnpm \
  --filter @robota-sdk/agent-interface-transport \
  --filter @robota-sdk/agent-transport-http \
  build

mkdir -p "$scenario_root/node_modules/@robota-sdk"
ln -s "$repo_root/packages/agent-interface-transport" \
  "$scenario_root/node_modules/@robota-sdk/agent-interface-transport"
ln -s "$repo_root/packages/agent-transport-http" \
  "$scenario_root/node_modules/@robota-sdk/agent-transport-http"

tee "$scenario_root/package.json" >/dev/null <<'JSON'
{
  "private": true,
  "type": "module"
}
JSON

tee "$scenario_root/tsconfig.json" >/dev/null <<JSON
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noImplicitAny": true,
    "noEmitOnError": true,
    "skipLibCheck": true,
    "types": ["node"],
    "typeRoots": ["$repo_root/node_modules/@types"],
    "rootDir": ".",
    "outDir": "dist"
  },
  "include": ["scenario.ts"]
}
JSON

tee "$scenario_root/scenario.ts" >/dev/null <<'TYPESCRIPT'
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  createSessionCapabilityHost,
  readSessionCapability,
} from '@robota-sdk/agent-interface-transport';
import { createHttpTransport } from '@robota-sdk/agent-transport-http';

const emitter = new EventEmitter();
let nextTurn = 0;

const host = createSessionCapabilityHost({
  turnSubmission: {
    async submit() {
      const result = {
        response: 'ARCH012_OK',
        history: [],
        toolSummaries: [],
        contextState: {
          usedTokens: 0,
          maxTokens: 1,
          usedPercentage: 0,
          remainingPercentage: 100,
        },
      };
      const handle = {
        turnId: `arch012-turn-${(nextTurn += 1)}`,
        completed: Promise.resolve(result),
      };

      emitter.emit('complete', result);
      return handle;
    },
  },
  events: {
    on(event, handler) {
      emitter.on(event, handler);
    },
    off(event, handler) {
      emitter.off(event, handler);
    },
  },
  turnControl: {
    abort() {},
    cancelQueue() {},
  },
  identity: {
    getSession() {
      return { getSessionId: () => 'arch012-http-session' };
    },
  },
  commands: {
    async executeCommand() {
      return null;
    },
    listCommands() {
      return [];
    },
  },
  conversationRead: {
    getMessages() {
      return [];
    },
    getContextState() {
      return {
        usedTokens: 0,
        maxTokens: 1,
        usedPercentage: 0,
        remainingPercentage: 100,
      };
    },
  },
  executionState: {
    isExecuting() {
      return false;
    },
    getPendingPrompt() {
      return null;
    },
    getPendingCount() {
      return 0;
    },
  },
});

assert.deepEqual(Object.keys(host.capabilities), [
  'turnSubmission',
  'events',
  'turnControl',
  'identity',
  'commands',
  'conversationRead',
  'executionState',
]);

const transport = createHttpTransport({
  admission: {
    open: true,
    openReason: 'ARCH-012 local capability scenario',
  },
});

transport.attach(host);
await transport.start();

try {
  const response = await transport.getApp().request('/submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt: 'prove the public capability host' }),
  });

  assert.equal(response.status, 200);
  const body = await response.text();
  const dataLine = body.split('\n').find((line) => line.startsWith('data: '));
  assert.ok(dataLine, 'the SSE response must contain a data line');

  const payload: unknown = JSON.parse(dataLine.slice('data: '.length));
  assert.ok(typeof payload === 'object' && payload !== null && 'response' in payload);
  assert.equal(payload.response, 'ARCH012_OK');
  process.stdout.write('ARCH012_OK\n');

  const absent = readSessionCapability(host, 'driverAttribution');
  assert.equal(absent.provided, false);
  process.stdout.write('NOT_PROVIDED\n');

  const providedEmptyHost = createSessionCapabilityHost({
    driverAttribution: {
      getActiveDriverId() {
        return null;
      },
    },
  });
  const provided = readSessionCapability(providedEmptyHost, 'driverAttribution');
  assert.equal(provided.provided, true);
  assert.ok(provided.provided);
  assert.equal(provided.value.getActiveDriverId(), null);
  process.stdout.write('PROVIDED_EMPTY\n');
} finally {
  await transport.stop();
}
TYPESCRIPT

timeout 60s pnpm exec tsc -p "$scenario_root/tsconfig.json"
timeout 20s node "$scenario_root/dist/scenario.js" |
  tee "$scenario_root/result.log"

mapfile -t observed < "$scenario_root/result.log"
test "${#observed[@]}" -eq 3
test "${observed[0]}" = 'ARCH012_OK'
test "${observed[1]}" = 'NOT_PROVIDED'
test "${observed[2]}" = 'PROVIDED_EMPTY'

completed_root="$scenario_root"
cleanup
trap - EXIT
test ! -e "$completed_root"
printf 'CLEANUP_OK\n'
```

## Expected observable result

- TypeScript compilation succeeds without type assertions, `any`, private imports, or source-path imports.
- The host capability map contains exactly `turnSubmission`, `events`, `turnControl`, `identity`,
  `commands`, `conversationRead`, and `executionState`.
- Public HTTP `/submit` returns status `200` and an SSE completion response of `ARCH012_OK`.
- The consumer process prints exactly:

  ```text
  ARCH012_OK
  NOT_PROVIDED
  PROVIDED_EMPTY
  ```

- The complete Bash block exits `0` within the stated bounds. Bash then proves the temporary directory
  absent and separately prints `CLEANUP_OK`.
- A missing or extra role, indistinguishable absent/empty result, compile/import failure, wrong SSE
  response, timeout, or cleanup failure exits nonzero.

## Cleanup

The explicit cleanup and fallback `EXIT` trap remove only the basename-validated `robota-arch012.*`
temporary consumer, including symlinks, source, compiler output, and result log. No tracked repository
file is modified.

## Observed evidence

Re-executed the complete exact Bash block from the repository root on 2026-08-14 after the final
capability-registry, immutable snapshot, non-enumerable role, and accessor-backed method forwarding
changes, against planning HEAD `27d2ee475` plus the ARCH-012 implementation working tree. Both public
packages built, the isolated
consumer compiled without casts or private imports, and the unified command exited `0`. The consumer
printed exactly:

```text
ARCH012_OK
NOT_PROVIDED
PROVIDED_EMPTY
```

Bash then proved the temporary directory absent and printed exactly one `CLEANUP_OK` marker. A
post-run search found no `robota-arch012.*` directory under `${TMPDIR:-/tmp}`.
