import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemorySandboxClient } from '@robota-sdk/agent-tools';
import { afterAll, describe, expect, it } from 'vitest';

import { createDefaultTools } from '../create-default-tools.js';

import type { IRetrievalAdapter, IComputerDriver } from '@robota-sdk/agent-tools';

/**
 * ARCH-010 made `cwd` a required field of `ICreateDefaultToolsOptions`. The cases that assert the tool
 * LIST never execute a tool and so never reach a path guard; this root is named once, here, so that
 * inertness is visible rather than implied. The containment cases below choose their own roots.
 * Every root sits, unmade, inside one private per-run directory rather than at a fixed name under
 * /tmp that another local user could create first.
 */
const PRIVATE_BASE = mkdtempSync(join(tmpdir(), 'robota-create-tools-'));
afterAll(() => rmSync(PRIVATE_BASE, { recursive: true, force: true }));
const ASSEMBLY_ROOT = join(PRIVATE_BASE, 'create-tools-assembly-root');

describe('createDefaultTools', () => {
  it('assembles all default local tools and describes web tools as local tools', () => {
    expect(createDefaultTools({ cwd: ASSEMBLY_ROOT }).map((tool) => tool.getName())).toEqual([
      'Shell',
      'Bash',
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch',
      'AskUserQuestion',
    ]);
  });

  it('accepts a separate-filesystem sandbox client, withholding the host-only search tools', () => {
    const sandboxClient = new InMemorySandboxClient();

    expect(
      createDefaultTools({ sandboxClient, cwd: ASSEMBLY_ROOT }).map((tool) => tool.getName()),
    ).toEqual([
      'Shell',
      'Bash',
      'Read',
      'Write',
      'Edit',
      'WebFetch',
      'WebSearch',
      'AskUserQuestion',
    ]);
  });

  // SEC-007 — the reachability floor for the ENUMERATING tools. `Glob`/`Grep` used to be registered
  // here as the module-level singletons, which take no `cwd` at all: the assembly's containment root
  // reached `Read`/`Write`/`Edit` and stopped. A per-call instance is the whole fix, so the property
  // asserted is that the assembly produces a CONTAINED tool, not merely that a factory can accept a
  // `cwd` nobody passes.
  it('SEC-007: Glob and Grep are bound to the assembly cwd, not context-free singletons', async () => {
    const contained = createDefaultTools({ cwd: join(PRIVATE_BASE, 'sec007-assembly-scope') });
    // ARCH-010 — this used to be `createDefaultTools()` with no root at all, which is no longer
    // constructible. A SECOND root serves the same purpose and states it better: one shared singleton
    // could not carry two different roots either way.
    const otherRoot = createDefaultTools({ cwd: join(PRIVATE_BASE, 'sec007-other-scope') });

    for (const name of ['Glob', 'Grep']) {
      const tool = contained.find((candidate) => candidate.getName() === name);
      expect(tool, `${name} must be part of the default set`).toBeDefined();
      // A fresh instance per call — a shared singleton could not carry two different roots.
      expect(tool).not.toBe(otherRoot.find((candidate) => candidate.getName() === name));

      const parameters = { pattern: name === 'Grep' ? 'root' : '*', path: '/etc' };
      const outcome = await tool!.execute(
        parameters as never,
        {
          toolName: name,
          parameters,
        } as never,
      );
      const result = JSON.parse(String((outcome as { data?: unknown }).data)) as {
        success: boolean;
        error?: string;
      };

      expect(result.success, `${name} must refuse an out-of-root search root`).toBe(false);
      expect(result.error).toContain('outside the working directory');
    }
  });

  // SELFHOST-003 TC-03: the retrieval adapter is threaded through assembly and the tool is
  // adapter-gated — absent with no adapter, present (and only then) when an adapter is supplied.
  it('TC-03: CodebaseRetrieval joins the default set only when a retrieval adapter is supplied', () => {
    expect(createDefaultTools({ cwd: ASSEMBLY_ROOT }).map((tool) => tool.getName())).not.toContain(
      'CodebaseRetrieval',
    );

    const retrievalAdapter: IRetrievalAdapter = {
      retrieve: async () => ({ symbols: [], totalTokens: 0 }),
    };
    expect(
      createDefaultTools({ retrievalAdapter, cwd: ASSEMBLY_ROOT }).map((tool) => tool.getName()),
    ).toContain('CodebaseRetrieval');
  });

  // SELFHOST-010 TC-04: the computer driver is threaded through assembly and the ComputerView/Computer
  // tools are adapter-gated — ABSENT with no driver (no host fallback), present only when a driver is
  // supplied.
  it('TC-04: ComputerView/Computer join the default set only when a computer driver is supplied', () => {
    const withoutDriver = createDefaultTools({ cwd: ASSEMBLY_ROOT }).map((tool) => tool.getName());
    expect(withoutDriver).not.toContain('ComputerView');
    expect(withoutDriver).not.toContain('Computer');

    const computerDriver: IComputerDriver = {
      screenshot: async () => ({ data: 'x', mediaType: 'image/png' }),
      act: async () => ({ screenshot: { data: 'x', mediaType: 'image/png' } }),
    };
    const withDriver = createDefaultTools({ computerDriver, cwd: ASSEMBLY_ROOT }).map((tool) =>
      tool.getName(),
    );
    expect(withDriver).toContain('ComputerView');
    expect(withDriver).toContain('Computer');
  });
});

/**
 * CLI-1990 TC-11 — the default tier is RESIDENT.
 *
 * Residency is declared by omission: a tool that says nothing about `deferLoading` is sent on every
 * request, which is what every built-in must remain. Anthropic's own guidance is that standard tool
 * calling beats a search under ten tools, so deferring any of these would be a measurable
 * regression rather than a saving — and the invariant that at least one tool stays resident is
 * satisfied by this tier alone.
 */
describe('CLI-1990 TC-11 — default tool residency', () => {
  it('declares no deferLoading on any built-in — the whole tier is resident', () => {
    const deferred = createDefaultTools({ cwd: ASSEMBLY_ROOT })
      .filter((tool) => tool.schema.deferLoading !== undefined)
      .map((tool) => tool.getName());
    expect(deferred).toEqual([]);
  });

  it('keeps the ten built-ins ten — the search tool is added by session assembly, not here', () => {
    const names = createDefaultTools({ cwd: ASSEMBLY_ROOT }).map((tool) => tool.getName());
    expect(names).toEqual([
      'Shell',
      'Bash',
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch',
      'AskUserQuestion',
    ]);
    expect(names).not.toContain('ToolSearch');
  });

  it('stays resident under the adapter gates too', () => {
    const retrievalAdapter: IRetrievalAdapter = {
      retrieve: async () => ({ symbols: [], totalTokens: 0 }),
    };
    const withRetrieval = createDefaultTools({ retrievalAdapter, cwd: ASSEMBLY_ROOT });
    expect(withRetrieval.every((tool) => tool.schema.deferLoading === undefined)).toBe(true);
  });
});

describe('file tools follow the sandbox filesystem relation (issue #3081)', () => {
  it('a separate filesystem withholds Glob and Grep, and routes Read through the sandbox', async () => {
    const sandboxClient = new InMemorySandboxClient();
    await sandboxClient.writeFile('/sandbox/only.txt', 'inside the sandbox');
    const tools = createDefaultTools({ cwd: '/sandbox', sandboxClient });
    const names = tools.map((tool) => tool.getName());
    expect(names).not.toContain('Glob');
    expect(names).not.toContain('Grep');
    const read = tools.find((tool) => tool.getName() === 'Read')!;
    const result = await read.execute({ filePath: '/sandbox/only.txt' });
    expect(JSON.stringify(result)).toContain('inside the sandbox');
  });

  it('a shared filesystem keeps every file tool on the host', async () => {
    const shared = Object.assign(new InMemorySandboxClient(), { filesystem: 'shared' as const });
    await shared.writeFile('/sandbox/only.txt', 'inside the sandbox');
    const tools = createDefaultTools({ cwd: '/sandbox', sandboxClient: shared });
    const names = tools.map((tool) => tool.getName());
    expect(names).toContain('Glob');
    expect(names).toContain('Grep');
    const read = tools.find((tool) => tool.getName() === 'Read')!;
    const result = await read.execute({ filePath: '/sandbox/only.txt' });
    // The host has no /sandbox root, so the host read fails; it never consults the sandbox's files.
    expect(JSON.stringify(result)).not.toContain('inside the sandbox');
  });
});
