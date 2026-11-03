/**
 * An oversized MCP tool result is conversation content spilled to disk. Where it goes is the product's
 * decision: the owner-only state root, never the shared operating-system temporary directory, and
 * gone when the run ends. The spill store alone still defaults to that temporary directory for SDK
 * embedders, so the CLI must always hand it a parent; the first test fails the moment it does not.
 *
 * Drives the real startup composition against a real stdio MCP server; a permissive umask is set so a
 * mode assertion cannot pass on an inherited restrictive one.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROCESS_OWNER_RECORD_NAME } from '@robota-sdk/agent-core/node';
import { WorkspaceTrustService } from '@robota-sdk/agent-framework';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { createProductUserSettingsSources } from '../../product/user-settings.js';
import { composeMcpClientForStartup } from '../mcp-startup.js';

import type { IWorkspaceIdentity } from '@robota-sdk/agent-framework';

const roots: string[] = [];
let previousUmask: number;

beforeEach(() => {
  previousUmask = process.umask(0o022);
});

afterEach(() => {
  process.umask(previousUmask);
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(prefix: string): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  roots.push(root);
  return root;
}

async function trustedAccessFor(root: string) {
  const identity: IWorkspaceIdentity = {
    repositoryKey: `fixture:${root}`,
    displayPath: root,
    worktreeRoot: root,
  };
  return new WorkspaceTrustService({
    identityResolver: { resolve: () => identity },
    store: {
      inspect: async () => ({ state: 'trusted', generation: 1 }),
      grant: async () => ({ state: 'trusted', generation: 1 }),
      revoke: async () => ({ state: 'revoked', generation: 2 }),
    },
  }).inspect(root);
}

interface ISpilledRun {
  readonly spillParent: string;
  /** What the operating-system temporary directory resolves to for this run. */
  readonly sharedTemporary: string;
  readonly mcp: Awaited<ReturnType<typeof composeMcpClientForStartup>>;
}

/**
 * Composes the real MCP startup with one stdio server whose result is large enough to spill, and
 * calls it once.
 */
async function spillOneResult(): Promise<ISpilledRun> {
  const cwd = tempRoot('test-product-spill-cwd-');
  const userHome = tempRoot('test-product-spill-home-');
  const sharedTemporary = tempRoot('test-product-spill-shared-tmp-');
  for (const name of ['TMPDIR', 'TMP', 'TEMP']) vi.stubEnv(name, sharedTemporary);
  const fixture = fileURLToPath(
    new URL('../../../../agent-mcp/examples/stdio-fixture-server.mjs', import.meta.url),
  );
  const args = [fixture, 'spillable-stdio'];
  const stateRoot = join(userHome, '.test-product');
  mkdirSync(stateRoot, { recursive: true });
  writeFileSync(
    join(stateRoot, 'settings.json'),
    JSON.stringify({
      mcpServers: { local: { type: 'stdio', command: process.execPath, args, cwd } },
    }),
  );
  const runtime = createTestProductRuntime('test-product', { HOME: userHome });
  const mcp = await composeMcpClientForStartup({
    productRuntime: runtime,
    settingsSources: createProductUserSettingsSources(runtime),
    projectAccess: await trustedAccessFor(cwd),
    cwd,
    env: {},
    mode: 'interactive',
    inspectTrust: async () => ({ state: 'trusted', generation: 1 }),
    reportDiagnostic: () => undefined,
    stdioAuthorities: {
      local: {
        allowedRoot: cwd,
        generation: 'host-1',
        executables: [{ command: process.execPath, args: [args] }],
        environment: { HOME: userHome },
      },
    },
  });
  await mcp.activationAdapter.approve('local');
  try {
    const tools = await mcp.connect();
    const result = await tools[0]!.execute({}, { toolName: 'local__ping', parameters: {} });
    expect(result.success).toBe(true);
    expect(result.data).toMatch(/^tool-result:/u);
  } catch (error) {
    await mcp.shutdown();
    throw error;
  }
  return { spillParent: join(stateRoot, 'spill'), sharedTemporary, mcp };
}

describe('a spilled MCP tool result', () => {
  it.skipIf(process.platform === 'win32')(
    'is spilled through a store the CLI gave the state root as its parent, never the temporary directory the store defaults to',
    async () => {
      const { spillParent, sharedTemporary, mcp } = await spillOneResult();
      try {
        expect(readdirSync(sharedTemporary)).toEqual([]);
        expect(readdirSync(spillParent)).toEqual([
          expect.stringMatching(
            new RegExp(`^agent-tool-results-${process.pid}-[A-Za-z0-9]{6}$`, 'u'),
          ),
        ]);
      } finally {
        await mcp.shutdown();
      }
      expect(readdirSync(sharedTemporary)).toEqual([]);
    },
    30_000,
  );

  it.skipIf(process.platform === 'win32')(
    'lives in an owner-only directory of the state root and is removed at shutdown',
    async () => {
      const { spillParent, sharedTemporary, mcp } = await spillOneResult();
      try {
        const [spillDirectory] = readdirSync(spillParent);
        const directory = join(spillParent, spillDirectory!);
        const [spillFile] = readdirSync(directory).filter(
          (name) => name !== PROCESS_OWNER_RECORD_NAME,
        );
        expect(statSync(spillParent).mode & 0o777).toBe(0o700);
        expect(statSync(directory).mode & 0o777).toBe(0o700);
        expect(statSync(join(directory, spillFile!)).mode & 0o777).toBe(0o600);
        expect(readFileSync(join(directory, spillFile!), 'utf8')).toContain('SPILLABLE-');
      } finally {
        await mcp.shutdown();
      }

      expect(readdirSync(spillParent)).toEqual([]);
      expect(readdirSync(sharedTemporary)).toEqual([]);
    },
    30_000,
  );
});
