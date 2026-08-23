# ARCH-011 — custom runner and shipped service share one public lifecycle registry (agent-run)

This scenario exercises the built public lifecycle contract from an isolated external-style consumer.
The custom runner implementation imports only the universal contract package; a separate composition
file registers it beside the shipped configurable WebSocket service and observes lifecycle results.

## Executability

`agent-executable` — non-interactive Bash, TypeScript, and Node.js. No provider, credential, external
network, test runner, private source import, or repository-internal factory path is used.

## Prerequisites

- Run from the repository root with workspace dependencies installed.
- Bash, Node.js 22+, pnpm, TypeScript, GNU coreutils `timeout`, `mktemp`, and local symlink permission
  must be available.
- `${TMPDIR:-/tmp}` must be writable.
- The affected workspace packages and their dependencies must be buildable.
- No model-provider key, external service, or internet access is required. WebSocket admission is
  explicitly open only for the isolated loopback process, with a nonempty reason.

## Exact command

```bash
set -euo pipefail

repo_root="$(pwd -P)"
scenario_root="$(mktemp -d "${TMPDIR:-/tmp}/robota-arch011.XXXXXX")"

cleanup() {
  case "$(basename -- "$scenario_root")" in
    robota-arch011.*)
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

timeout 240s pnpm \
  --filter '@robota-sdk/agent-transport...' \
  --filter '@robota-sdk/agent-transport-ws...' \
  build

mkdir -p "$scenario_root/node_modules/@robota-sdk"
for package_name in agent-interface-transport agent-transport agent-transport-ws; do
  ln -s "$repo_root/packages/$package_name" \
    "$scenario_root/node_modules/@robota-sdk/$package_name"
done
mkdir -p "$scenario_root/node_modules/@types"
ln -s "$repo_root/node_modules/@types/node" "$scenario_root/node_modules/@types/node"

tee "$scenario_root/package.json" >/dev/null <<'JSON'
{
  "name": "arch-011-external-consumer",
  "private": true,
  "type": "module"
}
JSON

tee "$scenario_root/tsconfig.json" >/dev/null <<'JSON'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": false,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["*.ts"]
}
JSON

tee "$scenario_root/custom-transport.ts" >/dev/null <<'TYPESCRIPT'
import type { TTransportRunOutcome, ITransportRunnerAdapter } from '@robota-sdk/agent-interface-transport';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';

export class Arch011Runner implements ITransportRunnerAdapter<IInteractiveSession> {
  readonly name = 'arch011-runner';
  readonly lifecycle: Readonly<{ kind: 'runner' }> = Object.freeze({ kind: 'runner' });

  private attached = false;
  private started = false;
  private completion: Promise<TTransportRunOutcome> | undefined;
  private settle: ((outcome: TTransportRunOutcome) => void) | undefined;

  constructor(private readonly onLaunch: () => void) {}

  attach(_session: IInteractiveSession): void {
    this.attached = true;
    this.started = false;
  }

  async start(): Promise<void> {
    if (!this.attached) throw new Error('attach required');
    if (this.started) throw new Error('already started');
    this.started = true;
    this.onLaunch();
    this.completion = new Promise<TTransportRunOutcome>((resolve) => {
      this.settle = resolve;
    });
  }

  waitForCompletion(): Promise<TTransportRunOutcome> {
    if (this.completion === undefined) throw new Error('start required');
    return this.completion;
  }

  complete(): void {
    if (this.settle === undefined) throw new Error('start required');
    this.settle({ status: 'succeeded', exitCode: 0 });
    this.settle = undefined;
  }

  async stop(): Promise<void> {
    this.started = false;
  }
}
TYPESCRIPT

tee "$scenario_root/scenario.ts" >/dev/null <<'TYPESCRIPT'
import assert from 'node:assert/strict';

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-transport/testing';
import { TransportRegistry } from '@robota-sdk/agent-transport';
import { WsTransport } from '@robota-sdk/agent-transport-ws';

import { Arch011Runner } from './custom-transport.js';

const started: string[] = [];
const registry = new TransportRegistry('./arch011-settings.json');
const runner = new Arch011Runner(() => started.push('arch011-runner'));
const ws = new WsTransport({
  port: 0,
  maxRetries: 0,
  open: true,
  openReason: 'ARCH-011 isolated loopback lifecycle scenario',
});

registry.register(runner);
registry.register(ws);
await registry.startAll(createTestInteractiveSession());
assert.equal(typeof ws.boundPort, 'number');
started.push('ws');

runner.complete();
const outcomes = await registry.waitForCompletion();
const failure = await registry.waitForFailure();
assert.deepEqual(outcomes, [
  { name: 'arch011-runner', outcome: { status: 'succeeded', exitCode: 0 } },
]);
assert.equal(failure, undefined);
const firstStarted = started.join(',');

const firstStop = await registry.stopAll();
assert.deepEqual(firstStop.errors, []);

await registry.startAll(createTestInteractiveSession());
assert.equal(typeof ws.boundPort, 'number');
const stoppedCompletion = registry.waitForCompletion();
const stoppedFailure = registry.waitForFailure();
const stopped = await registry.stopAll();
assert.deepEqual(stopped.errors, []);
assert.deepEqual(await stoppedCompletion, [
  { name: 'arch011-runner', outcome: { status: 'abandoned', reason: 'stopped' } },
]);
assert.equal(await stoppedFailure, undefined);

const secondStop = await registry.stopAll();
assert.deepEqual(secondStop.errors, []);

process.stdout.write(`STARTED=${firstStarted}\n`);
process.stdout.write('RUNNER=arch011-runner:succeeded:0\n');
process.stdout.write('ABANDONED=arch011-runner:stopped\n');
process.stdout.write('FAILURE=NONE\n');
process.stdout.write('WS_READY=true\n');
process.stdout.write('STOP=TWICE\n');
TYPESCRIPT

timeout 60s pnpm exec tsc -p "$scenario_root/tsconfig.json"
timeout 30s node "$scenario_root/dist/scenario.js" | tee "$scenario_root/result.log"

mapfile -t observed < "$scenario_root/result.log"
test "${#observed[@]}" -eq 6
test "${observed[0]}" = 'STARTED=arch011-runner,ws'
test "${observed[1]}" = 'RUNNER=arch011-runner:succeeded:0'
test "${observed[2]}" = 'ABANDONED=arch011-runner:stopped'
test "${observed[3]}" = 'FAILURE=NONE'
test "${observed[4]}" = 'WS_READY=true'
test "${observed[5]}" = 'STOP=TWICE'

completed_root="$scenario_root"
cleanup
trap - EXIT
test ! -e "$completed_root"
printf 'CLEANUP_OK\n'
```

## Expected observable result

- The complete Bash block exits `0` within the stated build, compile, and run bounds.
- Package-build output is setup output and is not part of the user observable.
- The isolated Node consumer prints exactly:

  ```text
  STARTED=arch011-runner,ws
  RUNNER=arch011-runner:succeeded:0
  ABANDONED=arch011-runner:stopped
  FAILURE=NONE
  WS_READY=true
  STOP=TWICE
  ```

- Bash then proves the disposable consumer directory is absent and prints exactly `CLEANUP_OK`.
- A blocked sibling, wrong typed result/order, missing or failure-producing normal-stop abandonment,
  unexpected failure, unbound WS service, repeated-stop
  error, cast/private import compile failure, timeout, or residual directory makes the block nonzero.

## Cleanup

The `EXIT` trap removes only a basename-validated `robota-arch011.*` temporary directory. The success
path explicitly removes it, disables the trap only afterward, proves absence, and emits the cleanup
marker. No tracked repository file is created or modified.

## Observed evidence

On 2026-08-14, after the final Round A review converged at `ACTIONABLE FINDINGS: 0`, the guardian
independently extracted and executed the exact Bash fence from the repository root against the final
registry/settings/WebRTC/scanner implementation. The unified command exited `0`. The isolated public
SDK consumer printed exactly:

```text
STARTED=arch011-runner,ws
RUNNER=arch011-runner:succeeded:0
ABANDONED=arch011-runner:stopped
FAILURE=NONE
WS_READY=true
STOP=TWICE
```

Bash then removed the basename-validated temporary consumer, proved its path absent, and printed
`CLEANUP_OK`. A final `${TMPDIR:-/tmp}/robota-arch011.*` scan returned no residual paths. Package
build output was setup only and was not used as user-execution evidence.
