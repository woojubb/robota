import { visibleMarkdown } from './markdown-visibility.mjs';
import { validateApplicableScenarioSection } from './user-execution-scenario-contract.mjs';

const CONTRACT_START = '<!-- user-execution-plan-contract:v1:start -->';
const CONTRACT_END = '<!-- user-execution-plan-contract:v1:end -->';
const AUTHOR_VERDICT =
  /^\*\*Author verdict:\*\* `SCENARIO DRAFTED: (not-applicable|automatable|manual) \| (0|[1-9]\d*)`$/;
const CONTRACT_KEYS = Object.freeze(['version', 'visibility', 'task', 'spec', 'reason', 'cutover']);
const TASK_KEYS = Object.freeze(['heading', 'authorVerdict', 'reasonLabel']);
const SPEC_KEYS = Object.freeze(['heading', 'notApplicableLine', 'reasonLabel']);
const REASON_KEYS = Object.freeze([
  'normalization',
  'minUnicodeScalars',
  'minLetterNumberTokens',
  'forbiddenPhrases',
]);
const CUTOVER_KEYS = Object.freeze(['introduction', 'taskStrictness', 'specStrictness']);
const FORBIDDEN_PHRASES = Object.freeze([
  'build',
  'typecheck',
  'type check',
  'lint',
  'unit test',
  'unit tests',
  'harness check',
  'harness checks',
  'CI check',
  'CI checks',
  'static inspection',
  'document inspection',
  'backlog inspection',
  'source inspection',
  'rg check',
]);

function failure(error) {
  return { ok: false, error };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exactKeys(value, expected) {
  return JSON.stringify(Object.keys(value ?? {})) === JSON.stringify(expected);
}

export function parseUserExecutionPlanContract(ruleText) {
  const source = String(ruleText ?? '');
  const starts = source.split(CONTRACT_START).length - 1;
  const ends = source.split(CONTRACT_END).length - 1;
  if (starts !== 1 || ends !== 1) {
    return failure(`user-execution PLAN contract markers must occur once, found ${starts}/${ends}`);
  }
  const region = source.slice(
    source.indexOf(CONTRACT_START) + CONTRACT_START.length,
    source.indexOf(CONTRACT_END),
  );
  const fenced = /^\s*```json\s*\n([\s\S]*?)\n```\s*$/.exec(region);
  if (!fenced) return failure('user-execution PLAN contract must contain one json fence');
  let contract;
  try {
    contract = JSON.parse(fenced[1]);
  } catch (error) {
    return failure(`user-execution PLAN contract JSON is invalid: ${error.message}`);
  }
  if (!exactKeys(contract, CONTRACT_KEYS)) {
    return failure(
      'user-execution PLAN contract top-level fields are missing, unknown, or out of order',
    );
  }
  if (contract.version !== 1 || contract.visibility !== 'visibleMarkdown') {
    return failure('user-execution PLAN contract version/visibility is unsupported');
  }
  if (
    !exactKeys(contract.task, TASK_KEYS) ||
    contract.task?.heading !== '## User Execution Test Scenarios' ||
    contract.task?.authorVerdict !==
      '**Author verdict:** `SCENARIO DRAFTED: <outcome> | <count>`' ||
    contract.task?.reasonLabel !== '**Reason:** '
  ) {
    return failure('user-execution PLAN Task grammar is malformed');
  }
  if (
    !exactKeys(contract.spec, SPEC_KEYS) ||
    contract.spec?.heading !== '## User Execution Test Scenarios' ||
    contract.spec?.notApplicableLine !== 'Not applicable.' ||
    contract.spec?.reasonLabel !== '**Reason:** '
  ) {
    return failure('user-execution PLAN spec grammar is malformed');
  }
  if (
    !exactKeys(contract.reason, REASON_KEYS) ||
    contract.reason?.normalization !==
      'visible-text+NFKC+markdown-delimiters-removed+unicode-whitespace-collapsed' ||
    contract.reason?.minUnicodeScalars !== 50 ||
    contract.reason?.minLetterNumberTokens !== 8 ||
    JSON.stringify(contract.reason?.forbiddenPhrases) !== JSON.stringify(FORBIDDEN_PHRASES)
  ) {
    return failure('user-execution PLAN reason contract is malformed');
  }
  if (
    !exactKeys(contract.cutover, CUTOVER_KEYS) ||
    contract.cutover?.introduction !== 'unique-valid-marker-commit-whose-parents-lack-marker' ||
    contract.cutover?.taskStrictness !== 'introduction-is-ancestor-of-checkpoint-commit' ||
    contract.cutover?.specStrictness !==
      'worktree-changed-or-introduction-is-ancestor-of-current-path-blob-commit'
  ) {
    return failure('user-execution PLAN cutover contract is malformed');
  }
  return { ok: true, contract };
}

function visibleSection(text, heading) {
  const lines = visibleMarkdown(text).split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end);
}

function normalizedReason(contract, lines, label, afterIndex) {
  const starts = lines
    .map((line, index) => (line.startsWith(label) ? index : -1))
    .filter((index) => index !== -1);
  if (starts.length !== 1) return failure(`expected exactly one visible ${label} field`);
  if (starts[0] <= afterIndex) return failure(`${label} field must follow its outcome signal`);
  const parts = [lines[starts[0]].slice(label.length)];
  for (let index = starts[0] + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (
      line.trim() === '' ||
      /^#{1,6}\s+/.test(line) ||
      /^\s*(?:[-+*]|\d+[.)])\s+/.test(line) ||
      /^\*\*[^*]+:\*\*/.test(line)
    ) {
      break;
    }
    parts.push(line);
  }
  const normalized = parts
    .join(' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
  const scalars = Array.from(normalized).length;
  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (
    scalars < contract.reason.minUnicodeScalars ||
    tokens.length < contract.reason.minLetterNumberTokens
  ) {
    return failure(
      `Reason is thin: ${scalars} Unicode scalar(s), ${tokens.length} letter/number token(s)`,
    );
  }
  const lower = normalized.toLocaleLowerCase('en-US');
  for (const phrase of contract.reason.forbiddenPhrases) {
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegExp(String(phrase).toLocaleLowerCase('en-US'))}($|[^\\p{L}\\p{N}])`,
      'u',
    );
    if (pattern.test(lower))
      return failure(`Reason cites forbidden engineering evidence: ${phrase}`);
  }
  return { ok: true, reason: normalized };
}

export function validateTaskUserExecutionPlan(contract, taskText) {
  const lines = visibleSection(taskText, contract.task.heading);
  if (lines === null) return failure(`missing ${contract.task.heading} section`);
  const signals = lines
    .map((line, index) => ({ match: AUTHOR_VERDICT.exec(line), index }))
    .filter((entry) => entry.match !== null);
  if (signals.length !== 1) return failure('Task must carry exactly one visible author verdict');
  const outcome = signals[0].match[1];
  const count = Number(signals[0].match[2]);
  if (outcome !== 'not-applicable') return { ok: true, outcome, count };
  if (count !== 0) return failure('not-applicable author verdict requires count zero');
  const reason = normalizedReason(contract, lines, contract.task.reasonLabel, signals[0].index);
  return reason.ok ? { ok: true, outcome, count, reason: reason.reason } : reason;
}

export function validateSpecUserExecutionPlan(contract, specText) {
  const lines = visibleSection(specText, contract.spec.heading);
  if (lines === null) return failure(`missing ${contract.spec.heading} section`);
  const notApplicable = lines
    .map((line, index) => ({ line, index }))
    .filter((entry) => entry.line.trim() === contract.spec.notApplicableLine);
  if (notApplicable.length === 1) {
    const reason = normalizedReason(
      contract,
      lines,
      contract.spec.reasonLabel,
      notApplicable[0].index,
    );
    return reason.ok ? { ok: true, outcome: 'not-applicable', reason: reason.reason } : reason;
  }
  if (notApplicable.length > 1) {
    return failure(`expected at most one visible ${contract.spec.notApplicableLine} signal`);
  }
  if (lines.some((line) => /\b(?:N\/A|not applicable)\b/i.test(line))) {
    return failure(
      `not-applicable spec outcome must use exact line ${contract.spec.notApplicableLine}`,
    );
  }
  const applicable = validateApplicableScenarioSection(lines.join('\n'));
  return applicable.ok
    ? { ok: true, outcome: 'applicable', count: applicable.scenarios.length }
    : failure(applicable.error);
}

export const USER_EXECUTION_PLAN_CONTRACT_MARKERS = Object.freeze({
  start: CONTRACT_START,
  end: CONTRACT_END,
});
