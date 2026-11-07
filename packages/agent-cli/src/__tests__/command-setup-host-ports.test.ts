/**
 * #3693: the command package holds no host default, so the commands that need one only work because
 * `buildCommandSetup` passes it in. The registry's descriptors do not show that (they omit `execute`),
 * so this runs the commands the setup builds:
 *
 * - `/doctor` reports through the Node probes and repairs through the Node writers (`doctorDeps`),
 * - `/keybindings` opens its file in the editor through the terminal handoff (`keybindingsEditor`),
 * - `/git` reads a real repository (`gitProcess`), both from the default set and from the coding pack
 *   that supplies it in the product,
 * - `/user-local` and the `user-local` subcommand read and write the user's storage root through the
 *   Node file system (`userLocalFileSystem`, `fsAsync`).
 */
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestCommandHost } from '@robota-sdk/agent-framework/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { createProductCapabilityPacks } from '../product/product-profile.js';
import { userLocalStorageRoot } from '../product/user-paths.js';
import { buildCommandSetup } from '../startup/command-setup.js';
import { runUserLocalDirectCommandIfRequested } from '../user-local-direct-command.js';
import { createTestProductRuntime } from './helpers/product-runtime.js';

import type { ISystemCommand } from '@robota-sdk/agent-framework';
import type { IParsedCliArgs } from '../utils/cli-args.js';

const MINIMAL_ARGS = { noUpdateCheck: true } as unknown as IParsedCliArgs;
const ROOT = realpathSync(mkdtempSync(join(tmpdir(), 'test-product-host-ports-')));
const HOME = join(ROOT, 'home');
const REPOSITORY = join(ROOT, 'repository');
const KEYBINDINGS_FILE = join(ROOT, 'keybindings.json');
const EDITOR_MARKER = join(ROOT, 'editor-opened');
const EDITOR_SCRIPT = join(ROOT, 'editor.sh');

const runtime = createTestProductRuntime('test-product', { HOME });
const environmentWithoutGitRedirects = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
);

const previousEditor = { VISUAL: process.env['VISUAL'], EDITOR: process.env['EDITOR'] };

beforeAll(() => {
  mkdirSync(HOME, { recursive: true });
  mkdirSync(REPOSITORY, { recursive: true });
  execFileSync('git', ['init', '--quiet'], {
    cwd: REPOSITORY,
    env: environmentWithoutGitRedirects,
  });
  writeFileSync(join(REPOSITORY, 'scratch-for-host-ports.log'), 'untracked\n');
  writeFileSync(EDITOR_SCRIPT, `#!/bin/sh\nprintf '%s' "$1" > '${EDITOR_MARKER}'\n`);
  chmodSync(EDITOR_SCRIPT, 0o755);
});

afterEach(() => {
  for (const [name, value] of Object.entries(previousEditor)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  rmSync(EDITOR_MARKER, { force: true });
});

afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

/** The commands a default CLI setup builds, with the pack's modules left in the base. */
function setupCommands(): ReadonlyMap<string, ISystemCommand> {
  const setup = buildCommandSetup(
    REPOSITORY,
    MINIMAL_ARGS,
    { productRuntime: runtime },
    '0.0.0-test',
    [],
    { ensureFile: async () => KEYBINDINGS_FILE },
  );
  return new Map(
    setup.baseCommandModules
      .flatMap((module) => module.systemCommands ?? [])
      .map((command) => [command.name, command]),
  );
}

function command(name: string): ISystemCommand {
  const found = setupCommands().get(name);
  if (found === undefined) throw new Error(`buildCommandSetup builds no /${name}`);
  return found;
}

describe('buildCommandSetup gives the commands their host ports', () => {
  it('/doctor reports through the Node probes, and repairs through the Node writers', async () => {
    const doctor = command('doctor');

    const report = await doctor.execute(
      createTestCommandHost({ overrides: { getCwd: () => REPOSITORY } }),
      '',
    );
    expect(report.message).not.toMatch(/unavailable on this host/);
    expect(report.message).toMatch(/User storage \[storage\.user\]/);
    expect(report.data).toMatchObject({ failCount: expect.any(Number) });

    const ask = vi.fn(async () => ({ type: 'answer' as const, values: ['yes'] }));
    const repaired = await doctor.execute(
      createTestCommandHost({ overrides: { getUserInteraction: () => ({ ask }) } }),
      'repair storage.user',
    );
    expect(repaired.success).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);
    const sessions = join(runtime.layout.userRoot, 'sessions');
    expect(existsSync(sessions)).toBe(true);
    if (process.platform !== 'win32') expect(statSync(sessions).mode & 0o077).toBe(0);
  });

  it.skipIf(process.platform === 'win32')(
    '/keybindings opens the file in the editor through the terminal handoff',
    async () => {
      delete process.env['VISUAL'];
      process.env['EDITOR'] = EDITOR_SCRIPT;
      const runWithTerminal = vi.fn(async (operation: () => Promise<number>) => operation());

      const result = await command('keybindings').execute(
        createTestCommandHost({
          overrides: {
            getCwd: () => REPOSITORY,
            canHandoffTerminal: () => true,
            runWithTerminal: runWithTerminal as never,
          },
        }),
        '',
      );

      expect(result).toMatchObject({ success: true, data: { path: KEYBINDINGS_FILE } });
      expect(runWithTerminal).toHaveBeenCalledTimes(1);
      expect(readFileSync(EDITOR_MARKER, 'utf8')).toBe(KEYBINDINGS_FILE);
    },
  );

  it('/user-local writes and lists the user storage through the Node file system', async () => {
    const userLocal = command('user-local');
    const host = createTestCommandHost({ overrides: { getCwd: () => REPOSITORY } });

    const stored = await userLocal.execute(
      host,
      'memory set view-preference last-panel background --summary Panel --source user-input',
    );
    expect(stored).toMatchObject({ success: true });
    expect(stored.message).not.toMatch(/unavailable on this host/);

    const listed = await userLocal.execute(host, 'memory list --format=json');
    expect(listed.success).toBe(true);
    expect(JSON.parse(listed.message).items).toEqual([
      expect.objectContaining({ category: 'view-preference', key: 'last-panel' }),
    ]);
    expect(existsSync(userLocalStorageRoot(runtime))).toBe(true);
  });

  it('the `user-local` subcommand reads the same storage through the Node file system', async () => {
    const lines: string[] = [];
    const terminal = { writeLine: (line: string) => lines.push(line) };

    const ran = await runUserLocalDirectCommandIfRequested(
      {
        positional: ['user-local', 'storage', 'list'],
        format: 'json',
      } as unknown as IParsedCliArgs,
      REPOSITORY,
      terminal as never,
      runtime,
    );

    expect(ran).toBe(true);
    expect(JSON.parse(lines.join('\n'))).toMatchObject({ root: userLocalStorageRoot(runtime) });
  });

  it('/git reads a real repository', async () => {
    const result = await command('git').execute(
      createTestCommandHost({ overrides: { getCwd: () => REPOSITORY } }),
      'status',
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('scratch-for-host-ports.log');
  });

  it("the product's coding pack gives its /git the same process", async () => {
    const pack = createProductCapabilityPacks({ cwd: REPOSITORY }, runtime)[0];
    const gitCommand = pack?.commandModules
      ?.flatMap((module) => module.systemCommands ?? [])
      .find((candidate) => candidate.name === 'git');
    expect(gitCommand).toBeDefined();

    const result = await gitCommand!.execute(
      createTestCommandHost({ overrides: { getCwd: () => REPOSITORY } }),
      'status',
    );

    expect(result.success).toBe(true);
    expect(result.message).toContain('scratch-for-host-ports.log');
  });
});
