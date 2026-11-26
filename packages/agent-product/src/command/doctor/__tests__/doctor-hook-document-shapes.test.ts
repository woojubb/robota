/**
 * A plugin's `hooks.json` is whatever JSON its author wrote, and the Extensions probe reads it. The
 * session reads the events at the top level or wrapped under `hooks`, and ignores a value that is not
 * a list where one belongs; the doctor reads the same way, so a shape the session tolerates never
 * takes the plugins, skills, hooks and MCP checks down with it, and a shape the session ignores is
 * named by file and field.
 */
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { runDoctor } from '../doctor-runner.js';
import { createDoctorFixture } from './doctor-fixture.js';

import type { IDoctorFixture } from './doctor-fixture.js';
import type { IDoctorReport } from '../doctor-types.js';

const fixtures: IDoctorFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

const PLUGIN_DIR = join('.fixture-product', 'plugins', 'cache', 'mk', 'plug', '1.0.0');
const HOOK = { type: 'command', command: 'fixture-hook-tool' };
const GROUP = { matcher: '*', hooks: [HOOK] };

/** A home with one installed plugin whose `hooks.json` holds `document`, and the report over it. */
async function reportFor(document: unknown): Promise<{ f: IDoctorFixture; report: IDoctorReport }> {
  const f = createDoctorFixture({ env: {}, resolvable: ['fixture-hook-tool'] });
  fixtures.push(f);
  f.write(
    join(PLUGIN_DIR, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'plug', version: '1.0.0', description: 'fixture' }),
  );
  f.write(join(PLUGIN_DIR, 'hooks', 'hooks.json'), JSON.stringify(document));
  return { f, report: await runDoctor(f.inputs, f.deps) };
}

function find(report: IDoctorReport, id: string) {
  return report.checks.find((check) => check.id === id);
}

/** What one JSON position holds when it is not the list the position needs. */
const SHAPES: ReadonlyArray<readonly [string, unknown]> = [
  ['an object', { type: 'command', command: 'x' }],
  ['null', null],
  ['a string', 'not-a-list'],
  ['a number', 7],
];

interface IPosition {
  readonly name: string;
  readonly place: (value: unknown) => unknown;
  /** The field path of the value, relative to the events. */
  readonly field: string;
  /** A record is the right type here (a group, a hook); otherwise only a list is. */
  readonly takesRecord: boolean;
}

/** Where a value can sit in a hooks document: an event, a group's hooks, a group, a hook. */
const POSITIONS: readonly IPosition[] = [
  {
    name: 'an event',
    place: (value) => ({ PreToolUse: value }),
    field: 'PreToolUse',
    takesRecord: false,
  },
  {
    name: 'the hooks of a group',
    place: (value) => ({ PreToolUse: [{ matcher: '*', hooks: value }] }),
    field: 'PreToolUse.0.hooks',
    takesRecord: false,
  },
  {
    name: 'a group',
    place: (value) => ({ PreToolUse: [value] }),
    field: 'PreToolUse.0',
    takesRecord: true,
  },
  {
    name: 'a hook',
    place: (value) => ({ PreToolUse: [{ matcher: '*', hooks: [value] }] }),
    field: 'PreToolUse.0.hooks.0',
    takesRecord: true,
  },
];

function isDefect(position: IPosition, value: unknown): boolean {
  return !(position.takesRecord && typeof value === 'object' && value !== null);
}

/** What every non-array shape must leave intact: the other extension checks, and the run itself. */
function expectOtherChecksStand(report: IDoctorReport): void {
  expect(find(report, 'extensions')).toBeUndefined();
  expect(find(report, 'plugins')).toMatchObject({ status: 'ok', cause: '1 plugin(s) loaded' });
  expect(find(report, 'skills')).toBeDefined();
  expect(find(report, 'hooks')).toBeDefined();
  expect(find(report, 'mcp.activation')).toBeDefined();
}

describe('the doctor reads a plugin hooks.json the way the session does', () => {
  it('counts the command hooks of an unwrapped file', async () => {
    const { report } = await reportFor({ PreToolUse: [GROUP] });

    expect(find(report, 'extensions')).toBeUndefined();
    expect(find(report, 'plugins')).toMatchObject({ status: 'ok' });
    expect(find(report, 'hooks')).toMatchObject({
      status: 'ok',
      cause: '1 command hook(s); every executable resolves',
    });
    expect(find(report, 'plugin.plug@mk.hooks')).toBeUndefined();
  });

  it('counts the command hooks of a file that wraps its events under hooks', async () => {
    const { report } = await reportFor({
      description: 'a plugin that wraps its hooks',
      hooks: { PreToolUse: [GROUP], SessionStart: [GROUP] },
    });

    expect(find(report, 'extensions')).toBeUndefined();
    expect(find(report, 'plugins')).toMatchObject({ status: 'ok', cause: '1 plugin(s) loaded' });
    expect(find(report, 'hooks')).toMatchObject({
      status: 'ok',
      cause: '2 command hook(s); every executable resolves',
    });
    expect(find(report, 'plugin.plug@mk.hooks')).toBeUndefined();
  });

  it('reports a wrapped command hook whose executable is missing', async () => {
    const { report } = await reportFor({
      hooks: { Stop: [{ matcher: '*', hooks: [{ type: 'command', command: 'ghost-tool --x' }] }] },
    });

    expect(find(report, 'hooks')).toMatchObject({
      status: 'warn',
      cause: '1 command hook executable(s) not found on PATH',
      detail: ['ghost-tool'],
    });
  });

  describe.each(POSITIONS)(
    'when $name of an unwrapped file is not the type it needs',
    (position) => {
      it.each(SHAPES.filter(([, value]) => isDefect(position, value)))(
        'is %s: the other checks stand and the file and field are named',
        async (_shape, value) => {
          const { f, report } = await reportFor(position.place(value));

          expectOtherChecksStand(report);
          const named = find(report, 'plugin.plug@mk.hooks');
          expect(named).toMatchObject({
            status: 'warn',
            path: join(f.home, PLUGIN_DIR, 'hooks', 'hooks.json'),
          });
          expect(named?.cause).toContain(position.field);
        },
      );
    },
  );

  describe.each(POSITIONS)('when $name of a wrapped file is not the type it needs', (position) => {
    it.each(SHAPES.filter(([, value]) => isDefect(position, value)))(
      'is %s: the other checks stand and the file and field are named',
      async (_shape, value) => {
        const { f, report } = await reportFor({ hooks: position.place(value) });

        expectOtherChecksStand(report);
        expect(find(report, 'plugin.plug@mk.hooks')).toMatchObject({
          status: 'warn',
          path: join(f.home, PLUGIN_DIR, 'hooks', 'hooks.json'),
          cause: `hooks.json fails the hooks schema: hooks.${position.field} (invalid_type)`,
        });
      },
    );
  });

  it.each(POSITIONS.filter((position) => position.takesRecord))(
    'accepts a record as $name of a wrapped file without a finding',
    async (position) => {
      const { report } = await reportFor({ hooks: position.place({ type: 'command' }) });

      expectOtherChecksStand(report);
      expect(find(report, 'plugin.plug@mk.hooks')).toBeUndefined();
    },
  );

  it.each([
    ['a string', 'not-a-record'],
    ['a number', 7],
    ['a list', []],
  ])('names the wrapper itself when it is %s', async (_shape, wrapper) => {
    const { f, report } = await reportFor({ hooks: wrapper });

    expect(find(report, 'extensions')).toBeUndefined();
    expect(find(report, 'plugin.plug@mk.hooks')).toMatchObject({
      status: 'warn',
      path: join(f.home, PLUGIN_DIR, 'hooks', 'hooks.json'),
      cause: 'hooks.json fails the hooks schema: hooks (invalid_type)',
    });
  });

  it('reads a null wrapper as no wrapper, like the session, without failing or reporting it', async () => {
    const { report } = await reportFor({ hooks: null });

    expect(find(report, 'extensions')).toBeUndefined();
    expect(find(report, 'hooks')).toMatchObject({ status: 'not-configured' });
    expect(find(report, 'plugin.plug@mk.hooks')).toBeUndefined();
  });

  it('completes the report for a document that is a list, naming the file', async () => {
    const { f, report } = await reportFor([1]);

    expect(find(report, 'extensions')).toBeUndefined();
    expect(find(report, 'plugin.plug@mk.hooks')).toMatchObject({
      status: 'warn',
      path: join(f.home, PLUGIN_DIR, 'hooks', 'hooks.json'),
    });
    expect(find(report, 'hooks')).toBeDefined();
  });

  it('keeps every other check when a settings layer carries hooks of the wrong type', async () => {
    const f = createDoctorFixture({ env: {} });
    fixtures.push(f);
    f.write('.fixture-product/settings.json', JSON.stringify({ hooks: { PreToolUse: { a: 1 } } }));

    const report = await runDoctor(f.inputs, f.deps);

    expect(find(report, 'extensions')).toBeUndefined();
    expect(find(report, 'settings.user.fixture-product')).toMatchObject({ status: 'fail' });
    expect(find(report, 'hooks')).toMatchObject({ status: 'not-configured' });
  });
});
