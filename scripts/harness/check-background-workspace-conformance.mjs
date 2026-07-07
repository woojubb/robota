#!/usr/bin/env node

/**
 * Check that CLI background/workspace UI remains a projection over SDK/runtime state.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = process.cwd();
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs']);

const REQUIRED_FILES = [
  {
    file: 'packages/agent-executor/src/background-tasks/background-task-manager.ts',
    pattern: /export\s+class\s+BackgroundTaskManager\b/,
    type: 'missing-runtime-background-manager',
    detail: 'agent-executor must own BackgroundTaskManager lifecycle state.',
  },
  {
    file: 'packages/agent-framework/src/background-tasks/execution-workspace-projection.ts',
    pattern: /export\s+function\s+createExecutionWorkspaceSnapshot\b/,
    type: 'missing-sdk-execution-workspace-projection',
    detail: 'agent-framework must own execution workspace snapshot projection.',
  },
  {
    file: 'packages/agent-transport-tui/src/TuiInteractionChannel.ts',
    pattern: /getExecutionWorkspaceSnapshot/,
    type: 'missing-cli-sdk-snapshot-consumption',
    detail: 'agent-cli must consume SDK execution workspace snapshots for background UI.',
  },
  {
    file: 'packages/agent-transport-tui/src/TuiInteractionChannel.ts',
    pattern: /execution_workspace_event/,
    type: 'missing-cli-sdk-workspace-event-consumption',
    detail: 'agent-cli must consume SDK execution workspace events instead of raw runtime events.',
  },
  {
    file: 'packages/agent-transport-tui/src/TuiInteractionChannel.ts',
    pattern: /readExecutionWorkspaceDetail/,
    type: 'missing-cli-sdk-detail-reader',
    detail: 'agent-cli must read detail panes through SDK execution workspace APIs.',
  },
  {
    file: 'packages/agent-transport-tui/src/tui-state-manager.ts',
    pattern: /syncExecutionWorkspaceSnapshot/,
    type: 'missing-cli-workspace-snapshot-state-sync',
    detail: 'agent-cli TUI state must sync SDK snapshots instead of deriving lifecycle state.',
  },
  {
    file: '.agents/specs/architecture-map/agent-system.md',
    pattern: /Background workspace\/read model\s+\|\s+`agent-framework`\s+\+\s+`agent-executor`/,
    type: 'missing-architecture-map-workspace-owner',
    detail:
      'Architecture map must keep background workspace ownership in agent-framework + agent-executor.',
  },
  {
    file: 'packages/agent-cli/docs/SPEC.md',
    pattern:
      /Background agent task lifecycle and progress are projected by the SDK execution workspace APIs/,
    type: 'missing-cli-spec-workspace-boundary',
    detail:
      'agent-cli SPEC must state that background lifecycle is SDK execution workspace projection.',
  },
];

const CLI_FORBIDDEN_PATTERNS = [
  {
    type: 'cli-agent-executor-import',
    pattern: /from\s+['"]@robota-sdk\/agent-executor(?:\/[^'"]*)?['"]/,
    detail: 'agent-cli must not import agent-executor directly; consume SDK workspace projections.',
    // HARNESS-011: composition-root exemptions — the app assembly point may wire
    // concrete runners; every entry requires a reason string (.agents/project-structure.md).
    exemptions: {
      'packages/agent-cli/src/cli.ts': 'composition root — concrete runner wiring',
      'packages/agent-cli/src/modes/print-mode.ts': 'composition root — type-only runner contract',
      'packages/agent-cli/src/subagents/git-worktree-isolation-adapter.ts':
        'composition root — concrete worktree adapter wiring',
    },
  },
  {
    type: 'cli-background-registry-owner',
    pattern:
      /\b(?:class|interface|type|const)\s+\w*(?:BackgroundTaskRegistry|BackgroundTaskStore)\b/,
    detail: 'agent-cli must not own durable background task registries or stores.',
  },
  {
    type: 'cli-background-retention-owner',
    pattern:
      /\b(?:class|interface|type|const)\s+\w*(?:BackgroundTaskRetentionPolicy|ExecutionWorkspaceRetentionPolicy|CompletedTaskRetention|UnreadPolicy|BackgroundGroupPolicy)\b/,
    detail: 'agent-cli must not own retention, unread, or background grouping policy.',
  },
  {
    type: 'cli-background-state-machine-owner',
    pattern: /\b(?:class|interface|type|const)\s+\w*BackgroundTaskStateMachine\b/,
    detail: 'agent-cli must not own background task lifecycle state machines.',
  },
];

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function isSourceFile(relativePath) {
  return SOURCE_EXTENSIONS.has(path.extname(relativePath));
}

function isIgnoredPath(relativePath) {
  return (
    relativePath.includes('/node_modules/') ||
    relativePath.includes('/dist/') ||
    relativePath.includes('/coverage/') ||
    relativePath.includes('/__tests__/') ||
    /\.test\.[cm]?[jt]sx?$/.test(relativePath) ||
    /\.spec\.[cm]?[jt]sx?$/.test(relativePath)
  );
}

async function walkFiles(root, relativeDir) {
  const absoluteDir = path.join(root, relativeDir);
  if (!(await pathExists(absoluteDir))) {
    return [];
  }

  const entries = await fs.readdir(absoluteDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const childRelativePath = path.join(relativeDir, entry.name);
    if (isIgnoredPath(childRelativePath)) {
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(root, childRelativePath)));
      continue;
    }
    if (entry.isFile() && isSourceFile(childRelativePath)) {
      files.push(childRelativePath);
    }
  }
  return files;
}

async function readIfExists(root, relativePath) {
  try {
    return await fs.readFile(path.join(root, relativePath), 'utf8');
  } catch {
    return undefined;
  }
}

async function findRequiredFileFindings(root) {
  const findings = [];
  for (const check of REQUIRED_FILES) {
    const content = await readIfExists(root, check.file);
    if (content !== undefined && check.pattern.test(content)) {
      continue;
    }
    findings.push({
      file: check.file,
      type: check.type,
      detail: check.detail,
    });
  }
  return findings;
}

async function findCliForbiddenFindings(root) {
  const findings = [];
  const exemptionsUsed = [];
  for (const file of await walkFiles(root, 'packages/agent-cli/src')) {
    const content = await fs.readFile(path.join(root, file), 'utf8');
    for (const check of CLI_FORBIDDEN_PATTERNS) {
      if (!check.pattern.test(content)) {
        continue;
      }
      const exemptionReason = check.exemptions?.[file];
      if (exemptionReason !== undefined) {
        exemptionsUsed.push({ file, type: check.type, reason: exemptionReason });
        continue;
      }
      findings.push({
        file,
        type: check.type,
        detail: check.detail,
      });
    }
  }
  return { findings, exemptionsUsed };
}

export async function findBackgroundWorkspaceConformanceFindings(root = WORKSPACE_ROOT) {
  const cli = await findCliForbiddenFindings(root);
  return [...(await findRequiredFileFindings(root)), ...cli.findings];
}

/** Exemptions actually used in this tree (reported, never silent). */
export async function findUsedExemptions(root = WORKSPACE_ROOT) {
  return (await findCliForbiddenFindings(root)).exemptionsUsed;
}

export async function main() {
  const findings = await findBackgroundWorkspaceConformanceFindings(WORKSPACE_ROOT);
  if (findings.length === 0) {
    const exemptions = await findUsedExemptions(WORKSPACE_ROOT);
    for (const exemption of exemptions) {
      process.stdout.write(
        `  exempted: ${exemption.file} [${exemption.type}] — ${exemption.reason}\n`,
      );
    }
    process.stdout.write('background workspace conformance scan passed.\n');
    return;
  }

  process.stdout.write('background workspace conformance scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  process.exitCode = 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
