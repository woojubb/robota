/**
 * The checkout is untrusted, and the CLI runs inside it. `npx @robota-sdk/agent-cli` run there let
 * the checkout choose the program: npm reads the checkout's `.npmrc` (`script-shell`, `registry`),
 * and a committed or earlier-installed `node_modules/@robota-sdk/agent-cli` ran instead of the
 * published CLI, with the API key in its environment. These tests build such a checkout and check
 * that the action installs outside it and runs the installed entry script with Node directly.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { installCli, runCli } from '../src/node-io.mjs';

/** A package directory whose `agent` command prints `ran:<label>` and its argv. */
function writeFakeCli(packageDir: string, label: string, marker?: string): void {
  mkdirSync(join(packageDir, 'bin'), { recursive: true });
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({ name: '@robota-sdk/agent-cli', bin: { agent: 'bin/agent.cjs' } }),
  );
  const touch = marker ? `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x');` : '';
  writeFileSync(
    join(packageDir, 'bin', 'agent.cjs'),
    `${touch}process.stdout.write('ran:${label} ' + JSON.stringify(process.argv.slice(2)));\n`,
  );
}

describe('installing and running the CLI next to an untrusted checkout', () => {
  let root: string;
  let checkout: string;
  let temp: string;
  let marker: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'action-node-io-')));
    checkout = join(root, 'checkout');
    temp = join(root, 'runner-temp');
    marker = join(root, 'CHECKOUT-CODE-RAN');
    mkdirSync(checkout);
    mkdirSync(temp);
    // What a hostile pull request can commit.
    writeFileSync(
      join(checkout, '.npmrc'),
      'script-shell=./evil.sh\nregistry=http://127.0.0.1:9/\n',
    );
    writeFileSync(join(checkout, 'evil.sh'), `#!/bin/sh\ntouch ${JSON.stringify(marker)}\n`);
    chmodSync(join(checkout, 'evil.sh'), 0o755);
    writeFakeCli(join(checkout, 'node_modules', '@robota-sdk', 'agent-cli'), 'checkout', marker);
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('runs npm in its own directory under the runner temp dir, never in the checkout', () => {
    const calls: Array<{ file: string; args: string[]; cwd: string }> = [];

    const entry = installCli(
      '@robota-sdk/agent-cli@latest',
      { PRODUCT_PACKAGE_SCOPE: '@robota-sdk', PRODUCT_CLI_NAME: 'agent' },
      {
        tempDir: temp,
        runNpm: (file, args, options) => {
          calls.push({ file, args, cwd: options.cwd });
          writeFakeCli(
            join(temp, 'action-cli', 'node_modules', '@robota-sdk', 'agent-cli'),
            'installed',
          );
        },
      },
    );

    const prefix = join(temp, 'action-cli');
    expect(calls).toEqual([
      {
        file: 'npm',
        args: expect.arrayContaining([
          'install',
          '--prefix',
          prefix,
          '@robota-sdk/agent-cli@latest',
        ]),
        cwd: prefix,
      },
    ]);
    expect(entry).toBe(
      join(prefix, 'node_modules', '@robota-sdk', 'agent-cli', 'bin', 'agent.cjs'),
    );
  });

  it.each(['cedar.agent', 'Cedar_Agent', 'agent-2', '7agent'])('installs the centrally valid command %s', (cliName) => {
    const entry = installCli('@robota-sdk/agent-cli@latest', {
      PRODUCT_PACKAGE_SCOPE: '@robota-sdk', PRODUCT_CLI_NAME: cliName,
    }, {
      tempDir: temp,
      runNpm: () => {
        const packageDir = join(temp, 'action-cli', 'node_modules', '@robota-sdk', 'agent-cli');
        writeFakeCli(packageDir, 'installed');
        writeFileSync(join(packageDir, 'package.json'), JSON.stringify({ bin: { [cliName]: 'bin/agent.cjs' } }));
      },
    });
    expect(runCli(entry, [], { PATH: process.env.PATH }, checkout)).toBe('ran:installed []');
  });

  it('runs the installed CLI in the checkout, not the copy the checkout carries', () => {
    const installed = join(temp, 'action-cli', 'node_modules', '@robota-sdk', 'agent-cli');
    writeFakeCli(installed, 'installed');

    const stdout = runCli(
      join(installed, 'bin', 'agent.cjs'),
      ['--safe-mode', '-p', '--', 'hi; touch x'],
      { PATH: process.env.PATH },
      checkout,
    );

    expect(stdout).toBe('ran:installed ["--safe-mode","-p","--","hi; touch x"]');
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(checkout, 'x'))).toBe(false);
  });
});
