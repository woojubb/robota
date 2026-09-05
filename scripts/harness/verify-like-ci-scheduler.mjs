import { CI_STAGES, describeCiSource } from './ci-mirror-map.mjs';
import {
  advanceBuildState,
  blockedStageResult,
  initialBuildState,
  stageGate,
} from './verify-like-ci-product.mjs';

const BATCHES = [
  ['format-check', 'commitlint'],
  ['scan-suite-dist-free'],
  ['harness-self-test', 'harness-hermetic-test'],
  ['build'],
  ['scan-suite'],
  ['package-quality'],
  ['binary-e2e'],
  ['examples-typecheck'],
  ['tui-e2e'],
];

export function executionBatches(selected, declared = CI_STAGES) {
  const names = BATCHES.flat();
  if (
    new Set(names).size !== names.length ||
    names.length !== declared.length ||
    declared.some((stage) => !names.includes(stage.name)) ||
    selected.some((stage) => !names.includes(stage.name))
  ) {
    throw new Error('CI execution batches must cover every declared check exactly once');
  }
  const byName = new Map(selected.map((stage) => [stage.name, stage]));
  return BATCHES.map((names) =>
    names.filter((name) => byName.has(name)).map((name) => byName.get(name)),
  ).filter((batch) => batch.length > 0);
}

export async function executeStages(selected, options, context, runners, annotate) {
  const batches = executionBatches(selected);
  const results = [];
  const gates = new Map(selected.map((stage) => [stage.name, stageGate(stage.name, context)]));
  let buildState = initialBuildState(selected, context);
  let failed = false;
  let thrown;
  let executedChecks = 0;
  let executedBatches = 0;
  const started = performance.now();
  for (const batch of batches) {
    if (failed) {
      results.push(
        ...batch.map((stage) => ({
          name: stage.name,
          status: 'blocked',
          note: 'blocked by an earlier failed batch; not executed',
          durationMs: 0,
        })),
      );
      continue;
    }
    let batchRan = false;
    const settled = await Promise.allSettled(
      batch.map(async (stage) => {
        const stageStarted = performance.now();
        const gate = gates.get(stage.name);
        if (!gate.run) return { name: stage.name, status: 'skip', note: gate.note, durationMs: 0 };
        const blocked = blockedStageResult(stage, buildState);
        if (blocked) return { ...blocked, durationMs: 0 };
        batchRan = true;
        executedChecks += 1;
        process.stdout.write(`\n===== ${stage.name} =====\nmirrors: ${describeCiSource(stage)}\n`);
        const outcome = await runners[stage.name](options, context);
        if (stage.name === 'build') buildState = advanceBuildState(buildState, stage, outcome.code);
        return {
          name: stage.name,
          status: outcome.code === 0 ? 'pass' : 'fail',
          note: await annotate(stage.name, outcome),
          durationMs: performance.now() - stageStarted,
        };
      }),
    );
    if (batchRan) executedBatches += 1;
    for (const [index, result] of settled.entries()) {
      if (result.status === 'fulfilled') results.push(result.value);
      else {
        thrown ??= result.reason;
        results.push({
          name: batch[index].name,
          status: 'fail',
          note: `runner threw: ${result.reason?.message ?? result.reason}`,
          durationMs: 0,
        });
      }
    }
    failed = results.some((result) => result.status === 'fail');
  }
  return {
    results,
    thrown,
    totalDurationMs: performance.now() - started,
    execution: {
      selectedChecks: selected.length,
      applicableChecks: [...gates.values()].filter((gate) => gate.run).length,
      executedChecks,
      executedBatches,
    },
  };
}
