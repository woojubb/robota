import {
  continuationArtifacts,
  formatCheckpointEvidence,
  parseCheckpointEvidenceContracts,
  priorPassDigest,
  taskItemsForCheckpoint,
} from './checkpoint-evidence-contract.mjs';
import {
  checkpointHistoryBindings,
  checkpointIntroductionSpec,
  precedingCheckpointIntegrationCommit,
} from './checkpoint-evidence-git-contract.mjs';
import {
  checkpointDeliveryDeclaration,
  checkpointGit,
  checkpointPlanSignal,
  checkpointWorktreePaths,
  v2CheckpointContract,
} from './gate-checkpoint-evidence-common.mjs';
import { correctionCheckpointEvidence } from './gate-correction-checkpoint-evidence.mjs';
import { gateImplementEntryResults } from './scan-user-execution-plan-order.mjs';

function validatedPriorCheckpoint(root, ruleText, specText, taskText, taskRel, declaredDelivery) {
  const signal = checkpointPlanSignal(ruleText, taskText);
  const basename = taskRel.split('/').at(-1);
  const history = checkpointHistoryBindings(root, 'HEAD', 'HEAD', basename);
  const results = gateImplementEntryResults(specText, { basename, signal }, ruleText, {
    baseSpec: specText,
    introductionSpecs: history.introductionSpecs,
    introductionShas: history.introductionShas,
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
  const forms = results.slice(1).map((result) => result.payload.form);
  const correctionCount = forms.filter((form) => form === 'gateImplementCorrection').length;
  if (
    correctionCount > 1 ||
    (correctionCount === 1 && forms[0] !== 'gateImplementCorrection') ||
    forms.some(
      (form, index) =>
        form !== 'gateImplementContinuation' &&
        !(form === 'gateImplementCorrection' && index === 0),
    )
  ) {
    throw new Error(
      'GATE-IMPLEMENT continuation prior sequence must be first, optional correction, then continuations',
    );
  }
  if (correctionCount === 1) {
    const correction = checkpointIntroductionSpec(root, 'HEAD', basename, results[1].body);
    if (correction === null) {
      throw new Error(
        'GATE-IMPLEMENT continuation cannot resolve the correction introduction revision',
      );
    }
    const integrationRef = process.env.HARNESS_BASE_REF || 'origin/develop';
    const integrated = checkpointGit(root, [
      'merge-base',
      '--is-ancestor',
      correction.commit,
      integrationRef,
    ]);
    if (!integrated.ok) {
      throw new Error(
        `GATE-IMPLEMENT continuation correction is not yet on integration base ${integrationRef}`,
      );
    }
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
  if (results[0].payload.version === 1 && correctionCount === 0) {
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

export { correctionCheckpointEvidence };

export function firstCheckpointEvidence({ root, ruleText, specText, taskText, taskRel, specRel }) {
  const contract = v2CheckpointContract(ruleText);
  const declaredDelivery = checkpointDeliveryDeclaration(contract, specText);
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
    plan: checkpointPlanSignal(ruleText, taskText),
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
  const contract = v2CheckpointContract(ruleText);
  const declaredDelivery = checkpointDeliveryDeclaration(contract, specText);
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
    plan: checkpointPlanSignal(ruleText, taskText),
    worktreePaths,
  };
  const rendered = formatCheckpointEvidence(contract, 'gateImplementContinuation', payload);
  if (!rendered.ok) throw new Error(`GATE-IMPLEMENT evidence payload invalid: ${rendered.error}`);
  return rendered.text.split('\n');
}

export function checkpointEvidenceForGate(gate, input) {
  if (gate.correction) return correctionCheckpointEvidence(input);
  if (gate.continuation) return continuationCheckpointEvidence(input);
  return firstCheckpointEvidence(input);
}
