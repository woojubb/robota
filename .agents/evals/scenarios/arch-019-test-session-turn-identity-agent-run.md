# ARCH-019 — published test session mints one identity per submission (agent-run)

This scenario exercises the shipped `@robota-sdk/agent-interface-transport/testing` export from a
disposable external-style consumer. One fresh Node.js process creates one sanctioned test session,
derives its runtime session id, submits twice, and proves the two default handles are exactly
`<session-id>-turn-1` and `<session-id>-turn-2`.

## Executability

`agent-executable` — the flow is non-interactive Bash over the built public testing subpath. It uses
no provider, credential, network service, test runner, private source import, or repository-internal
factory path.

## Prerequisites

- Run from the repository root with workspace dependencies installed.
- Bash, Node.js 22+, pnpm, GNU coreutils `timeout`, `mktemp`, and permission to create a local symbolic
  link must be available.
- `packages/agent-interface-transport` must be buildable; the exact command below builds it before
  executing the consumer.
- The system temporary directory (`${TMPDIR:-/tmp}`) must be writable.
- No model-provider key or network access is required.

The existing `scratch/` workspace is intentionally not used: it does not directly declare the
interface-transport package, and its source-condition runner would not prove the built public export.
The command creates and removes its own isolated consumer.

## Exact command

```bash
set -euo pipefail

repo_root="$(pwd -P)"
scenario_root="$(mktemp -d "${TMPDIR:-/tmp}/robota-arch019.XXXXXX")"

cleanup() {
  case "$(basename -- "$scenario_root")" in
    robota-arch019.*)
      node -e "require('node:fs').rmSync(process.argv[1], { recursive: true, force: true })" \
        "$scenario_root"
      ;;
    *) printf 'refusing unexpected cleanup path: %s\n' "$scenario_root" >&2; return 1 ;;
  esac
}
trap cleanup EXIT

timeout 120s pnpm --filter @robota-sdk/agent-interface-transport build

mkdir -p "$scenario_root/node_modules/@robota-sdk"
ln -s "$repo_root/packages/agent-interface-transport" \
  "$scenario_root/node_modules/@robota-sdk/agent-interface-transport"

tee "$scenario_root/scenario.mjs" >/dev/null <<'JAVASCRIPT'
import assert from 'node:assert/strict';

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-transport/testing';

const session = createTestInteractiveSession();
const sessionId = session.getSession().getSessionId();
const first = await session.submit('first');
const second = await session.submit('second');

assert.equal(first.turnId, `${sessionId}-turn-1`);
assert.equal(second.turnId, `${sessionId}-turn-2`);
assert.notEqual(first.turnId, second.turnId);
await Promise.all([first.completed, second.completed]);

process.stdout.write(`${first.turnId}\n${second.turnId}\nDISTINCT\n`);
JAVASCRIPT

timeout 15s node "$scenario_root/scenario.mjs" | tee "$scenario_root/result.log"

mapfile -t observed < "$scenario_root/result.log"
test "${#observed[@]}" -eq 3
test "${observed[0]}" = 'test-session-1-turn-1'
test "${observed[1]}" = 'test-session-1-turn-2'
test "${observed[2]}" = 'DISTINCT'

completed_root="$scenario_root"
cleanup
trap - EXIT
test ! -e "$completed_root"
printf 'CLEANUP_OK\n'
```

## Expected observable result

- The complete Bash block exits with status `0` within the stated 120-second build and 15-second
  execution bounds.
- In addition to package-build setup output, the one fresh consumer Node.js process prints exactly:

  ```text
  test-session-1-turn-1
  test-session-1-turn-2
  DISTINCT
  ```

- After the consumer output, Bash proves the temporary directory is absent and prints exactly one
  cleanup marker: `CLEANUP_OK`.

- Inside that process, each printed id is derived from the session's own public `getSessionId()`
  value, both `completed` promises settle, and the two ids differ.
- Any reused id, wrong prefix or sequence, unsettled completion, extra output, import failure, build
  failure, or timeout makes the command exit non-zero.

## Cleanup

The explicit cleanup and fallback `EXIT` trap remove only the validated `robota-arch019.*` temporary
consumer directory through Node's filesystem API, including its package symlink, script, and result
log. The command then proves the path no longer exists and prints `CLEANUP_OK`. No tracked repository
file is created or modified.

## Observed evidence

EMPTY
