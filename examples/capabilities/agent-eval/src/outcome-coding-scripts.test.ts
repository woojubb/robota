import assert from 'node:assert/strict';
import { test } from 'node:test';

import { planScriptedTrial, type TScriptedBehavior } from './outcome-coding-scripts.js';
import { CODING_TASKS, taskFiles, type ICodingTask } from './outcome-coding-tasks.js';

const PROJECT = '/work/project';

/** Applies a plan's file writes to the task's initial tree, the way the worker's tools would. */
function applyWrites(
  initial: Readonly<Record<string, string>>,
  plan: ReturnType<typeof planScriptedTrial>,
): Record<string, string> {
  const files: Record<string, string> = { ...initial };
  for (const step of plan?.steps ?? []) {
    for (const call of step.toolCalls ?? []) {
      if (call.name !== 'Write') continue;
      const { filePath, content } = call.args as { filePath: string; content: string };
      assert.ok(filePath.startsWith(`${PROJECT}/`), 'tools take paths inside the project');
      files[filePath.slice(PROJECT.length + 1)] = content;
    }
  }
  return files;
}

test('a scripted solve leaves exactly the solved control tree, for every task', () => {
  for (const task of CODING_TASKS) {
    const plan = planScriptedTrial(task, 'solve', PROJECT);
    assert.ok(plan, task.id);
    assert.deepEqual(plan.expectedFailures, []);
    assert.deepEqual(applyWrites(task.files, plan), { ...taskFiles(task, 'solved') }, task.id);
    assert.equal(plan.steps.at(-1)?.text, 'Done');
  }
});

test('a claim without work and a read-only run change nothing and use the expected verdicts', () => {
  for (const task of CODING_TASKS) {
    const claim = planScriptedTrial(task, 'claim-only', PROJECT);
    assert.deepEqual(claim?.steps, [{ text: 'Done' }]);
    assert.deepEqual(applyWrites(task.files, claim), { ...task.files });
    const readOnly = planScriptedTrial(task, 'read-only', PROJECT);
    assert.deepEqual(applyWrites(task.files, readOnly), { ...task.files });
    assert.deepEqual(readOnly?.expectedFailures, ['verifier-failed']);
  }
});

test('tampering behaviors apply only where they can, and break exactly the rule they target', () => {
  const protectedEdit = CODING_TASKS.filter(
    (task) => planScriptedTrial(task, 'edit-protected', PROJECT) !== undefined,
  );
  assert.deepEqual(
    protectedEdit.map((task) => task.id),
    ['navigation', 'test-diagnosis'],
  );
  for (const task of protectedEdit) {
    const plan = planScriptedTrial(task, 'edit-protected', PROJECT);
    const files = applyWrites(task.files, plan);
    const changed = task.protectedFiles.filter((path) => files[path] !== task.files[path]);
    assert.equal(changed.length, 1);
    assert.deepEqual(plan?.expectedFailures, ['protected-files-changed']);
  }
  const bugRepair = CODING_TASKS.find((task) => task.id === 'bug-repair') as ICodingTask;
  const stray = planScriptedTrial(bugRepair, 'stray-file', PROJECT);
  assert.ok('notes.txt' in applyWrites(bugRepair.files, stray));
  assert.deepEqual(stray?.expectedFailures, ['unexpected-files']);
});

test('every behavior applies to at least one task', () => {
  const behaviors: TScriptedBehavior[] = [
    'solve',
    'claim-only',
    'read-only',
    'edit-protected',
    'stray-file',
  ];
  for (const behavior of behaviors) {
    assert.ok(
      CODING_TASKS.some((task) => planScriptedTrial(task, behavior, PROJECT) !== undefined),
    );
  }
});
