import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { InMemorySandboxClient } from '@robota-sdk/agent-tools';
import { afterAll, describe, expect, it } from 'vitest';

import { createDefaultTools } from '../create-default-tools.js';

/**
 * `cwd` is a required field of `ICreateDefaultToolsOptions`. The cases that assert the tool
 * LIST never execute a tool and so never reach a path guard; this root is named once, here, so that
 * inertness is visible rather than implied. The containment cases below choose their own roots.
 * Every root sits, unmade, inside one private per-run directory rather than at a fixed name under
 * /tmp that another local user could create first.
 */
const PRIVATE_BASE = mkdtempSync(join(tmpdir(), 'agent-test-create-tools-'));
afterAll(() => rmSync(PRIVATE_BASE, { recursive: true, force: true }));
const ASSEMBLY_ROOT = join(PRIVATE_BASE, 'create-tools-assembly-root');

describe('createDefaultTools', () => {
  it('assembles all default local tools', () => {
    expect(createDefaultTools({ cwd: ASSEMBLY_ROOT }).map((tool) => tool.getName())).toEqual([
      'Shell',
      'Bash',
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'WebFetch',
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
      'AskUserQuestion',
    ]);
  });

  // The reachability floor for the ENUMERATING tools. `Glob`/`Grep` used to be registered
  // here as the module-level singletons, which take no `cwd` at all: the assembly's containment root
  // reached `Read`/`Write`/`Edit` and stopped. A per-call instance is the whole fix, so the property
  // asserted is that the assembly produces a CONTAINED tool, not merely that a factory can accept a
  // `cwd` nobody passes.
  it('Glob and Grep are bound to the assembly cwd, not context-free singletons', async () => {
    const contained = createDefaultTools({ cwd: join(PRIVATE_BASE, 'sec007-assembly-scope') });
    // This used to be `createDefaultTools()` with no root at all, which is no longer
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

  // MUST 4: `WebFetch` used to be the module-level singleton `webFetchTool` from
  // `@robota-sdk/agent-tools` — the SAME object on every call. Two concurrently open sessions each
  // built from `createDefaultTools({cwd})` then shared it and tripped a resource guard's
  // `resource-reused` even though nothing about the tool needs sharing across sessions. A fresh
  // instance per call is the fix, mirroring Glob/Grep.
  it('MUST 4: WebFetch is a fresh instance per call, not a context-free singleton', () => {
    const first = createDefaultTools({ cwd: ASSEMBLY_ROOT });
    const second = createDefaultTools({ cwd: ASSEMBLY_ROOT });
    const a = first.find((tool) => tool.getName() === 'WebFetch');
    const b = second.find((tool) => tool.getName() === 'WebFetch');
    expect(a, 'WebFetch must be part of the default set').toBeDefined();
    expect(b).toBeDefined();
    expect(a).not.toBe(b);
  });

  // Web search reaches the model through the provider's native search and MCP servers; the default
  // set holds only tools that need no external service, credential or adapter, so none of the
  // adapter-gated tools is in it either.
  it('holds no web search tool and no adapter-gated tool', () => {
    const names = createDefaultTools({ cwd: ASSEMBLY_ROOT }).map((tool) => tool.getName());
    expect(names).not.toContain('WebSearch');
    for (const adapterGated of ['CodebaseRetrieval', 'ComputerView', 'Computer']) {
      expect(names).not.toContain(adapterGated);
    }
  });
});

/**
 * The default tier is RESIDENT.
 *
 * Residency is declared by omission: a tool that says nothing about `deferLoading` is sent on every
 * request, which is what every built-in must remain. Anthropic's own guidance is that standard tool
 * calling beats a search under ten tools, so deferring any of these would be a measurable
 * regression rather than a saving — and the invariant that at least one tool stays resident is
 * satisfied by this tier alone.
 */
describe('default tool residency', () => {
  it('declares no deferLoading on any built-in — the whole tier is resident', () => {
    const deferred = createDefaultTools({ cwd: ASSEMBLY_ROOT })
      .filter((tool) => tool.schema.deferLoading !== undefined)
      .map((tool) => tool.getName());
    expect(deferred).toEqual([]);
  });

  it('keeps the nine built-ins nine — the search tool is added by session assembly, not here', () => {
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
      'AskUserQuestion',
    ]);
    expect(names).not.toContain('ToolSearch');
  });
});

describe('file tools follow the sandbox filesystem relation', () => {
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

/** An editor reaches the host file tools and the searches, never the commands. */
describe('an editor reaches the host file tools only', () => {
  function recordingEditor() {
    const asked: string[] = [];
    const requests: string[] = [];
    const access = {
      pathAuthority: 'stable-root' as const,
      readTextFile: async (path: string) => {
        requests.push(`read ${path}`);
        return 'EDITOR TEXT\n';
      },
      writeTextFile: async (path: string) => {
        requests.push(`write ${path}`);
      },
    };
    return {
      requests,
      asked,
      editorFiles: () => {
        asked.push('asked');
        return access;
      },
    };
  }
  const parse = (outcome: unknown) =>
    JSON.parse(String((outcome as { data?: unknown }).data)) as { output: string };

  it('Read and Write go through the editor and the searches say they read the disk', async () => {
    const root = mkdtempSync(join(PRIVATE_BASE, 'editor-'));
    writeFileSync(join(root, 'probe.txt'), 'DISK TEXT\n');
    const editor = recordingEditor();
    const tools = createDefaultTools({ cwd: root, editorFiles: editor.editorFiles });
    const byName = (name: string) => tools.find((tool) => tool.getName() === name)!;

    expect(parse(await byName('Read').execute({ filePath: 'probe.txt' })).output).toContain(
      'EDITOR TEXT',
    );
    await byName('Write').execute({ filePath: 'out.txt', content: 'x' });
    expect(editor.requests).toEqual([`read ${join(root, 'probe.txt')}`, `write ${join(root, 'out.txt')}`]);
    expect(parse(await byName('Grep').execute({ pattern: 'DISK' })).output).toContain(
      '[Searched the files on disk.',
    );
  });

  it('Shell and Bash never ask for the editor', async () => {
    const root = mkdtempSync(join(PRIVATE_BASE, 'editor-shell-'));
    const editor = recordingEditor();
    const tools = createDefaultTools({ cwd: root, editorFiles: editor.editorFiles });
    for (const name of ['Shell', 'Bash']) {
      const outcome = await tools
        .find((tool) => tool.getName() === name)!
        .execute({ command: 'echo shell-ok' });
      expect(JSON.stringify(outcome)).toContain('shell-ok');
    }
    expect(editor.asked).toEqual([]);
  });

  it('a separate sandbox filesystem keeps every file tool, so the editor is not asked', async () => {
    const sandboxClient = new InMemorySandboxClient();
    await sandboxClient.writeFile('/sandbox/only.txt', 'inside the sandbox');
    const editor = recordingEditor();
    const tools = createDefaultTools({
      cwd: '/sandbox',
      sandboxClient,
      editorFiles: editor.editorFiles,
    });
    const read = tools.find((tool) => tool.getName() === 'Read')!;
    expect(JSON.stringify(await read.execute({ filePath: '/sandbox/only.txt' }))).toContain(
      'inside the sandbox',
    );
    await tools.find((tool) => tool.getName() === 'Write')!.execute({
      filePath: '/sandbox/out.txt',
      content: 'x',
    });
    expect(editor.asked).toEqual([]);
  });
});
