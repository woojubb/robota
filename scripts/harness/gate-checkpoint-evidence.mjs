import { spawnSync } from 'node:child_process';

import {
  checkpointDelivery,
  continuationArtifacts,
  formatCheckpointEvidence,
  parseCheckpointEvidenceContracts,
  priorPassDigest,
  taskItemsForCheckpoint,
} from './checkpoint-evidence-contract.mjs';
import {
  checkpointIntroductionSpec,
  precedingCheckpointIntegrationCommit,
} from './checkpoint-evidence-git-contract.mjs';
import { gateImplementEntryResults } from './scan-user-execution-plan-order.mjs';
import { envWithoutGitVars } from './shared.mjs';
import {
  parseUserExecutionPlanContract,
  validateTaskUserExecutionPlan,
} from './user-execution-plan-contract.mjs';

function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    env: envWithoutGitVars(),
  });
  return { ok: result.status === 0, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function checkpointWorktreePaths(root) {
  const status = git(root, ['status', '--porcelain', '--untracked-files=all']);
  if (!status.ok) throw new Error(`checkpoint worktree query failed: ${status.stderr.trim()}`);
  return status.stdout
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => line.slice(3).split(' -> ').pop().trim().replace(/^"|"$/g, ''))
    .sort();
}

function v2Contract(ruleText) {
  const parsed = parseCheckpointEvidenceContracts(ruleText);
  if (!parsed.ok) throw new Error(`GATE-IMPLEMENT evidence contract unreadable: ${parsed.error}`);
  const contract = parsed.contracts.get(2);
  if (!contract) throw new Error('GATE-IMPLEMENT evidence contract v2 is unavailable');
  return contract;
}

function planSignal(ruleText, taskText) {
  const parsed = parseUserExecutionPlanContract(ruleText);
  if (!parsed.ok) throw new Error(`GATE-IMPLEMENT PLAN contract unreadable: ${parsed.error}`);
  const signal = validateTaskUserExecutionPlan(parsed.contract, taskText);
  if (!signal.ok) throw new Error(`GATE-IMPLEMENT PLAN signal is invalid: ${signal.error}`);
  return { outcome: signal.outcome, count: signal.count };
}

function delivery(contract, specText) {
  const result = checkpointDelivery(contract, specText);
  if (!result.ok) throw new Error(`GATE-IMPLEMENT delivery declaration invalid: ${result.error}`);
  return result;
}

function validatedPriorCheckpoint(root, ruleText, specText, taskText, taskRel, declaredDelivery) {
  const signal = planSignal(ruleText, taskText);
  const basename = taskRel.split('/').at(-1);
  const results = gateImplementEntryResults(specText, { basename, signal }, ruleText, {
    baseSpec: specText,
  });
  if (results.length === 0) {
    throw new Error('GATE-IMPLEMENT continuation has no prior raw PASS');
  }
  const invalid = results.find((result) => !result.ok);
  if (invalid) {
    throw new Error(`GATE-IMPLEMENT continuation prior PASS is invalid: ${invalid.error}`);
  }
  if (results[0].payload.form !== 'gateImplementFirst') {
    throw new Error('GATE-IMPLEMENT continuation prior sequence must begin with the first form');
  }
  if (results.slice(1).some((result) => result.payload.form !== 'gateImplementContinuation')) {
    throw new Error(
      'GATE-IMPLEMENT continuation prior sequence may contain only continuation forms',
    );
  }
  const deliveryMismatch = results.find(
    (result) =>
      result.payload.version === 2 &&
      (result.payload.deliveryMode !== declaredDelivery.deliveryMode ||
        JSON.stringify(result.payload.sequencedArtifacts) !==
          JSON.stringify(declaredDelivery.artifacts)),
  );
  if (deliveryMismatch) {
    throw new Error(
      'GATE-IMPLEMENT continuation prior v2 delivery does not bind the current Decision contract',
    );
  }
  if (results[0].payload.version === 1) {
    const introduced = checkpointIntroductionSpec(root, 'HEAD', basename, results[0].body);
    if (introduced === null) {
      throw new Error(
        'GATE-IMPLEMENT continuation cannot resolve the legacy v1 first PASS introduction revision',
      );
    }
    const parsedContracts = parseCheckpointEvidenceContracts(ruleText);
    const legacyContract = parsedContracts.ok ? parsedContracts.contracts.get(1) : undefined;
    if (!legacyContract) {
      throw new Error('GATE-IMPLEMENT continuation legacy v1 contract is unavailable');
    }
    const historicalArtifacts = continuationArtifacts(legacyContract, introduced.specText);
    if (!historicalArtifacts.ok) {
      throw new Error(
        `GATE-IMPLEMENT continuation legacy v1 historical Decision is not sequenced; a corrective checkpoint is required: ${historicalArtifacts.error}`,
      );
    }
    if (
      JSON.stringify(historicalArtifacts.artifacts) !== JSON.stringify(declaredDelivery.artifacts)
    ) {
      throw new Error(
        'GATE-IMPLEMENT continuation legacy v1 historical Decision artifacts do not bind the current Decision contract',
      );
    }
  }
  const selected = taskItemsForCheckpoint(specText, taskText);
  if (!selected.ok) {
    throw new Error(`GATE-IMPLEMENT continuation Task binding is invalid: ${selected.error}`);
  }
  if (JSON.stringify(results[0].payload.taskItems) !== JSON.stringify(selected.items)) {
    throw new Error(
      'GATE-IMPLEMENT continuation prior first PASS does not bind current Task items',
    );
  }
  return results.at(-1).body;
}

export function firstCheckpointEvidence({ root, ruleText, specText, taskText, taskRel, specRel }) {
  const contract = v2Contract(ruleText);
  const declaredDelivery = delivery(contract, specText);
  const taskItems = taskItemsForCheckpoint(specText, taskText);
  if (!taskItems.ok) {
    throw new Error(`GATE-IMPLEMENT task evidence unavailable: ${taskItems.error}`);
  }
  const payload = {
    version: contract.version,
    form: 'gateImplementFirst',
    deliveryMode: declaredDelivery.deliveryMode,
    sequencedArtifacts: declaredDelivery.artifacts,
    taskPath: taskRel,
    specPath: specRel,
    taskItems: taskItems.items,
    plan: planSignal(ruleText, taskText),
    worktreePaths: checkpointWorktreePaths(root),
  };
  const rendered = formatCheckpointEvidence(contract, 'gateImplementFirst', payload);
  if (!rendered.ok) throw new Error(`GATE-IMPLEMENT evidence payload invalid: ${rendered.error}`);
  return rendered.text.split('\n');
}

export function continuationCheckpointEvidence({
  root,
  ruleText,
  specText,
  taskText,
  taskRel,
  specRel,
}) {
  const contract = v2Contract(ruleText);
  const declaredDelivery = delivery(contract, specText);
  if (declaredDelivery.deliveryMode !== 'sequenced') {
    throw new Error('GATE-IMPLEMENT continuation requires `Delivery mode: sequenced`');
  }
  const prior = validatedPriorCheckpoint(
    root,
    ruleText,
    specText,
    taskText,
    taskRel,
    declaredDelivery,
  );
  const ancestorSha = precedingCheckpointIntegrationCommit(root, 'HEAD', specRel.split('/').at(-1));
  if (ancestorSha === null) {
    throw new Error(
      'GATE-IMPLEMENT continuation has no preceding integration commit that introduced its prior PASS',
    );
  }
  const worktreePaths = [...new Set([taskRel, specRel, ...checkpointWorktreePaths(root)])].sort();
  const payload = {
    version: contract.version,
    form: 'gateImplementContinuation',
    deliveryMode: declaredDelivery.deliveryMode,
    sequencedArtifacts: declaredDelivery.artifacts,
    priorPass: priorPassDigest(prior),
    ancestorSha,
    taskPath: taskRel,
    specPath: specRel,
    plan: planSignal(ruleText, taskText),
    worktreePaths,
  };
  const rendered = formatCheckpointEvidence(contract, 'gateImplementContinuation', payload);
  if (!rendered.ok) throw new Error(`GATE-IMPLEMENT evidence payload invalid: ${rendered.error}`);
  return rendered.text.split('\n');
}
