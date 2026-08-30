import { promises as fs } from 'node:fs';
import path from 'node:path';

export function groupFindingsByType(findings) {
  const typeGroups = new Map();
  for (const finding of findings) {
    const count = typeGroups.get(finding.type) ?? 0;
    typeGroups.set(finding.type, count + 1);
  }
  return typeGroups;
}

export function printCleanupFindings(findings, typeGroups, verdict) {
  process.stdout.write(`harness cleanup drift scan: ${findings.length} finding(s)\n`);
  if (findings.length === 0) {
    process.stdout.write(
      verdict === undefined || verdict.ok
        ? 'no drift detected.\n'
        : 'no drift found in this run — but the verdict FAILED against the frozen baseline (see above).\n',
    );
    return;
  }
  process.stdout.write('\nsummary:\n');
  for (const [type, count] of typeGroups) process.stdout.write(`  ${type}: ${count}\n`);
  process.stdout.write('\ndetails:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
}

function cleanupReportPayload(findings, verdict) {
  return {
    type: 'cleanup',
    timestamp: new Date().toISOString(),
    findingCount: findings.length,
    findings: findings.map(({ file, type, detail }) => ({ file, type, detail })),
    ...(verdict === undefined ? { verdict: 'baseline-frozen' } : { passed: verdict.ok }),
  };
}

export async function writeCleanupReport(workspaceRoot, reportFile, findings, verdict) {
  if (!reportFile) return;
  const targetPath = path.resolve(workspaceRoot, reportFile);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(
    targetPath,
    `${JSON.stringify(cleanupReportPayload(findings, verdict), null, 2)}\n`,
    'utf8',
  );
  const relativePath = path.relative(workspaceRoot, targetPath);
  process.stdout.write(
    `\nReport written: ${relativePath.startsWith('..') ? targetPath : relativePath}\n`,
  );
}
