import { promises as fs } from 'node:fs';
import path from 'node:path';

import { createVerificationPlan, parsePlanArgs, renderPlanSummary } from './check-plan.mjs';
import {
  collectPackageManifestChanges,
  detectChangedFiles,
  listWorkspaceScopes,
  WORKSPACE_ROOT,
} from './shared.mjs';

function inferReportFormat(reportFile, explicitFormat) {
  if (explicitFormat) {
    return explicitFormat;
  }
  if (reportFile?.endsWith('.md')) {
    return 'markdown';
  }
  return 'json';
}

async function writeReport(reportFile, format, plan) {
  const targetPath = path.resolve(WORKSPACE_ROOT, reportFile);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });

  const content =
    format === 'markdown' ? renderPlanSummary(plan) : `${JSON.stringify(plan, null, 2)}\n`;
  await fs.writeFile(targetPath, content, 'utf8');

  const relativePath = path.relative(WORKSPACE_ROOT, targetPath);
  process.stdout.write(
    `\nReport written: ${relativePath.startsWith('..') ? targetPath : relativePath}\n`,
  );
}

async function main() {
  const options = parsePlanArgs(process.argv.slice(2));
  const scopes = await listWorkspaceScopes();
  const changedFiles =
    options.changedFiles.length > 0 ? options.changedFiles : detectChangedFiles(options.baseRef);
  const manifestChangesByScope = await collectPackageManifestChanges({
    scopes,
    changedFiles,
    baseRef: options.baseRef,
  });

  const plan = createVerificationPlan({
    scopes,
    changedFiles,
    scopeTokens: options.scopeTokens,
    manifestChangesByScope,
    includeDependentScopes: !options.skipDependentScopes,
  });

  process.stdout.write(renderPlanSummary(plan));

  if (options.reportFile) {
    await writeReport(
      options.reportFile,
      inferReportFormat(options.reportFile, options.reportFormat),
      plan,
    );
  }
}

void main();
