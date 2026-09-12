import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { runWorkspaceBuild } from '../build-workspace.mjs';
import { pinGeneration } from '../generation.mjs';
import { packVerifiedPackage } from '../pack.mjs';
import { createWorkspaceAffectedPlan } from '../../harness/workspace-affected-plan.mjs';
import { readWorkspaceGraph } from '../../harness/workspace-graph.mjs';
import { createWorkspaceExecution } from '../../harness/workspace-execution-plan.mjs';
import {
  executeWorkspaceExecution,
  summarizeWorkspaceExecution,
} from '../../harness/workspace-execution-engine.mjs';
import { releaseWorkspace, writeConsumerConfig } from './release-path-fixture.mjs';

async function affectedBuild(root, changedFiles) {
  const graph = readWorkspaceGraph(root);
  const plan = createWorkspaceAffectedPlan({ root, graph, operation: 'build', changedFiles });
  expect(plan.mode).toBe('packages');
  const execution = createWorkspaceExecution({ plan, graph });
  const results = await executeWorkspaceExecution(execution, { root, concurrency: 1 });
  return { plan, execution, summary: summarizeWorkspaceExecution({ execution, results }) };
}

it('cold root execution builds real node/browser/types plus Vite copies and packs their exact payload', async () => {
  const { root, consumer, web } = releaseWorkspace();
  expect(existsSync(path.join(consumer, 'dist'))).toBe(false);
  expect(existsSync(path.join(web, 'dist'))).toBe(false);
  expect(await runWorkspaceBuild({ root, concurrency: 1 })).toMatchObject({
    ok: true,
    taskCount: 2,
  });
  const pinned = pinGeneration(consumer);
  expect(pinned.manifest.files.map((file) => file.path)).toEqual(
    expect.arrayContaining([
      'node/index.js',
      'node/index.cjs',
      'node/index.d.ts',
      'browser/index.js',
      'browser/index.d.ts',
      'web/index.html',
    ]),
  );
  expect(pinned.manifest.files.some((file) => file.path.startsWith('web/assets/'))).toBe(true);
  const packed = await packVerifiedPackage(consumer, {
    workspaceRoot: root,
    destination: path.join(root, 'tarballs'),
  });
  expect(packed.generationId).toBe(pinned.id);
  for (const file of pinned.manifest.files) {
    expect(packed.files.find((item) => item.path === `dist/${file.path}`)).toEqual({
      ...file,
      path: `dist/${file.path}`,
    });
  }
}, 30000);

it('web-only affected rebuild removes seeded stale output and a later config edit removes obsolete entries', async () => {
  const { root, consumer, web } = releaseWorkspace();
  await runWorkspaceBuild({ root, concurrency: 1 });
  writeFileSync(path.join(consumer, 'dist/obsolete.js'), 'seeded stale output');
  writeFileSync(
    path.join(web, 'main.js'),
    'document.querySelector("#app").textContent = "new-web-generation";',
  );
  const webBuild = await affectedBuild(root, ['packages/web/main.js']);
  expect(webBuild.summary).toMatchObject({ ok: true, taskCount: 2 });
  expect(webBuild.execution.stages.map((stage) => stage.map((task) => task.packageName))).toEqual([
    ['@fixture/web'],
    ['@fixture/consumer'],
  ]);
  expect(existsSync(path.join(consumer, 'dist/obsolete.js'))).toBe(false);
  writeConsumerConfig(consumer, false);
  const removedBuild = await affectedBuild(root, ['packages/consumer/tsdown.config.ts']);
  expect(removedBuild.summary.ok).toBe(true);
  const pinned = pinGeneration(consumer);
  expect(pinned.manifest.files.some((file) => file.path.includes('legacy'))).toBe(false);
  const packed = await packVerifiedPackage(consumer, {
    workspaceRoot: root,
    destination: path.join(root, 'tarballs'),
  });
  expect(packed.files.some((file) => /legacy|obsolete/.test(file.path))).toBe(false);
}, 30000);

it('real emit failure retains the complete prior consumer and can still pack that verified generation', async () => {
  const { root, consumer } = releaseWorkspace();
  await runWorkspaceBuild({ root, concurrency: 1 });
  const previous = pinGeneration(consumer);
  const html = readFileSync(path.join(previous.root, 'web/index.html'));
  writeFileSync(path.join(consumer, 'src/index.ts'), 'export const = ;');
  const failed = await affectedBuild(root, ['packages/consumer/src/index.ts']);
  expect(failed.summary.ok).toBe(false);
  expect(
    failed.summary.failures.some(
      (failure) => failure.id === 'packages/consumer:build' && failure.status !== 0,
    ),
  ).toBe(true);
  expect(pinGeneration(consumer)).toEqual(previous);
  expect(readFileSync(path.join(previous.root, 'web/index.html'))).toEqual(html);
  const packed = await packVerifiedPackage(consumer, {
    workspaceRoot: root,
    destination: path.join(root, 'tarballs'),
  });
  expect(packed.generationId).toBe(previous.id);
}, 30000);
