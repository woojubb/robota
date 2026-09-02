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
} from './checkpoint-evidence-git-contract.mjs';
import {
  checkpointDeliveryDeclaration,
  checkpointPlanSignal,
  checkpointWorktreePaths,
  v2CheckpointContract,
} from './gate-checkpoint-evidence-common.mjs';
import { asScalar, frontmatterObject } from './frontmatter.mjs';
import { gateImplementEntryResults } from './scan-user-execution-plan-order.mjs';

export function correctionCheckpointEvidence({
  root,
  ruleText,
  specText,
  taskText,
  taskRel,
  specRel,
}) {
  const taskStatus = asScalar(frontmatterObject(taskText).status ?? '');
  if (taskStatus !== 'in-progress') {
    throw new Error(
      `GATE-IMPLEMENT correction paired Task is \`status: ${taskStatus || '(absent)'}\`, \`in-progress\` required`,
    );
  }
  const contract = v2CheckpointContract(ruleText);
  const declaredDelivery = checkpointDeliveryDeclaration(contract, specText);
  if (declaredDelivery.deliveryMode !== 'sequenced') {
    throw new Error('GATE-IMPLEMENT correction requires `Delivery mode: sequenced`');
  }
  const signal = checkpointPlanSignal(ruleText, taskText);
  const basename = taskRel.split('/').at(-1);
  const history = checkpointHistoryBindings(root, 'HEAD', 'HEAD', basename);
  const results = gateImplementEntryResults(specText, { basename, signal }, ruleText, {
    baseSpec: specText,
    introductionSpecs: history.introductionSpecs,
    introductionShas: history.introductionShas,
  });
  if (results.length !== 1 || !results[0].ok) {
    throw new Error(
      `GATE-IMPLEMENT correction requires exactly one valid prior PASS: ${results.find((result) => !result.ok)?.error ?? `found ${results.length}`}`,
    );
  }
  if (results[0].payload.form !== 'gateImplementFirst' || results[0].payload.version !== 1) {
    throw new Error('GATE-IMPLEMENT correction requires a legacy v1 first PASS');
  }
  const introduced = checkpointIntroductionSpec(root, 'HEAD', basename, results[0].body);
  if (introduced === null) {
    throw new Error(
      'GATE-IMPLEMENT correction cannot resolve the legacy v1 first PASS introduction revision',
    );
  }
  const parsedContracts = parseCheckpointEvidenceContracts(ruleText);
  const legacyContract = parsedContracts.ok ? parsedContracts.contracts.get(1) : undefined;
  if (!legacyContract)
    throw new Error('GATE-IMPLEMENT correction legacy v1 contract is unavailable');
  const historicalArtifacts = continuationArtifacts(legacyContract, introduced.specText);
  if (historicalArtifacts.ok) {
    throw new Error(
      'GATE-IMPLEMENT correction is forbidden because the legacy v1 introduction already declared sequenced artifacts',
    );
  }
  const selected = taskItemsForCheckpoint(specText, taskText);
  if (!selected.ok) {
    throw new Error(`GATE-IMPLEMENT correction Task binding is invalid: ${selected.error}`);
  }
  if (JSON.stringify(results[0].payload.taskItems) !== JSON.stringify(selected.items)) {
    throw new Error('GATE-IMPLEMENT correction prior first PASS does not bind current Task items');
  }
  const worktreePaths = [...new Set([taskRel, specRel, ...checkpointWorktreePaths(root)])].sort();
  const payload = {
    version: contract.version,
    form: 'gateImplementCorrection',
    deliveryMode: declaredDelivery.deliveryMode,
    sequencedArtifacts: declaredDelivery.artifacts,
    priorPass: priorPassDigest(results[0].body),
    firstPassIntroductionSha: introduced.commit,
    taskPath: taskRel,
    specPath: specRel,
    taskItems: selected.items,
    plan: signal,
    worktreePaths,
  };
  const rendered = formatCheckpointEvidence(contract, 'gateImplementCorrection', payload);
  if (!rendered.ok) throw new Error(`GATE-IMPLEMENT evidence payload invalid: ${rendered.error}`);
  return rendered.text.split('\n');
}
