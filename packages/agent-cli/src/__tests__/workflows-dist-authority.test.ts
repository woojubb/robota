import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

/**
 * The CLI mints a workspace authority through `@robota-sdk/agent-framework/node`; the bundled
 * `@robota-sdk/workflows` (the published release, not rebuilt here) imports only the framework's main
 * entry and calls `assertWorkspaceProjectAuthority`, `getWorkspaceProjectReader`,
 * `getWorkspaceProjectIdentity` and `assertWorkspaceProjectMutationForAuthority` on it. The two
 * entries must therefore be one module instance in the built output, in ESM and in CJS. This runs
 * the real workflows dist over the framework's real dist in plain Node.
 *
 * Build-dependent: it needs the framework's `dist`, and is skipped where that was not built; CI
 * builds first and sets `CI`, where a missing build fails the test instead.
 */
const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  'fixtures',
  'workflows-dist-authority.mjs',
);
const FRAMEWORK_DIST = fileURLToPath(
  new URL('../../../agent-framework/dist/', import.meta.url),
);
const built = ['index.js', 'index.cjs', 'node.js', 'node.cjs'].every((name) =>
  existsSync(join(FRAMEWORK_DIST, name)),
);
const requireBuilt = process.env['CI'] !== undefined;
/** Each case starts a Node process that loads two built packages. */
const SPAWN_TIMEOUT_MS = 60_000;

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function projectRoot(): { root: string; store: string } {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'workflows-dist-authority-')));
  roots.push(base);
  const root = join(base, 'project');
  execFileSync('git', ['init', '--quiet', root]);
  writeFileSync(join(root, 'AGENTS.md'), '# project guidance\n');
  mkdirSync(join(root, '.workflows'));
  return { root, store: join(base, 'trust.json') };
}

describe.skipIf(!built && !requireBuilt)(
  'the published workflows dist over the framework dist',
  () => {
    it.each(['esm', 'cjs'] as const)(
      'accepts an authority and a mutation minted through ./node (%s)',
      (format) => {
        const { root, store } = projectRoot();
        const output = execFileSync(process.execPath, [FIXTURE, format, root, store], {
          encoding: 'utf8',
          // The trust store is the temporary one above; nothing is read from or written to the real HOME.
          env: { ...process.env, HOME: dirname(store) },
        });
        const result = JSON.parse(output.trim().split('\n').at(-1) ?? '{}') as Record<
          string,
          unknown
        >;

        expect(result).toMatchObject({
          trust: 'trusted',
          canMutate: true,
          executionRoot: root,
          read: '# project guidance\n',
          forged: 'WorkspaceAuthorityRequiredError',
        });
        expect(result['listing']).toEqual(expect.arrayContaining(['AGENTS.md', '.workflows']));
        if (process.platform === 'linux') expect(result['written']).toBe('{}');
      },
      SPAWN_TIMEOUT_MS,
    );
  },
);
