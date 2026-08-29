import { createHash } from 'node:crypto';

import { visibleMarkdown } from './markdown-visibility.mjs';

const CONTRACT_START = '<!-- checkpoint-evidence-contract:v1:start -->';
const CONTRACT_END = '<!-- checkpoint-evidence-contract:v1:end -->';

const CONTRACT_SHAPE = Object.freeze({
  entryEncoding: {
    startMarker: '<!-- checkpoint-evidence:v1:start -->',
    fence: 'json',
    endMarker: '<!-- checkpoint-evidence:v1:end -->',
    multiplicity: 'exactly-one',
  },
  priorPassDigest: {
    algorithm: 'sha256',
    encoding: 'lowercase-hex',
    source: 'prior-complete-gate-implement-entry-raw-utf8',
  },
  decisionArtifacts: {
    section: 'Architecture Review/Decision',
    linePrefix: '**Continuation artifacts:** ',
    separator: ', ',
    token: 'markdown-code-repository-path',
    multiplicity: 'exactly-one',
  },
  actionMapping: {
    'automatable:robota-cli': 'command',
    'automatable:robota-tui': 'command',
    'automatable:robota-browser-ui': 'browserSteps',
    'automatable:public-sdk-example': 'command',
    'manual:robota-tui': 'uiSteps',
    'manual:robota-browser-ui': 'uiSteps',
  },
  forms: {
    gateImplementFirst: {
      heading: 'GATE-IMPLEMENT',
      statusUpgrade: 'approved → in-progress',
      specFolder: 'todo',
      payloadKeys: [
        'version',
        'form',
        'taskPath',
        'specPath',
        'taskItems',
        'plan',
        'worktreePaths',
      ],
    },
    gateImplementContinuation: {
      heading: 'GATE-IMPLEMENT',
      statusUpgrade: 'in-progress → in-progress (continuation)',
      specFolder: 'active',
      payloadKeys: [
        'version',
        'form',
        'priorPass',
        'sequencedArtifacts',
        'ancestorSha',
        'taskPath',
        'specPath',
        'plan',
        'worktreePaths',
      ],
    },
    doneGateStageOne: {
      heading: 'DONE-GATE-STAGE-1',
      statusUpgrade: 'scenario drafted → scenario written',
      payloadKeys: ['version', 'form', 'outcome', 'scenarios'],
      scenarioKeys: [
        'name',
        'surface',
        'surfaceRationale',
        'invocation',
        'observableType',
        'observable',
        'observableRationale',
        'guardianObservableVerdict',
        'executability',
        'prerequisite',
        'action',
        'expectedObservable',
        'cleanup',
        'evidence',
      ],
      conditionalScenarioKeys: [
        'productStatePath',
        'barrier',
        'unavailableCapability',
        'attemptedAutomation',
        'uiSteps',
      ],
    },
  },
});

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
    if (value[key] !== expectedValue) return `${member}.${key} must be ${expectedValue}`;
  }
  return null;
}

function validateContractShape(contract) {
  const entryError = exactDeclaredObject(
    contract.entryEncoding,
    CONTRACT_SHAPE.entryEncoding,
    'entryEncoding',
  );
  if (entryError) return entryError;
  const digestError = exactDeclaredObject(
    contract.priorPassDigest,
    CONTRACT_SHAPE.priorPassDigest,
    'priorPassDigest',
  );
  if (digestError) return digestError;
  const artifactError = exactDeclaredObject(
    contract.decisionArtifacts,
    CONTRACT_SHAPE.decisionArtifacts,
    'decisionArtifacts',
  );
  if (artifactError) return artifactError;
  const mappingError = exactDeclaredObject(
    contract.actionMapping,
    CONTRACT_SHAPE.actionMapping,
    'actionMapping',
  );
  if (mappingError) return mappingError;

  const formsError = exactKeys(contract.forms, Object.keys(CONTRACT_SHAPE.forms), 'forms');
  if (formsError) return formsError;
  for (const [formName, expected] of Object.entries(CONTRACT_SHAPE.forms)) {
    const form = contract.forms[formName];
    const formKeysError = exactKeys(form, Object.keys(expected), `forms.${formName}`);
    if (formKeysError) return formKeysError;
    for (const [key, expectedValue] of Object.entries(expected)) {
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

function levelTwoSectionLines(text, headingPattern) {
  const source = String(text).split('\n');
  let fenced = false;
  let start = -1;
  for (let index = 0; index < source.length; index += 1) {
    const line = source[index];
    if (/^\s*```/.test(line)) fenced = !fenced;
    if (fenced) continue;
    if (start === -1) {
      if (/^##\s+/.test(line) && headingPattern.test(line.replace(/^##\s+/, '').trim())) {
        start = index;
      }
      continue;
    }
    if (/^##\s+/.test(line)) return source.slice(start + 1, index);
  }
  return start === -1 ? null : source.slice(start + 1);
}

export function checkpointCheckboxItems(lines) {
  const items = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)[-*]\s+\[([ xX])\]\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const indent = match[1].length;
    const parts = [match[3]];
    let next = index + 1;
    for (; next < lines.length; next += 1) {
      const line = lines[next];
      if (line.trim() === '') break;
      const lead = /^(\s*)/.exec(line)[1].length;
      if (lead <= indent) break;
      parts.push(line.trim());
    }
    items.push({ checked: match[2] !== ' ', text: parts.join(' ').trim(), line: index, indent });
    index = next - 1;
  }
  return items;
}

export function checkpointCompletionCriteria(text) {
  const section = levelTwoSectionLines(text, /^Completion Criteria$/i);
  return section === null
    ? null
    : checkpointCheckboxItems(section).filter((item) => item.indent === 0);
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

export function taskItemsForCheckpoint(specText, taskText) {
  const criterionItems = checkpointCompletionCriteria(specText) ?? [];
  const criteria = criterionItems
    .map((item) => /^(TC-\d{2,}):/.exec(item.text)?.[1] ?? null)
    .filter(Boolean);
  if (criteria.every((id) => String(taskText).includes(id))) {
    return {
      ok: true,
      items: criteria.map((value) => ({ kind: 'tc-id', value })),
    };
  }
  const checkboxes = checkpointCheckboxItems(String(taskText).split('\n')).map((item) => item.text);
  if (checkboxes.length < criterionItems.length) {
    return failure(
      `Task names ${criteria.filter((id) => String(taskText).includes(id)).length}/${criteria.length} TC ids and carries ${checkboxes.length} checkbox task(s)`,
    );
  }
  return {
    ok: true,
    items: checkboxes.map((value) => ({ kind: 'checkbox', value })),
  };
}

export function parseCheckpointEvidenceContract(ruleText) {
  const source = String(ruleText);
  const starts = source.split(CONTRACT_START).length - 1;
  const ends = source.split(CONTRACT_END).length - 1;
  if (starts !== 1 || ends !== 1) {
    return failure(
      `checkpoint evidence contract markers: expected exactly one start/end pair, found ${starts}/${ends}`,
    );
  }
  const region = source.slice(
    source.indexOf(CONTRACT_START) + CONTRACT_START.length,
    source.indexOf(CONTRACT_END),
  );
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
  if (contract?.version !== 1) {
    return failure(`checkpoint evidence contract version must be integer 1`);
  }
  const topLevelError = exactKeys(
    contract,
    ['version', 'entryEncoding', 'priorPassDigest', 'decisionArtifacts', 'actionMapping', 'forms'],
    'contract',
  );
  if (topLevelError) return failure(topLevelError);
  const shapeError = validateContractShape(contract);
  if (shapeError) return failure(shapeError);
  return { ok: true, contract };
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

function projectedHeading(line) {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
  if (!match) return null;
  return {
    level: match[1].length,
    content: (match[2] ?? '').replace(/[ \t]+#+[ \t]*$/, '').trim(),
  };
}

function projectedSection(projection, level, title) {
  const start = projection.lines.findIndex((line) => {
    const heading = projectedHeading(line);
    return heading?.level === level && heading.content === title;
  });
  if (start === -1) return null;
  let end = projection.lines.length;
  for (let index = start + 1; index < projection.lines.length; index += 1) {
    const heading = projectedHeading(projection.lines[index]);
    if (heading && heading.level <= level) {
      end = index;
      break;
    }
  }
  return { start, end };
}

export function rawGateImplementPassEntries(specText) {
  const projection = visibleMarkdown(specText, true);
  const section = projectedSection(projection, 2, 'Evidence Log');
  if (section === null) return [];
  const entries = [];
  for (let index = section.start + 1; index < section.end; index += 1) {
    const heading = projectedHeading(projection.lines[index]);
    if (
      heading?.level !== 3 ||
      !/^\[GATE-IMPLEMENT\] — ✅ PASS \| \d{4}-\d{2}-\d{2}$/.test(heading.content)
    ) {
      continue;
    }
    let end = section.end;
    for (let cursor = index + 1; cursor < section.end; cursor += 1) {
      const next = projectedHeading(projection.lines[cursor]);
      if (next && next.level <= 3) {
        end = cursor;
        break;
      }
    }
    const rawStart = projection.lineStarts[projection.rawIndices[index]];
    const rawEnd =
      end === projection.lines.length
        ? projection.source.length
        : projection.lineStarts[projection.rawIndices[end]];
    entries.push(projection.source.slice(rawStart, rawEnd));
  }
  return entries;
}

export function priorPassDigest(rawEntry) {
  return `sha256:${createHash('sha256').update(String(rawEntry), 'utf8').digest('hex')}`;
}

export function continuationArtifacts(contract, specText) {
  const [parentTitle, childTitle] = contract.decisionArtifacts.section.split('/');
  const projection = visibleMarkdown(specText, true);
  const parent = projectedSection(projection, 2, parentTitle);
  if (parent === null) return failure(`missing ${contract.decisionArtifacts.section} section`);
  const childStart = projection.lines.findIndex((line, index) => {
    if (index <= parent.start || index >= parent.end) return false;
    const heading = projectedHeading(line);
    return heading?.level === 3 && heading.content === childTitle;
  });
  if (childStart === -1) return failure(`missing ${contract.decisionArtifacts.section} section`);
  let childEnd = parent.end;
  for (let index = childStart + 1; index < parent.end; index += 1) {
    const heading = projectedHeading(projection.lines[index]);
    if (heading && heading.level <= 3) {
      childEnd = index;
      break;
    }
  }
  const prefix = contract.decisionArtifacts.linePrefix;
  const lines = projection.lines
    .slice(childStart + 1, childEnd)
    .filter((line) => line.startsWith(prefix));
  if (lines.length !== 1) {
    return failure(`Continuation artifacts line must occur exactly once, found ${lines.length}`);
  }
  const encoded = lines[0].slice(prefix.length);
  const tokens = encoded.split(contract.decisionArtifacts.separator);
  if (tokens.length === 0 || tokens.some((token) => !/^`[^`]+`$/.test(token))) {
    return failure('Continuation artifacts must be Markdown code repository paths');
  }
  const paths = tokens.map((token) => token.slice(1, -1));
  const pathsError = validateStringArray(paths, 'Continuation artifacts');
  return pathsError ? failure(pathsError) : { ok: true, artifacts: paths };
}

export const CHECKPOINT_EVIDENCE_CONTRACT_MARKERS = Object.freeze({
  start: CONTRACT_START,
  end: CONTRACT_END,
});
