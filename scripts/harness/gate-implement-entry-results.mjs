import {
  parseCheckpointEvidence,
  parseCheckpointEvidenceContract,
  parseCheckpointEvidenceContracts,
  priorPassDigest,
} from './checkpoint-evidence-contract.mjs';
import { checkpointDeliveryBindingError } from './checkpoint-evidence-source.mjs';
import {
  continuationEntryError,
  correctionEntryError,
} from './gate-implement-correction-validation.mjs';

const TASK_PREFIX = '.agents/tasks/';
const SPEC_PREFIX = '.agents/spec-docs/';
const LOOP_RUNS_PREFIX = '.agents/loop-runs/';
const POST_MERGE_LEDGER = `${LOOP_RUNS_PREFIX}post-merge-cycle.jsonl`;

export const FIRST_CHECKPOINT_STATUS_LINE = '**Status upgrade:** approved → in-progress';
export const CONTINUATION_STATUS_LINE =
  '**Status upgrade:** in-progress → in-progress (continuation)';
export const CORRECTION_STATUS_LINE = '**Status upgrade:** in-progress → in-progress (correction)';

export function gateImplementEntryForm(body) {
  if (/^\*\*Status upgrade:\*\* approved → in-progress\s*$/m.test(body)) return 'first';
  if (/^\*\*Status upgrade:\*\* in-progress → in-progress \(continuation\)\s*$/m.test(body)) {
    return 'continuation';
  }
  if (/^\*\*Status upgrade:\*\* in-progress → in-progress \(correction\)\s*$/m.test(body)) {
    return 'correction';
  }
  return null;
}

const invalid = (body, error) => ({ ok: false, error, body });
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const exactToken = (text, token) =>
  new RegExp(`(^|[\\s\`])${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[\\s\`])`, 'm').test(
    text,
  );

function completeLegacyGateImplementEntry(body, binding = null) {
  const structurallyComplete =
    gateImplementEntryForm(body) !== null &&
    /\.agents\/tasks\/[A-Z][A-Z0-9]*-\d+[^\s`]*\.md/.test(body) &&
    /SCENARIO DRAFTED:\s*(?:not-applicable|automatable|manual)\s*\|\s*\d+/.test(body) &&
    /whole[-\s]+worktree/i.test(body);
  if (!structurallyComplete || binding === null) return structurallyComplete;
  const hasSpecPath = ['todo', 'active'].some((state) =>
    exactToken(body, `.agents/spec-docs/${state}/${binding.basename}`),
  );
  const signals = [
    ...body.matchAll(
      /SCENARIO DRAFTED:\s*(not-applicable|automatable|manual)\s*\|\s*(0|[1-9]\d*)(?!\d)/g,
    ),
  ];
  return (
    exactToken(body, `${TASK_PREFIX}${binding.basename}`) &&
    hasSpecPath &&
    signals.some(
      (match) => match[1] === binding.signal.outcome && Number(match[2]) === binding.signal.count,
    )
  );
}

function declaredContracts(rule) {
  if (rule.includes('checkpoint-evidence-contract:v2:')) {
    return parseCheckpointEvidenceContracts(rule);
  }
  const parsed = parseCheckpointEvidenceContract(rule);
  return parsed.ok ? { ok: true, contracts: new Map([[1, parsed.contract]]) } : parsed;
}

function formName(body) {
  const form = gateImplementEntryForm(body);
  if (form === 'first') return 'gateImplementFirst';
  if (form === 'continuation') return 'gateImplementContinuation';
  if (form === 'correction') return 'gateImplementCorrection';
  return null;
}

function bindingError({ binding, contract, name, payload }) {
  if (binding === null) return null;
  const expectedTask = `${TASK_PREFIX}${binding.basename}`;
  const expectedSpec = `${SPEC_PREFIX}${contract.forms[name].specFolder}/${binding.basename}`;
  if (payload.taskPath !== expectedTask) return `${name}.taskPath does not bind ${expectedTask}`;
  if (payload.specPath !== expectedSpec) return `${name}.specPath does not bind ${expectedSpec}`;
  if (
    payload.plan.outcome !== binding.signal.outcome ||
    payload.plan.count !== binding.signal.count
  ) {
    return `${name}.plan does not bind the Task author verdict`;
  }
  return null;
}

function worktreeError({ payload, name, contract, binding, checkpointPaths, current }) {
  const allowed = new Set([
    payload.taskPath,
    payload.specPath,
    ...payload.worktreePaths.filter((entry) => entry.startsWith(LOOP_RUNS_PREFIX)),
  ]);
  if (
    !payload.worktreePaths.includes(payload.taskPath) ||
    !payload.worktreePaths.includes(payload.specPath) ||
    payload.worktreePaths.some((entry) => !allowed.has(entry))
  ) {
    return `${name}.worktreePaths must be the paired Task/spec plus only PLAN ledger paths`;
  }
  if (!current || binding === null || checkpointPaths === null) return null;
  const expected = [
    `${TASK_PREFIX}${binding.basename}`,
    `${SPEC_PREFIX}${contract.forms[name].specFolder}/${binding.basename}`,
    ...checkpointPaths.filter(
      (entry) => entry.startsWith(LOOP_RUNS_PREFIX) && entry !== POST_MERGE_LEDGER,
    ),
  ].sort();
  return same(payload.worktreePaths, expected)
    ? null
    : `${name}.worktreePaths do not bind the exact checkpoint inventory`;
}

export function evaluateGateImplementEntries({
  spec,
  binding,
  ruleText,
  entries,
  visibleEntryCount,
  options = {},
}) {
  const {
    legacyEntries = [],
    priorEntries = null,
    introductionSpecs = null,
    introductionShas = null,
    ancestorSha = null,
    expectedTaskItems = null,
    taskItemsError = null,
    baseSpec = null,
    checkpointPaths = null,
  } = options;
  if (entries.length !== visibleEntryCount) {
    return entries.map((body) =>
      invalid(
        body,
        'raw and canonical PASS populations must correspond exactly under real-calendar date semantics',
      ),
    );
  }
  if (
    priorEntries !== null &&
    (entries.length !== priorEntries.length + 1 ||
      priorEntries.some((entry, index) => entries[index] !== entry))
  ) {
    return entries.map((body) =>
      invalid(
        body,
        'parent raw PASS entries must remain byte-identical in exact prefix order before exactly one appended entry',
      ),
    );
  }
  const rule = String(ruleText ?? '');
  if (!rule.includes('checkpoint-evidence-contract:v1:')) {
    return entries.map((body) => ({
      ok: completeLegacyGateImplementEntry(body, binding),
      error: 'legacy-v0 GATE-IMPLEMENT binding is incomplete',
      body,
    }));
  }
  const parsedContracts = declaredContracts(rule);
  if (!parsedContracts.ok) {
    return entries.map((body) =>
      invalid(body, `checkpoint evidence contract unreadable: ${parsedContracts.error}`),
    );
  }
  const legacyCounts = new Map();
  for (const entry of legacyEntries) {
    const key = entry.trimEnd();
    legacyCounts.set(key, (legacyCounts.get(key) ?? 0) + 1);
  }
  const results = entries.map((body, index) => {
    const current = priorEntries !== null && index === priorEntries.length;
    const name = formName(body);
    if (name === null) return invalid(body, 'GATE-IMPLEMENT status form is invalid');
    const matching = [...parsedContracts.contracts.values()].filter((contract) =>
      body.includes(contract.entryEncoding.startMarker),
    );
    if (matching.length === 0) {
      const key = body.trimEnd();
      const eligible = (legacyCounts.get(key) ?? 0) > 0;
      if (eligible) legacyCounts.set(key, legacyCounts.get(key) - 1);
      return {
        ok: eligible && completeLegacyGateImplementEntry(body, binding),
        error:
          'legacy-v0 GATE-IMPLEMENT occurrence is not ancestry-eligible: no continuously surviving introduction ancestry before the v1 cutover',
        body,
      };
    }
    if (matching.length !== 1) {
      return invalid(body, 'GATE-IMPLEMENT entry matches multiple contract versions');
    }
    const contract = matching[0];
    const parsed = parseCheckpointEvidence(contract, name, body);
    if (!parsed.ok) return invalid(body, parsed.error);
    const bound = bindingError({ binding, contract, name, payload: parsed.payload });
    if (bound) return invalid(body, bound);
    if (['gateImplementFirst', 'gateImplementCorrection'].includes(name) && current) {
      if (taskItemsError !== null) return invalid(body, taskItemsError);
      if (expectedTaskItems !== null && !same(parsed.payload.taskItems, expectedTaskItems)) {
        return invalid(
          body,
          `${name}.taskItems do not bind the Task/Completion Criteria selection`,
        );
      }
    }
    const inventory = worktreeError({
      payload: parsed.payload,
      name,
      contract,
      binding,
      checkpointPaths,
      current,
    });
    if (inventory) return invalid(body, inventory);
    if (['gateImplementContinuation', 'gateImplementCorrection'].includes(name) && !current) {
      const prior = entries[index - 1];
      if (prior === undefined || parsed.payload.priorPass !== priorPassDigest(prior)) {
        return invalid(body, `${name}.priorPass does not hash the latest prior raw PASS entry`);
      }
    }
    const specialized =
      name === 'gateImplementCorrection'
        ? correctionEntryError({
            entries,
            index,
            parsed,
            parsedContracts,
            contract,
            introductionSpecs,
            introductionShas,
            isCurrentIntroduction: current,
            spec,
          })
        : name === 'gateImplementContinuation'
          ? continuationEntryError({
              entries,
              index,
              parsed,
              parsedContracts,
              contract,
              entryForm: gateImplementEntryForm,
              isCurrentIntroduction: current,
              baseSpec,
              spec,
              ancestorSha,
            })
          : null;
    if (specialized) return invalid(body, specialized);
    const delivery = checkpointDeliveryBindingError({
      contract,
      formName: name,
      isCurrentIntroduction: current,
      payload: parsed.payload,
      spec,
      baseSpec,
      introductionSpec: introductionSpecs?.[index],
      appendedForm: gateImplementEntryForm(entries[priorEntries?.length]),
      priorEntryCount: priorEntries?.length ?? 0,
      hasCorrection: entries.some((entry) => gateImplementEntryForm(entry) === 'correction'),
    });
    return delivery === null
      ? { ok: true, payload: parsed.payload, body }
      : invalid(body, delivery);
  });
  if (priorEntries === null) return results;
  const currentIndex = priorEntries.length;
  const priorResults = results.slice(0, currentIndex);
  if (priorResults.some((result) => !result.ok)) {
    results[currentIndex] = invalid(
      entries[currentIndex],
      'every prior canonical PASS must be complete and valid before a continuation',
    );
    return results;
  }
  const current = results[currentIndex];
  const latest = priorResults.findLast((result) => result.ok);
  if (
    current?.ok &&
    ['gateImplementContinuation', 'gateImplementCorrection'].includes(current.payload.form) &&
    (latest === undefined || current.payload.priorPass !== priorPassDigest(latest.body))
  ) {
    results[currentIndex] = invalid(
      current.body,
      `${current.payload.form}.priorPass does not hash the latest complete validated predecessor PASS entry`,
    );
  }
  return results;
}
