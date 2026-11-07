import { describe, expect, it } from 'vitest';

import {
  WorkspaceAuthorityRequiredError,
  WorkspaceTrustService,
  assertWorkspaceProjectAuthority,
  assertWorkspaceProjectMutation,
  assertWorkspaceProjectMutationForAuthority,
  assertWorkspaceProjectReader,
  assertWorkspaceProjectSettingsWriter,
  assertWorkspaceProjectStateStorage,
  createRestrictedWorkspaceProjectAccess,
  createWorkspaceProjectMutation,
  createWorkspaceProjectSettingsWriter,
  getWorkspaceProjectReader,
  getWorkspaceProjectStateStorage,
  prepareWorkflowJsonMutation,
} from './index.js';
import { ProjectReadLimitExceededError } from './project-reader-path.js';

import type {
  IWorkspaceDirectoryEntry,
  IWorkspaceIdentity,
  IWorkspaceProjectAuthority,
  IWorkspaceProjectFiles,
  IWorkspaceProjectMutation,
  IWorkspaceProjectMutationBoundary,
  IWorkspaceProjectReader,
  IWorkspaceProjectSettingsWriter,
  IWorkspaceProjectStateStorage,
  IWorkspaceTrustStore,
  TWorkspaceProjectStateDirectories,
} from './index.js';

/**
 * The host supplies the project file operations; the trust service binds them to every authority it
 * mints. These tests drive that binding with a host that has no file system at all, which is what a
 * platform-neutral host looks like, and prove that nothing but a minted authority reaches them.
 */

const STATE: TWorkspaceProjectStateDirectories = {
  sessions: '.state/sessions',
  'session-logs': '.state/logs',
  memory: '.state/memory',
  checkpoints: '.state/checkpoints',
};

const trustedStore: IWorkspaceTrustStore = {
  inspect: async () => ({ state: 'trusted', generation: 1 }),
  grant: async () => ({ state: 'trusted', generation: 1 }),
  revoke: async () => ({ state: 'revoked', generation: 2 }),
};

interface IMemoryFiles {
  readonly files: IWorkspaceProjectFiles;
  /** Every operation the host was asked to perform, in order. */
  readonly calls: string[];
  /** What each boundary wrote, by root-relative path. */
  readonly written: Map<string, Uint8Array | string>;
  readonly contents: Map<string, Uint8Array>;
  overBudget: boolean;
  readFailure: unknown;
}

function memoryFiles(initial: Readonly<Record<string, string>> = {}): IMemoryFiles {
  const calls: string[] = [];
  const written = new Map<string, Uint8Array | string>();
  const contents = new Map(
    Object.entries(initial).map(([name, text]) => [name, new TextEncoder().encode(text)]),
  );
  const state: IMemoryFiles = {
    calls,
    written,
    contents,
    overBudget: false,
    readFailure: undefined,
    files: {
      readBytes: (root, segments) => {
        calls.push(`readBytes ${root} ${segments.join('/')}`);
        if (state.readFailure !== undefined) throw state.readFailure;
        if (state.overBudget) return 'over-budget';
        return contents.get(segments.join('/'));
      },
      listDirectory: (_identity, _resolver, segments): readonly IWorkspaceDirectoryEntry[] => {
        calls.push(`listDirectory ${segments.join('/')}`);
        return [{ name: 'AGENTS.md', kind: 'file' }];
      },
      inspectKind: (_identity, _resolver, segments) => {
        calls.push(`inspectKind ${segments.join('/')}`);
        return contents.has(segments.join('/')) ? 'file' : undefined;
      },
      createMutationBoundary: (identity): IWorkspaceProjectMutationBoundary => {
        calls.push(`createMutationBoundary ${identity.worktreeRoot}`);
        const refuse = (): never => {
          throw new Error('not used here');
        };
        return {
          write: (path, content) => {
            calls.push(`write ${path}`);
            written.set(path, content);
          },
          replace: (path, content) => {
            calls.push(`replace ${path}`);
            written.set(path, content);
          },
          append: refuse,
          delete: (path) => {
            calls.push(`delete ${path}`);
            return written.delete(path);
          },
          sweepTemporaries: () => 0,
          linkCount: () => 1,
          stage: refuse,
          commitStaged: refuse,
          discardStaged: refuse,
        };
      },
      createStableWriter: (root) => {
        calls.push(`createStableWriter ${root}`);
        return {
          assertNamedRoot: () => undefined,
          writeUtf8WhileNamed: (segments, content) => {
            calls.push(`writeUtf8WhileNamed ${segments.join('/')}`);
            written.set(segments.join('/'), content);
          },
          close: () => undefined,
        };
      },
    },
  };
  return state;
}

function identityFor(root: string): IWorkspaceIdentity {
  return { repositoryKey: `memory:${root}`, displayPath: root, worktreeRoot: root };
}

async function trustedAuthority(
  host: IMemoryFiles,
  root = '/memory/project',
): Promise<IWorkspaceProjectAuthority> {
  const identity = identityFor(root);
  const access = await new WorkspaceTrustService({
    identityResolver: { resolve: () => identity },
    store: trustedStore,
    projectFiles: host.files,
    projectStateDirectories: STATE,
  }).inspect(root);
  if (access.status !== 'trusted') throw new Error('the service did not trust the project');
  return access.authority;
}

describe('a trust service built on the host’s project files', () => {
  it('reads, lists and inspects only through them, never through a file system', async () => {
    const host = memoryFiles({ 'AGENTS.md': '﻿hello' });
    const authority = await trustedAuthority(host);
    const reader = getWorkspaceProjectReader(authority);

    // A BOM is kept, as `Buffer` kept it.
    expect(reader.readText('AGENTS.md', 'test')).toBe('﻿hello');
    expect(reader.readText('missing.md', 'test')).toBeUndefined();
    expect(reader.listDirectory('', 'test')).toEqual([{ name: 'AGENTS.md', kind: 'file' }]);
    expect(reader.inspectKind('AGENTS.md', 'test')).toBe('file');
    expect(host.calls).toEqual([
      'readBytes /memory/project AGENTS.md',
      'readBytes /memory/project missing.md',
      'listDirectory ',
      'inspectKind AGENTS.md',
    ]);
  });

  it.each([
    ['/memory/project', '/', '.state/sessions'],
    ['C:\\memory\\project', '\\', '.state\\sessions'],
  ])(
    'spells the paths it hands back with the separator of the host (%s)',
    async (root, separator, stateRoot) => {
      const host = memoryFiles({ 'AGENTS.md': 'top', 'a/b/AGENTS.md': 'nested' });
      const identity = identityFor(root);
      const access = await new WorkspaceTrustService({
        identityResolver: { resolve: () => identity },
        store: trustedStore,
        projectFiles: host.files,
        projectStateDirectories: { ...STATE, sessions: stateRoot },
      }).inspect(root);
      if (access.status !== 'trusted') throw new Error('expected trusted access');

      // The labels a context load or a memory store shows are the host's own spelling...
      expect(
        getWorkspaceProjectReader(access.authority)
          .readTextAlongAncestors('a/b', 'AGENTS.md', 'test')
          .map((entry) => entry.relativePath),
      ).toEqual([`AGENTS.md`, `a${separator}b${separator}AGENTS.md`]);
      expect(
        getWorkspaceProjectStateStorage(access.authority, 'sessions').projectRelativePath(
          'x/y.json',
        ),
      ).toBe(`${stateRoot}${separator}x${separator}y.json`);
      // ...and what the host's files are asked for is always the split segments.
      expect(host.calls.filter((call) => call.startsWith('readBytes'))).toEqual([
        `readBytes ${root} AGENTS.md`,
        `readBytes ${root} a/AGENTS.md`,
        `readBytes ${root} a/b/AGENTS.md`,
      ]);
    },
  );

  it('reports a file over the budget as the project read limit, and a host failure as a refusal', async () => {
    const host = memoryFiles({ 'big.md': 'x' });
    const reader = getWorkspaceProjectReader(await trustedAuthority(host));

    host.overBudget = true;
    expect(() => reader.readBytes('big.md', 'test', 7)).toThrowError(
      expect.objectContaining<Partial<ProjectReadLimitExceededError>>({
        maxBytes: 7,
        actualBytes: 8n,
      }),
    );

    host.overBudget = false;
    host.readFailure = new Error('EACCES /memory/project/secret-path');
    let refusal: unknown;
    try {
      reader.readBytes('big.md', 'test');
    } catch (error) {
      refusal = error;
    }
    // Whatever a host throws reaches the caller as a refusal that names no path.
    expect(refusal).toBeInstanceOf(WorkspaceAuthorityRequiredError);
    expect(String(refusal)).not.toContain('secret-path');

    const phrased = new WorkspaceAuthorityRequiredError('The host refused this read.');
    host.readFailure = phrased;
    expect(() => reader.readBytes('big.md', 'test')).toThrow(phrased);
  });

  it('writes state, settings and project mutations through the boundary of the authority’s own files', async () => {
    const host = memoryFiles();
    const authority = await trustedAuthority(host);

    const storage = getWorkspaceProjectStateStorage(authority, 'sessions');
    storage.writeText('a/b.json', '{"é":1}', 'test');
    expect(host.written.get('.state/sessions/a/b.json')).toEqual(
      new TextEncoder().encode('{"é":1}'),
    );
    expect(storage.projectRelativePath('a/b.json')).toBe('.state/sessions/a/b.json');

    const settings = createWorkspaceProjectSettingsWriter(authority, {
      status: 'approved',
      target: 'project',
      relativePath: '.agent/settings.json',
      purpose: 'test',
    });
    settings.writeText('{}');
    expect(host.written.get('.agent/settings.json')).toBe('{}');

    const mutation = createWorkspaceProjectMutation(authority, {
      status: 'approved',
      purpose: 'test',
    });
    mutation.writeBytes('docs/x.md', new Uint8Array([1]), 'test');
    expect(host.written.get('docs/x.md')).toEqual(new Uint8Array([1]));
    expect(assertWorkspaceProjectMutationForAuthority(mutation, authority)).toBe(mutation);

    const workflow = prepareWorkflowJsonMutation(authority);
    workflow
      .approve({ status: 'approved', purpose: 'test' })
      .writeBytes('.workflows/w.json', new TextEncoder().encode('{}'), 'test');
    workflow.close();
    expect(host.written.get('.workflows/w.json')).toBe('{}');
    expect(host.calls).toContain('createStableWriter /memory/project');
  });

  it('keeps two services’ files apart: a mutation of one authority is no mutation of another', async () => {
    const first = memoryFiles();
    const second = memoryFiles();
    const firstAuthority = await trustedAuthority(first, '/memory/one');
    const secondAuthority = await trustedAuthority(second, '/memory/two');
    const mutation = createWorkspaceProjectMutation(firstAuthority, {
      status: 'approved',
      purpose: 'test',
    });

    mutation.writeBytes('x.md', new Uint8Array([1]), 'test');
    expect(first.written.size).toBe(1);
    expect(second.written.size).toBe(0);
    expect(() => assertWorkspaceProjectMutationForAuthority(mutation, secondAuthority)).toThrow(
      WorkspaceAuthorityRequiredError,
    );
  });

  it('binds the operations when the service is built: a host changing its object later changes nothing', async () => {
    const host = memoryFiles({ 'AGENTS.md': 'bound' });
    const replaced = memoryFiles({ 'AGENTS.md': 'swapped in' });
    const mutableFiles = { ...host.files };
    const identity = identityFor('/memory/project');
    const service = new WorkspaceTrustService({
      identityResolver: { resolve: () => identity },
      store: trustedStore,
      projectFiles: mutableFiles,
    });
    mutableFiles.readBytes = replaced.files.readBytes;

    const access = await service.inspect('/memory/project');
    if (access.status !== 'trusted') throw new Error('expected trusted access');
    expect(getWorkspaceProjectReader(access.authority).readText('AGENTS.md', 'test')).toBe('bound');
    expect(replaced.calls).toEqual([]);
  });
});

describe('an authority cannot be forged or carried by a host', () => {
  it('refuses a look-alike of every minted object, and never reaches the host’s files for one', async () => {
    const host = memoryFiles({ 'AGENTS.md': 'secret' });
    const authority = await trustedAuthority(host);
    const reader = getWorkspaceProjectReader(authority);
    const storage = getWorkspaceProjectStateStorage(authority, 'sessions');
    const mutation = createWorkspaceProjectMutation(authority, {
      status: 'approved',
      purpose: 'test',
    });
    const writer = createWorkspaceProjectSettingsWriter(authority, {
      status: 'approved',
      target: 'project',
      relativePath: '.agent/settings.json',
      purpose: 'test',
    });
    host.calls.length = 0;

    // Each look-alike copies every own and inherited member of the real object, or implements its
    // interface by hand; none of them was issued by the service.
    const copyOf = <T extends object>(real: T): T => {
      const copy = Object.create(Object.getPrototypeOf(real)) as Record<PropertyKey, unknown>;
      for (const key of Reflect.ownKeys(real)) {
        const descriptor = Object.getOwnPropertyDescriptor(real, key);
        if (descriptor !== undefined) Object.defineProperty(copy, key, descriptor);
      }
      return copy as T;
    };
    const lookAlikeAuthority = copyOf(authority);
    const handWrittenAuthority = Object.freeze(Object.create(null)) as IWorkspaceProjectAuthority;
    const lookAlikeReader: IWorkspaceProjectReader = {
      readText: () => 'forged',
      readBytes: () => new Uint8Array(),
      listDirectory: () => [],
      inspectKind: () => 'file',
      readTextAlongAncestors: () => [],
    } as unknown as IWorkspaceProjectReader;
    const lookAlikeStorage = {
      ...copyOf(storage),
      namespace: 'sessions',
      rootRelativePath: '.state/sessions',
    } as unknown as IWorkspaceProjectStateStorage;
    const lookAlikeMutation = {
      writeBytes: () => undefined,
      deleteFile: () => false,
    } as unknown as IWorkspaceProjectMutation;
    const lookAlikeWriter = {
      target: 'project',
      relativePath: '.agent/settings.json',
      writeText: () => undefined,
    } as unknown as IWorkspaceProjectSettingsWriter;

    for (const forged of [
      lookAlikeAuthority,
      handWrittenAuthority,
      {},
      JSON.parse('{}') as object,
    ]) {
      expect(() => assertWorkspaceProjectAuthority(forged)).toThrow(
        WorkspaceAuthorityRequiredError,
      );
      expect(() => getWorkspaceProjectReader(forged as IWorkspaceProjectAuthority)).toThrow(
        WorkspaceAuthorityRequiredError,
      );
      expect(() =>
        getWorkspaceProjectStateStorage(forged as IWorkspaceProjectAuthority, 'sessions'),
      ).toThrow(WorkspaceAuthorityRequiredError);
      expect(() =>
        createWorkspaceProjectMutation(forged as IWorkspaceProjectAuthority, {
          status: 'approved',
          purpose: 'test',
        }),
      ).toThrow(WorkspaceAuthorityRequiredError);
      expect(() =>
        createWorkspaceProjectSettingsWriter(forged as IWorkspaceProjectAuthority, {
          status: 'approved',
          target: 'project',
          relativePath: '.agent/settings.json',
          purpose: 'test',
        }),
      ).toThrow(WorkspaceAuthorityRequiredError);
      expect(() => prepareWorkflowJsonMutation(forged as IWorkspaceProjectAuthority)).toThrow(
        WorkspaceAuthorityRequiredError,
      );
    }
    for (const forged of [lookAlikeReader, copyOf(reader)]) {
      expect(() => assertWorkspaceProjectReader(forged)).toThrow(WorkspaceAuthorityRequiredError);
    }
    for (const forged of [lookAlikeStorage, copyOf(storage)]) {
      expect(() => assertWorkspaceProjectStateStorage(forged)).toThrow(
        WorkspaceAuthorityRequiredError,
      );
    }
    for (const forged of [lookAlikeMutation, copyOf(mutation)]) {
      expect(() => assertWorkspaceProjectMutation(forged)).toThrow(WorkspaceAuthorityRequiredError);
      expect(() => assertWorkspaceProjectMutationForAuthority(forged, authority)).toThrow(
        WorkspaceAuthorityRequiredError,
      );
    }
    for (const forged of [lookAlikeWriter, copyOf(writer)]) {
      expect(() => assertWorkspaceProjectSettingsWriter(forged)).toThrow(
        WorkspaceAuthorityRequiredError,
      );
    }

    // The genuine objects still pass, and not one of the refusals reached the host.
    expect(assertWorkspaceProjectAuthority(authority)).toBe(authority);
    expect(assertWorkspaceProjectReader(reader)).toBe(reader);
    expect(assertWorkspaceProjectStateStorage(storage)).toBe(storage);
    expect(assertWorkspaceProjectMutation(mutation)).toBe(mutation);
    expect(assertWorkspaceProjectSettingsWriter(writer)).toBe(writer);
    expect(host.calls).toEqual([]);
  });

  it('hands out facets whose own properties carry nothing of the host’s file operations', async () => {
    const host = memoryFiles({ 'AGENTS.md': 'x' });
    const authority = await trustedAuthority(host);
    const facets = {
      authority,
      reader: getWorkspaceProjectReader(authority),
      storage: getWorkspaceProjectStateStorage(authority, 'sessions'),
      mutation: createWorkspaceProjectMutation(authority, { status: 'approved', purpose: 'test' }),
      writer: createWorkspaceProjectSettingsWriter(authority, {
        status: 'approved',
        target: 'project',
        relativePath: '.agent/settings.json',
        purpose: 'test',
      }),
    };

    // The host's operations take any root, so a holder of a reader must not be able to pick them up
    // from it: nothing is reachable as a property, enumerable or not, string or symbol.
    expect(Reflect.ownKeys(facets.authority)).toEqual([]);
    expect(Reflect.ownKeys(facets.reader)).toEqual([]);
    expect(Reflect.ownKeys(facets.mutation)).toEqual([]);
    expect(Reflect.ownKeys(facets.storage).sort()).toEqual(['namespace', 'rootRelativePath']);
    expect(Reflect.ownKeys(facets.writer).sort()).toEqual(['relativePath', 'target']);
  });

  it('keeps the service’s files, generations and minting step out of every property and method', async () => {
    const host = memoryFiles({ 'AGENTS.md': 'x' });
    const identity = identityFor('/memory/project');
    const options = {
      identityResolver: { resolve: () => identity },
      store: trustedStore,
      projectFiles: host.files,
      projectStateDirectories: STATE,
    };
    const service = new WorkspaceTrustService(options);

    // The service is the one issuer, and the operations it holds take any root: no own property of it
    // carries them, the host's raw object, the generations that decide liveness or the options.
    expect(Reflect.ownKeys(service)).toEqual([]);
    // Nothing a caller can reach mints an authority but the three entry points.
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(service)).sort()).toEqual([
      'constructor',
      'grant',
      'inspect',
      'revoke',
    ]);
    for (const hidden of ['options', 'projectFiles', 'issuerGenerations', 'mintTrustedAccess']) {
      expect((service as unknown as Record<string, unknown>)[hidden]).toBeUndefined();
    }

    // Still a working issuer, and one the host cannot redirect after the fact.
    options.store = {
      ...trustedStore,
      inspect: async () => ({ state: 'untrusted', generation: 0 }),
    };
    const access = await service.inspect('/memory/project');
    expect(access.status).toBe('trusted');
  });

  it('gives an authority one reader, built over the files the service was given', async () => {
    const host = memoryFiles();
    const authority = await trustedAuthority(host);
    expect(getWorkspaceProjectReader(authority)).toBe(getWorkspaceProjectReader(authority));
  });

  it('stops a revoked authority’s reads and writes at once', async () => {
    const host = memoryFiles({ 'AGENTS.md': 'hello' });
    let live = true;
    const identity = identityFor('/memory/project');
    const service = new WorkspaceTrustService({
      identityResolver: { resolve: () => identity },
      store: {
        inspect: async () => ({ state: live ? 'trusted' : 'revoked', generation: live ? 1 : 2 }),
        grant: async () => ({ state: 'trusted', generation: 1 }),
        revoke: async () => ({ state: 'revoked', generation: 2 }),
      },
      projectFiles: host.files,
      projectStateDirectories: STATE,
    });
    const access = await service.inspect('/memory/project');
    if (access.status !== 'trusted') throw new Error('expected trusted access');
    const reader = getWorkspaceProjectReader(access.authority);
    const mutation = createWorkspaceProjectMutation(access.authority, {
      status: 'approved',
      purpose: 'test',
    });

    live = false;
    expect((await service.inspect('/memory/project')).status).toBe('restricted');
    host.calls.length = 0;
    expect(() => reader.readText('AGENTS.md', 'test')).toThrow(WorkspaceAuthorityRequiredError);
    expect(() => mutation.writeBytes('x.md', new Uint8Array(), 'test')).toThrow(
      WorkspaceAuthorityRequiredError,
    );
    expect(host.calls).toEqual([]);
  });
});

describe('a host without project files', () => {
  const identity = identityFor('/memory/project');

  it('builds no trust service: it refuses at construction rather than at the first read', () => {
    const options = { identityResolver: { resolve: () => identity }, store: trustedStore };
    expect(
      () =>
        new WorkspaceTrustService(
          options as unknown as ConstructorParameters<typeof WorkspaceTrustService>[0],
        ),
    ).toThrow(/projectFiles/);
    for (const member of [
      'readBytes',
      'listDirectory',
      'inspectKind',
      'createMutationBoundary',
      'createStableWriter',
    ] as const) {
      const files = { ...memoryFiles().files, [member]: undefined };
      expect(
        () =>
          new WorkspaceTrustService({
            ...options,
            projectFiles: files as unknown as IWorkspaceProjectFiles,
          }),
      ).toThrow(new RegExp(`projectFiles\\.${member}`));
    }
  });

  it('is Restricted: its access carries no authority and so can read and write nothing', () => {
    const access = createRestrictedWorkspaceProjectAccess('untrusted', '/memory/project');

    expect(access).toMatchObject({ status: 'restricted', reason: 'WorkspaceAuthorityRequired' });
    expect('authority' in access).toBe(false);
    expect(() => assertWorkspaceProjectAuthority(undefined)).toThrow(
      WorkspaceAuthorityRequiredError,
    );
  });
});
