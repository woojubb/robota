import { spawn } from 'node:child_process';

function defaultRunTask(task, { root }) {
  return new Promise((resolve) => {
    const child = spawn(task.command, task.args, { cwd: root, stdio: 'inherit' });
    child.once('error', (error) => resolve({ status: null, signal: null, error: error.message }));
    child.once('exit', (status, signal) => resolve({ status, signal, error: null }));
  });
}

export async function executeWorkspaceTasks(
  tasks,
  { root, concurrency = 4, runTask = defaultRunTask } = {},
) {
  const bounded = Number.isInteger(concurrency) && concurrency > 0 ? Math.min(concurrency, 16) : 4;
  const results = new Array(tasks.length);
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      try {
        results[index] = await runTask(tasks[index], { root });
      } catch (error) {
        results[index] = { status: null, signal: null, error: error.message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(bounded, tasks.length) }, () => worker()));
  return tasks.map((task, index) => ({ task, result: results[index] ?? null }));
}

function failedResult(entry) {
  return !entry.result || entry.result.status !== 0 || entry.result.signal || entry.result.error;
}

export async function executeWorkspaceExecution(
  execution,
  { root, concurrency = 4, runTask = defaultRunTask } = {},
) {
  if (execution.errors.length > 0) {
    return execution.tasks.map((task) => ({
      task,
      result: { status: null, signal: null, error: 'blocked by execution planning failure' },
    }));
  }
  const results = [];
  for (let stageIndex = 0; stageIndex < execution.stages.length; stageIndex += 1) {
    const stageResults = await executeWorkspaceTasks(execution.stages[stageIndex], {
      root,
      concurrency,
      runTask,
    });
    results.push(...stageResults);
    if (stageResults.some(failedResult)) {
      for (const blockedStage of execution.stages.slice(stageIndex + 1)) {
        for (const task of blockedStage) {
          results.push({
            task,
            result: {
              status: null,
              signal: null,
              error: `blocked by prerequisite stage ${stageIndex + 1} failure`,
            },
          });
        }
      }
      break;
    }
  }
  return results;
}

export function summarizeWorkspaceExecution({ execution, results }) {
  const failures = [...execution.errors.map((error) => ({ id: '<planning>', error }))];
  for (const entry of results) {
    if (failedResult(entry)) {
      failures.push({
        id: entry.task.id,
        status: entry.result?.status ?? null,
        signal: entry.result?.signal ?? null,
        error: entry.result?.error ?? 'missing execution result',
      });
    }
  }
  const expectedIds = execution.tasks.map((task) => task.id);
  const resultCounts = new Map();
  for (const entry of results) {
    const id = entry.task?.id ?? '<missing-task-id>';
    resultCounts.set(id, (resultCounts.get(id) ?? 0) + 1);
  }
  for (const id of expectedIds) {
    const count = resultCounts.get(id) ?? 0;
    if (count !== 1)
      failures.push({ id: '<aggregate>', error: `${id} has ${count} results; expected 1` });
  }
  for (const [id, count] of resultCounts) {
    if (!expectedIds.includes(id)) {
      failures.push({
        id: '<aggregate>',
        error: `Unexpected result ${id} appeared ${count} time(s)`,
      });
    }
  }
  return {
    ok: failures.length === 0,
    taskCount: execution.tasks.length,
    skippedCount: execution.skipped.length,
    failures,
  };
}
