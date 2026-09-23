import { mkdtemp, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createStdioAdapter } from '../client/stdio.js';
import { definitionFingerprint, securityIdentity } from '../definition/identity.js';

import type { IMCPActivationAdmission, IMCPActivationRequest } from '../mcp-activation.js';
import type { IMCPServerDefinitionResolved, IMCPResolvedEntry } from '../definition/types.js';

function fixture(
  root: string,
  cwd?: string,
  overrides: Partial<IMCPServerDefinitionResolved> = {},
) {
  const definition: IMCPServerDefinitionResolved = {
    name: 'fixture',
    source: 'project',
    origin: 'fixture.json',
    transport: 'stdio',
    command: process.execPath,
    args: ['server.mjs'],
    unsetVariables: [],
    ...(cwd === undefined ? {} : { cwd }),
    ...overrides,
  };
  const entry: IMCPResolvedEntry = {
    name: definition.name,
    source: definition.source,
    origin: definition.origin,
    status: 'resolved',
    definition,
    shadowed: [],
  };
  const fingerprint = definitionFingerprint(definition);
  const activation: IMCPActivationRequest = {
    serverId: definition.name,
    endpoint: [definition.command ?? '', ...(definition.args ?? [])].join(' ').trim(),
    source: definition.source,
    provenance: { kind: definition.source, id: definition.origin, version: fingerprint },
    definitionFingerprint: fingerprint,
    securityIdentity: securityIdentity(entry),
    workspace: { repositoryKey: root, trustState: 'trusted', generation: 1 },
  };
  return { definition, activation };
}

describe('stdio authority admission', () => {
  function approvedAdmission(): IMCPActivationAdmission {
    return {
      inspect: vi.fn(() => {
        throw Error('unused');
      }),
      admit: vi.fn((request) => ({
        ...request,
        status: 'approved',
        allowed: true,
        reason: 'approved',
      })),
    };
  }

  it('rejects an untrusted definition before reading host environment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcp-stdio-'));
    const input = fixture(root);
    const environment = Object.defineProperty({}, 'HOME', {
      enumerable: true,
      get: vi.fn(() => 'secret'),
    });
    const admission: IMCPActivationAdmission = {
      inspect: vi.fn(() => {
        throw Error('unused');
      }),
      admit: vi.fn(() => ({
        ...input.activation,
        status: 'untrusted' as const,
        allowed: false,
        reason: 'untrusted',
      })),
    };
    const adapter = createStdioAdapter({
      admission,
      authority: {
        allowedRoot: root,
        generation: '1',
        executables: [{ command: process.execPath, args: [['server.mjs']] }],
        environment,
      },
    });
    expect((await adapter.admit(input)).ok).toBe(false);
    expect(Object.getOwnPropertyDescriptor(environment, 'HOME')?.get).not.toHaveBeenCalled();
  });

  it('rejects traversal and symlink escape before transport construction', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcp-stdio-'));
    const outside = await mkdtemp(join(tmpdir(), 'mcp-outside-'));
    await mkdir(join(root, 'inside'));
    await symlink(outside, join(root, 'escape'));
    const admission = approvedAdmission();
    const adapter = createStdioAdapter({
      admission,
      authority: {
        allowedRoot: root,
        generation: '1',
        executables: [{ command: process.execPath, args: [['server.mjs']] }],
      },
    });
    expect((await adapter.admit(fixture(root, '../outside'))).ok).toBe(false);
    expect((await adapter.admit(fixture(root, 'escape'))).ok).toBe(false);
    expect((await adapter.admit(fixture(root, 'inside'))).ok).toBe(true);
  });

  it('rejects executable, argv, and environment authority violations', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcp-stdio-'));
    const adapter = createStdioAdapter({
      admission: approvedAdmission(),
      authority: {
        allowedRoot: root,
        generation: '1',
        executables: [{ command: process.execPath, args: [['server.mjs']] }],
        environment: { HOME: root, TOKEN: 'host-secret' },
        allowedEnvironmentKeys: ['TOKEN'],
      },
    });
    expect((await adapter.admit(fixture(root, undefined, { command: '/bin/echo' }))).ok).toBe(
      false,
    );
    expect((await adapter.admit(fixture(root, undefined, { args: ['-e', 'code'] }))).ok).toBe(
      false,
    );
    expect((await adapter.admit(fixture(root, undefined, { env: { OTHER: 'value' } }))).ok).toBe(
      false,
    );
    expect(
      (await adapter.admit(fixture(root, undefined, { env: { TOKEN: 'different' } }))).ok,
    ).toBe(false);
    expect(
      (await adapter.admit(fixture(root, undefined, { env: { NODE_OPTIONS: '--require=x' } }))).ok,
    ).toBe(false);
    expect(
      (await adapter.admit(fixture(root, undefined, { env: { TOKEN: 'host-secret' } }))).ok,
    ).toBe(true);
  });

  it('accepts a symlinked host root by canonical identity and rejects invalid roots', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcp-stdio-'));
    const link = join(await mkdtemp(join(tmpdir(), 'mcp-link-')), 'root');
    await symlink(root, link);
    const accepted = createStdioAdapter({
      admission: approvedAdmission(),
      authority: {
        allowedRoot: link,
        generation: '1',
        executables: [{ command: process.execPath, args: [['server.mjs']] }],
      },
    });
    expect((await accepted.admit(fixture(root, link))).ok).toBe(true);
    const invalid = createStdioAdapter({
      admission: approvedAdmission(),
      authority: {
        allowedRoot: join(root, 'missing'),
        generation: '1',
        executables: [{ command: process.execPath, args: [['server.mjs']] }],
      },
    });
    expect((await invalid.admit(fixture(root))).ok).toBe(false);
  });

  it('rejects unresolved cwd templates and NUL arguments', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mcp-stdio-'));
    const adapter = createStdioAdapter({
      admission: approvedAdmission(),
      authority: {
        allowedRoot: root,
        generation: '1',
        executables: [{ command: process.execPath, args: [['server.mjs'], ['a\0b']] }],
      },
    });
    expect((await adapter.admit(fixture(root, '${MISSING}'))).ok).toBe(false);
    expect((await adapter.admit(fixture(root, undefined, { args: ['a\0b'] }))).ok).toBe(false);
  });
});
