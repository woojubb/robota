import { readFileSync } from 'node:fs';
import path from 'node:path';

import { asScalar, frontmatterObject, parseFrontmatterEntryLine } from './frontmatter.mjs';
import {
  parseUserExecutionPlanContract,
  validateTaskUserExecutionPlan,
} from './user-execution-plan-contract.mjs';

export function resolveContinuationGate(options, requested, lane) {
  if (!options.continuation && !options.correction) return null;
  if (options.continuation && options.correction) {
    throw new Error('--continuation and --correction are mutually exclusive');
  }
  if (requested !== 'GATE-IMPLEMENT' || lane !== 'L2') {
    throw new Error(
      `${options.correction ? '--correction' : '--continuation'} is supported only for L2 GATE-IMPLEMENT`,
    );
  }
  const correction = Boolean(options.correction);
  return {
    name: requested,
    composes: [requested],
    select: {},
    upgrade: [
      'in-progress',
      correction ? 'in-progress (correction)' : 'in-progress (continuation)',
    ],
    prior: undefined,
    priorKey: correction ? 'GATE-IMPLEMENT (correction)' : 'GATE-IMPLEMENT (continuation)',
    continuation: !correction,
    correction,
    lane,
  };
}

export function validateNotApplicablePlan(ruleText, taskText) {
  const parsed = parseUserExecutionPlanContract(ruleText);
  if (!parsed.ok) return { ok: false, error: `contract is unreadable: ${parsed.error}` };
  const validated = validateTaskUserExecutionPlan(parsed.contract, taskText);
  return validated.ok
    ? { ok: true }
    : { ok: false, error: `reason is invalid: ${validated.error}` };
}

export function rewriteFrontmatterStatus(text, next) {
  const source = String(text);
  const lines = source.split('\n');
  const end = lines.indexOf('---', 1);
  if (lines[0] !== '---' || end === -1) {
    throw new Error('document has no leading frontmatter block');
  }

  for (let index = 1; index < end; index += 1) {
    if (parseFrontmatterEntryLine(lines[index])?.key !== 'status') continue;
    lines[index] = `status: ${next}`;
    return lines.join('\n');
  }

  throw new Error('frontmatter has no status field');
}

export function readTaskRecordText(taskPath) {
  try {
    return readFileSync(taskPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function prepareTaskActivation(root, taskRel) {
  const taskPath = path.resolve(root, taskRel);
  const taskText = readTaskRecordText(taskPath);
  if (taskText === null) {
    throw new Error(`refused: GATE-IMPLEMENT paired Task ${taskRel} is not on disk`);
  }
  const status = asScalar(frontmatterObject(taskText).status ?? '');
  if (status !== 'todo') {
    throw new Error(
      `refused: GATE-IMPLEMENT paired Task is \`status: ${status || '(absent)'}\`, \`todo\` required before atomic activation`,
    );
  }
  return { path: taskPath, text: rewriteFrontmatterStatus(taskText, 'in-progress') };
}
