import { promises as fs } from 'node:fs';
import path from 'node:path';

import {
  classifyScopeChanges,
  detectChangedFiles,
  hasCanonicalSpecReference,
  listWorkspaceScopes,
  mapFilesToScopes,
  parseScopeArgs,
  pathExists,
  readText,
  resolveRequestedScopes,
  WORKSPACE_ROOT,
} from './shared.mjs';
import { resolveScenarioRecord, resolveScenarioVerification } from './scenario-owner-map.mjs';

function createFinding(priority, scope, message) {
  return { priority, scope, message };
}

function printSection(title) {
  process.stdout.write(`\n${title}\n`);
}

function inferReportFormat(reportFile, explicitFormat) {
  if (explicitFormat) {
    return explicitFormat;
  }
  if (reportFile?.endsWith('.json')) {
    return 'json';
  }
  return 'markdown';
}

function buildRecommendedCommands(scopeRecommendations) {
  return [
    'pnpm harness:scan',
    ...scopeRecommendations.flatMap((item) => {
      const commands = [
        item.includeScenarios
          ? `pnpm harness:verify -- --scope ${item.scope.relativeDir} --include-scenarios`
          : `pnpm harness:verify -- --scope ${item.scope.relativeDir}`,
      ];
      if (item.includeRecord) {
        commands.push(`pnpm harness:record -- --scope ${item.scope.relativeDir}`);
      }
      return commands;
    }),
  ];
}

function summarizeScopes(selectedScopes) {
  return selectedScopes.map((scope) => ({
    kind: scope.kind,
    relativeDir: scope.relativeDir,
    workspaceName: scope.workspaceName,
  }));
}

function renderMarkdownReport({ changedFiles, selectedScopes, outsideSelectedScopeFiles, findings, recommendedCommands }) {
  const lines = [
    '# Harness Review Report',
    '',
    '## Summary',
    `- Changed files: ${changedFiles.length}`,
    `- Selected scopes: ${selectedScopes.map((scope) => scope.relativeDir).join(', ') || 'none'}`,
  ];

  if (outsideSelectedScopeFiles.length > 0) {
    lines.push(`- Files outside selected scopes: ${outsideSelectedScopeFiles.join(', ')}`);
  }

  lines.push('', '## Findings');
  if (findings.length === 0) {
    lines.push('- No review findings from the heuristic harness.');
  } else {
    for (const finding of findings) {
      lines.push(`- [${finding.priority}] ${finding.scope}: ${finding.message}`);
    }
  }

  lines.push('', '## Recommended Commands');
  for (const command of recommendedCommands) {
    lines.push(`- ${command}`);
  }

  return `${lines.join('\n')}\n`;
}

async function writeReport(reportFile, format, payload) {
  const targetPath = path.resolve(WORKSPACE_ROOT, reportFile);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  const content = format === 'json'
    ? `${JSON.stringify(payload, null, 2)}\n`
    : renderMarkdownReport(payload);

  await fs.writeFile(targetPath, content, 'utf8');
  return targetPath;
}

function renderReportPath(reportPath) {
  const relativePath = path.relative(WORKSPACE_ROOT, reportPath);
  if (relativePath.startsWith('..')) {
    return reportPath;
  }
  return relativePath;
}

async function main() {
  const options = parseScopeArgs(process.argv.slice(2));
  const scopes = await listWorkspaceScopes();
  const changedFiles = detectChangedFiles(options.baseRef);
  const scopeFiles = mapFilesToScopes(changedFiles, scopes);
  const selectedScopes = options.scopeTokens.length > 0
    ? resolveRequestedScopes(options.scopeTokens, scopes)
    : scopes.filter((scope) => (scopeFiles.get(scope.relativeDir) ?? []).length > 0);

  const outsideSelectedScopeFiles = changedFiles.filter((file) => {
    return !selectedScopes.some((scope) => file === scope.relativeDir || file.startsWith(`${scope.relativeDir}/`));
  });

  const findings = [];
  const scopeRecommendations = [];

  if (changedFiles.some((file) => file === 'AGENTS.md' || file.startsWith('.agents/') || file.startsWith('scripts/harness/'))) {
    findings.push(createFinding('high', 'repository', 'Policy or harness files changed. Run `pnpm harness:scan` and review drift carefully.'));
  }

  if (outsideSelectedScopeFiles.some((file) => file === 'package.json')) {
    findings.push(createFinding('high', 'repository', 'Root package.json changed. Command surface or workspace behavior may have changed.'));
  }

  for (const scope of selectedScopes) {
    const files = scopeFiles.get(scope.relativeDir) ?? [];
    const classification = classifyScopeChanges(scope, files, options.scopeTokens.length > 0);
    const hasExamplesDir = await pathExists(`${WORKSPACE_ROOT}/${scope.relativeDir}/examples`);
    const hasScenarioVerification = Boolean(resolveScenarioVerification(scope));
    const hasScenarioRecord = Boolean(resolveScenarioRecord(scope));
    const hasSpec = await pathExists(`${WORKSPACE_ROOT}/${scope.relativeDir}/docs/SPEC.md`);
    const docsIndexPath = `${WORKSPACE_ROOT}/${scope.relativeDir}/docs/README.md`;
    const hasDocsIndex = await pathExists(docsIndexPath);

    if (classification.hasSourceChanges) {
      findings.push(createFinding('high', scope.relativeDir, 'Source files changed. Build, test, lint, and typecheck should be reviewed for this scope.'));
    }

    if (classification.hasEntrypointChanges) {
      findings.push(createFinding('high', scope.relativeDir, 'Entrypoint changed. Public surface and semver impact should be reviewed.'));
    }

    if (classification.hasManifestChanges) {
      findings.push(createFinding('medium', scope.relativeDir, 'Package manifest changed. Build scripts, dependencies, or package metadata may have shifted.'));
    }

    if (classification.hasScenarioChanges) {
      findings.push(createFinding('medium', scope.relativeDir, 'Scenario or example files changed. Owner verification flow should be checked.'));
    }

    if (classification.hasSourceChanges && hasExamplesDir && hasScenarioVerification) {
      findings.push(createFinding('medium', scope.relativeDir, 'Source changed in a scenario-owning scope. Include scenario verification in follow-up checks.'));
    }

    if ((classification.hasScenarioChanges || (classification.hasSourceChanges && hasExamplesDir)) && hasScenarioRecord) {
      findings.push(createFinding('low', scope.relativeDir, 'Scenario-owning scope changed. If verification reports record drift and the new output is intentional, refresh the owner record.'));
    }

    if (classification.hasDocsChanges && !classification.hasSourceChanges) {
      findings.push(createFinding('low', scope.relativeDir, 'Docs changed without source changes in this scope.'));
    }

    if (!hasSpec) {
      findings.push(createFinding('medium', scope.relativeDir, 'Workspace is missing docs/SPEC.md. Package or app ownership is not fully documented.'));
    }

    if (hasSpec && !hasDocsIndex) {
      findings.push(createFinding('medium', scope.relativeDir, 'Workspace is missing docs/README.md. The canonical docs entrypoint is incomplete.'));
    }

    if (hasSpec && hasDocsIndex) {
      const docsIndexContent = await readText(docsIndexPath);
      if (!hasCanonicalSpecReference(docsIndexContent)) {
        findings.push(createFinding('medium', scope.relativeDir, 'docs/README.md does not point to `SPEC.md`. Canonical package specification is hard to discover.'));
      }
    }

    if (scope.relativeDir.startsWith('packages/dag-') && classification.hasSourceChanges) {
      findings.push(createFinding('high', scope.relativeDir, 'DAG package source changed. Review dependency direction, event ownership, fallback behavior, and terminal state integrity.'));
    }

    if (scope.relativeDir.startsWith('packages/dag-nodes/') && classification.hasSourceChanges) {
      findings.push(createFinding('high', scope.relativeDir, 'DAG node source changed. Check AbstractNodeDefinition usage, NodeIoAccessor validation, and DAG error code conventions.'));
    }

    scopeRecommendations.push({
      scope,
      includeScenarios: hasScenarioVerification && (
        classification.hasScenarioChanges
        || ((classification.hasSourceChanges || classification.hasConfigChanges) && hasExamplesDir)
      ),
      includeRecord: hasScenarioRecord && (
        classification.hasScenarioChanges
        || ((classification.hasSourceChanges || classification.hasConfigChanges) && hasExamplesDir)
      ),
    });
  }

  const recommendedCommands = buildRecommendedCommands(scopeRecommendations);
  const selectedScopeSummary = summarizeScopes(selectedScopes);

  printSection('Review Summary');
  process.stdout.write(`Changed files: ${changedFiles.length}\n`);
  process.stdout.write(`Selected scopes: ${selectedScopes.map((scope) => scope.relativeDir).join(', ') || 'none'}\n`);
  if (outsideSelectedScopeFiles.length > 0) {
    process.stdout.write(`Files outside selected scopes: ${outsideSelectedScopeFiles.join(', ')}\n`);
  }

  printSection('Findings');
  if (findings.length === 0) {
    process.stdout.write('- No review findings from the heuristic harness.\n');
  } else {
    const order = { high: 0, medium: 1, low: 2 };
    findings.sort((left, right) => order[left.priority] - order[right.priority] || left.scope.localeCompare(right.scope));
    for (const finding of findings) {
      process.stdout.write(`- [${finding.priority}] ${finding.scope}: ${finding.message}\n`);
    }
  }

  printSection('Recommended Commands');
  for (const command of recommendedCommands) {
    process.stdout.write(`- ${command}\n`);
  }

  if (options.reportFile) {
    const format = inferReportFormat(options.reportFile, options.reportFormat);
    const reportPath = await writeReport(options.reportFile, format, {
      changedFiles,
      selectedScopes: selectedScopeSummary,
      outsideSelectedScopeFiles,
      findings,
      recommendedCommands,
    });
    process.stdout.write(`\nReport written: ${renderReportPath(reportPath)}\n`);
  }
}

void main();
