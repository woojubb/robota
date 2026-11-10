import { randomUUID } from 'node:crypto';
import { isAbsolute, relative } from 'node:path';

import {
  type IProcessMarkerHandle,
  type TProcessMarkerGuardResult,
} from '@robota-sdk/agent-core';
import {
  WorkspaceAuthorityRequiredError,
  WorkspaceTrustService,
  type IWorkspaceDirectoryEntry,
  type IWorkspaceIdentity,
  type IWorkspaceIdentityResolver,
  type IWorkspaceProjectFiles,
  type IWorkspaceProjectMutationBoundary,
  type IWorkspaceProjectStableWriter,
  type IWorkspaceTrustStore,
  type TWorkspaceContributionKind,
  type TWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import { createNodeWorkspaceIdentityResolver } from '@robota-sdk/agent-framework/node';

import { ensureWorkspaceRootBroker } from './workspace-root-broker-process.js';
import { requestWorkspaceRootBroker, type TWorkspaceRootBrokerResponse } from './workspace-root-broker.js';
import { SyncWorkspaceRootBrokerClient } from './workspace-root-broker-sync.js';

import type { ICliRuntimeContext } from '../product/runtime-context.js';

const KINDS = new Set(['file', 'directory', 'link', 'other']);

function refusal(response: TWorkspaceRootBrokerResponse): never {
  const reason = response.status === 'refused' ? response.reason : response.status;
  throw new WorkspaceAuthorityRequiredError(`The live workspace broker refused the operation (${reason}).`);
}

function kind(value: string): TWorkspaceContributionKind {
  if (!KINDS.has(value)) throw new WorkspaceAuthorityRequiredError('The workspace broker returned an invalid file kind.');
  return value as TWorkspaceContributionKind;
}

function within(root: string, cwd: string): boolean {
  const path = relative(root, cwd);
  return path === '' || (path !== '..' && !path.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(path));
}

/**
 * A checkpoint writer lease the broker holds for this process. The broker owns the marker, so no other
 * process can take it over while the broker runs, and it releases the lease when this process ends. The
 * marker's operation lock cannot stay held across the process boundary (the framework hands the guard a
 * closure), so a guarded operation runs only while the lease still holds, which is the same protection:
 * only the broker changes this marker.
 */
function brokeredWriterLease(
  sync: (request: Parameters<SyncWorkspaceRootBrokerClient['request']>[0]) => TWorkspaceRootBrokerResponse,
  writerLease: string,
): IProcessMarkerHandle {
  let released = false;
  const holds = (): boolean => {
    if (released) return false;
    try {
      const response = sync({ op: 'writerLeaseHolds', writerLease });
      return response.status === 'mutation' && response.value === true;
    } catch {
      return false;
    }
  };
  return Object.freeze({
    holds,
    withGuard: <T>(operation: () => T): TProcessMarkerGuardResult<T> =>
      holds() ? { status: 'ran', value: operation() } : { status: 'lost' },
    release: (): void => {
      if (released) return;
      released = true;
      try { sync({ op: 'writerLeaseRelease', writerLease }); } catch { /* the broker releases it when this process ends */ }
    },
  });
}

/** A CLI-owned service whose only project file port crosses the live root broker. */
export class BrokeredWorkspaceTrustService {
  readonly #runtime: ICliRuntimeContext;
  readonly #endpoint: string;
  readonly #inner: WorkspaceTrustService;
  readonly #identities = new Map<string, IWorkspaceIdentity>();
  readonly #leases = new Map<string, string>();
  readonly #sync: SyncWorkspaceRootBrokerClient;
  #pendingCandidate: string | undefined;

  private constructor(runtime: ICliRuntimeContext, endpoint: string) {
    this.#runtime = runtime;
    this.#endpoint = endpoint;
    this.#sync = new SyncWorkspaceRootBrokerClient(endpoint);
    const native = createNodeWorkspaceIdentityResolver();
    const identityResolver: IWorkspaceIdentityResolver = {
      resolve: (cwd) => {
        try {
          const identity = native.resolve(cwd);
          const remembered = this.#identities.get(identity.worktreeRoot);
          if (remembered !== undefined) return remembered;
          this.#identities.set(identity.worktreeRoot, identity);
          return identity;
        } catch (error) {
          for (const identity of this.#identities.values()) {
            if (within(identity.worktreeRoot, cwd)) return identity;
          }
          throw error;
        }
      },
    };
    const store: IWorkspaceTrustStore = {
      inspect: async (identity) => {
        let response: TWorkspaceRootBrokerResponse;
        try {
          response = await requestWorkspaceRootBroker(endpoint, {
            op: 'inspect', root: identity.worktreeRoot,
          });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return { state: 'untrusted', generation: 0 };
          }
          throw error;
        }
        if (response.status === 'trusted') {
          this.#leases.set(identity.worktreeRoot, response.lease);
          return { state: 'trusted', generation: response.generation, grantedAt: response.grantedAt };
        }
        this.#leases.delete(identity.worktreeRoot);
        if (response.status === 'untrusted' || response.status === 'revoked' ||
            response.status === 'stale/replaced') {
          return { state: response.status, generation: response.generation };
        }
        return refusal(response);
      },
      grant: async (identity) => {
        const candidate = this.#pendingCandidate;
        if (candidate === undefined) throw new Error('A prepared, human-approved workspace root is required.');
        const response = await requestWorkspaceRootBroker(endpoint, {
          op: 'approve', candidate, root: identity.worktreeRoot,
        });
        if (response.status !== 'trusted') return refusal(response);
        this.#leases.set(identity.worktreeRoot, response.lease);
        return { state: 'trusted', generation: response.generation, grantedAt: response.grantedAt };
      },
      revoke: async (identity) => {
        const response = await requestWorkspaceRootBroker(endpoint, {
          op: 'revoke', root: identity.worktreeRoot,
        });
        this.#leases.delete(identity.worktreeRoot);
        if (response.status !== 'revoked') return refusal(response);
        return { state: 'revoked', generation: response.generation };
      },
    };
    const leaseFor = (root: string): string => {
      const lease = this.#leases.get(root);
      if (lease === undefined) throw new WorkspaceAuthorityRequiredError('The workspace root has no live lease.');
      return lease;
    };
    const sync = (request: Parameters<SyncWorkspaceRootBrokerClient['request']>[0]) =>
      this.#sync.request(request);
    const mutation = (
      root: string,
      method: Extract<Parameters<typeof sync>[0], { op: 'mutate' }>['method'],
      relativePath: string,
      options: { content?: Uint8Array | string; temporaryName?: string; apply?: boolean; migrationStartedAt?: number } = {},
    ): TWorkspaceRootBrokerResponse => {
      const response = sync({
        op: 'mutate', lease: leaseFor(root), operationId: randomUUID(), method, relativePath,
        ...(options.content === undefined ? {} : {
          content: (typeof options.content === 'string'
            ? Buffer.from(options.content, 'utf8') : Buffer.from(options.content)).toString('base64'),
        }),
        ...(options.temporaryName === undefined ? {} : { temporaryName: options.temporaryName }),
        ...(options.apply === undefined ? {} : { apply: options.apply }),
        ...(options.migrationStartedAt === undefined ? {} : {
          migrationStartedAt: options.migrationStartedAt,
        }),
      });
      if (response.status !== 'mutation' && response.status !== 'missing') return refusal(response);
      return response;
    };
    const projectFiles: IWorkspaceProjectFiles = {
      readBytes: (root, segments, maxBytes) => {
        const response = sync({ op: 'read', lease: leaseFor(root), segments, maxBytes });
        if (response.status === 'missing') return undefined;
        if (response.status === 'over-budget') return 'over-budget';
        if (response.status === 'bytes') return Buffer.from(response.content, 'base64');
        return refusal(response);
      },
      listDirectory: (identity, _resolver, segments): readonly IWorkspaceDirectoryEntry[] => {
        const response = sync({ op: 'list', lease: leaseFor(identity.worktreeRoot), segments });
        if (response.status !== 'entries') return refusal(response);
        return response.entries.map((entry) => ({ name: entry.name, kind: kind(entry.kind) }));
      },
      inspectKind: (identity, _resolver, segments) => {
        const response = sync({ op: 'kind', lease: leaseFor(identity.worktreeRoot), segments });
        if (response.status === 'missing') return undefined;
        if (response.status === 'kind') return kind(response.kind);
        return refusal(response);
      },
      createMutationBoundary: (identity): IWorkspaceProjectMutationBoundary => {
        const root = identity.worktreeRoot;
        const result = (response: TWorkspaceRootBrokerResponse) => {
          if (response.status !== 'mutation') return refusal(response);
          return response.value;
        };
        return Object.freeze({
          write: (path: string, content: Uint8Array | string) => { mutation(root, 'write', path, { content }); },
          replace: (path: string, content: Uint8Array | string) => { mutation(root, 'replace', path, { content }); },
          append: (path: string, content: string) => { mutation(root, 'append', path, { content }); },
          delete: (path: string) => result(mutation(root, 'delete', path)) as boolean,
          sweepTemporaries: (path: string, apply: boolean, migrationStartedAt?: number) =>
            result(mutation(root, 'sweepTemporaries', path, { apply, migrationStartedAt })) as number,
          linkCount: (path: string) => {
            const response = mutation(root, 'linkCount', path);
            return response.status === 'missing' ? undefined : result(response) as number;
          },
          stage: (path: string, content: Uint8Array | string) =>
            result(mutation(root, 'stage', path, { content })) as string,
          commitStaged: (path: string, temporaryName: string) => {
            mutation(root, 'commitStaged', path, { temporaryName });
          },
          discardStaged: (path: string, temporaryName: string) => {
            mutation(root, 'discardStaged', path, { temporaryName });
          },
          claimDirectory: (path: string) => result(mutation(root, 'claimDirectory', path)) as boolean,
          acquireWriter: (path: string): IProcessMarkerHandle | undefined => {
            const response = sync({
              op: 'acquireWriter', lease: leaseFor(root), relativePath: path, owner: process.pid,
            });
            if (response.status === 'missing') return undefined;
            if (response.status !== 'writerLease') return refusal(response);
            return brokeredWriterLease(sync, response.writerLease);
          },
        });
      },
      createStableWriter: (root): IWorkspaceProjectStableWriter => {
        const response = sync({ op: 'prepareWriter', lease: leaseFor(root) });
        if (response.status !== 'writer') return refusal(response);
        const writer = response.writer;
        return Object.freeze({
          assertNamedRoot: () => {
            const answer = sync({ op: 'writerAssert', writer });
            if (answer.status !== 'same') return refusal(answer);
          },
          writeUtf8WhileNamed: (segments: readonly string[], content: string) => {
            const answer = sync({ op: 'writerWrite', writer, segments, content });
            if (answer.status !== 'written') return refusal(answer);
          },
          close: () => {
            const answer = sync({ op: 'writerClose', writer });
            if (answer.status !== 'released') return refusal(answer);
          },
        });
      },
    };
    this.#inner = new WorkspaceTrustService({
      identityResolver, store, projectFiles,
      projectStateDirectories: runtime.layout.projectStateDirectories,
    });
  }

  static async create(runtime: ICliRuntimeContext): Promise<BrokeredWorkspaceTrustService> {
    return new BrokeredWorkspaceTrustService(runtime, await ensureWorkspaceRootBroker(runtime));
  }

  inspect(cwd: string): Promise<TWorkspaceProjectAccess> { return this.#inner.inspect(cwd); }

  async prepare(cwd: string): Promise<string> {
    const identity = createNodeWorkspaceIdentityResolver().resolve(cwd);
    const response = await requestWorkspaceRootBroker(this.#endpoint, {
      op: 'prepare', root: identity.worktreeRoot,
    });
    if (response.status !== 'prepared') return refusal(response);
    return response.candidate;
  }

  async release(candidate: string): Promise<void> {
    const response = await requestWorkspaceRootBroker(this.#endpoint, { op: 'release', candidate });
    if (response.status !== 'released') return refusal(response);
  }

  async grant(cwd: string, candidate: string): Promise<TWorkspaceProjectAccess> {
    if (this.#pendingCandidate !== undefined) throw new Error('A workspace approval is already in progress.');
    this.#pendingCandidate = candidate;
    try {
      return await this.#inner.grant(cwd);
    } finally {
      this.#pendingCandidate = undefined;
    }
  }

  async revoke(cwd: string): Promise<TWorkspaceProjectAccess> {
    await ensureWorkspaceRootBroker(this.#runtime);
    return this.#inner.revoke(cwd);
  }

  close(): void { this.#sync.close(); }
}
