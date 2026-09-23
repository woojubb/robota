import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { makeTemp } from './make-temp.mjs';
import {
  AUDITED_PRODUCT_INTEGRATION_TESTS,
  isExternalContributionUnitTest,
  isProductIntegrationTest,
  productIntegrationReproduction,
  readExternalContributionUnitInventory,
  readProductIntegrationInventory,
  runProductIntegrationTests,
  selectExternalContributionUnitTests,
  selectProductIntegrationTests,
} from '../product-integration-tests.mjs';

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');

function write(root, relative, value = '') {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, value);
}

function fixture() {
  const root = makeTemp('robota-product-integration-');
  write(root, 'packages/core/package.json', JSON.stringify({ name: '@fixture/core' }));
  write(root, 'packages/core/src/core.unit.test.ts');
  write(root, 'packages/core/src/core.contract.test.ts');
  write(root, 'packages/core/src/core-functional.test.ts');
  write(root, 'packages/core/src/core-scenario.test.ts');
  write(root, 'packages/core/src/core-functional.bintest.test.ts');
  write(root, 'packages/core/src/core-functional.pty.test.ts');
  write(
    root,
    'packages/consumer/package.json',
    JSON.stringify({
      name: '@fixture/consumer',
      devDependencies: { '@fixture/core': 'workspace:*' },
    }),
  );
  write(root, 'packages/consumer/src/consumer-integration.test.ts');
  write(root, 'apps/unrelated/package.json', JSON.stringify({ name: '@fixture/unrelated' }));
  write(root, 'apps/unrelated/src/unrelated.e2e.test.ts');
  return root;
}

describe('product integration test selection', () => {
  it('recognizes integration, contract, e2e, functional, and scenario files but not pure units', () => {
    expect(isProductIntegrationTest('src/a.integration.test.ts')).toBe(true);
    expect(isProductIntegrationTest('src/a-display-contract.test.tsx')).toBe(true);
    expect(isProductIntegrationTest('src/a.contracts.test.ts')).toBe(true);
    expect(isProductIntegrationTest('src/a.e2e.test.mjs')).toBe(true);
    expect(isProductIntegrationTest('src/e2e/scripted.test.ts')).toBe(true);
    expect(isProductIntegrationTest('src/goal-functional.test.ts')).toBe(true);
    expect(isProductIntegrationTest('src/admission-loopback-scenario.test.ts')).toBe(true);
    expect(isProductIntegrationTest('src/a.unit.test.ts')).toBe(false);
    expect(isProductIntegrationTest('src/goal-functional.bintest.test.ts')).toBe(false);
    expect(isProductIntegrationTest('src/goal-functional.pty.test.ts')).toBe(false);
    expect(isProductIntegrationTest('src/goal-functional.live.test.ts')).toBe(false);
  });

  it('assigns only pure units to the external-contribution exception lane', () => {
    expect(isExternalContributionUnitTest('src/a.unit.test.ts')).toBe(true);
    expect(isExternalContributionUnitTest('src/a.integration.test.ts')).toBe(false);
    expect(isExternalContributionUnitTest('src/a-functional.test.ts')).toBe(false);
    expect(isExternalContributionUnitTest('src/a.bintest.test.ts')).toBe(false);
    expect(isExternalContributionUnitTest('src/a.pty.test.ts')).toBe(false);
    expect(isExternalContributionUnitTest('src/a.live.test.ts')).toBe(false);

    const result = selectExternalContributionUnitTests({
      root: fixture(),
      changedFiles: ['packages/core/src/index.ts'],
    });
    expect(result).toMatchObject({ lane: 'external-units', mode: 'affected' });
    expect(result.tests).toEqual(['packages/core/src/core.unit.test.ts']);
  });

  it('assigns audited cross-package, CLI-contract, and real-server tests only to integration', () => {
    expect(AUDITED_PRODUCT_INTEGRATION_TESTS).toEqual([
      'apps/agent-server/src/__tests__/app.test.ts',
      'apps/agent-server/src/__tests__/remote-chat-stream.test.ts',
      'apps/agent-server/src/__tests__/websocket-server.test.ts',
      'apps/dag-runtime-server/src/__tests__/http-provider.roundtrip.test.ts',
      'apps/remote-signaling/src/__tests__/relay.test.ts',
      'apps/remote-signaling/src/__tests__/server-caps.test.ts',
      'packages/agent-cli/src/__tests__/cli-exit-codes.test.ts',
      'packages/agent-cli/src/__tests__/ws-command-host-action.test.ts',
      'packages/agent-cli/src/__tests__/ws-multi-surface-exit-policy.test.ts',
      'packages/agent-cli/src/modes/__tests__/serve-monitor-ui.test.ts',
      'packages/agent-cli/src/remote-control/__tests__/local-peer-channel.test.ts',
      'packages/agent-cli/src/session-analyzer/__tests__/session-analyze-command.test.ts',
      'packages/agent-core/src/hooks/__tests__/http-executor.test.ts',
      'packages/agent-command/src/git/__tests__/git-command-module.test.ts',
      'packages/agent-command-workflows/src/__tests__/workspace-writer.test.ts',
      'packages/agent-builtin-providers/src/deepseek-provider-demo.test.ts',
      'packages/agent-framework/src/__tests__/cross-package-hooks.test.ts',
      'packages/agent-framework/src/__tests__/cross-package-skills.test.ts',
      'packages/agent-framework/src/__tests__/history-cross-package.test.ts',
      'packages/agent-framework/src/interactive/__tests__/interactive-session-background-tasks.test.ts',
      'packages/agent-framework/src/interactive/__tests__/interactive-session-memory.test.ts',
      'packages/agent-framework/src/interactive/__tests__/interactive-session-prompt-flow.test.ts',
      'packages/agent-framework/src/interactive/__tests__/plan-mode-wiring.test.ts',
      'packages/agent-framework/src/orchestration/__tests__/group-chat.test.ts',
      'packages/agent-framework/src/orchestration/__tests__/handoff.test.ts',
      'packages/agent-framework/src/orchestration/__tests__/hierarchical.test.ts',
      'packages/agent-framework/src/orchestration/__tests__/parallel.test.ts',
      'packages/agent-framework/src/orchestration/__tests__/sequential.test.ts',
      'packages/agent-interface-tui/src/__tests__/command-interaction.test.ts',
      'packages/agent-session/src/__tests__/compaction-failure-preservation.test.ts',
      'packages/agent-remote-pairing/src/local/__tests__/peer-credential.test.ts',
      'packages/agent-subagent-runner/src/__tests__/worker-composition.test.ts',
      'packages/agent-transport-ws/src/__tests__/ws-transport-auth.test.ts',
      'packages/agent-transport-ws/src/__tests__/ws-transport-lifecycle.test.ts',
      'packages/agent-tool-mcp/src/__tests__/mcp-tool.test.ts',
      'packages/agent-ui-terminal/src/__tests__/TuiInteractionChannel.lifecycle.test.ts',
      'packages/dag-cli/src/__tests__/persistence-store.test.ts',
      'packages/dag-cli/src/__tests__/code-node-persistence.test.ts',
      'packages/dag-cli/src/__tests__/studio-http-server-security.test.ts',
      'packages/dag-cli/src/__tests__/studio-http-server.test.ts',
      'packages/dag-framework/src/__tests__/create-dag-framework.test.ts',
      'packages/dag-framework/src/__tests__/prompt-backend.test.ts',
      'packages/dag-framework/src/__tests__/tool-node-run.test.ts',
    ]);
    for (const file of AUDITED_PRODUCT_INTEGRATION_TESTS) {
      expect(isProductIntegrationTest(file), file).toBe(true);
      expect(isExternalContributionUnitTest(file), file).toBe(false);
    }
    const optInLive = 'packages/agent-command-workflows/src/__tests__/create-command.live.test.ts';
    expect(isProductIntegrationTest(optInLive)).toBe(false);
    expect(isExternalContributionUnitTest(optInLive)).toBe(false);
  });

  it('selects owner contracts and manifest consumers without unrelated units', () => {
    const result = selectProductIntegrationTests({
      root: fixture(),
      changedFiles: ['packages/core/src/index.ts'],
    });

    expect(result.mode).toBe('affected');
    expect(result.tests).toEqual([
      'packages/consumer/src/consumer-integration.test.ts',
      'packages/core/src/core-functional.test.ts',
      'packages/core/src/core-scenario.test.ts',
      'packages/core/src/core.contract.test.ts',
    ]);
  });

  it('selects no runner work for non-product documentation', () => {
    const result = selectProductIntegrationTests({
      root: fixture(),
      changedFiles: ['README.md'],
    });
    expect(result).toMatchObject({ mode: 'none', tests: [] });
  });

  it.each(['.npmrc', 'tsconfig.base.json', 'tsconfig.eslint.json', 'tsconfig.json'])(
    'selects the complete integration and external-unit inventories for workspace-full input %s',
    (changedFile) => {
      const root = fixture();
      const integration = selectProductIntegrationTests({ root, changedFiles: [changedFile] });
      const external = selectExternalContributionUnitTests({ root, changedFiles: [changedFile] });
      expect(integration).toMatchObject({ mode: 'all', reason: 'shared input changed' });
      expect(external).toMatchObject({ mode: 'all', reason: 'shared input changed' });
      expect(integration.tests.length).toBeGreaterThan(0);
      expect(external.tests.length).toBeGreaterThan(0);
    },
  );

  it('keeps the audited repository inventory including functional and scenario contracts', () => {
    const tests = readProductIntegrationInventory(REPO_ROOT).flatMap((entry) => entry.tests);
    const externalUnits = readExternalContributionUnitInventory(REPO_ROOT).flatMap(
      (entry) => entry.tests,
    );
    expect(tests).toHaveLength(99);
    expect(tests).toEqual(
      expect.arrayContaining([
        'packages/agent-framework/src/goal/__tests__/goal-functional.test.ts',
        'packages/agent-framework/src/testing/__tests__/multi-session-functional.test.ts',
        'packages/agent-command/src/editor/__tests__/editor-command-functional.test.ts',
        'packages/agent-transport-http/src/__tests__/admission-loopback-scenario.test.ts',
        ...AUDITED_PRODUCT_INTEGRATION_TESTS,
      ]),
    );
    expect(tests.filter((file) => externalUnits.includes(file))).toEqual([]);
    expect(tests.some((file) => /(?:bintest|pty)/u.test(file))).toBe(false);
  });

  it('runs only the selected files from each owning workspace', async () => {
    const root = fixture();
    const plan = selectProductIntegrationTests({
      root,
      changedFiles: ['packages/core/src/index.ts'],
    });
    const run = vi.fn(() => ({ status: 0, signal: null }));

    await expect(runProductIntegrationTests(plan, root, run)).resolves.toBe(0);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls.flatMap(([, args]) => args)).not.toContain('core.unit.test.ts');
  });

  it('finishes independent workspace groups after one fails and returns an aggregate failure', async () => {
    const root = fixture();
    const plan = selectProductIntegrationTests({ root, changedFiles: [] });
    const run = vi
      .fn()
      .mockReturnValueOnce({ status: 1, signal: null })
      .mockReturnValue({ status: 0, signal: null });
    const errors = [];

    await expect(
      runProductIntegrationTests(plan, root, run, (line) => errors.push(line)),
    ).resolves.toBe(1);
    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls.map(([, , options]) => path.relative(root, options.cwd)).sort()).toEqual([
      'apps/unrelated',
      'packages/consumer',
      'packages/core',
    ]);
    expect(errors).toContain('[product-integration] failed workspace group: apps/unrelated');
    expect(errors).toContain(
      `[product-integration] reproduce: ${productIntegrationReproduction('apps/unrelated', [
        'src/unrelated.e2e.test.ts',
      ])}`,
    );
    expect(errors.at(-1)).toBe('[product-integration] 1 workspace group(s) failed');
  });
});
