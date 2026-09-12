/** Publish verified tarball bytes only. Build/approval/OTP timing remains owned by publish-packages.sh. */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync } from 'node:fs';

function runPublish(args) {
  const cli = process.env.npm_execpath;
  const nodeCli = cli && /[/\\]pnpm\.(?:c?js|mjs)$/u.test(cli);
  if (!nodeCli && process.platform === 'win32') {
    throw new Error('artifact publish: invoke through pnpm on Windows');
  }
  return new Promise((resolve, reject) => {
    const child = spawn(nodeCli ? process.execPath : 'pnpm', nodeCli ? [cli, ...args] : args, {
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) =>
      code === 0
        ? resolve()
        : reject(new Error(`artifact publish: package command failed (${signal ?? code})`)),
    );
  });
}

function verifyUnchanged(artifact) {
  if (
    !artifact ||
    typeof artifact.tarballPath !== 'string' ||
    !lstatSync(artifact.tarballPath).isFile()
  ) {
    throw new Error('artifact publish: expected a regular verified tarball');
  }
  const actual = createHash('sha256').update(readFileSync(artifact.tarballPath)).digest('hex');
  if (actual !== artifact.sha256)
    throw new Error(`artifact publish: verified tarball changed for ${artifact.packageName}`);
}

export async function publishVerifiedArtifacts(
  artifacts,
  { packageNames, dryRun = false, otp, run = runPublish },
) {
  if (
    !Array.isArray(packageNames) ||
    !packageNames.length ||
    packageNames.some((name) => typeof name !== 'string' || !name.trim()) ||
    new Set(packageNames).size !== packageNames.length
  ) {
    throw new Error('artifact publish: select a nonempty unique package set');
  }
  if (!dryRun && !otp) throw new Error('artifact publish: OTP is required');
  const selected = packageNames.map((name) => {
    const matches = artifacts.filter((artifact) => artifact.packageName === name);
    if (matches.length !== 1)
      throw new Error(`artifact publish: missing or duplicate verified package ${name}`);
    return matches[0];
  });
  // Validate the whole selected set before the first irreversible registry operation.
  for (const artifact of selected) verifyUnchanged(artifact);
  const concurrency = 4;
  for (let index = 0; index < selected.length; index += concurrency) {
    const batch = selected.slice(index, index + concurrency);
    const results = await Promise.allSettled(
      batch.map(async (artifact) => {
        verifyUnchanged(artifact);
        await run([
          'publish',
          artifact.tarballPath,
          '--no-git-checks',
          ...(dryRun ? ['--dry-run'] : ['--otp', otp]),
        ]);
      }),
    );
    const failures = results.flatMap((result, offset) =>
      result.status === 'rejected'
        ? [new Error(`${batch[offset].packageName} failed`, { cause: result.reason })]
        : [],
    );
    if (failures.length) {
      throw new AggregateError(
        failures,
        `artifact publish: ${failures.map((error) => error.message).join('; ')}`,
      );
    }
  }
}
