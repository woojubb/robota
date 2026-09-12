#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { prepareReleaseArtifacts } from './publish-set.mjs';
import { publishVerifiedArtifacts } from './publish.mjs';

const USAGE =
  'usage: publish-cli.mjs prepare <directory> <packages...> | publish <release-set.json> <dry-run|publish> <packages...>';

function readReleaseSet(file) {
  const value = JSON.parse(readFileSync(file, 'utf8'));
  if (value.version !== 1 || !Array.isArray(value.artifacts) || !value.artifacts.length) {
    throw new Error('artifact publish: invalid release set');
  }
  for (const artifact of value.artifacts) {
    if (
      !artifact ||
      typeof artifact.packageName !== 'string' ||
      typeof artifact.tarballPath !== 'string' ||
      !path.isAbsolute(artifact.tarballPath) ||
      path.dirname(artifact.tarballPath) !== path.dirname(path.resolve(file)) ||
      typeof artifact.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(artifact.sha256)
    ) {
      throw new Error('artifact publish: invalid or foreign prepared artifact');
    }
  }
  return value.artifacts;
}

async function main(args) {
  const [action, location, mode, ...rest] = args;
  if (action === 'prepare' && location && mode) {
    const destination = path.resolve(location);
    const artifacts = await prepareReleaseArtifacts({
      root: process.cwd(),
      destination,
      packageNames: [mode, ...rest],
    });
    writeFileSync(
      path.join(destination, 'release-set.json'),
      JSON.stringify({ version: 1, artifacts }),
      { flag: 'wx' },
    );
    process.stdout.write(
      `Prepared ${artifacts.length} verified package tarballs in ${destination}\n`,
    );
  } else if (
    action === 'publish' &&
    location &&
    ['dry-run', 'publish'].includes(mode) &&
    rest.length
  ) {
    await publishVerifiedArtifacts(readReleaseSet(location), {
      packageNames: rest,
      dryRun: mode === 'dry-run',
      otp: process.env.ROBOTA_PUBLISH_OTP,
    });
  } else {
    throw new Error(USAGE);
  }
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
