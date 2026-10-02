import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const script = path.join(root, 'scripts/install.sh');
const temporaryDirectories = [];

function fixture(assetName = 'Cedar-linux-x64') {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'installer-test-'));
  temporaryDirectories.push(directory);
  const commands = path.join(directory, 'commands');
  mkdirSync(commands);
  const payload = path.join(directory, 'fixture-binary');
  writeFileSync(payload, '#!/bin/sh\necho fixture-version\n', { mode: 0o755 });
  const sum = spawnSync('sha256sum', [payload], { encoding: 'utf8' });
  if (sum.status !== 0) throw new Error('sha256sum is needed for the installer fixture');
  writeFileSync(
    path.join(directory, 'checksums'),
    `${sum.stdout.trim().split(/\s+/u)[0]}  ${assetName}\n`,
  );
  writeFileSync(
    path.join(commands, 'uname'),
    '#!/bin/sh\ncase "$1" in -s) echo Linux ;; -m) echo x86_64 ;; *) exit 1 ;; esac\n',
    { mode: 0o755 },
  );
  writeFileSync(
    path.join(commands, 'curl'),
    `#!/bin/sh
while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then output=$2; shift 2; else shift; fi
done
case "$output" in
  */SHA256SUMS.txt) cp "$FIXTURE_CHECKSUMS" "$output" ;;
  *) cp "$FIXTURE_BINARY" "$output" ;;
esac
`,
    { mode: 0o755 },
  );
  chmodSync(path.join(commands, 'curl'), 0o755);
  return { directory, commands, payload, checksums: path.join(directory, 'checksums') };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe('POSIX installer configuration', () => {
  it('installs Robota without requiring an external product selection', () => {
    const test = fixture('robota-linux-x64');
    const result = spawnSync('sh', [script], {
      encoding: 'utf8',
      env: {
        PATH: `${test.commands}:${process.env.PATH}`,
        HOME: test.directory,
        FIXTURE_BINARY: test.payload,
        FIXTURE_CHECKSUMS: test.checksums,
      },
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('https://github.com/woojubb/robota/releases/latest/download');
    expect(readFileSync(path.join(test.directory, '.robota/bin/robota'), 'utf8')).toContain(
      'fixture-version',
    );
  });
  it('uses explicit identity, state root, and release base with a generic CLI-name artifact fallback', () => {
    const test = fixture();
    const installRoot = path.join(test.directory, 'selected-state');
    const result = spawnSync('sh', [script], {
      encoding: 'utf8',
      env: {
        PATH: `${test.commands}:${process.env.PATH}`,
        PRODUCT_CLI_NAME: 'Cedar',
        PRODUCT_USER_STATE_DIR: installRoot,
        PROJECT_RELEASE_BASE_URL: 'https://downloads.example/releases',
        FIXTURE_BINARY: test.payload,
        FIXTURE_CHECKSUMS: test.checksums,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Cedar-linux-x64');
    expect(readFileSync(path.join(installRoot, 'bin', 'Cedar'), 'utf8')).toContain(
      'fixture-version',
    );
  });

  it('uses an explicitly configured artifact prefix and release tag prefix', () => {
    const test = fixture('CedarBundle-linux-x64');
    const installRoot = path.join(test.directory, 'state');
    const result = spawnSync('sh', [script], {
      encoding: 'utf8',
      env: {
        PATH: `${test.commands}:${process.env.PATH}`,
        PRODUCT_CLI_NAME: 'Cedar',
        PRODUCT_ARTIFACT_PREFIX: 'CedarBundle',
        PRODUCT_USER_STATE_DIR: installRoot,
        PROJECT_RELEASE_BASE_URL: 'https://downloads.example/releases',
        PROJECT_RELEASE_VERSION: '4.2.0',
        PROJECT_RELEASE_TAG_PREFIX: 'rel-',
        FIXTURE_BINARY: test.payload,
        FIXTURE_CHECKSUMS: test.checksums,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('CedarBundle-linux-x64');
    expect(result.stdout).toContain('https://downloads.example/releases/download/rel-4.2.0');
  });

  it('fails before downloading when explicit product settings are missing', () => {
    const result = spawnSync('sh', [script], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH, PRODUCT_CLI_NAME: 'Cedar' },
    });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('PROJECT_RELEASE_BASE_URL is required');
  });
});
