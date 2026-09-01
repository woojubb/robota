export {
  checkpointCheckboxItems,
  checkpointCompletionCriteria,
  checkpointDelivery,
  continuationArtifacts,
  priorPassDigest,
  rawGateImplementPassEntries,
  taskItemsForCheckpoint,
} from './checkpoint-evidence-source.mjs';

import { CONTRACT_SHAPE, CONTRACT_SHAPE_V2 } from './checkpoint-evidence-contract-shapes.mjs';

const CONTRACT_START = '<!-- checkpoint-evidence-contract:v1:start -->';
const CONTRACT_END = '<!-- checkpoint-evidence-contract:v1:end -->';
const CONTRACT_V2_START = '<!-- checkpoint-evidence-contract:v2:start -->';
const CONTRACT_V2_END = '<!-- checkpoint-evidence-contract:v2:end -->';

function failure(error) {
  return { ok: false, error };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function duplicateJsonMember(source) {
  const objects = [];
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === '{') {
      objects.push(new Set());
      continue;
    }
    if (character === '}') {
      objects.pop();
      continue;
    }
    if (character !== '"') continue;
    const start = index;
    let escaped = false;
    for (index += 1; index < source.length; index += 1) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (source[index] === '\\') {
        escaped = true;
        continue;
      }
      if (source[index] === '"') break;
    }
    let next = index + 1;
    while (/\s/.test(source[next] ?? '')) next += 1;
    if (source[next] !== ':' || objects.length === 0) continue;
    let key;
    try {
      key = JSON.parse(source.slice(start, index + 1));
    } catch (error) {
      return { error: `member key JSON is invalid: ${error.message}` };
    }
    const keys = objects[objects.length - 1];
    if (keys.has(key)) return { duplicate: key };
    keys.add(key);
  }
  return {};
}

function exactKeys(value, expected, member) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return `${member} must be an object`;
  }
  const actual = Object.keys(value);
  const unknown = actual.find((key) => !expected.includes(key));
  if (unknown) return `unknown ${member} field: ${unknown}`;
  const missing = expected.find((key) => !actual.includes(key));
  if (missing) return `missing ${member} field: ${missing}`;
  if (actual.some((key, index) => key !== expected[index])) {
    return `${member} fields are out of declared order`;
  }
  return null;
}

function exactStringArray(value, expected, member) {
  if (!Array.isArray(value)) return `${member} must be an array`;
  if (new Set(value).size !== value.length) return `${member} contains a duplicate member`;
  const mismatch = expected.findIndex((entry, index) => value[index] !== entry);
  if (value.length !== expected.length || mismatch !== -1) {
    const index = mismatch === -1 ? Math.min(value.length, expected.length) : mismatch;
    return `${member}[${index}] must be ${expected[index] ?? '(no member)'}`;
  }
  return null;
}

function exactDeclaredObject(value, expected, member) {
  const keysError = exactKeys(value, Object.keys(expected), member);
  if (keysError) return keysError;
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (expectedValue !== null && typeof expectedValue === 'object') {
      const nested = exactDeclaredObject(value[key], expectedValue, `${member}.${key}`);
      if (nested) return nested;
    } else if (value[key] !== expectedValue) {
      return `${member}.${key} must be ${expectedValue}`;
    }
  }
  return null;
}

function validateContractShape(contract, expected = CONTRACT_SHAPE) {
  const entryError = exactDeclaredObject(
    contract.entryEncoding,
    expected.entryEncoding,
    'entryEncoding',
  );
  if (entryError) return entryError;
  const digestError = exactDeclaredObject(
    contract.priorPassDigest,
    expected.priorPassDigest,
    'priorPassDigest',
  );
  if (digestError) return digestError;
  const artifactError = exactDeclaredObject(
    contract.decisionArtifacts,
    expected.decisionArtifacts,
    'decisionArtifacts',
  );
  if (artifactError) return artifactError;
  if (expected.decisionDelivery) {
    const deliveryError = exactDeclaredObject(
      contract.decisionDelivery,
      expected.decisionDelivery,
      'decisionDelivery',
    );
    if (deliveryError) return deliveryError;
  }
  if (expected.actionMapping) {
    const mappingError = exactDeclaredObject(
      contract.actionMapping,
      expected.actionMapping,
      'actionMapping',
    );
    if (mappingError) return mappingError;
  }

  const formsError = exactKeys(contract.forms, Object.keys(expected.forms), 'forms');
  if (formsError) return formsError;
  for (const [formName, expectedForm] of Object.entries(expected.forms)) {
    const form = contract.forms[formName];
    const formKeysError = exactKeys(form, Object.keys(expectedForm), `forms.${formName}`);
    if (formKeysError) return formKeysError;
    for (const [key, expectedValue] of Object.entries(expectedForm)) {
      const error = Array.isArray(expectedValue)
        ? exactStringArray(form[key], expectedValue, `forms.${formName}.${key}`)
        : form[key] === expectedValue
          ? null
          : `forms.${formName}.${key} must be ${expectedValue}`;
      if (error) return error;
    }
  }
  return null;
}

function isRepositoryPath(value) {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.startsWith('/') ||
    value.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return false;
  }
  const segments = value.split('/');
  return segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

function validateStringArray(values, member, { sorted = false, allowEmpty = false } = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
    return `${member} must be ${allowEmpty ? 'an' : 'a non-empty'} array`;
  }
  if (values.some((value) => !isRepositoryPath(value))) {
    return `${member} contains an invalid repository path`;
  }
  if (new Set(values).size !== values.length) return `${member} contains a duplicate path`;
  if (sorted && values.some((value, index) => value !== [...values].sort()[index])) {
    return `${member} must be sorted`;
  }
  return null;
}

function validateTaskItems(items) {
  if (!Array.isArray(items)) return 'taskItems must be an array';
  const values = [];
  for (const [index, item] of items.entries()) {
    const keysError = exactKeys(item, ['kind', 'value'], `taskItems[${index}]`);
    if (keysError) return keysError;
    if (!['tc-id', 'checkbox'].includes(item.kind)) {
      return `taskItems[${index}].kind is unsupported`;
    }
    if (typeof item.value !== 'string' || item.value.trim() === '') {
      return `taskItems[${index}].value must be a non-empty string`;
    }
    values.push(`${item.kind}:${item.value}`);
  }
  if (new Set(values).size !== values.length) return 'taskItems contains a duplicate value';
  return null;
}

function validatePlan(plan) {
  const keysError = exactKeys(plan, ['outcome', 'count'], 'plan');
  if (keysError) return keysError;
  if (!['not-applicable', 'automatable', 'manual'].includes(plan.outcome)) {
    return 'plan.outcome is unsupported';
  }
  if (!Number.isInteger(plan.count) || plan.count < 0) return 'plan.count must be non-negative';
  return null;
}

function validatePayload(contract, formName, payload) {
  const form = contract?.forms?.[formName];
  if (!form) return `unknown checkpoint evidence form: ${formName}`;
  const keysError = exactKeys(payload, form.payloadKeys, `${formName} payload`);
  if (keysError) return keysError;
  if (payload.version !== contract.version)
    return `${formName}.version does not match the contract`;
  if (payload.form !== formName) return `${formName}.form does not match the selected form`;

  if (formName.startsWith('gateImplement')) {
    if (
      !isRepositoryPath(payload.taskPath) ||
      !/^\.agents\/tasks\/[^/]+\.md$/.test(payload.taskPath)
    ) {
      return `${formName}.taskPath is invalid`;
    }
    if (
      !isRepositoryPath(payload.specPath) ||
      !new RegExp(`^\\.agents/spec-docs/${form.specFolder}/[^/]+\\.md$`).test(payload.specPath)
    ) {
      return `${formName}.specPath does not use declared folder ${form.specFolder}`;
    }
    if (payload.taskPath.split('/').at(-1) !== payload.specPath.split('/').at(-1)) {
      return `${formName} Task/spec basenames do not match`;
    }
    const planError = validatePlan(payload.plan);
    if (planError) return planError;
    const pathsError = validateStringArray(payload.worktreePaths, 'worktreePaths', {
      sorted: true,
      allowEmpty: true,
    });
    if (pathsError) return pathsError;
    if (contract.version === 2) {
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
      if (formName === 'gateImplementContinuation' && payload.deliveryMode !== 'sequenced') {
        return 'gateImplementContinuation requires sequenced delivery';
      }
    }
  }
  if (formName === 'gateImplementFirst') {
    const itemsError = validateTaskItems(payload.taskItems);
    if (itemsError) return itemsError;
  }
  if (formName === 'gateImplementContinuation') {
    if (!/^sha256:[0-9a-f]{64}$/.test(payload.priorPass)) {
      return 'gateImplementContinuation.priorPass must be sha256 lowercase hex';
    }
    const artifactsError = validateStringArray(payload.sequencedArtifacts, 'sequencedArtifacts');
    if (artifactsError) return artifactsError;
    if (!/^[0-9a-f]{40}$/.test(payload.ancestorSha)) {
      return 'gateImplementContinuation.ancestorSha must be a full lowercase commit SHA';
    }
  }
  if (formName === 'doneGateStageOne') {
    if (!['automatable', 'manual'].includes(payload.outcome)) {
      return 'doneGateStageOne.outcome is unsupported';
    }
    if (!Array.isArray(payload.scenarios) || payload.scenarios.length === 0) {
      return 'doneGateStageOne.scenarios must be a non-empty array';
    }
    const names = [];
    for (const [index, scenario] of payload.scenarios.entries()) {
      const conditional = [];
      if (scenario?.observableType === 'product-state-file') conditional.push('productStatePath');
      if (payload.outcome === 'manual') {
        conditional.push('barrier', 'unavailableCapability', 'attemptedAutomation');
      }
      if (payload.outcome === 'manual' && scenario?.surface === 'robota-tui') {
        conditional.push('uiSteps');
      }
      const expectedKeys = [...form.scenarioKeys, ...conditional];
      const scenarioError = exactKeys(
        scenario,
        expectedKeys,
        `doneGateStageOne.scenarios[${index}]`,
      );
      if (scenarioError) return scenarioError;
      for (const key of expectedKeys.filter((key) => key !== 'action')) {
        if (typeof scenario[key] !== 'string' || scenario[key].trim() === '') {
          return `doneGateStageOne.scenarios[${index}].${key} must be a non-empty string`;
        }
      }
      if (scenario.guardianObservableVerdict !== 'product-behavior') {
        return `doneGateStageOne.scenarios[${index}].guardianObservableVerdict must be product-behavior`;
      }
      const expectedAction = contract.actionMapping[`${payload.outcome}:${scenario.surface}`];
      if (!expectedAction) {
        return `doneGateStageOne.scenarios[${index}] outcome/surface mapping is unsupported`;
      }
      const actionError = exactKeys(
        scenario.action,
        ['kind', 'value'],
        `doneGateStageOne.scenarios[${index}].action`,
      );
      if (actionError) return actionError;
      if (scenario.action.kind !== expectedAction) {
        return `doneGateStageOne.scenarios[${index}].action.kind must be ${expectedAction}`;
      }
      if (typeof scenario.action.value !== 'string' || scenario.action.value.trim() === '') {
        return `doneGateStageOne.scenarios[${index}].action.value must be a non-empty string`;
      }
      names.push(scenario.name);
    }
    if (new Set(names).size !== names.length)
      return 'doneGateStageOne.scenarios has duplicate names';
  }
  return null;
}

export function parseCheckpointEvidenceContract(ruleText) {
  return parseContractRegion(String(ruleText), {
    version: 1,
    start: CONTRACT_START,
    end: CONTRACT_END,
    shape: CONTRACT_SHAPE,
  });
}

function parseContractRegion(source, { version, start, end, shape }) {
  const starts = source.split(start).length - 1;
  const ends = source.split(end).length - 1;
  if (starts !== 1 || ends !== 1) {
    return failure(
      `checkpoint evidence contract v${version} markers: expected exactly one start/end pair, found ${starts}/${ends}`,
    );
  }
  const region = source.slice(source.indexOf(start) + start.length, source.indexOf(end));
  const fenced = /^\s*```json\s*\n([\s\S]*?)\n```\s*$/.exec(region);
  if (!fenced) return failure('checkpoint evidence contract region must contain one json fence');
  const duplicate = duplicateJsonMember(fenced[1]);
  if (duplicate.error) return failure(`checkpoint evidence contract ${duplicate.error}`);
  if (duplicate.duplicate !== undefined)
    return failure(`duplicate checkpoint evidence contract field: ${duplicate.duplicate}`);
  let contract;
  try {
    contract = JSON.parse(fenced[1]);
  } catch (error) {
    return failure(`checkpoint evidence contract JSON is invalid: ${error.message}`);
  }
  if (contract?.version !== version) {
    return failure(`checkpoint evidence contract version must be integer ${version}`);
  }
  const topLevelKeys = [
    'version',
    'entryEncoding',
    'priorPassDigest',
    'decisionArtifacts',
    ...(shape.decisionDelivery ? ['decisionDelivery'] : []),
    ...(shape.actionMapping ? ['actionMapping'] : []),
    'forms',
  ];
  const topLevelError = exactKeys(contract, topLevelKeys, 'contract');
  if (topLevelError) return failure(topLevelError);
  const shapeError = validateContractShape(contract, shape);
  if (shapeError) return failure(shapeError);
  return { ok: true, contract };
}

export function parseCheckpointEvidenceContracts(ruleText) {
  const source = String(ruleText);
  const known = [
    { version: 1, start: CONTRACT_START, end: CONTRACT_END, shape: CONTRACT_SHAPE },
    { version: 2, start: CONTRACT_V2_START, end: CONTRACT_V2_END, shape: CONTRACT_SHAPE_V2 },
  ];
  const declaredVersions = [
    ...source.matchAll(/<!-- checkpoint-evidence-contract:v(\d+):(start|end) -->/g),
  ].map((match) => Number(match[1]));
  const unknown = declaredVersions.find(
    (version) => !known.some((entry) => entry.version === version),
  );
  if (unknown !== undefined)
    return failure(`unknown checkpoint evidence contract version: ${unknown}`);
  const v1Index = source.indexOf(CONTRACT_START);
  const v2Index = source.indexOf(CONTRACT_V2_START);
  if (v1Index !== -1 && v2Index !== -1 && v1Index > v2Index) {
    return failure('checkpoint evidence contract regions must occur in v1 then v2 order');
  }
  const contracts = new Map();
  for (const entry of known) {
    const parsed = parseContractRegion(source, entry);
    if (!parsed.ok) return parsed;
    contracts.set(entry.version, parsed.contract);
  }
  return { ok: true, contracts };
}

export function formatCheckpointEvidence(contract, formName, payload) {
  const error = validatePayload(contract, formName, payload);
  if (error) return failure(error);
  const encoding = contract.entryEncoding;
  return {
    ok: true,
    text: [
      encoding.startMarker,
      `\`\`\`${encoding.fence}`,
      JSON.stringify(payload, null, 2),
      '```',
      encoding.endMarker,
    ].join('\n'),
  };
}

export function parseCheckpointEvidence(contract, formName, body) {
  const encoding = contract.entryEncoding;
  const source = String(body);
  const starts = source.split(encoding.startMarker).length - 1;
  const ends = source.split(encoding.endMarker).length - 1;
  if (starts !== 1 || ends !== 1) {
    return failure(`${formName} evidence markers must occur exactly once, found ${starts}/${ends}`);
  }
  const region = source.slice(
    source.indexOf(encoding.startMarker) + encoding.startMarker.length,
    source.indexOf(encoding.endMarker),
  );
  const fence = new RegExp(
    '^\\s*```' + escapeRegExp(encoding.fence) + '\\s*\\n([\\s\\S]*?)\\n```\\s*$',
  ).exec(region);
  if (!fence) return failure(`${formName} evidence must contain one ${encoding.fence} fence`);
  const duplicate = duplicateJsonMember(fence[1]);
  if (duplicate.error) return failure(`${formName} payload ${duplicate.error}`);
  if (duplicate.duplicate !== undefined)
    return failure(`duplicate ${formName} payload field: ${duplicate.duplicate}`);
  let payload;
  try {
    payload = JSON.parse(fence[1]);
  } catch (error) {
    return failure(`${formName} payload JSON is invalid: ${error.message}`);
  }
  const error = validatePayload(contract, formName, payload);
  return error ? failure(error) : { ok: true, payload };
}

export const CHECKPOINT_EVIDENCE_CONTRACT_MARKERS = Object.freeze({
  start: CONTRACT_START,
  end: CONTRACT_END,
  v2Start: CONTRACT_V2_START,
  v2End: CONTRACT_V2_END,
});
