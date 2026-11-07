import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

/**
 * `.` and `./node` must be ONE module instance in the built output. The authority brand and the
 * records behind it live in module-level `WeakMap`s: if `./node` carried its own copy of the module
 * that owns them, an authority the Node service mints would be unknown to the main entry's
 * `assertWorkspaceProjectAuthority`, and every consumer that calls the main entry on an authority
 * the CLI minted (the bundled `@robota-sdk/workflows` does) would be refused as a forgery. Source
 * tests cannot see this, so this loads the real ESM and CJS output.
 *
 * Build-dependent, like the other tests that load a package's own `dist`: it is skipped where the
 * package was not built, and CI builds first.
 */
const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));
const FORMATS = {
  esm: { main: 'index.js', node: 'node.js' },
  cjs: { main: 'index.cjs', node: 'node.cjs' },
} as const;
const built = Object.values(FORMATS).every(
  ({ main, node }) => existsSync(join(DIST, main)) && existsSync(join(DIST, node)),
);
const requireBuilt = process.env['CI'] !== undefined;
/** Loading a whole built entry is slow on a busy machine. */
const LOAD_TIMEOUT_MS = 30_000;

type TEntry = Record<string, (...args: never[]) => unknown>;

async function load(format: keyof typeof FORMATS): Promise<{ main: TEntry; node: TEntry }> {
  const { main, node } = FORMATS[format];
  if (format === 'esm') {
    return {
      main: (await import(pathToFileURL(join(DIST, main)).href)) as TEntry,
      node: (await import(pathToFileURL(join(DIST, node)).href)) as TEntry,
    };
  }
  const require = createRequire(import.meta.url);
  return { main: require(join(DIST, main)) as TEntry, node: require(join(DIST, node)) as TEntry };
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function projectRoot(): { root: string; store: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'dist-entry-sharing-')));
  roots.push(base);
  const root = join(base, 'project');
  execFileSync('git', ['init', '--quiet', root]);
  writeFileSync(join(root, 'AGENTS.md'), '# from the project\n');
  return { root, store: join(base, 'trust.json') };
}

const STATE = {
  sessions: '.state/sessions',
  'session-logs': '.state/logs',
  memory: '.state/memory',
  checkpoints: '.state/checkpoints',
};

for (const format of ['esm', 'cjs'] as const) {
  describe.skipIf(!built && !requireBuilt)(
    `the built ${format} entries share one authority brand`,
    () => {
      it(
        'accepts, on the main entry, an authority and a mutation the ./node service issued',
        async () => {
          const { main, node } = await load(format);
          const { root, store } = projectRoot();
          const service = (
            node['createNodeWorkspaceTrustService'] as (...args: unknown[]) => {
              grant(cwd: string): Promise<{ status: string; authority: object }>;
            }
          )(store, STATE);
          const access = await service.grant(root);
          expect(access.status).toBe('trusted');
          const { authority } = access;

          // The four calls the bundled workflows package makes, on the main entry.
          const assertAuthority = main['assertWorkspaceProjectAuthority'] as (
            value: unknown,
          ) => unknown;
          const identityOf = main['getWorkspaceProjectIdentity'] as (value: unknown) => {
            worktreeRoot: string;
          };
          const readerOf = main['getWorkspaceProjectReader'] as (value: unknown) => {
            readText(path: string, purpose: string): string | undefined;
          };
          const assertMutationFor = main['assertWorkspaceProjectMutationForAuthority'] as (
            mutation: unknown,
            authority: unknown,
          ) => unknown;
          const createMutation = main['createWorkspaceProjectMutation'] as (
            authority: unknown,
            decision: unknown,
          ) => { writeBytes(path: string, bytes: Uint8Array, purpose: string): void };

          expect(assertAuthority(authority)).toBe(authority);
          expect(identityOf(authority).worktreeRoot).toBe(realpathSync.native(root));
          expect(readerOf(authority).readText('AGENTS.md', 'dist entry sharing')).toBe(
            '# from the project\n',
          );
          const mutation = createMutation(authority, { status: 'approved', purpose: 'dist test' });
          expect(assertMutationFor(mutation, authority)).toBe(mutation);

          // Where the host can prove a write stays in the project, the mutation really writes.
          if ((node['supportsWorkspaceProjectMutation'] as () => boolean)()) {
            mutation.writeBytes('written.txt', new TextEncoder().encode('hi'), 'dist test');
            expect(readerOf(authority).readText('written.txt', 'dist entry sharing')).toBe('hi');
          }
        },
        LOAD_TIMEOUT_MS,
      );

      it(
        'still refuses a look-alike object on the main entry',
        async () => {
          const { main } = await load(format);
          const assertAuthority = main['assertWorkspaceProjectAuthority'] as (
            value: unknown,
          ) => unknown;
          const assertMutationFor = main['assertWorkspaceProjectMutationForAuthority'] as (
            mutation: unknown,
            authority: unknown,
          ) => unknown;

          const forged = Object.freeze(Object.create(null));
          expect(() => assertAuthority(forged)).toThrow();
          expect(() => assertAuthority({})).toThrow();
          expect(() =>
            assertMutationFor({ writeBytes: () => undefined, deleteFile: () => false }, forged),
          ).toThrow();
        },
        LOAD_TIMEOUT_MS,
      );
    },
  );
}

describe.skipIf(!built && !requireBuilt)('the built main entry types', () => {
  it.each(['index.d.ts', 'index.d.cts'])(
    'carries the session and checkpoint store contracts a host with no files implements (%s)',
    (declaration) => {
      const exported =
        readFileSync(join(DIST, declaration), 'utf8')
          .split(/^export \{/m)
          .at(-1) ?? '';
      for (const name of [
        'IInteractiveSessionStore',
        'IInteractiveSessionRecord',
        'IResumableSessionSummary',
        'TSessionLoadOutcome',
        'IEditCheckpointStore',
        'IWorkspaceProjectFiles',
      ]) {
        expect(exported, name).toMatch(new RegExp(`\\btype ${name}\\b`));
      }
    },
  );
});
