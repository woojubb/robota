import {
  checkpointDelivery,
  continuationArtifacts,
  parseCheckpointEvidence,
} from './checkpoint-evidence-contract.mjs';

export function correctionEntryError({
  entries,
  index,
  parsed,
  parsedContracts,
  contract,
  introductionSpecs,
  introductionShas,
  isCurrentIntroduction,
  spec,
}) {
  if (!Array.isArray(introductionSpecs) || !Array.isArray(introductionShas)) {
    return 'gateImplementCorrection validation requires immutable introduction spec and commit context';
  }
  const legacyContract = parsedContracts.contracts.get(1);
  const firstParsed = legacyContract
    ? parseCheckpointEvidence(legacyContract, 'gateImplementFirst', entries[0] ?? '')
    : { ok: false };
  if (index !== 1 || !firstParsed.ok) {
    return 'gateImplementCorrection requires exactly one preceding legacy v1 first PASS and no prior correction or continuation';
  }
  const firstIntroductionSpec = introductionSpecs[0];
  if (firstIntroductionSpec === null) {
    return 'gateImplementCorrection legacy v1 first PASS introduction revision is unavailable';
  }
  if (firstIntroductionSpec !== undefined) {
    const historical = continuationArtifacts(legacyContract, firstIntroductionSpec);
    if (historical.ok) {
      return 'gateImplementCorrection is forbidden because the legacy v1 introduction already declared sequenced artifacts';
    }
  }
  const firstIntroductionSha = introductionShas[0];
  if (firstIntroductionSha === null) {
    return 'gateImplementCorrection legacy v1 first PASS introduction commit is unavailable';
  }
  if (
    firstIntroductionSha !== undefined &&
    parsed.payload.firstPassIntroductionSha !== firstIntroductionSha
  ) {
    return 'gateImplementCorrection.firstPassIntroductionSha does not bind the legacy first PASS introduction commit';
  }
  if (JSON.stringify(parsed.payload.taskItems) !== JSON.stringify(firstParsed.payload.taskItems)) {
    return 'gateImplementCorrection.taskItems do not bind the legacy first PASS';
  }
  const correctionSpec = isCurrentIntroduction ? spec : introductionSpecs[index];
  if (correctionSpec === null)
    return 'gateImplementCorrection introduction revision is unavailable';
  if (correctionSpec !== undefined) {
    const correctionDelivery = checkpointDelivery(contract, correctionSpec);
    if (!correctionDelivery.ok) return correctionDelivery.error;
    if (
      correctionDelivery.deliveryMode !== 'sequenced' ||
      JSON.stringify(parsed.payload.sequencedArtifacts) !==
        JSON.stringify(correctionDelivery.artifacts)
    ) {
      return 'gateImplementCorrection delivery does not bind its introduction-revision Decision contract';
    }
  }
  return null;
}

export function continuationEntryError({
  entries,
  index,
  parsed,
  parsedContracts,
  contract,
  entryForm,
  isCurrentIntroduction,
  baseSpec,
  spec,
  ancestorSha,
}) {
  const correctionBody = entries.slice(0, index).find((entry) => entryForm(entry) === 'correction');
  if (correctionBody !== undefined) {
    const correctionContract = parsedContracts.contracts.get(2);
    const correction = correctionContract
      ? parseCheckpointEvidence(correctionContract, 'gateImplementCorrection', correctionBody)
      : { ok: false };
    if (!correction.ok) return 'gateImplementContinuation correction delivery anchor is invalid';
    if (
      parsed.payload.deliveryMode !== correction.payload.deliveryMode ||
      JSON.stringify(parsed.payload.sequencedArtifacts) !==
        JSON.stringify(correction.payload.sequencedArtifacts)
    ) {
      return 'gateImplementContinuation delivery does not bind the canonical correction delivery array';
    }
  }
  if (isCurrentIntroduction) {
    const artifacts = continuationArtifacts(contract, baseSpec ?? spec);
    if (!artifacts.ok) return artifacts.error;
    if (JSON.stringify(parsed.payload.sequencedArtifacts) !== JSON.stringify(artifacts.artifacts)) {
      return 'gateImplementContinuation.sequencedArtifacts do not bind the base parentSpec Decision line';
    }
  }
  if (isCurrentIntroduction && ancestorSha === null) {
    return 'gateImplementContinuation.ancestorSha has no preceding integration commit that introduced the sequenced checkpoint';
  }
  if (isCurrentIntroduction && ancestorSha !== null && parsed.payload.ancestorSha !== ancestorSha) {
    return 'gateImplementContinuation.ancestorSha does not bind the preceding integration commit that introduced the sequenced checkpoint';
  }
  return null;
}
