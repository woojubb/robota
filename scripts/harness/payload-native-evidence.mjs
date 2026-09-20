#!/usr/bin/env node

import { readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED = Object.freeze({
  'darwin-arm64': { platform: 'darwin', arch: 'arm64' },
  'darwin-x64': { platform: 'darwin', arch: 'x64' },
  'linux-arm64': { platform: 'linux', arch: 'arm64' },
  'linux-x64': { platform: 'linux', arch: 'x64' },
  'windows-x64': { platform: 'win32', arch: 'x64' },
});

export function validatePayloadNativeEvidence(directory) {
  const root = resolve(directory);
  const files = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  const expectedFiles = Object.keys(EXPECTED)
    .map((target) => `evidence-${target}.json`)
    .sort();
  if (JSON.stringify(files) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `Native evidence set mismatch: expected ${expectedFiles.join(', ')}, received ${files.join(', ') || '(none)'}.`,
    );
  }

  const seen = new Set();
  for (const file of files) {
    const evidence = JSON.parse(readFileSync(join(root, file), 'utf8'));
    const expected = EXPECTED[evidence.target];
    if (!expected || seen.has(evidence.target)) {
      throw new Error(`Unexpected or duplicate native target in ${file}.`);
    }
    seen.add(evidence.target);
    if (file !== `evidence-${evidence.target}.json`) {
      throw new Error(`Native evidence filename does not match target ${evidence.target}.`);
    }
    const exact = {
      schemaVersion: 1,
      platform: expected.platform,
      arch: expected.arch,
      koffi: '3.3.1',
      rootReplacement: 'preserved',
      finalLink: 'refused',
      boundedRead: 'refused',
    };
    for (const [key, value] of Object.entries(exact)) {
      if (evidence[key] !== value) {
        throw new Error(`Native evidence ${file} has invalid ${key}.`);
      }
    }
    if (!/^v20\.19\.\d+$/u.test(evidence.node20)) {
      throw new Error(`Native evidence ${file} has invalid Node 20 runtime.`);
    }
    if (!/^v22\.\d+\.\d+$/u.test(evidence.node22)) {
      throw new Error(`Native evidence ${file} has invalid Node 22 runtime.`);
    }
    if (evidence.bun !== '1.3.14') {
      throw new Error(`Native evidence ${file} has invalid Bun runtime.`);
    }
  }
  return [...seen].sort();
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = process.argv[2];
  if (!directory) throw new Error(`usage: ${basename(process.argv[1])} <evidence-directory>`);
  const targets = validatePayloadNativeEvidence(directory);
  process.stdout.write(`stable payload native evidence: ${targets.join(', ')}\n`);
}
