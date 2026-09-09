import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { isAbsolute, join, resolve } from 'node:path';

import { tightenExistingFile, writeOwnerOnlyFile } from '@robota-sdk/agent-core/node';

import { WorkspaceTrustService } from './workspace-trust-service.js';
import { userPaths } from '../paths.js';

import type {
  IWorkspaceIdentity,
  IWorkspaceIdentityResolver,
  IWorkspaceTrustStore,
  IWorkspaceTrustStoreSnapshot,
} from './types.js';

const TRUST_STORE_VERSION = 1;
const HEX_RADIX = 16;
const TRUST_STATES = new Set<IWorkspaceTrustStoreSnapshot['state']>(['trusted', 'revoked']);

type TJsonValue =
  null | boolean | number | string | TJsonValue[] | { readonly [key: string]: TJsonValue };

interface IPersistedGrant {
  readonly repositoryKey: string;
  readonly worktreeRoot: string;
  readonly state: 'trusted' | 'revoked';
  readonly generation: number;
  readonly grantedAt?: string;
}

interface IPersistedTrustStore {
  readonly version: 1;
  readonly grants: IPersistedGrant[];
}

function runGit(cwd: string, args: readonly string[]): string {
  try {
    return execFileSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch (error) {
    throw new Error(`Git workspace identity is unavailable for ${cwd}`, { cause: error });
  }
}

function canonicalPath(value: string): string {
  try {
    return realpathSync(value);
  } catch (error) {
    throw new Error(`Git workspace identity is unavailable for ${value}`, { cause: error });
  }
}

function identityKey(identity: Pick<IWorkspaceIdentity, 'repositoryKey' | 'worktreeRoot'>): string {
  return `${identity.repositoryKey}\0${identity.worktreeRoot}`;
}

function isJsonRecord(value: TJsonValue): value is { readonly [key: string]: TJsonValue } {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isTrustState(value: TJsonValue): value is IPersistedGrant['state'] {
  return typeof value === 'string' && TRUST_STATES.has(value as IPersistedGrant['state']);
}

function isPositiveGeneration(value: TJsonValue): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}

function parsePersistedGrant(value: TJsonValue, filePath: string): IPersistedGrant {
  if (!isJsonRecord(value)) {
    throw new Error(`workspace trust store is corrupt: ${filePath}`);
  }
  const { repositoryKey, worktreeRoot, state, generation, grantedAt } = value;
  if (
    typeof repositoryKey !== 'string' ||
    typeof worktreeRoot !== 'string' ||
    !isTrustState(state) ||
    !isPositiveGeneration(generation) ||
    (grantedAt !== undefined && typeof grantedAt !== 'string')
  ) {
    throw new Error(`workspace trust store has an invalid grant: ${filePath}`);
  }
  return {
    repositoryKey,
    worktreeRoot,
    state,
    generation,
    ...(grantedAt === undefined ? {} : { grantedAt }),
  };
}

function assertPersistedStore(value: TJsonValue, filePath: string): IPersistedTrustStore {
  if (!isJsonRecord(value)) throw new Error(`workspace trust store is corrupt: ${filePath}`);
  const grantsValue = value.grants;
  if (value.version !== TRUST_STORE_VERSION || !Array.isArray(grantsValue)) {
    throw new Error(`workspace trust store has an unexpected shape: ${filePath}`);
  }
  const grants = grantsValue.map((grant) => parsePersistedGrant(grant, filePath));
  const keys = grants.map((grant) => identityKey(grant));
  if (new Set(keys).size !== keys.length) {
    throw new Error(`workspace trust store has duplicate grant: ${filePath}`);
  }
  return { version: TRUST_STORE_VERSION, grants };
}

function snapshotFor(grant: IPersistedGrant | undefined): IWorkspaceTrustStoreSnapshot {
  if (grant === undefined) return { state: 'untrusted', generation: 0 };
  return {
    state: grant.state,
    generation: grant.generation,
    ...(grant.grantedAt === undefined ? {} : { grantedAt: grant.grantedAt }),
  };
}

function expectedGenerationError(expected: number, actual: number): Error {
  return new Error(
    `workspace trust grant changed concurrently (expected generation ${expected}, current ${actual})`,
  );
}

/** Resolve a Git worktree to a replacement-safe host identity. */
export function createNodeWorkspaceIdentityResolver(): IWorkspaceIdentityResolver {
  return Object.freeze({
    resolve(cwd: string): IWorkspaceIdentity {
      const canonicalCwd = canonicalPath(resolve(cwd));
      const worktreeRoot = canonicalPath(runGit(canonicalCwd, ['rev-parse', '--show-toplevel']));
      const commonDirValue = runGit(canonicalCwd, ['rev-parse', '--git-common-dir']);
      const commonDir = canonicalPath(
        isAbsolute(commonDirValue) ? commonDirValue : join(worktreeRoot, commonDirValue),
      );
      const commonStat = statSync(commonDir);
      const repositoryKey = `git:${commonStat.dev.toString(HEX_RADIX)}:${commonStat.ino.toString(HEX_RADIX)}:${commonDir}`;
      return Object.freeze({
        repositoryKey,
        displayPath: worktreeRoot,
        worktreeRoot,
      });
    },
  });
}

/** Default user-owned location for the persistent workspace trust grants. */
export function getWorkspaceTrustStorePath(): string {
  return join(dirname(userPaths().settings), 'workspace-trust.json');
}

function readPersistedTrustStore(filePath: string): IPersistedTrustStore {
  if (!existsSync(filePath)) return { version: TRUST_STORE_VERSION, grants: [] };
  try {
    tightenExistingFile(filePath);
    const raw = readFileSync(filePath, 'utf8');
    return assertPersistedStore(JSON.parse(raw) as TJsonValue, filePath);
  } catch (error) {
    if (error instanceof Error && /workspace trust store/.test(error.message)) throw error;
    throw new Error(`workspace trust store is corrupt: ${filePath}`, { cause: error });
  }
}

function writePersistedTrustStore(filePath: string, store: IPersistedTrustStore): void {
  writeOwnerOnlyFile(filePath, `${JSON.stringify(store, null, 2)}\n`);
}

/** Create the owner-only, replacement-safe persistent grant store used by the Node host. */
export function createNodeWorkspaceTrustStore(
  filePath: string = getWorkspaceTrustStorePath(),
): IWorkspaceTrustStore {
  const readStore = (): IPersistedTrustStore => readPersistedTrustStore(filePath);
  const writeStore = (store: IPersistedTrustStore): void =>
    writePersistedTrustStore(filePath, store);

  const findGrant = (
    store: IPersistedTrustStore,
    identity: IWorkspaceIdentity,
  ): IPersistedGrant | undefined =>
    store.grants.find((grant) => identityKey(grant) === identityKey(identity));

  const update = async (
    identity: IWorkspaceIdentity,
    expectedGeneration: number,
    state: IPersistedGrant['state'],
  ): Promise<IWorkspaceTrustStoreSnapshot> => {
    const store = readStore();
    const current = findGrant(store, identity);
    const actualGeneration = current?.generation ?? 0;
    if (actualGeneration !== expectedGeneration) {
      throw expectedGenerationError(expectedGeneration, actualGeneration);
    }
    const next: IPersistedGrant = {
      repositoryKey: identity.repositoryKey,
      worktreeRoot: identity.worktreeRoot,
      state,
      generation: actualGeneration + 1,
      ...(state === 'trusted' ? { grantedAt: new Date().toISOString() } : {}),
    };
    const grants = store.grants.filter((grant) => identityKey(grant) !== identityKey(identity));
    grants.push(next);
    writeStore({ version: TRUST_STORE_VERSION, grants });
    return snapshotFor(next);
  };

  return Object.freeze({
    async inspect(identity: IWorkspaceIdentity): Promise<IWorkspaceTrustStoreSnapshot> {
      return snapshotFor(findGrant(readStore(), identity));
    },
    grant(identity: IWorkspaceIdentity, expectedGeneration: number) {
      return update(identity, expectedGeneration, 'trusted');
    },
    revoke(identity: IWorkspaceIdentity, expectedGeneration: number) {
      return update(identity, expectedGeneration, 'revoked');
    },
  });
}

/** Compose the default Node resolver, persistent store, and authority service for a CLI host. */
export function createNodeWorkspaceTrustService(
  filePath: string = getWorkspaceTrustStorePath(),
): WorkspaceTrustService {
  return new WorkspaceTrustService({
    identityResolver: createNodeWorkspaceIdentityResolver(),
    store: createNodeWorkspaceTrustStore(filePath),
  });
}
