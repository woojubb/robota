import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll } from 'vitest';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../../..');

/**
 * Every copy this module has handed out, removed when the file that asked for one finishes.
 *
 * Review of #1567: the first version exported a `removeHooksCopy()` and none of the three call sites
 * called it, so each run left a full copy of `.claude/hooks/` in the temp directory forever —
 * measured, 15 of them accumulated in one session. An exported cleanup nobody invokes is the same
 * defect this repository keeps meeting under a different name (registered, never reached), and
 * threading a `scratch` array through three call sites would have fixed three instances of it while
 * leaving the fourth caller free to forget.
 *
 * So the helper cleans up after itself and there is nothing for a caller to remember. `afterAll`
 * registers against the importing test file, which is exactly the lifetime of the copy handed back.
 *
 * Measured both directions from an empty baseline: with this, the three files leave 0 behind; with
 * the `rmSync` line commented out, 1 survives a single file's run.
 */
const copies = [];
afterAll(() => {
  while (copies.length > 0) rmSync(copies.pop(), { recursive: true, force: true });
});

/**
 * A copy of `.claude/hooks/` at a path that is definitely NOT under `.claude/worktrees/`.
 *
 * `worktree-cwd-guard.sh` decides whether this is a worktree session by reading the directory THE
 * HOOK ITSELF LIVES IN (`SELF_DIR`, and the comment beside it says so deliberately: "the hook file
 * lives under `.claude/worktrees/` exactly when this is a worktree session"). The hook's own path is
 * therefore an INPUT to the decision — and three tests spawned it from whichever checkout the suite
 * happened to be running in, leaving that input uncontrolled.
 *
 * Run from the main clone they passed. Run from a worktree — the configuration
 * `worktree-parallel-orchestration` mandates for parallel work, and the one every subagent uses —
 * `SELF_DIR` contained `/.claude/worktrees/`, so the guard was in worktree mode no matter what the
 * fixture claimed, and all three FAIL-SAFE cases ("an ordinary main-clone session is left alone")
 * failed. Measured 2026-08-01: 3 failed / 1828 passed from a worktree, 1831 passed from the main
 * clone, on identical source.
 *
 * The cost was not only noise. Each parallel agent had to prove the three reds were not its own, and
 * at least one then pushed with `--no-verify` — a gap in local verification teaching agents to
 * bypass the gate that would have caught a real one.
 *
 * The whole directory is copied, not the single file, because hooks source `lib/command-scan.sh`
 * relative to themselves.
 */
export function hooksOutsideAWorktree() {
  const dir = mkdtempSync(path.join(tmpdir(), 'hooks-main-clone-'));
  copies.push(dir);
  const hooks = path.join(dir, 'hooks');
  cpSync(path.join(WORKSPACE_ROOT, '.claude/hooks'), hooks, { recursive: true });
  return hooks;
}
