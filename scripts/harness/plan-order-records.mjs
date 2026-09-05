/**
 * The RECORD VOCABULARY `scan-user-execution-plan-order.mjs` classifies paths with, and the L0
 * GROUND defined over it (issue #2539).
 *
 * The guard itself is about ORDER — did the user-execution PLAN complete before implementation. This
 * module holds the two things that are not that judgement: which repository paths are Task and spec
 * records (and which basename each names), and, for an L0 unit, what may stand in for the planning
 * checkpoint the L0 lane never reaches.
 *
 * L0 (`.agents/rules/spec-workflow.md` § Lanes) has no spec document, so it has no `todo/` GATE-PLAN
 * PASS and no `active/` GATE-IMPLEMENT PASS to move to. What it does have is the planning PRELUDE —
 * the commit that records the Task with its exact `SCENARIO DRAFTED` author verdict — and that is
 * the same causal boundary a checkpoint proves. `l0GroundDecision` accepts an implementation on that
 * ground only when BOTH hold:
 *
 *   - the pending unit carries no spec document in ANY lifecycle folder, so this form can never
 *     stand in for an L1/L2 unit's checkpoint; and
 *   - every changed path sits at lane floor L0, derived from `spec-workflow.md` § "Lane floors" —
 *     the table `scan-lane-declaration.mjs` owns, read here rather than copied.
 *
 * The second half is what keeps the loosening honest: a diff that reaches L1 or L2 under an L0
 * ground is refused by name, and a floors table that cannot be read is refused too, because a bound
 * this module cannot compute is a bound it cannot grant.
 */

import {
  findLaneFloors,
  parseLaneFloors,
  parseSpecTriggerSections,
} from './scan-lane-declaration.mjs';
import { asScalar, frontmatterObject } from './frontmatter.mjs';

export const TASK_PREFIX = '.agents/tasks/';
export const SPEC_PREFIX = '.agents/spec-docs/';

/** The rule whose § "Lane floors" table bounds what an L0 ground may carry (issue #2539). */
export const LANE_RULE_PATH = '.agents/rules/spec-workflow.md';
/** Every folder a spec document can live in — an L0 unit has one in none of them. */
const SPEC_LIFECYCLE_FOLDERS = ['draft', 'backlog', 'todo', 'active', 'done', 'rejected'];
const SPEC_FOLDERS = new Set(['draft', 'backlog', 'todo', 'active', 'done']);
export const PRE_CHECKPOINT_SPEC_STATUS = new Map([
  ['draft', 'draft'],
  ['backlog', 'review-ready'],
  ['todo', 'approved'],
]);

export function taskBasename(file) {
  if (!file.startsWith(TASK_PREFIX)) return null;
  const relative = file.slice(TASK_PREFIX.length);
  const withoutCompleted = relative.startsWith('completed/')
    ? relative.slice('completed/'.length)
    : relative;
  return withoutCompleted.endsWith('.md') ? withoutCompleted : null;
}

export function specBasename(file) {
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
export function l1SpecCandidates(paths) {
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

export function pairCandidates(paths, readTask) {
  return [
    ...new Set([...activePairCandidates(paths), ...continuationPairCandidates(paths, readTask)]),
  ].sort();
}

export function subjectId(basename) {
  const match = /^([A-Z][A-Z0-9]*-\d+)(?:-|\.md)/.exec(basename);
  return match?.[1] ?? null;
}

export function isExactCheckpointPairPath(file, basename) {
  return file === `${TASK_PREFIX}${basename}` || file === `${SPEC_PREFIX}active/${basename}`;
}

export function isPreCheckpointPlanningPath(file, basename) {
  if (file === `${TASK_PREFIX}${basename}`) return true;
  if (!file.startsWith(SPEC_PREFIX) || specBasename(file) !== basename) return false;
  const folder = file.slice(SPEC_PREFIX.length).split('/', 1)[0];
  return PRE_CHECKPOINT_SPEC_STATUS.has(folder);
}

export function l1SpecPaths(basename) {
  return {
    taskPath: `${TASK_PREFIX}${basename}`,
    specPath: `${SPEC_PREFIX}todo/${basename}`,
    draftPath: `${SPEC_PREFIX}draft/${basename}`,
  };
}

/**
 * The planning units a change set names. `taskBasename` strips a leading `completed/` and
 * `specBasename` accepts `done/`, so a change that repairs several historical records names more
 * than one unit and no single one can be identified — which is what issue #2539 measured. Filtering
 * closed records out here was tried and REMOVED: it changed no verdict, because a change that names
 * no unit and one that names three both fall to the same refusal, and `l0GroundDecision` below is
 * what actually distinguishes a grounded L0 repair from an ungrounded one. An unfalsifiable
 * refinement is worse than none.
 */
export function planningBasenames(paths) {
  return [
    ...new Set(paths.map((file) => taskBasename(file) ?? specBasename(file)).filter(Boolean)),
  ].sort();
}

/**
 * Why the pending unit `basename` cannot GROUND an L0 implementation (issue #2539), read from the
 * tree that existed BEFORE the change under judgement — so the ground is causally prior, never
 * something the implementation grants itself.
 */
function l0GroundProblems(basename, textAt, planSignal) {
  const task = textAt(`${TASK_PREFIX}${basename}`);
  if (task === null) {
    return [`the pending planning unit \`${basename}\` has no Task record to ground on.`];
  }
  if (planSignal(task) === null) {
    return [
      `the pending Task \`${basename}\` records no single subject-bound \`SCENARIO DRAFTED\` author verdict, so no user-execution PLAN precedes this implementation.`,
    ];
  }
  const spec = SPEC_LIFECYCLE_FOLDERS.map((folder) => `${SPEC_PREFIX}${folder}/${basename}`).find(
    (file) => textAt(file) !== null,
  );
  if (spec !== undefined) {
    return [
      `the pending unit \`${basename}\` carries the spec document \`${spec}\`, so it is an L1/L2 unit and reaches its own planning checkpoint — the L0 ground does not apply to it.`,
    ];
  }
  return [];
}

/**
 * The lane floor the changed paths reach, judged against `spec-workflow.md` § "Lane floors" — the
 * SSOT `scan-lane-declaration` derives its own criteria from, read here rather than copied.
 *
 * Returns `null` when every path sits at floor L0, and a problem string otherwise. No diff text is
 * supplied, so a `#non-comment` row counts as code (`floorForPath`'s documented upward default) and a
 * floors table that cannot be read is a refusal: a bound this scan cannot compute is a bound it
 * cannot grant.
 */
function laneFloorAboveL0(paths, ruleText) {
  if (typeof ruleText !== 'string' || ruleText.trim() === '') {
    return `the lane floors table (\`${LANE_RULE_PATH}\` § "Lane floors") could not be read, so the L0 bound could not be computed.`;
  }
  let perPath;
  try {
    perPath = findLaneFloors({
      changedPaths: paths,
      diffText: '',
      floors: parseLaneFloors(ruleText),
      specTriggerSections: parseSpecTriggerSections(ruleText),
    }).perPath;
  } catch (error) {
    return `the lane floors could not be judged: ${error instanceof Error ? error.message : String(error)}`;
  }
  const above = perPath.filter((entry) => entry.floor !== 'L0');
  return above.length === 0
    ? null
    : `path(s) above lane floor L0: ${above.map((entry) => `${entry.path} (${entry.floor})`).join(', ')}`;
}

/**
 * Whether an implementation is grounded by an ancestor L0 planning unit (issue #2539).
 *
 * `pending` is the unit the preludes left open; `proven` is a ground already established earlier on
 * the same branch, which is kept because the implementation may archive the very Task the ground was
 * read from, and a record that moves to `tasks/completed/` does not stop being the branch's ground.
 * `textBefore` reads the tree that existed BEFORE the change under judgement, so the ground is
 * causally prior and never something the implementation grants itself. `planSignal` is the caller's
 * exact `SCENARIO DRAFTED` reader.
 *
 * `problem === null` on a refusal means "no L0 ground applies here" — the caller keeps its own
 * refusal, unchanged. A non-null problem is this module naming why the ground was not granted.
 *
 * @returns {{ grounded: true, ground: string } | { grounded: false, problem: string|null }}
 */
export function l0GroundDecision({ pending, proven, paths, textBefore, laneRuleText, planSignal }) {
  const ground = proven ?? pending ?? null;
  if (ground === null) return { grounded: false, problem: null };
  if (ground !== proven && l0GroundProblems(ground, textBefore, planSignal).length > 0) {
    return { grounded: false, problem: null };
  }
  const floorProblem = laneFloorAboveL0(paths, laneRuleText);
  return floorProblem === null
    ? { grounded: true, ground }
    : {
        grounded: false,
        problem: `L0 implementation grounded by \`${ground}\` reaches ${floorProblem}. An L1/L2 change reaches its own planning checkpoint; the L0 ground does not stand in for it.`,
      };
}

/** Documentation-only authorization is atomic, not an ancestor implementation ground. */
export function isApprovedDocumentationBatch({
  paths,
  textAfter,
  laneRuleText,
  planSignal,
  isPlainFile,
}) {
  const allowed = (file) =>
    file === 'AGENTS.md' ||
    file === 'README.md' ||
    /^\.agents\/(?:rules|skills|tasks|evals\/lessons)\/[A-Za-z0-9_./-]+\.md$/.test(file) ||
    /^\.claude\/agents\/[A-Za-z0-9_-]+\.md$/.test(file) ||
    /^docs\/[A-Za-z0-9_./-]+\.md$/.test(file);
  if (
    paths.length === 0 ||
    !paths.every((file) => allowed(file) && !file.split('/').includes('..') && isPlainFile(file))
  )
    return false;
  if (laneFloorAboveL0(paths, laneRuleText) !== null) return false;
  const tasks = paths.filter((file) => file.startsWith(TASK_PREFIX));
  if (tasks.length !== 1 || tasks[0].slice(TASK_PREFIX.length).includes('/')) return false;
  const basename = taskBasename(tasks[0]);
  if (basename === null || subjectId(basename) === null) return false;
  const task = textAfter(tasks[0]);
  if (typeof task !== 'string') return false;
  const fields = frontmatterObject(task);
  if (!['todo', 'in-progress'].includes(asScalar(fields.status))) return false;
  if (
    asScalar(fields.documentation_batch_approval) !== 'DIRECT' ||
    asScalar(fields.documentation_batch_instruction).trim() === ''
  )
    return false;
  const signal = planSignal(task);
  return (
    signal?.outcome === 'not-applicable' &&
    signal.count === 0 &&
    l0GroundProblems(basename, textAfter, planSignal).length === 0
  );
}

export function readPlanSignal(task, sectionReader) {
  const section = sectionReader(task, '## User Execution Test Scenarios');
  const matches = [
    ...(section ?? '').matchAll(
      /^\*\*Author verdict:\*\*\s+`SCENARIO DRAFTED:\s*(not-applicable|automatable|manual)\s*\|\s*(0|[1-9]\d*)`\s*$/gm,
    ),
  ];
  return matches.length === 1 ? { outcome: matches[0][1], count: Number(matches[0][2]) } : null;
}
