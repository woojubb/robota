#!/usr/bin/env node

/**
 * Prove that user-execution PLAN completed before implementation (HARNESS-121).
 *
 * Presence in the final tree is not ordering: HARNESS-119 added its not-applicable verdict after
 * implementation and the old section scan could not tell. This guard uses the causal boundary Git
 * already records. A work unit gets one planning-only checkpoint commit containing the exact Task's
 * complete PLAN outcome and the paired spec's gate PASS. Every other path is implementation and may
 * change only after that checkpoint is an ancestor. What the checkpoint commit looks like is the
 * spec's LANE (PROC-016; `.agents/rules/spec-workflow.md` § Lanes, gate catalogue § Gates per lane):
 *
 *   - L2 (lane absent or `lane: L2`): the commit that moves the spec into `active/` with
 *     `status: in-progress`, the Task in-progress beside it, and adds the first complete
 *     `[GATE-IMPLEMENT] — ✅ PASS` (`approved → in-progress`).
 *   - L1 (`lane: L1`): the spec never enters `active/` and never carries `in-progress`. Its
 *     checkpoint is the commit in which the spec, at `todo/<basename>` with `status: approved`, first
 *     carries a complete `[GATE-PLAN] — ✅ PASS` (`draft → approved`, naming the paired Task path and
 *     the `SCENARIO DRAFTED` outcome/count the Task itself records) while the Task exists as `todo`
 *     or `in-progress`. The parent commit carries no GATE-PLAN PASS.
 *
 * Before either checkpoint only the pair's own planning documents may change, plus a pure append to
 * any `.agents/loop-runs/*.jsonl` ledger — the skill records its run there and a run record is not
 * implementation. The post-merge and user-execution-scenario ledgers keep their stricter shapes.
 *
 * Two entry points share this engine:
 *   - default: replay every commit after the topic merge base (CI / harness scan);
 *   - --staged: reject the proposed commit before Git creates it (Husky pre-commit).
 */

import { envWithoutGitVars } from './shared.mjs';
import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';

import { asList, asScalar, frontmatterObject } from './frontmatter.mjs';
import { visibleMarkdown } from './markdown-visibility.mjs';
import {
  CHECKPOINT_EVIDENCE_CONTRACT_MARKERS,
  parseCheckpointEvidence,
  parseCheckpointEvidenceContract,
  parseCheckpointEvidenceContracts,
  rawGateImplementPassEntries,
  taskItemsForCheckpoint,
} from './checkpoint-evidence-contract.mjs';
import {
  checkpointEvidenceContractState,
  legacyCheckpointEntries,
  checkpointHistoryBindings,
} from './checkpoint-evidence-git-contract.mjs';
import { parseConversionEvidence } from './conversion-evidence.mjs';
import {
  CONTINUATION_STATUS_LINE,
  CORRECTION_STATUS_LINE,
  FIRST_CHECKPOINT_STATUS_LINE,
  evaluateGateImplementEntries,
  gateImplementEntryForm,
} from './gate-implement-entry-results.mjs';
import {
  parseUserExecutionPlanContract,
  validateTaskUserExecutionPlan,
} from './user-execution-plan-contract.mjs';
import { userExecutionPlanContractState } from './user-execution-plan-git-contract.mjs';
import {
  normalizedScenarioLines as sharedNormalizedScenarioLines,
  scenarioContract as sharedScenarioContract,
  scenarioEntries as sharedScenarioEntries,
} from './user-execution-scenario-contract.mjs';
import { tokenizeCanonicalShell as sharedTokenizeCanonicalShell } from './user-execution-scenario-surface.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const TASK_PREFIX = '.agents/tasks/';
const SPEC_PREFIX = '.agents/spec-docs/';
const LOOP_RUNS_PREFIX = '.agents/loop-runs/';
const POST_MERGE_LEDGER = `${LOOP_RUNS_PREFIX}post-merge-cycle.jsonl`;
const UES_LEDGER = `${LOOP_RUNS_PREFIX}user-execution-scenario.jsonl`;
const BACKLOG_RULE_PATH = '.agents/rules/backlog-execution.md';
const SPEC_FOLDERS = new Set(['draft', 'backlog', 'todo', 'active', 'done']);
const PRE_CHECKPOINT_SPEC_STATUS = new Map([
  ['draft', 'draft'],
  ['backlog', 'review-ready'],
  ['todo', 'approved'],
]);
const LOOP_TERMINALS = new Set([
  'converged',
  'no-progress',
  'bound-reached',
  'halted-for-user',
  'abandoned',
]);
const gitTextCache = new Map();
function finding(problem, commit = null) {
  return { commit, problem };
}

export function runGit(root, args) {
  // The hook's ambient GIT_DIR / GIT_WORK_TREE would redirect every call here to the repository the
  // hook was invoked from, whatever `root` is (PROC-016; the hazard worktree-gate.mjs describes).
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: envWithoutGitVars() });
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: (result.stderr ?? '').trim(),
  };
}

function lines(text) {
  return text.split('\n').filter((line) => line.length > 0);
}

function nulPaths(text) {
  return text.split('\0').filter((entry) => entry.length > 0);
}

function gitText(root, revision, file) {
  const key = `${root}\0${revision}\0${file}`;
  if (gitTextCache.has(key)) return gitTextCache.get(key);
  const result = runGit(root, ['show', `${revision}:${file}`]);
  const text = result.code === 0 ? result.stdout : null;
  gitTextCache.set(key, text);
  return text;
}

function checkpointOptionsAt(
  root,
  revision,
  basename,
  parentRevision = revision,
  checkpointPaths = null,
) {
  const checkpointState = checkpointEvidenceContractState(root, revision);
  const planState = userExecutionPlanContractState(root, revision);
  let strictPlanReason = false;
  let planReasonError = null;
  if (planState.valid) {
    if (planState.cutovers.length !== 1) {
      planReasonError = `user-execution PLAN contract cutover is ambiguous: expected one introduction, found ${planState.cutovers.length}`;
    } else strictPlanReason = true;
  } else if (planState.cutovers.length > 0) {
    planReasonError = 'user-execution PLAN contract is missing or invalid after its cutover';
  }
  let baseOid = null;
  const taskText = gitText(root, revision, `${TASK_PREFIX}${basename}`);
  if (String(taskText ?? '').includes('Conversion evidence:')) {
    const parentTask = gitText(root, parentRevision, `${TASK_PREFIX}${basename}`);
    const parentSpec = gitText(root, parentRevision, `${SPEC_PREFIX}active/${basename}`);
    const continuationParent =
      frontmatterStatus(parentTask) === 'in-progress' &&
      frontmatterStatus(parentSpec) === 'in-progress';
    if (continuationParent && taskText === parentTask) {
      const recorded = [
        ...String(taskText).matchAll(/^Conversion evidence: .*; base-oid=([0-9a-f]{40})\s*$/gim),
      ];
      const candidate = recorded.length === 1 ? recorded[0][1].toLowerCase() : null;
      if (
        candidate !== null &&
        runGit(root, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]).code === 0 &&
        runGit(root, ['merge-base', '--is-ancestor', candidate, parentRevision]).code === 0
      ) {
        baseOid = candidate;
      }
    } else {
      try {
        baseOid = resolveTopicMergeBase(root, 'origin/develop');
      } catch {
        // Scratch repositories used by the scanner tests may intentionally have no origin ref.
        // Conversion evidence is still rejected there unless a real base identity is available.
      }
    }
  }
  return {
    ...(checkpointState.cutovers.length === 1
      ? {
          legacyEntries: legacyCheckpointEntries(
            root,
            checkpointState.cutovers[0],
            revision,
            basename,
          ),
        }
      : {}),
    ...checkpointHistoryBindings(root, revision, parentRevision, basename),
    ...(baseOid === null ? {} : { baseOid }),
    ...(checkpointPaths === null ? {} : { checkpointPaths }),
    strictPlanReason,
    ...(planReasonError === null ? {} : { planReasonError }),
  };
}

function conversionEvidenceResult(task, spec, basename, checkpointOptions = {}) {
  if (!String(task ?? '').includes('Conversion evidence:')) return null;
  const issueMatch = String(task ?? '').match(
    /^issue:\s*https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)\s*$/m,
  );
  return parseConversionEvidence({
    taskText: task,
    specText: spec,
    issueNumber: issueMatch?.[1] ?? '',
    taskId: subjectId(basename) ?? '',
    baseOid: checkpointOptions.baseOid,
  });
}

function indexText(root, file) {
  const result = runGit(root, ['show', `:${file}`]);
  return result.code === 0 ? result.stdout : null;
}

function changedPaths(root, from, to) {
  const result = runGit(root, ['diff', '--name-only', '-z', '--no-renames', from, to, '--']);
  if (result.code !== 0) {
    throw new Error(`git diff ${from} ${to} failed: ${result.stderr || '(no stderr)'}`);
  }
  return nulPaths(result.stdout);
}

function stagedPaths(root) {
  requireWorktreeTopLevel(root);
  const result = runGit(root, [
    'diff',
    '--cached',
    '--name-only',
    '-z',
    '--no-renames',
    'HEAD',
    '--',
  ]);
  if (result.code !== 0) throw new Error(`staged diff failed: ${result.stderr || '(no stderr)'}`);
  return nulPaths(result.stdout);
}

function worktreePaths(root) {
  const unstaged = runGit(root, ['diff', '--name-only', '-z', '--no-renames', '--']);
  const untracked = runGit(root, ['ls-files', '--others', '--exclude-standard', '-z']);
  if (unstaged.code !== 0 || untracked.code !== 0) {
    throw new Error(
      `worktree query failed: ${unstaged.stderr || untracked.stderr || '(no stderr)'}`,
    );
  }
  return [...new Set([...nulPaths(unstaged.stdout), ...nulPaths(untracked.stdout)])];
}

function taskBasename(file) {
  if (!file.startsWith(TASK_PREFIX)) return null;
  const relative = file.slice(TASK_PREFIX.length);
  const withoutCompleted = relative.startsWith('completed/')
    ? relative.slice('completed/'.length)
    : relative;
  return withoutCompleted.endsWith('.md') ? withoutCompleted : null;
}

function specBasename(file) {
  if (!file.startsWith(SPEC_PREFIX)) return null;
  const relative = file.slice(SPEC_PREFIX.length);
  const slash = relative.indexOf('/');
  if (slash === -1) return null;
  const folder = relative.slice(0, slash);
  const basename = relative.slice(slash + 1);
  return SPEC_FOLDERS.has(folder) && basename.endsWith('.md') ? basename : null;
}

function activePairCandidates(paths) {
  const tasks = new Set(
    paths
      .filter((file) => file.startsWith(TASK_PREFIX) && !file.includes('/completed/'))
      .map(taskBasename)
      .filter(Boolean),
  );
  const activeSpecs = new Set(
    paths
      .filter((file) => file.startsWith(`${SPEC_PREFIX}active/`))
      .map(specBasename)
      .filter(Boolean),
  );
  return [...tasks].filter((basename) => activeSpecs.has(basename)).sort();
}

/**
 * Basenames of `todo/` specs a commit changes — the L1 checkpoint candidates (PROC-016). The Task
 * need not change in the same commit: it may have been committed in the prelude, and the PLAN entry
 * binds to it by path and signal rather than by co-change.
 */
function l1SpecCandidates(paths) {
  return [
    ...new Set(
      paths
        .filter((file) => file.startsWith(`${SPEC_PREFIX}todo/`))
        .map(specBasename)
        .filter(Boolean),
    ),
  ].sort();
}

// A continuation commit (HARNESS-131) touches the active spec only — the Task has nothing to
// change — so the pair is the active spec path in the change set whose paired Task exists in the
// resulting tree. `readTask` reads that tree (a commit, or the index on the staged path).
function continuationPairCandidates(paths, readTask) {
  const activeSpecs = paths
    .filter((file) => file.startsWith(`${SPEC_PREFIX}active/`))
    .map(specBasename)
    .filter(Boolean);
  const both = new Set(activePairCandidates(paths));
  return [...new Set(activeSpecs)]
    .filter((basename) => !both.has(basename) && readTask(`${TASK_PREFIX}${basename}`) !== null)
    .sort();
}

function pairCandidates(paths, readTask) {
  return [
    ...new Set([...activePairCandidates(paths), ...continuationPairCandidates(paths, readTask)]),
  ].sort();
}

function planningBasenames(paths) {
  return [
    ...new Set(paths.map((file) => taskBasename(file) ?? specBasename(file)).filter(Boolean)),
  ].sort();
}

function subjectId(basename) {
  const match = /^([A-Z][A-Z0-9]*-\d+)(?:-|\.md)/.exec(basename);
  return match?.[1] ?? null;
}

function isExactCheckpointPairPath(file, basename) {
  return file === `${TASK_PREFIX}${basename}` || file === `${SPEC_PREFIX}active/${basename}`;
}

function isPreCheckpointPlanningPath(file, basename) {
  if (file === `${TASK_PREFIX}${basename}`) return true;
  if (!file.startsWith(SPEC_PREFIX) || specBasename(file) !== basename) return false;
  const folder = file.slice(SPEC_PREFIX.length).split('/', 1)[0];
  return PRE_CHECKPOINT_SPEC_STATUS.has(folder);
}

function frontmatterStatus(text) {
  const status = asScalar(frontmatterObject(text ?? '').status).trim();
  return status === '' ? null : status;
}

/** `lane: L1` and nothing else selects the L1 checkpoint rule; absent or `L2` is the L2 rule. */
function isL1Spec(text) {
  return (
    asScalar(frontmatterObject(text ?? '').lane)
      .trim()
      .toUpperCase() === 'L1'
  );
}

function atxHeading(line) {
  const match = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
  if (!match) return null;
  const rawContent = match[2] ?? '';
  return {
    level: match[1].length,
    content: rawContent.replace(/[ \t]+#+[ \t]*$/, '').trim(),
  };
}

function markdownSection(text, heading) {
  const source = visibleMarkdown(text).split('\n');
  const wantedLevel = /^#+/.exec(heading)?.[0].length ?? 0;
  const wantedContent = heading.replace(/^#+\s+/, '');
  const start = source.findIndex((line) => {
    const parsed = atxHeading(line);
    return parsed?.level === wantedLevel && parsed.content === wantedContent;
  });
  if (start === -1) return null;
  let end = source.length;
  for (let index = start + 1; index < source.length; index += 1) {
    const next = atxHeading(source[index]);
    if (next && next.level <= wantedLevel) {
      end = index;
      break;
    }
  }
  return source.slice(start + 1, end).join('\n');
}

function isCanonicalDatedPass(content, gateName) {
  const match = new RegExp(`^\\[${gateName}\\] — ✅ PASS \\| (\\d{4}-\\d{2}-\\d{2})$`).exec(
    content,
  );
  if (!match) return false;
  const date = new Date(`${match[1]}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === match[1];
}

function canonicalRawPassEntries(text, sectionHeading, gateName) {
  const projection = visibleMarkdown(text, true);
  const sectionStart = projection.lines.findIndex((line) => {
    const heading = atxHeading(line);
    return heading?.level === 2 && heading.content === sectionHeading;
  });
  if (sectionStart === -1) return [];
  let sectionEnd = projection.lines.length;
  for (let index = sectionStart + 1; index < projection.lines.length; index += 1) {
    const heading = atxHeading(projection.lines[index]);
    if (heading && heading.level <= 2) {
      sectionEnd = index;
      break;
    }
  }
  const entries = [];
  for (let index = sectionStart + 1; index < sectionEnd; index += 1) {
    const heading = atxHeading(projection.lines[index]);
    if (heading?.level !== 3 || !isCanonicalDatedPass(heading.content, gateName)) continue;
    let end = sectionEnd;
    for (let cursor = index + 1; cursor < sectionEnd; cursor += 1) {
      const next = atxHeading(projection.lines[cursor]);
      if (next && next.level <= 3) {
        end = cursor;
        break;
      }
    }
    const rawStart = projection.rawIndices[index] + 1;
    const rawEnd =
      end === projection.lines.length ? projection.sourceLines.length : projection.rawIndices[end];
    entries.push(projection.sourceLines.slice(rawStart, rawEnd).join('\n'));
  }
  return entries;
}

function canonicalPassEntries(section, gateName) {
  const lines = String(section ?? '').split('\n');
  const entries = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = atxHeading(lines[index]);
    if (heading?.level !== 3 || !isCanonicalDatedPass(heading.content, gateName)) continue;
    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const next = atxHeading(lines[cursor]);
      if (next && next.level <= 3) {
        end = cursor;
        break;
      }
    }
    entries.push(lines.slice(index + 1, end).join('\n'));
  }
  return entries;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasExactMarkdownToken(text, token) {
  return new RegExp(`(^|[\\s\`])${escapeRegExp(token)}(?=$|[\\s\`])`, 'm').test(text);
}

export { CONTINUATION_STATUS_LINE, CORRECTION_STATUS_LINE, FIRST_CHECKPOINT_STATUS_LINE };

export function gateImplementEntryResults(spec, binding = null, ruleText = null, options = {}) {
  const evidence = markdownSection(spec, '## Evidence Log');
  const entries = rawGateImplementPassEntries(spec);
  return evaluateGateImplementEntries({
    spec,
    binding,
    ruleText,
    entries,
    visibleEntryCount: canonicalPassEntries(evidence, 'GATE-IMPLEMENT').length,
    options,
  });
}

function stageOneScenarioPayload(scenario, outcome, contract) {
  const binding = sharedScenarioContract(scenario.body, outcome);
  if (binding === null) return null;
  const actionKind = contract.actionMapping[`${outcome}:${binding.surface}`];
  const actionValue =
    actionKind === 'command'
      ? (sharedTokenizeCanonicalShell(binding.command)?.invocation ?? null)
      : actionKind === 'browserSteps'
        ? binding.browserSteps
        : actionKind === 'uiSteps'
          ? binding.uiSteps
          : null;
  if (actionValue === null) return null;
  return {
    name: scenario.name,
    surface: binding.surface,
    surfaceRationale: binding.surfaceRationale,
    invocation: binding.invocation,
    observableType: binding.observableType,
    observable: binding.observable,
    observableRationale: binding.observableRationale,
    guardianObservableVerdict: 'product-behavior',
    executability: binding.executability,
    prerequisite: binding.prerequisites,
    action: { kind: actionKind, value: actionValue },
    expectedObservable: binding.observable,
    cleanup: binding.cleanup,
    evidence: binding.evidence,
    ...(binding.productStatePath ? { productStatePath: binding.productStatePath } : {}),
    ...(outcome === 'manual'
      ? {
          barrier: binding.barrier,
          unavailableCapability: binding.unavailableCapability,
          attemptedAutomation: binding.attemptedAutomation,
        }
      : {}),
    ...(outcome === 'manual' && binding.surface === 'robota-tui'
      ? { uiSteps: binding.uiSteps }
      : {}),
  };
}

function v1StageOneResult(task, scenarios, outcome, ruleText) {
  const declared = parseCheckpointEvidenceContract(ruleText);
  if (!declared.ok) return declared;
  const form = declared.contract.forms.doneGateStageOne;
  const entries = canonicalRawPassEntries(task, 'User Execution Test Scenarios', form.heading);
  if (entries.length !== 1) {
    return { ok: false, error: `DONE-GATE-STAGE-1 PASS count is ${entries.length}, expected 1` };
  }
  const expectedStatus = `**Status upgrade:** ${form.statusUpgrade}`;
  const statusLines = entries[0]
    .split('\n')
    .filter((line) => /^\*\*Status upgrade:\*\*/.test(line.trim()));
  if (statusLines.length !== 1 || statusLines[0].trim() !== expectedStatus) {
    return {
      ok: false,
      error: `doneGateStageOne.statusUpgrade must be ${form.statusUpgrade}`,
    };
  }
  const parsed = parseCheckpointEvidence(declared.contract, 'doneGateStageOne', entries[0]);
  if (!parsed.ok) return parsed;
  const expectedScenarios = scenarios.map((scenario) =>
    stageOneScenarioPayload(scenario, outcome, declared.contract),
  );
  if (expectedScenarios.some((scenario) => scenario === null)) {
    return {
      ok: false,
      error: 'authored scenario does not satisfy the canonical product contract',
    };
  }
  if (parsed.payload.outcome !== outcome) {
    return { ok: false, error: 'doneGateStageOne.outcome does not bind the Task author verdict' };
  }
  if (JSON.stringify(parsed.payload.scenarios) !== JSON.stringify(expectedScenarios)) {
    return {
      ok: false,
      error: 'doneGateStageOne.scenarios do not exactly bind the authored scenario fields',
    };
  }
  return { ok: true };
}

function completeStageOneEntry(body, scenarios, outcome) {
  if (!/^\*\*Status upgrade:\*\* scenario drafted → scenario written\s*$/m.test(body)) {
    return false;
  }
  const evidence = sharedNormalizedScenarioLines(body);
  return scenarios.every((scenario) => {
    const contract = sharedScenarioContract(scenario.body, outcome);
    if (contract === null) return false;
    const barrierEvidence =
      outcome === 'manual'
        ? `; barrier=${contract.barrier}; unavailable-capability=${contract.unavailableCapability}; attempted-automation=${contract.attemptedAutomation}`
        : '';
    const statePathEvidence = contract.productStatePath
      ? `; product-state-path=${contract.productStatePath}`
      : '';
    const uiStepEvidence =
      outcome === 'manual' && contract.surface === 'robota-tui'
        ? `; ui-steps=${contract.uiSteps}`
        : '';
    const exactBinding = `${scenario.name} — surface=${contract.surface}; surface-rationale=${contract.surfaceRationale}; invocation=${contract.invocation}${uiStepEvidence}; observable-type=${contract.observableType}; observable=${contract.observable}; observable-rationale=${contract.observableRationale}${statePathEvidence}${barrierEvidence}; guardian-observable-verdict=product-behavior; `;
    const line = evidence.find((candidate) => candidate.startsWith(exactBinding));
    return (
      line?.startsWith(exactBinding) === true &&
      /executability/i.test(line) &&
      /prerequisite/i.test(line) &&
      /command|browser steps?|ui steps?/i.test(line) &&
      /expected (?:observable|result)/i.test(line) &&
      /cleanup|reset/i.test(line) &&
      /evidence/i.test(line)
    );
  });
}

function gateImplementPassCount(spec, binding = null, ruleText = null, options = {}) {
  return gateImplementEntryResults(spec, binding, ruleText, options).filter((result) => result.ok)
    .length;
}

/**
 * The L1 PLAN entry (PROC-016) mirrors the GATE-IMPLEMENT entry minus the whole-worktree inventory,
 * which PLAN does not produce: the `draft → approved` upgrade, the paired Task path, and the
 * `SCENARIO DRAFTED` outcome/count — bound, when a binding is given, to the exact Task and to the
 * signal that Task actually records.
 */
function completeGatePlanEntry(body, binding = null) {
  const structurallyComplete =
    /^\*\*Status upgrade:\*\* draft → approved\s*$/m.test(body) &&
    /\.agents\/tasks\/[A-Z][A-Z0-9]*-\d+[^\s`]*\.md/.test(body) &&
    /SCENARIO DRAFTED:\s*(?:not-applicable|automatable|manual)\s*\|\s*\d+/.test(body);
  if (!structurallyComplete || binding === null) return structurallyComplete;
  const evidenceSignals = [
    ...body.matchAll(
      /SCENARIO DRAFTED:\s*(not-applicable|automatable|manual)\s*\|\s*(0|[1-9]\d*)(?!\d)/g,
    ),
  ];
  const hasExactSignal = evidenceSignals.some(
    (match) => match[1] === binding.signal.outcome && Number(match[2]) === binding.signal.count,
  );
  return hasExactMarkdownToken(body, `${TASK_PREFIX}${binding.basename}`) && hasExactSignal;
}

/** Every `[GATE-PLAN] — ✅ PASS` heading, complete or not — what a parent or a prelude must lack. */
function gatePlanPassHeadings(spec) {
  return canonicalPassEntries(markdownSection(spec, '## Evidence Log'), 'GATE-PLAN').length;
}

/** GATE-PLAN PASS entries that are complete (and, with a binding, bound to the exact Task). */
function gatePlanPassCount(spec, binding = null) {
  return canonicalPassEntries(markdownSection(spec, '## Evidence Log'), 'GATE-PLAN').filter(
    (body) => completeGatePlanEntry(body, binding),
  ).length;
}

function gateImplementContinuationCount(spec, binding = null, ruleText = null, options = {}) {
  return gateImplementEntryResults(spec, binding, ruleText, options).filter(
    (result) => result.ok && gateImplementEntryForm(result.body) === 'continuation',
  ).length;
}

function gateImplementCorrectionCount(spec, binding = null, ruleText = null, options = {}) {
  return gateImplementEntryResults(spec, binding, ruleText, options).filter(
    (result) => result.ok && gateImplementEntryForm(result.body) === 'correction',
  ).length;
}

function exactPlanSignal(task) {
  const section = markdownSection(task, '## User Execution Test Scenarios');
  const matches = [
    ...(section ?? '').matchAll(
      /^\*\*Author verdict:\*\*\s+`SCENARIO DRAFTED:\s*(not-applicable|automatable|manual)\s*\|\s*(0|[1-9]\d*)`\s*$/gm,
    ),
  ];
  return matches.length === 1 ? { outcome: matches[0][1], count: Number(matches[0][2]) } : null;
}

function isCheckpointTransition({
  basename,
  parentTask,
  parentSpec,
  task,
  spec,
  ruleText = null,
  checkpointOptions = {},
}) {
  const signal = exactPlanSignal(task);
  if (signal === null) return false;
  const conversion = conversionEvidenceResult(task, spec, basename, checkpointOptions);
  if (conversion !== null && conversion.kind !== 'eligible') return false;
  if (frontmatterStatus(task) !== 'in-progress' || frontmatterStatus(spec) !== 'in-progress') {
    return false;
  }
  const binding = { basename, signal };
  const selectedTaskItems = taskItemsForCheckpoint(spec, task);
  const currentOptions = {
    ...checkpointOptions,
    priorEntries: rawGateImplementPassEntries(parentSpec),
    baseSpec: parentSpec,
    ...(selectedTaskItems.ok
      ? { expectedTaskItems: selectedTaskItems.items }
      : { taskItemsError: selectedTaskItems.error }),
  };
  const parentInProgress =
    frontmatterStatus(parentTask) === 'in-progress' &&
    frontmatterStatus(parentSpec) === 'in-progress';
  if (!parentInProgress) {
    // The first checkpoint of a pair: neither side was in-progress, and the spec gains its first
    // complete GATE-IMPLEMENT PASS, bound to the Task's exact PLAN signal…
    return (
      frontmatterStatus(parentTask) !== 'in-progress' &&
      frontmatterStatus(parentSpec) !== 'in-progress' &&
      gateImplementPassCount(parentSpec) === 0 &&
      gateImplementPassCount(spec, binding, ruleText, currentOptions) === 1 &&
      // …and that one entry is in FIRST form: a continuation line on a pair that was never
      // in-progress (copied from a sequenced spec) is not a first checkpoint.
      gateImplementContinuationCount(spec, binding, ruleText, currentOptions) === 0
    );
  }
  // A continuation checkpoint (HARNESS-131): the pair is already in-progress with a checkpoint on
  // the base — a spec whose delivery is sequenced across PRs — and this commit re-records the gate
  // as exactly one more bound entry, in continuation form, so the new branch is bound to the same
  // pair by a guardian-judged entry. Anything else on an in-progress pair is not a checkpoint.
  const passDeltaIsOne =
    task === parentTask &&
    // The prior PASS must be bound to the SAME exact PLAN signal: a continuation that re-plans the
    // outcome is scope growth, not a continuation.
    gateImplementPassCount(parentSpec, binding, ruleText, checkpointOptions) >= 1 &&
    gateImplementPassCount(spec, binding, ruleText, currentOptions) ===
      gateImplementPassCount(parentSpec, binding, ruleText, checkpointOptions) + 1;
  if (!passDeltaIsOne) return false;
  const continuationDelta =
    gateImplementContinuationCount(spec, binding, ruleText, currentOptions) -
    gateImplementContinuationCount(parentSpec, binding, ruleText, checkpointOptions);
  const correctionDelta =
    gateImplementCorrectionCount(spec, binding, ruleText, currentOptions) -
    gateImplementCorrectionCount(parentSpec, binding, ruleText, checkpointOptions);
  return (
    (continuationDelta === 1 && correctionDelta === 0) ||
    (continuationDelta === 0 && correctionDelta === 1)
  );
}

/**
 * The L1 checkpoint (PROC-016): the `todo/` spec is `lane: L1`, `status: approved`, and carries
 * exactly one complete GATE-PLAN PASS bound to the Task's own signal, while no parent copy of the
 * spec (at `todo/` or the `draft/` it came from) carried any GATE-PLAN PASS. The Task's status is
 * not constrained here — an L1 Task may be `todo` or `in-progress` at PLAN.
 */
function isL1CheckpointTransition({ basename, parentSpecs, task, spec }) {
  if (task === null || spec === null || !isL1Spec(spec)) return false;
  const signal = exactPlanSignal(task);
  return (
    signal !== null &&
    frontmatterStatus(spec) === 'approved' &&
    parentSpecs.every((parentSpec) => gatePlanPassHeadings(parentSpec) === 0) &&
    gatePlanPassCount(spec, { basename, signal }) === 1
  );
}

function l1SpecPaths(basename) {
  return {
    taskPath: `${TASK_PREFIX}${basename}`,
    specPath: `${SPEC_PREFIX}todo/${basename}`,
    draftPath: `${SPEC_PREFIX}draft/${basename}`,
  };
}

/**
 * Every checkpoint transition a set of changed paths performs, judged against the resulting tree
 * (`textAt`) and its parent (`parentTextAt`). L2 pairs are listed first and exactly as before; an
 * L1 transition is added only for a `todo/` spec that declares `lane: L1`.
 */
function checkpointTransitions(paths, textAt, parentTextAt, optionsFor = () => ({})) {
  const found = [];
  for (const basename of pairCandidates(paths, textAt)) {
    const taskPath = `${TASK_PREFIX}${basename}`;
    const specPath = `${SPEC_PREFIX}active/${basename}`;
    const task = textAt(taskPath);
    const spec = textAt(specPath);
    if (task === null || spec === null) continue;
    const transition = isCheckpointTransition({
      basename,
      parentTask: parentTextAt(taskPath),
      parentSpec: parentTextAt(specPath),
      task,
      spec,
      ruleText: textAt(BACKLOG_RULE_PATH),
      checkpointOptions: optionsFor(basename),
    });
    if (transition) found.push({ basename, lane: 'L2' });
  }
  for (const basename of l1SpecCandidates(paths)) {
    if (found.some((candidate) => candidate.basename === basename)) continue;
    const { taskPath, specPath, draftPath } = l1SpecPaths(basename);
    const transition = isL1CheckpointTransition({
      basename,
      parentSpecs: [parentTextAt(specPath), parentTextAt(draftPath)],
      task: textAt(taskPath),
      spec: textAt(specPath),
    });
    if (transition) found.push({ basename, lane: 'L1' });
  }
  return found;
}

function malformedL2CheckpointCandidates(paths, textAt, parentTextAt) {
  const ruleText = textAt(BACKLOG_RULE_PATH);
  if (!String(ruleText ?? '').includes('checkpoint-evidence-contract:v1:')) return [];
  return pairCandidates(paths, textAt).filter((basename) => {
    const taskPath = `${TASK_PREFIX}${basename}`;
    const specPath = `${SPEC_PREFIX}active/${basename}`;
    const task = textAt(taskPath);
    const spec = textAt(specPath);
    if (frontmatterStatus(task) !== 'in-progress' || frontmatterStatus(spec) !== 'in-progress') {
      return false;
    }
    const entries = canonicalPassEntries(
      markdownSection(spec, '## Evidence Log'),
      'GATE-IMPLEMENT',
    );
    const parentEntries = canonicalPassEntries(
      markdownSection(parentTextAt(specPath), '## Evidence Log'),
      'GATE-IMPLEMENT',
    );
    const parentInProgress =
      frontmatterStatus(parentTextAt(taskPath)) === 'in-progress' &&
      frontmatterStatus(parentTextAt(specPath)) === 'in-progress';
    return entries.length > 0 && (!parentInProgress || entries.length > parentEntries.length);
  });
}

function evaluateL1PlanTexts({ basename, parentSpecs, task, spec }) {
  const problems = [];
  const id = subjectId(basename);
  if (!id) problems.push(`cannot derive a Task ID from paired basename \`${basename}\`.`);
  if (!['todo', 'in-progress'].includes(frontmatterStatus(task))) {
    problems.push(
      `paired L1 Task \`${basename}\` is not status \`todo\` or \`in-progress\` in the checkpoint tree.`,
    );
  }
  if (frontmatterStatus(spec) !== 'approved') {
    problems.push(
      `paired L1 spec \`${basename}\` is not status \`approved\` in the checkpoint tree.`,
    );
  }
  const tasksSection = markdownSection(spec, '## Tasks');
  if (!tasksSection || !hasExactMarkdownToken(tasksSection, `${TASK_PREFIX}${basename}`)) {
    problems.push(`paired spec does not bind its Tasks section to \`.agents/tasks/${basename}\`.`);
  }
  if (!isL1CheckpointTransition({ basename, parentSpecs, task, spec })) {
    problems.push(
      'L1 checkpoint does not add the first complete GATE-PLAN PASS (draft → approved, naming the paired Task path and its SCENARIO DRAFTED outcome/count) for the exact Task/spec pair.',
    );
  }
  if (exactPlanSignal(task) === null) {
    problems.push(
      'paired Task must have exactly one subject-bound `SCENARIO DRAFTED` author verdict.',
    );
  }
  return problems;
}

export function evaluatePlanTexts({
  basename,
  parentTask = null,
  parentSpec = null,
  task,
  spec,
  ruleText = null,
  checkpointOptions = {},
}) {
  const problems = [];
  if (checkpointOptions.planReasonError) {
    problems.push(`${checkpointOptions.planReasonError}.`);
  }
  const conversion = conversionEvidenceResult(task, spec, basename, checkpointOptions);
  if (conversion !== null && conversion.kind !== 'eligible') {
    problems.push(`combined lifecycle conversion evidence refused: ${conversion.reason}.`);
  }
  const id = subjectId(basename);
  if (!id) problems.push(`cannot derive a Task ID from paired basename \`${basename}\`.`);
  if (frontmatterStatus(task) !== 'in-progress') {
    problems.push(
      `paired Task \`${basename}\` is not status \`in-progress\` in the checkpoint tree.`,
    );
  }
  if (frontmatterStatus(spec) !== 'in-progress') {
    problems.push(
      `paired spec \`${basename}\` is not status \`in-progress\` in the checkpoint tree.`,
    );
  }
  const taskHeadings = visibleMarkdown(task).split('\n').map(atxHeading).filter(Boolean);
  const hasBoundH1 =
    id !== null &&
    taskHeadings.some(
      (heading) =>
        heading.level === 1 &&
        new RegExp(`^${id.replace('-', '\\-')}(?::|\\s|$)`).test(heading.content),
    );
  if (id && !hasBoundH1) {
    problems.push(`Task subject binding does not name exact ID \`${id}\`.`);
  }
  const tasksSection = markdownSection(spec, '## Tasks');
  const boundTaskPath = `.agents/tasks/${basename}`;
  if (
    !tasksSection ||
    !new RegExp(
      `(^|[\\s\`])${boundTaskPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s\`]|$)`,
      'm',
    ).test(tasksSection)
  ) {
    problems.push(`paired spec does not bind its Tasks section to \`.agents/tasks/${basename}\`.`);
  }
  if (
    !isCheckpointTransition({
      basename,
      parentTask,
      parentSpec,
      task,
      spec,
      ruleText,
      checkpointOptions,
    })
  ) {
    const signal = exactPlanSignal(task);
    const selectedTaskItems = taskItemsForCheckpoint(spec, task);
    const diagnostics =
      signal === null
        ? []
        : gateImplementEntryResults(spec, { basename, signal }, ruleText, {
            ...checkpointOptions,
            priorEntries: rawGateImplementPassEntries(parentSpec),
            baseSpec: parentSpec,
            ...(selectedTaskItems.ok
              ? { expectedTaskItems: selectedTaskItems.items }
              : { taskItemsError: selectedTaskItems.error }),
          })
            .filter((result) => !result.ok)
            .map((result) => result.error);
    problems.push(
      diagnostics.length > 0
        ? `GATE-IMPLEMENT checkpoint binding failed: ${[...new Set(diagnostics)].join('; ')}.`
        : 'checkpoint is neither the first GATE-IMPLEMENT PASS transitioning the exact Task/spec pair into in-progress nor one continuation PASS (`in-progress → in-progress (continuation)`) or one correction PASS (`in-progress → in-progress (correction)`) on a pair already in-progress.',
    );
  }

  const scenarioSection = markdownSection(task, '## User Execution Test Scenarios');
  const signals = [
    ...(scenarioSection ?? '').matchAll(
      /^\*\*Author verdict:\*\*\s+`SCENARIO DRAFTED:\s*(not-applicable|automatable|manual)\s*\|\s*(0|[1-9]\d*)`\s*$/gm,
    ),
  ];
  if (signals.length !== 1) {
    problems.push(
      'paired Task must have exactly one subject-bound `SCENARIO DRAFTED` author verdict.',
    );
    return problems;
  }
  const signal = signals[0];
  const outcome = signal[1];
  const count = Number(signal[2]);
  if (outcome === 'not-applicable') {
    const strictReason =
      checkpointOptions.strictPlanReason ??
      String(ruleText ?? '').includes('user-execution-plan-contract:v1:');
    const reasonContract = strictReason ? parseUserExecutionPlanContract(ruleText) : null;
    const reasonResult = reasonContract?.ok
      ? validateTaskUserExecutionPlan(reasonContract.contract, task)
      : null;
    if (count !== 0 || (strictReason && (!reasonContract?.ok || !reasonResult?.ok))) {
      problems.push('not-applicable PLAN lacks its zero count and a concrete recorded reason.');
    }
  } else {
    if (count < 1) problems.push(`applicable PLAN outcome \`${outcome}\` declares no scenario.`);
    const scenarios = sharedScenarioEntries(scenarioSection);
    const hasCompleteScenarioSet =
      scenarios.length === count &&
      scenarios.every(
        (scenario, index) =>
          scenario.number === index + 1 && sharedScenarioContract(scenario.body, outcome) !== null,
      );
    if (!hasCompleteScenarioSet) {
      problems.push(
        'applicable PLAN scenario count or required executability/prerequisite/command/UI/observable/cleanup/evidence fields are incomplete.',
      );
    }
    const declaresV1 = String(ruleText ?? '').includes('checkpoint-evidence-contract:v1:');
    const stageOneV1 = declaresV1 ? v1StageOneResult(task, scenarios, outcome, ruleText) : null;
    const hasStageOnePass = declaresV1
      ? stageOneV1.ok
      : canonicalPassEntries(scenarioSection, 'DONE-GATE-STAGE-1').some((body) =>
          completeStageOneEntry(body, scenarios, outcome),
        );
    if (!hasStageOnePass) {
      problems.push(
        declaresV1
          ? `DONE-GATE-STAGE-1 checkpoint binding failed: ${stageOneV1.error}.`
          : 'applicable PLAN has no DONE-GATE-STAGE-1 PASS.',
      );
    }
  }
  return problems;
}

function appendedRecord(before, after) {
  if (!after.startsWith(before)) return false;
  const appended = lines(after.slice(before.length));
  if (appended.length !== 1) return null;
  try {
    return JSON.parse(appended[0]);
  } catch {
    return null;
  }
}

function validLoopRecord(record) {
  const allowedKeys = new Set([
    'runId',
    'opened',
    'closed',
    'roundFindings',
    'extensions',
    'terminal',
    'ref',
  ]);
  return Boolean(
    record &&
    typeof record === 'object' &&
    !Array.isArray(record) &&
    Object.keys(record).every((key) => allowedKeys.has(key)) &&
    (record.extensions === undefined ||
      (record.extensions !== null &&
        typeof record.extensions === 'object' &&
        !Array.isArray(record.extensions))) &&
    (record.ref === null || typeof record.ref === 'string') &&
    /^r\d{14}$/.test(String(record.runId ?? '')) &&
    !Number.isNaN(Date.parse(record.opened)) &&
    !Number.isNaN(Date.parse(record.closed)) &&
    Date.parse(record.closed) >= Date.parse(record.opened) &&
    LOOP_TERMINALS.has(record.terminal) &&
    Array.isArray(record.roundFindings) &&
    record.roundFindings.length > 0 &&
    record.roundFindings.every((count) => Number.isInteger(count) && count >= 0),
  );
}

function successfulLoopRecord(record) {
  return (
    validLoopRecord(record) && record.terminal === 'converged' && record.roundFindings.at(-1) === 0
  );
}

function exactSubjectRef(ref, basename) {
  const tokens = String(ref ?? '')
    .split(/[\s;,|]+/)
    .map((token) => token.replace(/^['"`]|['"`]$/g, ''))
    .filter(Boolean);
  const stem = basename.endsWith('.md') ? basename.slice(0, -3) : basename;
  return (
    tokens.includes(basename) ||
    tokens.includes(stem) ||
    tokens.includes(`${TASK_PREFIX}${basename}`)
  );
}

/** A top-level `.agents/loop-runs/<skill>.jsonl` ledger. */
function isLoopLedgerPath(file) {
  return (
    file.startsWith(LOOP_RUNS_PREFIX) &&
    file.endsWith('.jsonl') &&
    !file.slice(LOOP_RUNS_PREFIX.length).includes('/')
  );
}

/**
 * The lines a change adds to the END of a ledger, or null when it is not a pure append: an existing
 * line rewritten, extended, or removed, or an added line that is not one JSON object.
 */
function appendedLedgerLines(before, after) {
  if (!after.startsWith(before)) return null;
  const tail = after.slice(before.length);
  if (before !== '' && !before.endsWith('\n') && !tail.startsWith('\n')) return null;
  const appended = lines(tail);
  if (appended.length === 0) return null;
  const allRecords = appended.every((line) => {
    try {
      const record = JSON.parse(line);
      return Boolean(record) && typeof record === 'object' && !Array.isArray(record);
    } catch {
      return false;
    }
  });
  return allRecords ? appended : null;
}

/**
 * Whether a ledger change is a planning path. The post-merge ledger is never one (it has its own
 * prelude rule); the user-execution-scenario ledger keeps its strict subject-bound closed-record
 * shape; every other `.agents/loop-runs/*.jsonl` — the `user-request-gate` run the skill records,
 * for one — is a planning path exactly when it is a pure append (PROC-016).
 */
function validateLedgerAppend(file, before, after, basename) {
  if (file === POST_MERGE_LEDGER || !isLoopLedgerPath(file)) return false;
  if (file === UES_LEDGER) {
    const record = appendedRecord(before, after);
    return (
      basename !== null && successfulLoopRecord(record) && exactSubjectRef(record.ref, basename)
    );
  }
  return appendedLedgerLines(before, after) !== null;
}

function validateLedgerAppendBetween(root, from, to, file, basename) {
  if (!isLoopLedgerPath(file) || file === POST_MERGE_LEDGER) return false;
  return validateLedgerAppend(
    file,
    gitText(root, from, file) ?? '',
    gitText(root, to, file) ?? '',
    basename,
  );
}

/** True when every path is a ledger the change purely appends to — a commit with no planning unit. */
function onlyLedgerAppends(paths, textForPath, parentTextForPath) {
  return (
    paths.length > 0 &&
    paths.every((file) =>
      validateLedgerAppend(file, parentTextForPath(file) ?? '', textForPath(file) ?? '', null),
    )
  );
}

function isWorkRunReceiptPath(file) {
  return /^\.agents\/evals\/work-runs\/[0-9a-f-]+\/g(?:0|[1-9]\d*)-r(?:0|[1-9]\d*)\.json$/u.test(
    file,
  );
}

function correctionClosureOnly(paths, textForPath, parentTextForPath) {
  return (
    paths.length === 0 ||
    (paths.length === 1 && isWorkRunReceiptPath(paths[0])) ||
    onlyLedgerAppends(paths, textForPath, parentTextForPath)
  );
}

export function planningPreludeProblems(paths, basename, textForPath, parentTextForPath) {
  const problems = [];
  const ledgerAppend = (file) =>
    isLoopLedgerPath(file) &&
    file !== POST_MERGE_LEDGER &&
    validateLedgerAppend(file, parentTextForPath(file) ?? '', textForPath(file) ?? '', basename);
  const rewrittenLedgers = paths.filter(
    (file) => isLoopLedgerPath(file) && file !== POST_MERGE_LEDGER && !ledgerAppend(file),
  );
  for (const file of rewrittenLedgers) {
    problems.push(
      `prelude ledger \`${file}\` is not a pure append of JSON records (an existing line was rewritten, or a record is malformed).`,
    );
  }
  const unexpected = paths.filter(
    (file) =>
      !isPreCheckpointPlanningPath(file, basename) &&
      !ledgerAppend(file) &&
      !rewrittenLedgers.includes(file),
  );
  if (unexpected.length > 0) {
    problems.push(`non-planning prelude path(s): ${unexpected.join(', ')}.`);
  }
  for (const file of paths) {
    if (!isPreCheckpointPlanningPath(file, basename)) continue;
    const text = textForPath(file);
    if (text === null) {
      if (file === `${TASK_PREFIX}${basename}`) {
        problems.push(`prelude deletes Task \`${file}\` without a valid destination.`);
        continue;
      }
      const replacement = [...PRE_CHECKPOINT_SPEC_STATUS].some(([folder, expectedStatus]) => {
        const candidateText = textForPath(`${SPEC_PREFIX}${folder}/${basename}`);
        return (
          candidateText !== null &&
          frontmatterStatus(candidateText) === expectedStatus &&
          gateImplementPassCount(candidateText) === 0
        );
      });
      if (!replacement) {
        problems.push(
          `prelude deletes spec \`${file}\` without a valid same-basename destination.`,
        );
      }
      continue;
    }
    const status = frontmatterStatus(text);
    const expectedStatus =
      file === `${TASK_PREFIX}${basename}`
        ? 'todo'
        : PRE_CHECKPOINT_SPEC_STATUS.get(file.slice(SPEC_PREFIX.length).split('/', 1)[0]);
    if (status !== expectedStatus) {
      problems.push(
        `prelude path \`${file}\` has status \`${status ?? '(missing)'}\`; expected \`${expectedStatus}\` for this artifact and folder.`,
      );
    }
    if (specBasename(file) === basename && gateImplementPassCount(text) > 0) {
      problems.push(`prelude spec \`${file}\` already carries GATE-IMPLEMENT PASS.`);
    }
    if (specBasename(file) === basename && isL1Spec(text) && gatePlanPassHeadings(text) > 0) {
      problems.push(
        `prelude L1 spec \`${file}\` already carries a GATE-PLAN PASS entry that is not a complete planning checkpoint (todo/, status approved, the paired Task path and its SCENARIO DRAFTED outcome/count).`,
      );
    }
  }
  return problems;
}

function agreementProjection(text, heading) {
  const section = markdownSection(text ?? '', `## ${heading}`);
  if (section === null) return { missing: true, rows: [], malformed: [] };
  const rows = [];
  const malformed = [];
  for (const line of section.split('\n')) {
    if (!/^\s*[-*]\s+\[[ xX]\]/.test(line)) continue;
    const match =
      /^\s*[-*]\s+\[([ xX])\]\s+([A-Z][A-Z0-9]*-\d+)\s+—\s+(\S+)\s+—\s+`([^`]+)`\s*$/.exec(line);
    if (match === null) malformed.push(line);
    else
      rows.push({
        checked: match[1].toLowerCase() === 'x',
        id: match[2],
        status: match[3],
        taskPath: match[4],
      });
  }
  return { missing: false, rows, malformed };
}

function agreementPrelude(paths, textForPath, parentTextForPath) {
  const taskPaths = paths.filter(
    (file) => file.startsWith(TASK_PREFIX) && !file.slice(TASK_PREFIX.length).includes('/'),
  );
  const specPaths = paths.filter((file) => {
    const basename = specBasename(file);
    if (basename === null) return false;
    const folder = file.slice(SPEC_PREFIX.length).split('/', 1)[0];
    return PRE_CHECKPOINT_SPEC_STATUS.has(folder);
  });
  const parentTasks = taskPaths.filter((file) => {
    const id = subjectId(taskBasename(file) ?? '');
    return (
      id?.startsWith('AGREEMENT-') &&
      asList(frontmatterObject(textForPath(file) ?? '').children).length > 0
    );
  });
  const agreementSpecs = specPaths.filter(
    (file) => asScalar(frontmatterObject(textForPath(file) ?? '').type).trim() === 'AGREEMENT',
  );
  if (parentTasks.length === 0 && agreementSpecs.length === 0) return null;

  const problems = [];
  if (parentTasks.length !== 1 || agreementSpecs.length !== 1) {
    problems.push(
      `atomic AGREEMENT prelude requires exactly one parent Task and one AGREEMENT spec; found ${parentTasks.length} parent Task(s) and ${agreementSpecs.length} spec(s).`,
    );
    return { basename: null, problems };
  }

  const parentTaskPath = parentTasks[0];
  const parentSpecPath = agreementSpecs[0];
  const parentBasename = taskBasename(parentTaskPath);
  if (parentBasename === null || specBasename(parentSpecPath) !== parentBasename) {
    problems.push('atomic AGREEMENT parent Task and spec do not have the exact same basename.');
    return { basename: null, problems };
  }
  const parentTask = textForPath(parentTaskPath);
  const parentSpec = textForPath(parentSpecPath);
  if (parentTextForPath(parentTaskPath) !== null || parentTextForPath(parentSpecPath) !== null) {
    problems.push('atomic AGREEMENT parent Task/spec must both be newly added.');
  }
  if (frontmatterStatus(parentTask) !== 'todo') {
    problems.push('atomic AGREEMENT parent Task must have status `todo`.');
  }
  const specFolder = parentSpecPath.slice(SPEC_PREFIX.length).split('/', 1)[0];
  const expectedSpecStatus = PRE_CHECKPOINT_SPEC_STATUS.get(specFolder);
  if (frontmatterStatus(parentSpec) !== expectedSpecStatus) {
    problems.push(
      `atomic AGREEMENT spec in ${specFolder}/ must have status \`${expectedSpecStatus}\`.`,
    );
  }

  const parentFields = frontmatterObject(parentTask ?? '');
  const parentIssue = asScalar(parentFields.issue).trim();
  if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/.test(parentIssue)) {
    problems.push('atomic AGREEMENT parent must cite one concrete GitHub source issue.');
  }
  const children = asList(parentFields.children)
    .map((child) => child.trim())
    .filter(Boolean);
  if (new Set(children).size !== children.length) {
    problems.push('atomic AGREEMENT children must be unique.');
  }
  const childRecords = [];
  for (const childId of children) {
    const matches = taskPaths.filter((file) => subjectId(taskBasename(file) ?? '') === childId);
    if (matches.length !== 1) {
      problems.push(
        `atomic AGREEMENT child ${childId} must resolve to exactly one staged Task; found ${matches.length}.`,
      );
      continue;
    }
    const childPath = matches[0];
    const childText = textForPath(childPath);
    const childFields = frontmatterObject(childText ?? '');
    if (parentTextForPath(childPath) !== null)
      problems.push(`atomic AGREEMENT child ${childId} must be newly added.`);
    if (frontmatterStatus(childText) !== 'todo')
      problems.push(`atomic AGREEMENT child ${childId} must have status \`todo\`.`);
    if (asScalar(childFields.issue).trim() !== parentIssue) {
      problems.push(`atomic AGREEMENT child ${childId} must cite the parent source issue.`);
    }
    if (childId.startsWith('AGREEMENT-') || asList(childFields.children).length > 0) {
      problems.push(`atomic AGREEMENT child ${childId} must not be a nested AGREEMENT.`);
    }
    childRecords.push({ id: childId, taskPath: childPath });
  }

  const expectedPaths = new Set([
    parentTaskPath,
    parentSpecPath,
    ...childRecords.map((child) => child.taskPath),
  ]);
  for (const file of paths) {
    if (expectedPaths.has(file)) continue;
    if (
      isLoopLedgerPath(file) &&
      file !== POST_MERGE_LEDGER &&
      validateLedgerAppend(
        file,
        parentTextForPath(file) ?? '',
        textForPath(file) ?? '',
        parentBasename,
      )
    ) {
      continue;
    }
    problems.push(`atomic AGREEMENT prelude contains unrelated path \`${file}\`.`);
  }

  const expectedRows = childRecords
    .map(({ id, taskPath }) => JSON.stringify({ checked: false, id, status: 'todo', taskPath }))
    .sort();
  for (const [text, heading] of [
    [parentTask, 'Children'],
    [parentSpec, 'Tasks'],
  ]) {
    const projection = agreementProjection(text, heading);
    if (projection.missing) problems.push(`atomic AGREEMENT parent is missing ## ${heading}.`);
    if (projection.malformed.length > 0) {
      problems.push(`atomic AGREEMENT ## ${heading} has malformed row(s).`);
    }
    const actualRows = projection.rows.map((row) => JSON.stringify(row)).sort();
    if (JSON.stringify(actualRows) !== JSON.stringify(expectedRows)) {
      problems.push(`atomic AGREEMENT ## ${heading} must exactly project every declared child.`);
    }
  }
  return { basename: parentBasename, problems };
}

function allowedCheckpointPaths(root, from, to, paths, basename) {
  const sourceSpec = `${SPEC_PREFIX}todo/${basename}`;
  const validSourceDeletion =
    frontmatterStatus(gitText(root, from, sourceSpec)) === 'approved' &&
    gitText(root, to, sourceSpec) === null;
  const unexpected = paths.filter(
    (file) =>
      !isExactCheckpointPairPath(file, basename) &&
      !(file === sourceSpec && validSourceDeletion) &&
      !validateLedgerAppendBetween(root, from, to, file, basename),
  );
  return unexpected;
}

/**
 * An L1 checkpoint may change the Task, the `todo/` spec, delete the same-basename spec from the
 * pre-checkpoint folder it advanced out of (its parent status matching that folder), and append to
 * a ledger. Everything else is implementation mixed into planning.
 */
function allowedL1CheckpointPaths(paths, basename, textForPath, parentTextForPath) {
  const { taskPath, specPath } = l1SpecPaths(basename);
  const validSourceDeletion = (file) =>
    specBasename(file) === basename &&
    file !== specPath &&
    textForPath(file) === null &&
    frontmatterStatus(parentTextForPath(file)) ===
      PRE_CHECKPOINT_SPEC_STATUS.get(file.slice(SPEC_PREFIX.length).split('/', 1)[0]);
  return paths.filter(
    (file) =>
      file !== taskPath &&
      file !== specPath &&
      !validSourceDeletion(file) &&
      !validateLedgerAppend(file, parentTextForPath(file) ?? '', textForPath(file) ?? '', basename),
  );
}

function validateL1CheckpointCommit(root, parent, commit, paths, basename) {
  const { taskPath, specPath, draftPath } = l1SpecPaths(basename);
  const task = gitText(root, commit, taskPath);
  const spec = gitText(root, commit, specPath);
  const problems = [];
  if (task === null || spec === null) {
    problems.push(`checkpoint does not contain exact L1 pair \`${taskPath}\` + \`${specPath}\`.`);
    return problems;
  }
  problems.push(
    ...evaluateL1PlanTexts({
      basename,
      parentSpecs: [gitText(root, parent, specPath), gitText(root, parent, draftPath)],
      task,
      spec,
    }),
  );
  const unexpected = allowedL1CheckpointPaths(
    paths,
    basename,
    (file) => gitText(root, commit, file),
    (file) => gitText(root, parent, file),
  );
  if (unexpected.length > 0) {
    problems.push(
      `checkpoint mixes planning with implementation path(s): ${unexpected.join(', ')}.`,
    );
  }
  return problems;
}

function validateCheckpointCommit(root, parent, commit, paths, basename) {
  const taskPath = `${TASK_PREFIX}${basename}`;
  const specPath = `${SPEC_PREFIX}active/${basename}`;
  const task = gitText(root, commit, taskPath);
  const spec = gitText(root, commit, specPath);
  const parentTask = gitText(root, parent, taskPath);
  const parentSpec = gitText(root, parent, specPath);
  const problems = [];
  if (task === null || spec === null) {
    problems.push(
      `checkpoint does not contain exact active pair \`${taskPath}\` + \`${specPath}\`.`,
    );
    return problems;
  }
  problems.push(
    ...evaluatePlanTexts({
      basename,
      parentTask,
      parentSpec,
      task,
      spec,
      ruleText: gitText(root, commit, BACKLOG_RULE_PATH),
      checkpointOptions: checkpointOptionsAt(root, commit, basename, parent, paths),
    }),
  );
  const unexpected = allowedCheckpointPaths(root, parent, commit, paths, basename);
  if (unexpected.length > 0) {
    problems.push(
      `checkpoint mixes planning with implementation path(s): ${unexpected.join(', ')}.`,
    );
  }
  return problems;
}

function validatePostMergeRecord(root, before, after, base) {
  const record = appendedRecord(before, after);
  if (!successfulLoopRecord(record)) return false;
  const prMatches = [...String(record.ref ?? '').matchAll(/\bPR\s+#(\d+)\b/g)];
  const prNumber = prMatches.length === 1 ? prMatches[0][1] : null;
  if (!prNumber || !/\bMERGE VERIFIED PASS\b/.test(String(record.ref ?? ''))) return false;
  const hashes = String(record.ref).match(/\b[0-9a-f]{7,40}\b/gi) ?? [];
  const mergeOid = hashes.length === 1 ? hashes[0] : null;
  if (mergeOid === null) return false;
  const resolves = runGit(root, ['rev-parse', '--verify', '--quiet', `${mergeOid}^{commit}`]);
  if (resolves.code !== 0) return false;
  if (runGit(root, ['merge-base', '--is-ancestor', mergeOid, base]).code !== 0) return false;
  const subject = runGit(root, ['show', '-s', '--format=%s', mergeOid]);
  return (
    subject.code === 0 &&
    (subject.stdout.includes(`(#${prNumber})`) ||
      new RegExp(`\\bpull request #${prNumber}\\b`, 'i').test(subject.stdout))
  );
}

function validatePostMergePrelude(root, parent, commit, paths, base) {
  if (paths.length !== 1 || paths[0] !== POST_MERGE_LEDGER) return false;
  const before = gitText(root, parent, POST_MERGE_LEDGER) ?? '';
  const after = gitText(root, commit, POST_MERGE_LEDGER) ?? '';
  return validatePostMergeRecord(root, before, after, base);
}

export function resolveTopicMergeBase(root, requested, env = process.env) {
  const githubBase = env.GITHUB_BASE_REF
    ? env.GITHUB_BASE_REF.startsWith('origin/')
      ? env.GITHUB_BASE_REF
      : `origin/${env.GITHUB_BASE_REF}`
    : null;
  const candidates = requested
    ? [requested]
    : [env.HARNESS_BASE_REF, githubBase, 'origin/develop'].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = runGit(root, ['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`]);
    if (resolved.code !== 0) continue;
    const mergeBase = runGit(root, ['merge-base', 'HEAD', candidate]);
    if (mergeBase.code === 0 && mergeBase.stdout.trim()) return mergeBase.stdout.trim();
  }
  throw new Error(`no merge base could be resolved from ${candidates.join(', ') || '(none)'}`);
}

/**
 * The root must BE a git worktree's top level — not merely a directory from which git discovery
 * finds some repository above it. Measured (PROC-016): with `HARNESS_BASE_REF` set, a finder run
 * against a bare scratch root resolved the enclosing repository's commits and returned an empty
 * list — a pass over a tree it never read, the exact shape `scan-guard-scope-fail-closed` hunts.
 */
function requireWorktreeTopLevel(root) {
  if (!existsSync(path.join(root, '.git')))
    throw new Error(
      `${root} has no .git — not a git worktree; the governed population is this root's own history`,
    );
  const result = runGit(root, ['rev-parse', '--show-toplevel']);
  const top = result.code === 0 ? result.stdout.trim() : '';
  let same = false;
  try {
    same = top !== '' && realpathSync(top) === realpathSync(root);
  } catch {
    same = false;
  }
  if (!same)
    throw new Error(
      `${root} is not the top level of a git worktree (git rev-parse --show-toplevel → ${top || result.stderr || '(nothing)'}); the governed population is this root's own history`,
    );
}

function historyAnalysis(root = WORKSPACE_ROOT, requestedBase = undefined) {
  requireWorktreeTopLevel(root);
  const base = resolveTopicMergeBase(root, requestedBase);
  const planState = userExecutionPlanContractState(root);
  if (planState.cutovers.length === 0 && planState.markerCommits.length > 0) {
    return {
      base,
      commits: [],
      examined: 0,
      checkpoint: null,
      pendingBasename: null,
      findings: [
        finding('user-execution PLAN contract markers exist but no valid cutover can be proven.'),
      ],
    };
  }
  if (planState.cutovers.length > 1) {
    return {
      base,
      commits: [],
      examined: 0,
      checkpoint: null,
      pendingBasename: null,
      findings: [
        finding(
          `user-execution PLAN contract cutover is ambiguous: ${planState.cutovers.join(', ')}.`,
        ),
      ],
    };
  }
  if (planState.cutovers.length === 1 && !planState.valid) {
    return {
      base,
      commits: [],
      examined: 0,
      checkpoint: null,
      pendingBasename: null,
      findings: [
        finding('user-execution PLAN contract is missing or invalid after the v1 cutover.'),
      ],
    };
  }
  const checkpointState = checkpointEvidenceContractState(root);
  if (checkpointState.cutovers.length === 0 && checkpointState.markerCommits.length > 0) {
    return {
      base,
      commits: [],
      examined: 0,
      checkpoint: null,
      pendingBasename: null,
      findings: [
        finding(
          'checkpoint evidence contract markers exist but no valid v1 cutover can be proven.',
        ),
      ],
    };
  }
  if (checkpointState.cutovers.length > 1) {
    return {
      base,
      commits: [],
      examined: 0,
      checkpoint: null,
      pendingBasename: null,
      findings: [
        finding(
          `checkpoint evidence contract cutover is ambiguous: ${checkpointState.cutovers.join(', ')}.`,
        ),
      ],
    };
  }
  if (checkpointState.cutovers.length === 1 && !checkpointState.valid) {
    return {
      base,
      commits: [],
      examined: 0,
      checkpoint: null,
      pendingBasename: null,
      findings: [
        finding('checkpoint evidence contract is missing or invalid after the v1 cutover.'),
      ],
    };
  }
  if (
    checkpointState.correctionCutovers.length === 0 &&
    checkpointState.correctionMarkerCommits.length > 0
  ) {
    return {
      base,
      commits: [],
      examined: 0,
      checkpoint: null,
      pendingBasename: null,
      findings: [
        finding('checkpoint correction-form markers exist but no valid cutover can be proven.'),
      ],
    };
  }
  if (checkpointState.correctionCutovers.length > 1) {
    return {
      base,
      commits: [],
      examined: 0,
      checkpoint: null,
      pendingBasename: null,
      findings: [
        finding(
          `checkpoint correction-form cutover is ambiguous: ${checkpointState.correctionCutovers.join(', ')}.`,
        ),
      ],
    };
  }
  if (checkpointState.correctionCutovers.length === 1 && !checkpointState.correctionValid) {
    return {
      base,
      commits: [],
      examined: 0,
      checkpoint: null,
      pendingBasename: null,
      findings: [finding('checkpoint correction form is missing or invalid after its cutover.')],
    };
  }
  // Contained — HARNESS-130. `--no-merges`: this scan attributes a commit's content by diffing it
  // against its parent, which is defined for a single-parent commit and undefined for a merge —
  // `commit^` is the FIRST parent, so a merge whose first parent is the base diffs as the other
  // side's whole history. CI evaluates `refs/pull/N/merge`, exactly that shape: the checkpoint's
  // todo → active transition inside the merge's diff read as a second candidate and refused every
  // PR whose spec was still in-progress (issue #2373); on the branch tip a back-merge carrying the
  // base's content was refused the same way. Fail direction, stated: merges are EXCLUDED, so a
  // merge's OWN pre-checkpoint content — a conflict resolution introducing a path in neither
  // parent — is not judged on this path. That residual, and the staged path's mirror of it, is
  // HARNESS-130's.
  const listed = runGit(root, [
    'rev-list',
    '--reverse',
    '--topo-order',
    '--no-merges',
    `${base}..HEAD`,
  ]);
  if (listed.code !== 0) {
    throw new Error(`git rev-list failed: ${listed.stderr || '(no stderr)'}`);
  }
  const commits = lines(listed.stdout);
  let examined = 0;
  const entries = commits.map((commit) => {
    examined += 1;
    const parentResult = runGit(root, ['rev-parse', `${commit}^`]);
    if (parentResult.code !== 0) {
      throw new Error(
        `cannot resolve parent of ${commit}: ${parentResult.stderr || '(no stderr)'}`,
      );
    }
    const parent = parentResult.stdout.trim();
    return { commit, parent, paths: changedPaths(root, parent, commit) };
  });

  const textIn = (revision) => (file) => gitText(root, revision, file);
  const candidates = [];
  for (const entry of entries) {
    // `--no-renames` reports both deleted active paths during completion. A checkpoint candidate
    // must CONTAIN the pair in its resulting tree, not merely mention their deletion.
    const transitions = checkpointTransitions(
      entry.paths,
      textIn(entry.commit),
      textIn(entry.parent),
      (basename) => checkpointOptionsAt(root, entry.commit, basename, entry.parent, entry.paths),
    );
    const malformed =
      transitions.length === 0
        ? malformedL2CheckpointCandidates(entry.paths, textIn(entry.commit), textIn(entry.parent))
        : [];
    if (transitions.length > 0 || malformed.length > 0) {
      candidates.push({
        ...entry,
        pairs:
          transitions.length > 0 ? transitions.map((transition) => transition.basename) : malformed,
        lanes: new Map(
          transitions.length > 0
            ? transitions.map((transition) => [transition.basename, transition.lane])
            : malformed.map((basename) => [basename, 'L2']),
        ),
      });
    }
  }
  const findings = [];
  if (candidates.length === 0) {
    let postMergePreludes = 0;
    let pendingBasename = null;
    let planningStarted = false;
    for (const entry of entries) {
      if (entry.paths.length === 0) continue;
      if (onlyLedgerAppends(entry.paths, textIn(entry.commit), textIn(entry.parent))) continue;
      if (validatePostMergePrelude(root, entry.parent, entry.commit, entry.paths, base)) {
        postMergePreludes += 1;
        if (postMergePreludes > 1 || planningStarted) {
          findings.push(
            finding(
              'more than one predecessor post-merge prelude exists, or the prelude appears after planning began.',
              entry.commit,
            ),
          );
        }
        continue;
      }
      if (entry.paths.includes(POST_MERGE_LEDGER)) {
        findings.push(
          finding(
            'predecessor post-merge ledger is not one append-only closed record exactly bound to a verified PR merge ancestor of the topic base.',
            entry.commit,
          ),
        );
        continue;
      }
      const agreement = agreementPrelude(entry.paths, textIn(entry.commit), textIn(entry.parent));
      if (agreement !== null) {
        if (
          agreement.problems.length > 0 ||
          (pendingBasename !== null && pendingBasename !== agreement.basename)
        ) {
          findings.push(
            finding(
              `implementation exists with no planning checkpoint: ${entry.paths.join(', ')}${agreement.problems.length > 0 ? ` (${agreement.problems.join(' ')})` : ''}.`,
              entry.commit,
            ),
          );
          continue;
        }
        planningStarted = true;
        pendingBasename = agreement.basename;
        continue;
      }
      const basenames = planningBasenames(entry.paths);
      const basename = basenames.length === 1 ? basenames[0] : null;
      const preludeProblems =
        basename === null
          ? ['paths do not identify exactly one planning unit.']
          : planningPreludeProblems(
              entry.paths,
              basename,
              textIn(entry.commit),
              textIn(entry.parent),
            );
      if (
        preludeProblems.length > 0 ||
        (pendingBasename !== null && pendingBasename !== basename)
      ) {
        findings.push(
          finding(
            `implementation exists with no planning checkpoint: ${entry.paths.join(', ') || '(empty commit)'}${preludeProblems.length > 0 ? ` (${preludeProblems.join(' ')})` : ''}.`,
            entry.commit,
          ),
        );
        continue;
      }
      planningStarted = true;
      pendingBasename = basename;
    }
    return { base, commits, examined, checkpoint: null, pendingBasename, findings };
  }

  const first = candidates[0];
  if (first.pairs.length !== 1) {
    findings.push(
      finding(
        `checkpoint is ambiguous: multiple Task/spec pairs changed (${first.pairs.join(', ')}).`,
        first.commit,
      ),
    );
    return { base, commits, examined, checkpoint: null, findings };
  }
  const basename = first.pairs[0];
  let postMergePreludes = 0;
  let planningStarted = false;
  for (const entry of entries) {
    if (entry.commit === first.commit) break;
    if (validatePostMergePrelude(root, entry.parent, entry.commit, entry.paths, base)) {
      postMergePreludes += 1;
      if (postMergePreludes > 1 || planningStarted) {
        findings.push(
          finding(
            'more than one predecessor post-merge prelude exists, or the prelude appears after planning began.',
            entry.commit,
          ),
        );
      }
      continue;
    }
    if (entry.paths.includes(POST_MERGE_LEDGER)) {
      findings.push(
        finding(
          'predecessor post-merge ledger is not one append-only closed record exactly bound to a verified PR merge ancestor of the topic base.',
          entry.commit,
        ),
      );
    }
    const preludeProblems = planningPreludeProblems(
      entry.paths,
      basename,
      textIn(entry.commit),
      textIn(entry.parent),
    );
    if (preludeProblems.length > 0) {
      findings.push(
        finding(
          `implementation or invalid-lifecycle path(s) changed before the planning checkpoint: ${preludeProblems.join(' ')}`,
          entry.commit,
        ),
      );
    }
    if (entry.paths.some((file) => isPreCheckpointPlanningPath(file, basename))) {
      planningStarted = true;
    }
  }
  const lane = first.lanes.get(basename);
  const validateCheckpoint = lane === 'L1' ? validateL1CheckpointCommit : validateCheckpointCommit;
  for (const problem of validateCheckpoint(
    root,
    first.parent,
    first.commit,
    first.paths,
    basename,
  )) {
    findings.push(finding(problem, first.commit));
  }
  if (candidates.length > 1) {
    findings.push(
      finding(
        `multiple planning checkpoint candidates exist (${candidates.map((c) => c.commit.slice(0, 9)).join(', ')}).`,
      ),
    );
  }
  const parentPasses = rawGateImplementPassEntries(
    gitText(root, first.parent, `${SPEC_PREFIX}active/${basename}`),
  );
  const currentPasses = rawGateImplementPassEntries(
    gitText(root, first.commit, `${SPEC_PREFIX}active/${basename}`),
  );
  const checkpointForm =
    lane === 'L2' ? gateImplementEntryForm(currentPasses[parentPasses.length]) : 'first';
  const firstEntryIndex = entries.findIndex((entry) => entry.commit === first.commit);
  for (const entry of entries.slice(firstEntryIndex + 1)) {
    if (
      checkpointForm === 'correction' &&
      !correctionClosureOnly(entry.paths, textIn(entry.commit), textIn(entry.parent))
    ) {
      findings.push(
        finding(
          `correction checkpoint must reach the integration base before implementation; a later branch must record continuation first. Unexpected path(s): ${entry.paths.join(', ') || '(none)'}.`,
          entry.commit,
        ),
      );
    }
    const secondary = checkpointTransitions(
      entry.paths,
      textIn(entry.commit),
      textIn(entry.parent),
      (candidateBasename) =>
        checkpointOptionsAt(root, entry.commit, candidateBasename, entry.parent, entry.paths),
    )
      .map((transition) => transition.basename)
      .filter((candidateBasename) => candidateBasename !== basename);
    if (secondary.length > 0) {
      findings.push(
        finding(
          `second work-unit planning checkpoint transition exists after \`${basename}\`: ${secondary.join(', ')}.`,
          entry.commit,
        ),
      );
    }
  }
  return {
    base,
    commits,
    examined,
    checkpoint: { commit: first.commit, basename, lane, form: checkpointForm },
    pendingBasename: null,
    findings,
  };
}

export function findHistoryFindings(root = WORKSPACE_ROOT, requestedBase = undefined) {
  try {
    return historyAnalysis(root, requestedBase).findings;
  } catch (error) {
    return [
      finding(
        `history query failed closed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ];
  }
}

/** Exported so the self-reported traversal size is asserted as an output. */
export function readExaminedPlanOrderCount(root = WORKSPACE_ROOT, requestedBase = undefined) {
  return historyAnalysis(root, requestedBase).examined;
}

/**
 * A staged `todo/` spec that declares `lane: L1` and carries any GATE-PLAN PASS heading is a
 * proposed L1 checkpoint — judged in full below so an incomplete entry is refused by name rather
 * than falling through to the prelude rule's generic refusal.
 */
function l1StagedPairs(root, paths) {
  return l1SpecCandidates(paths).filter((basename) => {
    const spec = indexText(root, `${SPEC_PREFIX}todo/${basename}`);
    return spec !== null && isL1Spec(spec) && gatePlanPassHeadings(spec) > 0;
  });
}

function stagedLedgerProblems(root, paths, basename) {
  const problems = [];
  for (const file of paths) {
    if (!isLoopLedgerPath(file) || file === POST_MERGE_LEDGER) continue;
    const before = gitText(root, 'HEAD', file) ?? '';
    const after = indexText(root, file) ?? '';
    if (validateLedgerAppend(file, before, after, basename)) continue;
    problems.push(
      file === UES_LEDGER
        ? 'proposed PLAN ledger is not one append-only closed record subject-bound to the exact Task.'
        : `proposed ledger \`${file}\` is not a pure append of JSON records (an existing line was rewritten, or a record is malformed).`,
    );
  }
  return problems;
}

function stagedCheckpoint(root, paths) {
  const activePairs = pairCandidates(paths, (file) => indexText(root, file));
  const l1Pairs = l1StagedPairs(root, paths).filter((basename) => !activePairs.includes(basename));
  const pairs = [...activePairs, ...l1Pairs];
  if (pairs.length !== 1) return { pairs, problems: [] };
  const basename = pairs[0];
  const problems = [];
  const stagedText = (file) => indexText(root, file);
  const headText = (file) => gitText(root, 'HEAD', file);
  if (l1Pairs.length === 1) {
    const { taskPath, specPath, draftPath } = l1SpecPaths(basename);
    const task = stagedText(taskPath);
    const spec = stagedText(specPath);
    if (task === null || spec === null) {
      problems.push(
        `proposed L1 checkpoint does not stage the exact Task/todo-spec pair \`${basename}\`.`,
      );
    } else {
      problems.push(
        ...evaluateL1PlanTexts({
          basename,
          parentSpecs: [headText(specPath), headText(draftPath)],
          task,
          spec,
        }),
      );
    }
    const unexpected = allowedL1CheckpointPaths(paths, basename, stagedText, headText).filter(
      (file) => !isLoopLedgerPath(file) || file === POST_MERGE_LEDGER,
    );
    if (unexpected.length > 0) {
      problems.push(`proposed checkpoint mixes implementation path(s): ${unexpected.join(', ')}.`);
    }
    problems.push(...stagedLedgerProblems(root, paths, basename));
    return { pairs, basename, problems };
  }
  const taskPath = `${TASK_PREFIX}${basename}`;
  const specPath = `${SPEC_PREFIX}active/${basename}`;
  const task = stagedText(taskPath);
  const spec = stagedText(specPath);
  const parentTask = headText(taskPath);
  const parentSpec = headText(specPath);
  if (task === null || spec === null) {
    problems.push(
      `proposed checkpoint does not stage the exact active Task/spec pair \`${basename}\`.`,
    );
  } else {
    problems.push(
      ...evaluatePlanTexts({
        basename,
        parentTask,
        parentSpec,
        task,
        spec,
        ruleText: stagedText(BACKLOG_RULE_PATH),
        checkpointOptions: checkpointOptionsAt(root, 'HEAD', basename, 'HEAD', paths),
      }),
    );
  }
  const sourceSpec = `${SPEC_PREFIX}todo/${basename}`;
  const validSourceDeletion =
    frontmatterStatus(headText(sourceSpec)) === 'approved' && stagedText(sourceSpec) === null;
  const unexpected = paths.filter(
    (file) =>
      !isExactCheckpointPairPath(file, basename) &&
      !(file === sourceSpec && validSourceDeletion) &&
      (!isLoopLedgerPath(file) || file === POST_MERGE_LEDGER),
  );
  if (unexpected.length > 0) {
    problems.push(`proposed checkpoint mixes implementation path(s): ${unexpected.join(', ')}.`);
  }
  problems.push(...stagedLedgerProblems(root, paths, basename));
  return { pairs, basename, problems };
}

export function findStagedFindings(root = WORKSPACE_ROOT, requestedBase = undefined) {
  try {
    const staged = stagedPaths(root);
    if (staged.length === 0) return [];
    const history = historyAnalysis(root, requestedBase);
    if (history.findings.length > 0) return history.findings;
    if (staged.includes(BACKLOG_RULE_PATH)) {
      const stagedRule = indexText(root, BACKLOG_RULE_PATH);
      const stagedContract = parseCheckpointEvidenceContract(stagedRule);
      if (!stagedContract.ok) {
        return [
          finding(`staged checkpoint evidence contract is unreadable: ${stagedContract.error}.`),
        ];
      }
      const committedState = checkpointEvidenceContractState(root, 'HEAD');
      const requiresCorrectionForm = committedState.correctionCutovers.length === 1;
      const stagedContracts = parseCheckpointEvidenceContracts(stagedRule);
      if (
        !stagedContracts.ok ||
        (requiresCorrectionForm &&
          !String(stagedRule).includes(CHECKPOINT_EVIDENCE_CONTRACT_MARKERS.correctionForm))
      ) {
        return [
          finding(
            `staged checkpoint correction form is unreadable: ${stagedContracts.ok ? 'marker missing after cutover' : stagedContracts.error}.`,
          ),
        ];
      }
      if (String(stagedRule).includes('user-execution-plan-contract:v1:')) {
        const stagedPlanContract = parseUserExecutionPlanContract(stagedRule);
        if (!stagedPlanContract.ok) {
          return [
            finding(
              `staged user-execution PLAN contract is unreadable: ${stagedPlanContract.error}.`,
            ),
          ];
        }
      }
    }
    if (staged.includes(POST_MERGE_LEDGER)) {
      const before = gitText(root, 'HEAD', POST_MERGE_LEDGER) ?? '';
      const after = indexText(root, POST_MERGE_LEDGER) ?? '';
      const priorTopicLedgerChange = history.commits.some((commit) =>
        changedPaths(root, `${commit}^`, commit).includes(POST_MERGE_LEDGER),
      );
      const residue = worktreePaths(root);
      const validPrelude =
        staged.length === 1 &&
        history.checkpoint == null &&
        history.pendingBasename == null &&
        !priorTopicLedgerChange &&
        residue.length === 0 &&
        validatePostMergeRecord(root, before, after, history.base);
      return validPrelude
        ? []
        : [
            finding(
              'staged predecessor post-merge ledger is not one planning-free append-only verified PR merge record, or is mixed with other worktree paths.',
            ),
          ];
    }
    const stagedText = (file) => indexText(root, file);
    const headText = (file) => gitText(root, 'HEAD', file);
    if (history.checkpoint) {
      const residue = worktreePaths(root);
      if (
        history.checkpoint.form === 'correction' &&
        (!correctionClosureOnly(staged, stagedText, headText) || residue.length > 0)
      ) {
        return [
          finding(
            'correction checkpoint must reach the integration base before implementation; a later branch must record continuation first.',
          ),
        ];
      }
      // A same-basename re-transition is refused here too, as before: the checkpoint already exists.
      const secondary = checkpointTransitions(staged, stagedText, headText, (basename) =>
        checkpointOptionsAt(root, 'HEAD', basename, 'HEAD', staged),
      ).map((transition) => transition.basename);
      return secondary.length === 0
        ? []
        : [
            finding(
              `second work-unit planning checkpoint transition is staged after \`${history.checkpoint.basename}\`: ${secondary.join(', ')}.`,
            ),
          ];
    }

    const proposed = stagedCheckpoint(root, staged);
    const findings = proposed.problems.map((problem) => finding(problem));
    if (proposed.pairs.length === 0) {
      const agreement = agreementPrelude(staged, stagedText, headText);
      if (agreement !== null) {
        findings.push(...agreement.problems.map((problem) => finding(problem)));
        if (history.pendingBasename !== null) {
          findings.push(
            finding(
              `atomic AGREEMENT prelude cannot replace pending planning unit \`${history.pendingBasename}\`.`,
            ),
          );
        }
        const residue = worktreePaths(root);
        if (residue.length > 0) {
          findings.push(
            finding(
              `unstaged or untracked path(s) exist during planning prelude: ${residue.join(', ')}.`,
            ),
          );
        }
        return findings;
      }
      const basenames = planningBasenames(staged);
      const basename = basenames.length === 1 ? basenames[0] : null;
      const preludeProblems =
        basename === null
          ? onlyLedgerAppends(staged, stagedText, headText)
            ? []
            : ['paths do not identify exactly one planning unit.']
          : planningPreludeProblems(staged, basename, stagedText, headText);
      if (
        preludeProblems.length > 0 ||
        (basename !== null &&
          history.pendingBasename !== null &&
          history.pendingBasename !== basename)
      ) {
        findings.push(finding('staged implementation has no planning checkpoint ancestor.'));
      }
      const residue = worktreePaths(root);
      if (residue.length > 0) {
        findings.push(
          finding(
            `unstaged or untracked path(s) exist during planning prelude: ${residue.join(', ')}.`,
          ),
        );
      }
      return findings;
    }
    if (proposed.pairs.length > 1) {
      findings.push(
        finding(`proposed checkpoint is ambiguous: multiple pairs (${proposed.pairs.join(', ')}).`),
      );
      return findings;
    }
    if (history.pendingBasename !== null && history.pendingBasename !== proposed.basename) {
      findings.push(
        finding(
          `proposed checkpoint \`${proposed.basename}\` does not match pending planning unit \`${history.pendingBasename}\`.`,
        ),
      );
    }
    const outside = worktreePaths(root);
    if (outside.length > 0) {
      findings.push(
        finding(`non-planning worktree path(s) exist during checkpoint: ${outside.join(', ')}.`),
      );
    }
    return findings;
  } catch (error) {
    return [
      finding(
        `staged query failed closed: ${error instanceof Error ? error.message : String(error)}`,
      ),
    ];
  }
}

function argumentValue(args, name) {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

export function scanUserExecutionPlanOrder(args = process.argv.slice(2)) {
  const staged = args.includes('--staged');
  const requestedBase = argumentValue(args, '--base');
  const result = staged
    ? {
        findings: findStagedFindings(WORKSPACE_ROOT, requestedBase),
        examined: stagedPaths(WORKSPACE_ROOT).length,
      }
    : (() => {
        try {
          const analysis = historyAnalysis(WORKSPACE_ROOT, requestedBase);
          return { findings: analysis.findings, examined: analysis.examined };
        } catch (error) {
          return {
            findings: [
              finding(
                `history query failed closed: ${error instanceof Error ? error.message : String(error)}`,
              ),
            ],
            examined: 0,
          };
        }
      })();
  return { staged, ...result };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const result = scanUserExecutionPlanOrder();
  for (const item of result.findings) {
    const where = item.commit ? ` (${item.commit.slice(0, 9)})` : '';
    process.stderr.write(`✗ user-execution-plan-order${where}: ${item.problem}\n`);
  }
  if (result.examined === 0) {
    const message = result.staged
      ? '::examined:: 0 staged path(s) ::expected-empty:: the proposed commit index is empty'
      : '::examined:: 0 topic commit(s) ::expected-empty:: no non-merge commits beyond the integration merge base (merges are excluded from the enumeration)';
    process.stdout.write(`${message}\n`);
  } else {
    process.stdout.write(
      `::examined:: ${result.examined} ${result.staged ? 'staged path(s)' : 'topic commit(s)'}\n`,
    );
  }
  process.exitCode = result.findings.length > 0 ? 1 : 0;
}
