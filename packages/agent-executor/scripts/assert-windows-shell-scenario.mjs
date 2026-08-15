import { readFileSync } from 'node:fs';

const artifactPath = process.argv[2];
if (!artifactPath) throw new Error('Usage: assert-windows-shell-scenario.mjs <artifact.json>');

const value = JSON.parse(readFileSync(artifactPath, 'utf8'));
const expectedNames = ['default', 'sh', 'bash', 'powershell', 'pwsh', 'cmd'];
const expectedRequestedBasenames = [
  'powershell.exe',
  'sh.exe',
  'bash.exe',
  'powershell.exe',
  'pwsh.exe',
  'cmd.exe',
];
const expectedObservedBasenames = [
  'powershell.exe',
  'bash.exe',
  'bash.exe',
  'powershell.exe',
  'pwsh.exe',
  'cmd.exe',
];
const expectedSentinels = [
  'arch026-default',
  'arch026-sh',
  'arch026-bash',
  'arch026-powershell',
  'arch026-pwsh',
  'arch026-cmd',
];
if (
  !Array.isArray(value.rows) ||
  value.rows.map((row) => row.name).join(',') !== expectedNames.join(',')
) {
  throw new Error('ARCH-026 artifact shell rows are missing or out of order');
}
for (const [index, row] of value.rows.entries()) {
  if (row.requestedExecutableBasename !== expectedRequestedBasenames[index]) {
    throw new Error(`ARCH-026 requested executable mismatch for ${row.name}`);
  }
  if (
    row.managed?.success !== true ||
    row.scheduled?.success !== true ||
    row.scheduled?.fires !== 1
  ) {
    throw new Error(`ARCH-026 runner evidence failed for ${row.name}`);
  }
  if (
    row.managed.executableBasename !== expectedObservedBasenames[index] ||
    row.scheduled.executableBasename !== expectedObservedBasenames[index]
  ) {
    throw new Error(`ARCH-026 observed executable mismatch for ${row.name}`);
  }
  if (
    row.managed.output !== expectedSentinels[index] ||
    row.scheduled.output !== expectedSentinels[index]
  ) {
    throw new Error(`ARCH-026 sentinel evidence failed for ${row.name}`);
  }
}
const summary = value.summary;
if (
  summary?.runnerCases !== 12 ||
  summary?.unknownShellZeroSpawns !== true ||
  summary?.unknownShellSpawnAttempts !== 0 ||
  summary?.scheduledHandlesCancelled !== true ||
  summary?.environmentRestored !== true
) {
  throw new Error('ARCH-026 artifact summary failed closed validation');
}
process.stdout.write(`${JSON.stringify(value)}\n`);
