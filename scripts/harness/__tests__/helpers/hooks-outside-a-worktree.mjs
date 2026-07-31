import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../../../..');

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
export function hooksOutsideAWorktree(scratch) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hooks-main-clone-'));
  scratch?.push(dir);
  const hooks = path.join(dir, 'hooks');
  cpSync(path.join(WORKSPACE_ROOT, '.claude/hooks'), hooks, { recursive: true });
  return hooks;
}

export function removeHooksCopy(dir) {
  rmSync(path.dirname(dir), { recursive: true, force: true });
}
