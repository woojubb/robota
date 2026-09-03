#!/usr/bin/env node

/**
 * Check that CLI background/workspace UI remains a projection over SDK/runtime state.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

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

/** The one spelling of the executor module specifier; every pattern below is built from it. */
const EXECUTOR_MODULE_SOURCE = /['"]@robota-sdk\/agent-executor(?:\/[^'"]*)?['"]/.source;
const EXECUTOR_IMPORT_PATTERN = new RegExp(
  `import\\s+(type\\s+)?\\{([^}]*)\\}\\s+from\\s+${EXECUTOR_MODULE_SOURCE}`,
  'g',
);
const CLI_SOURCE_ROOT = 'packages/agent-cli/src';
const ENTRYPOINT_LAUNCH_SURFACES = new Set([
  `${CLI_SOURCE_ROOT}/bin.ts`,
  `${CLI_SOURCE_ROOT}/index.ts`,
]);

/** Every named binding a file imports from agent-executor, with whether it is type-only. */
function executorImportBindings(content) {
  const bindings = [];
  for (const match of content.matchAll(EXECUTOR_IMPORT_PATTERN)) {
    const statementTypeOnly = match[1] !== undefined;
    for (const raw of match[2].split(',')) {
      const entry = raw.trim();
      if (entry === '') continue;
      const inlineType = /^type\s+/.test(entry);
      const name = entry
        .replace(/^type\s+/, '')
        .split(/\s+as\s+/)[0]
        .trim();
      bindings.push({ name, typeOnly: statementTypeOnly || inlineType });
    }
  }
  return bindings;
}

function importsWithinCli(content) {
  return [...content.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)].map((match) => match[1]);
}

function stripSourceExtension(file) {
  return file.replace(/\.(?:[cm]?[jt]sx?)$/, '');
}

/**
 * CLI-080: the sanctioned composition-root categories, each with a STRUCTURAL membership test.
 * A file's exemption names a category; the guard verifies the file actually has that shape, so a
 * free-text reason can no longer admit an import by self-description (.agents/project-structure.md
 * § Composition-Root Exemption owns the definitions).
 */
const COMPOSITION_ROOT_CATEGORIES = {
  // The assembly point: only the package's launch surfaces — the process shim `bin.ts` and the
  // barrel `index.ts` — import it; nothing inside the package composes on top of it.
  entrypoint: {
    boundary:
      'only packages/agent-cli/src/bin.ts and packages/agent-cli/src/index.ts import the file',
    verify: ({ file, cliSources }) => {
      const target = stripSourceExtension(file);
      return cliSources.every(
        ({ file: importer, content }) =>
          importer === file ||
          ENTRYPOINT_LAUNCH_SURFACES.has(importer) ||
          !importsWithinCli(content).some(
            (specifier) =>
              stripSourceExtension(path.join(path.dirname(importer), specifier)) === target,
          ),
      );
    },
  },
  // A consumer of an executor CONTRACT only: every executor import is type-only.
  'type-only-contract': {
    boundary: 'every agent-executor import in the file is `import type`',
    verify: ({ content }) => {
      const bindings = executorImportBindings(content);
      return bindings.length > 0 && bindings.every((binding) => binding.typeOnly);
    },
  },
  // A concrete host adapter: a class that `implements` an executor-owned interface, with executor
  // VALUE imports limited to the contract's error classes (the type-imported interface is the
  // contract; everything else it needs comes from the host).
  'host-adapter': {
    boundary:
      'a class `implements` an interface imported as a type from agent-executor, and the only value imports from agent-executor are `*Error` classes',
    verify: ({ content }) => {
      const bindings = executorImportBindings(content);
      const interfaces = bindings.filter((binding) => binding.typeOnly).map((b) => b.name);
      const implementsContract = interfaces.some((name) =>
        new RegExp(`\\bimplements\\s+(?:[\\w.]+\\s*,\\s*)*${name}\\b`).test(content),
      );
      const valuesAreErrors = bindings
        .filter((binding) => !binding.typeOnly)
        .every((binding) => /Error$/.test(binding.name));
      return implementsContract && valuesAreErrors;
    },
  },
};

const CLI_FORBIDDEN_PATTERNS = [
  {
    type: 'cli-agent-executor-import',
    pattern: new RegExp(`from\\s+${EXECUTOR_MODULE_SOURCE}`),
    detail: 'agent-cli must not import agent-executor directly; consume SDK workspace projections.',
    // HARNESS-011 / CLI-080: composition-root exemptions. Every entry names a sanctioned category
    // (verified structurally by COMPOSITION_ROOT_CATEGORIES) plus a reason string; both are reported.
    exemptions: {
      'packages/agent-cli/src/cli.ts': {
        category: 'entrypoint',
        reason: 'composition root — concrete runner wiring',
      },
      'packages/agent-cli/src/modes/print-mode.ts': {
        category: 'type-only-contract',
        reason: 'composition root — type-only runner contract',
      },
      'packages/agent-cli/src/subagents/git-worktree-isolation-adapter.ts': {
        category: 'host-adapter',
        reason:
          'composition root — concrete worktree adapter implementing ISubagentWorktreeAdapter',
      },
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
  const cliSources = [];
  for (const file of await walkFiles(root, CLI_SOURCE_ROOT)) {
    cliSources.push({ file, content: await fs.readFile(path.join(root, file), 'utf8') });
  }
  for (const { file, content } of cliSources) {
    for (const check of CLI_FORBIDDEN_PATTERNS) {
      if (!check.pattern.test(content)) {
        continue;
      }
      const exemption = check.exemptions?.[file];
      if (exemption !== undefined) {
        const category = COMPOSITION_ROOT_CATEGORIES[exemption.category];
        if (category === undefined) {
          findings.push({
            file,
            type: `${check.type}-category-unknown`,
            detail: `exemption names category \`${exemption.category}\`, which is not a sanctioned composition-root category (${Object.keys(COMPOSITION_ROOT_CATEGORIES).join(', ')}).`,
          });
          continue;
        }
        if (!category.verify({ file, content, cliSources })) {
          findings.push({
            file,
            type: `${check.type}-category-mismatch`,
            detail: `exemption claims category \`${exemption.category}\` but the file does not have its shape: ${category.boundary}.`,
          });
          continue;
        }
        exemptionsUsed.push({
          file,
          type: check.type,
          category: exemption.category,
          reason: exemption.reason,
        });
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
        `  exempted: ${exemption.file} [${exemption.type}: ${exemption.category}] — ${exemption.reason}\n`,
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

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  void main();
}
