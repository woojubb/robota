#!/usr/bin/env node
// Release credentials exist only in an isolated runner keychain and are removed even on failure.
import { randomBytes } from 'node:crypto';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runCommand, selectIdentity } from './macos-signing.mjs';

function cleanup(directory) {
  const searchList = JSON.parse(readFileSync(join(directory, 'search-list.json'), 'utf8'));
  runCommand('security', ['list-keychains', '-d', 'user', '-s', ...searchList]);
  runCommand('security', ['delete-keychain', join(directory, 'release.keychain-db')]);
  rmSync(directory, { recursive: true, force: true });
}

function setup() {
  const env = process.env;
  for (const name of [
    'RUNNER_TEMP',
    'GITHUB_ENV',
    'MACOS_CERTIFICATE_P12',
    'MACOS_CERTIFICATE_PASSWORD',
    'APPLE_TEAM_ID',
    'APPLE_API_KEY_P8',
    'APPLE_API_KEY_ID',
    'APPLE_API_ISSUER',
  ]) {
    if (!env[name]) throw new Error(`${name} is required; refusing an unsigned macOS release.`);
  }
  if (!/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID)) throw new Error('Invalid Apple release team ID.');
  process.umask(0o077);
  const directory = mkdtempSync(join(env.RUNNER_TEMP, 'robota-signing-'));
  const keychain = join(directory, 'release.keychain-db');
  const certificate = join(directory, 'certificate.p12');
  const apiKey = join(directory, 'notary-key.p8');
  const password = randomBytes(32).toString('hex');
  const searchList = [
    ...runCommand('security', ['list-keychains', '-d', 'user']).matchAll(/"([^"\n]+)"/g),
  ].map((match) => match[1]);
  writeFileSync(join(directory, 'search-list.json'), JSON.stringify(searchList), { mode: 0o600 });
  try {
    writeFileSync(certificate, Buffer.from(env.MACOS_CERTIFICATE_P12, 'base64'), { mode: 0o600 });
    runCommand('security', ['create-keychain', '-p', password, keychain]);
    runCommand('security', ['set-keychain-settings', '-lut', '21600', keychain]);
    runCommand('security', ['unlock-keychain', '-p', password, keychain]);
    runCommand('security', [
      'import',
      certificate,
      '-k',
      keychain,
      '-P',
      env.MACOS_CERTIFICATE_PASSWORD,
      '-T',
      '/usr/bin/codesign',
    ]);
    runCommand('security', [
      'set-key-partition-list',
      '-S',
      'apple-tool:,apple:,codesign:',
      '-s',
      '-k',
      password,
      keychain,
    ]);
    runCommand('security', ['list-keychains', '-d', 'user', '-s', keychain, ...searchList]);
    const identity = selectIdentity(
      runCommand('security', ['find-identity', '-v', '-p', 'codesigning', keychain]),
      env.APPLE_TEAM_ID,
    );
    writeFileSync(apiKey, env.APPLE_API_KEY_P8, { mode: 0o600 });
    runCommand('xcrun', [
      'notarytool',
      'store-credentials',
      'robota-release',
      '--key',
      apiKey,
      '--key-id',
      env.APPLE_API_KEY_ID,
      '--issuer',
      env.APPLE_API_ISSUER,
      '--keychain',
      keychain,
    ]);
    rmSync(certificate);
    rmSync(apiKey);
    const values = {
      CSC_KEYCHAIN: keychain,
      MACOS_SIGNING_IDENTITY: identity,
      APPLE_KEYCHAIN: keychain,
      APPLE_KEYCHAIN_PROFILE: 'robota-release',
      MACOS_SIGNING_DIR: directory,
    };
    for (const [name, value] of Object.entries(values)) {
      if (/[\r\n]/.test(value)) throw new Error('Invalid runner credential path.');
      appendFileSync(env.GITHUB_ENV, `${name}=${value}\n`);
    }
    console.log('Developer ID identity and Apple notarization credentials validated.');
  } catch (error) {
    try {
      cleanup(directory);
    } catch {
      /* The disposable runner is destroyed after the job. */
    }
    throw error;
  }
}

try {
  if (process.platform !== 'darwin') throw new Error('Release credentials require a macOS runner.');
  if (process.argv[2] === 'setup') setup();
  else if (process.argv[2] === 'cleanup') {
    if (process.env.MACOS_SIGNING_DIR) cleanup(process.env.MACOS_SIGNING_DIR);
  } else throw new Error('Usage: setup-macos-signing.mjs <setup|cleanup>');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
