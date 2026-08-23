import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

import { makeTemp } from './make-temp.mjs';

import { validateScenarioRecordArtifact } from '../scenario-records.mjs';

const SCRIPT = path.resolve(import.meta.dirname, '../record-owner-scenario.mjs');
const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createWorkspace() {
  const directory = makeTemp('record-owner-scenario-');
  temporaryDirectories.push(directory);
  return directory;
}

function runScript(cwd, args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, npm_package_name: '@fixture/scenario-owner' },
  });
}

describe('record-owner-scenario', () => {
  it('writes a valid canonical record through the shared scenario-record SSOT', () => {
    const workspace = createWorkspace();
    const output = 'examples/scenarios/stable.record.json';
    const result = runScript(workspace, [
      '--scope',
      'packages/fixture-owner',
      '--output',
      output,
      '--',
      process.execPath,
      '-e',
      "process.stdout.write('stable output\\n')",
    ]);

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('record written: examples/scenarios/stable.record.json');
    const record = JSON.parse(readFileSync(path.join(workspace, output), 'utf8'));
    expect(validateScenarioRecordArtifact(record, 'packages/fixture-owner')).toEqual([]);
    expect(record.packageName).toBe('@fixture/scenario-owner');
    expect(record.stdout.normalized).toBe('stable output');
  });

  it('fails closed and writes no record when the owner command fails', () => {
    const workspace = createWorkspace();
    const output = 'examples/scenarios/failed.record.json';
    const result = runScript(workspace, [
      '--scope',
      'packages/fixture-owner',
      '--output',
      output,
      '--',
      process.execPath,
      '-e',
      'process.exit(7)',
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Scenario record command failed');
    expect(existsSync(path.join(workspace, output))).toBe(false);
  });

  it('is inert when imported', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)}); process.stdout.write('imported\\n');`,
      ],
      { encoding: 'utf8' },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('imported\n');
  });
});
