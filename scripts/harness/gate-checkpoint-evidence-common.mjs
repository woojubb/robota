import { spawnSync } from 'node:child_process';

import {
  checkpointDelivery,
  parseCheckpointEvidenceContracts,
} from './checkpoint-evidence-contract.mjs';
import { envWithoutGitVars } from './shared.mjs';
import {
  parseUserExecutionPlanContract,
  validateTaskUserExecutionPlan,
} from './user-execution-plan-contract.mjs';

export function checkpointGit(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: envWithoutGitVars(),
  });
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function checkpointWorktreePaths(root) {
  const status = checkpointGit(root, ['status', '--porcelain', '--untracked-files=all']);
  if (!status.ok) throw new Error(`checkpoint worktree query failed: ${status.stderr.trim()}`);
  return status.stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => line.slice(3).split(' -> ').pop().trim().replace(/^"|"$/g, ''))
    .sort();
}

export function v2CheckpointContract(ruleText) {
  const parsed = parseCheckpointEvidenceContracts(ruleText);
  if (!parsed.ok) throw new Error(`GATE-IMPLEMENT evidence contract unreadable: ${parsed.error}`);
  const contract = parsed.contracts.get(2);
  if (!contract) throw new Error('GATE-IMPLEMENT evidence contract v2 is unavailable');
  return contract;
}

export function checkpointPlanSignal(ruleText, taskText) {
  const parsed = parseUserExecutionPlanContract(ruleText);
  if (!parsed.ok) throw new Error(`GATE-IMPLEMENT PLAN contract unreadable: ${parsed.error}`);
  const signal = validateTaskUserExecutionPlan(parsed.contract, taskText);
  if (!signal.ok) throw new Error(`GATE-IMPLEMENT PLAN signal is invalid: ${signal.error}`);
  return { outcome: signal.outcome, count: signal.count };
}

export function checkpointDeliveryDeclaration(contract, specText) {
  const result = checkpointDelivery(contract, specText);
  if (!result.ok) throw new Error(`GATE-IMPLEMENT delivery declaration invalid: ${result.error}`);
  return result;
}
