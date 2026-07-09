#!/usr/bin/env node

/**
 * Hardcoded workspace-module mock scan (lesson 2026-07-02).
 *
 * A test that replaces a whole workspace package with a hardcoded factory —
 * `vi.mock('@robota-sdk/agent-core', () => ({ onlyTheExportsIKnew }))` — silently severs every OTHER export
 * of that package for the entire import graph of the file under test. The stub then breaks the
 * moment any transitively-loaded module starts using a new export: agent-playground's
 * `vi.mock('@robota-sdk/agent-core')` stubbed 2 exports, TERM-008 added `resolvePlatformShell`,
 * and every `git push` in the repo was blocked by a failure in a package the change never touched
 * (while CI stayed green — the breakage surfaced only in the full local suite).
 *
 * Correct form: partial-mock with the real module spread, so unknown exports keep working:
 *
 *   vi.mock('@robota-sdk/agent-core', async (importOriginal) => ({
 *     ...(await importOriginal<typeof import('@robota-sdk/agent-core')>()),
 *     onlyWhatThisTestOverrides: stub,
 *   }));
 *
 * This scan fails on NEW hardcoded workspace-module mock factories. Pre-existing violations are
 * pinned in ALLOWLIST below (tracked for burn-down by the MOCK-001 backlog item) — removing an
 * entry is welcome once its file is converted; adding one requires the same review as any
 * allowlist change. A deliberate full replacement can opt out with a same-line escape:
 * `// allow-module-mock: <reason>`.
 *
 * Exit code 0 = no new violations, 1 = new hardcoded workspace mock found.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');

/** Test globs are approximated by a directory walk filtered to *.test.ts / *.test.tsx. */
const SCAN_ROOTS = ['packages', 'apps'];

const MOCK_PATTERN = /vi\.mock\(\s*(['"])(@robota-sdk\/[^'"]+)\1\s*,/g;
/** How far past the `vi.mock(` call the factory is searched for `importOriginal`. */
const FACTORY_WINDOW_CHARS = 600;
const ESCAPE_PATTERN = /\/\/\s*allow-module-mock:\s*\S/;

/**
 * Pre-existing violations (2026-07-02 sweep, 36 files) — burn-down tracked by
 * `.agents/backlog/MOCK-001-hardcoded-workspace-mock-burndown.md`. Do not add entries for new code.
 */
const ALLOWLIST = new Set([
  'packages/agent-cli/src/__tests__/provider-factory-integration.test.ts',
  'packages/agent-framework/src/__tests__/create-session-new-options.test.ts',
  'packages/agent-framework/src/__tests__/create-subagent-session.test.ts',
  'packages/agent-framework/src/__tests__/hook-wiring.test.ts',
  'packages/agent-framework/src/__tests__/subagent-integration.test.ts',
  'packages/agent-framework/src/interactive/__tests__/interactive-session-bare.test.ts',
  'packages/agent-framework/src/interactive/__tests__/interactive-session-manifest.test.ts',
  'packages/agent-framework/src/interactive/__tests__/interactive-session-sandbox-snapshot.test.ts',
  'packages/agent-framework/src/interactive/__tests__/interactive-session-system-context-regression.test.ts',
  'packages/agent-provider-anthropic/src/anthropic/__tests__/response-parser.test.ts',
  'packages/agent-session/src/__tests__/active-preset-state.test.ts',
  'packages/agent-session/src/__tests__/apply-model-options.test.ts',
  'packages/agent-session/src/__tests__/parallel-subagents-gate.test.ts',
  'packages/agent-session/src/__tests__/session-compaction.test.ts',
  'packages/agent-session/src/__tests__/session-id-override.test.ts',
  'packages/agent-session/src/__tests__/session-system-prompt.test.ts',
  'packages/agent-transport-tui/src/__tests__/TuiInteractionChannel.askUser.test.ts',
  'packages/agent-transport-tui/src/__tests__/TuiInteractionChannel.display-contract.test.ts',
  'packages/agent-transport-tui/src/__tests__/TuiInteractionChannel.lifecycle.test.ts',
  'packages/dag-cli/src/__tests__/compare-benchmark.test.ts',
  'packages/dag-cli/src/__tests__/demo-command.test.ts',
  'packages/dag-cli/src/__tests__/describe-command.test.ts',
  'packages/dag-cli/src/__tests__/explain-suggest.test.ts',
  'packages/dag-cli/src/__tests__/fix-command.test.ts',
  'packages/dag-cli/src/__tests__/from-mermaid-command.test.ts',
  'packages/dag-cli/src/__tests__/misc-commands.test.ts',
  'packages/dag-cli/src/__tests__/run-utilities.test.ts',
  'packages/dag-cli/src/__tests__/runner-cli.test.ts',
  'packages/dag-cli/src/__tests__/studio-http-server.test.ts',
  'packages/dag-nodes/gemini-image-edit/src/runtime-core.test.ts',
  'packages/dag-nodes/instant-node/src/__tests__/index.test.ts',
  'packages/dag-nodes/llm-text-anthropic/src/index.test.ts',
  'packages/dag-nodes/llm-text-deepseek/src/index.test.ts',
  'packages/dag-nodes/llm-text-gemini/src/index.test.ts',
  'packages/dag-nodes/llm-text-openai/src/index.test.ts',
  'packages/dag-nodes/llm-text-qwen/src/index.test.ts',
]);

async function* walkTestFiles(dir) {
  let entries = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkTestFiles(full);
    } else if (/\.test\.tsx?$/.test(entry.name)) {
      yield full;
    }
  }
}

/**
 * Classify one file's content.
 * @returns {Array<{ module: string, line: number }>} hardcoded workspace-mock factories found.
 */
export function findHardcodedModuleMocks(content) {
  const violations = [];
  for (const match of content.matchAll(MOCK_PATTERN)) {
    const window = content.slice(match.index, match.index + FACTORY_WINDOW_CHARS);
    if (window.includes('importOriginal')) continue;
    const lineStart = content.lastIndexOf('\n', match.index) + 1;
    const lineEnd = content.indexOf('\n', match.index);
    const line = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd);
    if (ESCAPE_PATTERN.test(line)) continue;
    violations.push({
      module: match[2],
      line: content.slice(0, match.index).split('\n').length,
    });
  }
  return violations;
}

export async function main() {
  const findings = [];
  for (const rootDir of SCAN_ROOTS) {
    for await (const file of walkTestFiles(path.join(WORKSPACE_ROOT, rootDir))) {
      const relative = path.relative(WORKSPACE_ROOT, file);
      if (ALLOWLIST.has(relative)) continue;
      const content = await fs.readFile(file, 'utf8');
      for (const violation of findHardcodedModuleMocks(content)) {
        findings.push({ file: relative, ...violation });
      }
    }
  }

  if (findings.length === 0) {
    process.stdout.write(`test-module-mocks scan passed (${ALLOWLIST.size} legacy allowlisted).\n`);
    return;
  }

  process.stdout.write(
    'test-module-mocks scan failed — hardcoded workspace-module mock factory (breaks when the real module grows):\n',
  );
  for (const finding of findings) {
    process.stdout.write(`  - ${finding.file}:${finding.line} mocks ${finding.module}\n`);
  }
  process.stdout.write(
    'Use a partial mock instead: vi.mock(mod, async (importOriginal) => ({ ...(await importOriginal()), <overrides> })).\n' +
      'A deliberate full replacement can annotate the vi.mock line with // allow-module-mock: <reason>.\n',
  );
  process.exitCode = 1;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}
