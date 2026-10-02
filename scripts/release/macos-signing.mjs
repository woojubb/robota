#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export function runCommand(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch {
    // execFile's default error includes the complete command, which can contain credentials.
    throw new Error(`${command} ${args[0]} failed; no release artifact may be published.`);
  }
}

function required(env, name) {
  if (!env[name]) throw new Error(`${name} is required for macOS release signing.`);
  return env[name];
}

export function selectIdentity(output, teamId) {
  const matches = [
    ...output.matchAll(/([A-F0-9]{40}) "Developer ID Application: [^"\n]+ \(([A-Z0-9]{10})\)"/g),
  ].filter((match) => match[2] === teamId);
  if (matches.length !== 1)
    throw new Error(
      'Expected exactly one valid Developer ID Application identity for the release team.',
    );
  return matches[0][1];
}

export function signRuntime(binary, { env = process.env, run = runCommand } = {}) {
  const identity = required(env, 'MACOS_SIGNING_IDENTITY');
  const args = [
    '--force',
    '--sign',
    identity,
    '--timestamp',
    '--options',
    'runtime',
    '--entitlements',
    join(here, 'bun-entitlements.plist'),
  ];
  if (env.CSC_KEYCHAIN) args.push('--keychain', env.CSC_KEYCHAIN);
  run('codesign', [...args, binary]);
  run('codesign', ['--verify', '--strict', '--verbose=2', binary]);
}

export function notarizeArtifact(artifact, { env = process.env, run = runCommand } = {}) {
  const args = [
    'notarytool',
    'submit',
    artifact,
    '--keychain-profile',
    required(env, 'APPLE_KEYCHAIN_PROFILE'),
    '--wait',
    '--timeout',
    '30m',
    '--output-format',
    'json',
  ];
  if (env.APPLE_KEYCHAIN) args.push('--keychain', env.APPLE_KEYCHAIN);
  const result = JSON.parse(run('xcrun', args));
  if (result.status !== 'Accepted' || !result.id) {
    throw new Error(
      `Apple notarization was ${result.status ?? 'unknown'} (${result.id ?? 'no submission ID'}); refusing publication.`,
    );
  }
  if (extname(artifact) === '.dmg') {
    run('xcrun', ['stapler', 'staple', artifact]);
    run('xcrun', ['stapler', 'validate', artifact]);
  }
  return result.id;
}

function notarizeCli(binary) {
  const scratch = mkdtempSync(join(tmpdir(), 'agent-notarize-'));
  try {
    const archive = join(scratch, 'artifact.zip');
    runCommand('ditto', ['-c', '-k', '--keepParent', binary, archive]);
    console.log(`Apple accepted CLI submission: ${notarizeArtifact(archive)}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.platform !== 'darwin')
      throw new Error('macOS release signing requires a macOS host.');
    const [operation, input] = process.argv.slice(2);
    if (!input)
      throw new Error('Usage: macos-signing.mjs <sign-runtime|notarize-cli|notarize-dmgs> <path>');
    if (operation === 'sign-runtime') signRuntime(resolve(input));
    else if (operation === 'notarize-cli') notarizeCli(resolve(input));
    else if (operation === 'notarize-dmgs') {
      const dmgs = readdirSync(input).filter((name) => name.endsWith('.dmg'));
      if (!dmgs.length) throw new Error('No desktop DMG was produced; refusing publication.');
      for (const name of dmgs) {
        const artifact = resolve(input, name);
        const args = [
          '--force',
          '--sign',
          required(process.env, 'MACOS_SIGNING_IDENTITY'),
          '--timestamp',
        ];
        if (process.env.CSC_KEYCHAIN) args.push('--keychain', process.env.CSC_KEYCHAIN);
        runCommand('codesign', [...args, artifact]);
        runCommand('codesign', ['--verify', '--strict', '--verbose=2', artifact]);
        console.log(`Apple accepted DMG submission: ${notarizeArtifact(artifact)}`);
      }
    } else throw new Error(`Unknown macOS signing operation: ${operation}`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
