export const CORRECTION_FORM_MARKER = '<!-- checkpoint-evidence-correction-form:v1 -->';

export function correctionFormMarkerState(ruleText) {
  const count = String(ruleText).split(CORRECTION_FORM_MARKER).length - 1;
  return count > 1
    ? {
        count,
        error: `checkpoint evidence correction-form marker must occur at most once, found ${count}`,
      }
    : { count, error: null };
}

export function validateV2GateImplementDelivery(formName, payload, validateStringArray) {
  if (!['single', 'sequenced'].includes(payload.deliveryMode)) {
    return `${formName}.deliveryMode must be single or sequenced`;
  }
  const artifactsError = validateStringArray(payload.sequencedArtifacts, 'sequencedArtifacts', {
    allowEmpty: true,
  });
  if (artifactsError) return artifactsError;
  if (payload.deliveryMode === 'single' && payload.sequencedArtifacts.length !== 0) {
    return `${formName} single delivery requires an empty sequencedArtifacts array`;
  }
  if (payload.deliveryMode === 'sequenced' && payload.sequencedArtifacts.length === 0) {
    return `${formName} sequenced delivery requires a non-empty sequencedArtifacts array`;
  }
  if (
    ['gateImplementContinuation', 'gateImplementCorrection'].includes(formName) &&
    payload.deliveryMode !== 'sequenced'
  ) {
    return `${formName} requires sequenced delivery`;
  }
  return null;
}

export function validateV2GateImplementIdentity(formName, payload, validateStringArray) {
  if (['gateImplementContinuation', 'gateImplementCorrection'].includes(formName)) {
    if (!/^sha256:[0-9a-f]{64}$/.test(payload.priorPass)) {
      return `${formName}.priorPass must be sha256 lowercase hex`;
    }
    const artifactsError = validateStringArray(payload.sequencedArtifacts, 'sequencedArtifacts');
    if (artifactsError) return artifactsError;
  }
  if (formName === 'gateImplementContinuation' && !/^[0-9a-f]{40}$/.test(payload.ancestorSha)) {
    return 'gateImplementContinuation.ancestorSha must be a full lowercase commit SHA';
  }
  if (
    formName === 'gateImplementCorrection' &&
    !/^[0-9a-f]{40}$/.test(payload.firstPassIntroductionSha)
  ) {
    return 'gateImplementCorrection.firstPassIntroductionSha must be a full lowercase commit SHA';
  }
  return null;
}
