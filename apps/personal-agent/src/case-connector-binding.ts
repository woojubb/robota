/** An owner's explicit choice of connector for a case, kept apart from model-written case text. */
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

import { ConnectorRefusedError } from '@robota-sdk/agent-product/personal';

import type { CaseBook, ConnectorBook, IConnector } from '@robota-sdk/agent-product/personal';
import type { ICaseActionScope } from './connectors/case-action-scope.js';

export interface ICaseConnectorBinding {
  readonly revision: string;
  readonly connectorId?: string;
  readonly error?: true;
}

export interface ICaseConnectorAuthority {
  readonly connectorId: string;
  readonly generation: string;
}

export interface ICaseAuthorityState {
  readonly binding: ICaseConnectorAuthority;
  readonly connector: IConnector;
}

export interface ICaseConnectorBindings {
  get(caseId: string): Promise<ICaseConnectorBinding | undefined>;
  set(
    caseId: string,
    connectorId: string | null,
    revision: string,
  ): Promise<ICaseConnectorBinding | undefined>;
  fence(caseId: string, revision: string): Promise<ICaseConnectorBinding | undefined>;
  /** Take a snapshot under both locks. It must be rechecked at effect dispatch. */
  authoritySnapshot(caseId: string): Promise<ICaseConnectorAuthority | undefined>;
  /** Synchronously use the current authority while both locks are held; the boxed value is not awaited. */
  withAuthority<T>(
    caseId: string,
    use: (state: ICaseAuthorityState | undefined) => { readonly value: T },
  ): Promise<{ readonly value: T }>;
  /** Clear a case on closure while the caller holds the shared settings lock. */
  closeLocked(caseId: string): Promise<void>;
  /** Revoke references before a connector record is removed; caller holds the shared lock. */
  removeConnectorLocked(connectorId: string): Promise<void>;
}

interface ISavedBinding {
  readonly revision: string;
  readonly generation: string;
  readonly connectorId?: string;
  readonly error?: never;
}

type TBindingState =
  | ISavedBinding
  | {
      readonly revision: string;
      readonly error: true;
      readonly connectorId?: never;
      readonly generation?: never;
    };

const CASE_ID = /^case-[a-z0-9]{1,40}$/u;
const CONNECTOR_ID = /^connector-[a-z0-9-]{1,60}$/u;
const REVISION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function createCaseConnectorBindings(options: {
  readonly directory: string;
  readonly cases: CaseBook;
  readonly connectors: ConnectorBook;
  /** The same filesystem-backed lock that protects connector scope changes and removals. */
  readonly scope: ICaseActionScope;
  /** The lock that protects case writes, including closure in another process. */
  readonly writes: ICaseActionScope;
}): ICaseConnectorBindings {
  mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  const pathOf = (caseId: string): string => {
    if (!CASE_ID.test(caseId)) throw new ConnectorRefusedError('Invalid case id');
    return join(options.directory, `${caseId}.json`);
  };
  // Preserve unexpected directories during explicit recovery instead of deleting their contents.
  const retireDirectory = (path: string): void => {
    try {
      if (lstatSync(path).isDirectory()) renameSync(path, `${path}.damaged-${randomUUID()}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  };
  const write = (caseId: string, value: ISavedBinding, recovering = false): void => {
    const path = pathOf(caseId);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
      if (recovering) retireDirectory(path);
      renameSync(temporary, path);
    } catch {
      throw new ConnectorRefusedError('The case connector setting could not be saved');
    } finally {
      rmSync(temporary, { force: true });
    }
  };
  const recoveryPath = (caseId: string): string => `${pathOf(caseId)}.recovery`;
  const clearRecovery = (caseId: string): void => {
    try {
      retireDirectory(recoveryPath(caseId));
      rmSync(recoveryPath(caseId), { force: true });
    } catch {
      throw new ConnectorRefusedError('The case connector recovery setting could not be saved');
    }
  };
  const hasRecovery = (caseId: string): boolean => {
    try {
      statSync(recoveryPath(caseId));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw new ConnectorRefusedError('The case connector recovery setting cannot be read');
    }
  };
  const recoveryRevision = (caseId: string): string => {
    const path = recoveryPath(caseId);
    try {
      try {
        const token = readFileSync(path, 'utf8').trim();
        if (REVISION.test(token)) return `broken:${token}`;
      } catch {
        /* Rotating the token also invalidates an unreadable recovery request. */
      }
      const token = randomUUID();
      const temporary = `${path}.${token}.tmp`;
      try {
        writeFileSync(temporary, `${token}\n`, { mode: 0o600 });
        retireDirectory(path);
        renameSync(temporary, path);
      } finally {
        rmSync(temporary, { force: true });
      }
      return `broken:${token}`;
    } catch {
      throw new ConnectorRefusedError('The case connector recovery setting cannot be read');
    }
  };
  const read = (caseId: string): ISavedBinding | undefined => {
    try {
      const value: unknown = JSON.parse(readFileSync(pathOf(caseId), 'utf8'));
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
      const entry = value as { revision?: unknown; generation?: unknown; connectorId?: unknown };
      if (
        typeof entry.revision !== 'string' ||
        !REVISION.test(entry.revision) ||
        (entry.generation !== undefined &&
          (typeof entry.generation !== 'string' || !REVISION.test(entry.generation))) ||
        (entry.connectorId !== undefined &&
          (typeof entry.connectorId !== 'string' || !CONNECTOR_ID.test(entry.connectorId)))
      )
        throw new Error();
      return {
        revision: entry.revision,
        generation: entry.generation ?? entry.revision,
        ...(entry.connectorId !== undefined && { connectorId: entry.connectorId }),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new ConnectorRefusedError('The case connector setting cannot be read');
    }
  };
  const present = (caseId: string): TBindingState => {
    let found: ISavedBinding | undefined;
    try {
      found = read(caseId);
    } catch (error) {
      if (!(error instanceof ConnectorRefusedError)) throw error;
      return { revision: recoveryRevision(caseId), error: true };
    }
    if (found !== undefined && !hasRecovery(caseId)) return found;
    const refreshed: ISavedBinding = {
      ...found,
      revision: randomUUID(),
      generation: randomUUID(),
    };
    write(caseId, refreshed);
    clearRecovery(caseId);
    return refreshed;
  };
  const visible = (state: TBindingState): ICaseConnectorBinding => ({
    revision: state.revision,
    ...(state.connectorId !== undefined && { connectorId: state.connectorId }),
    ...(state.error === true && { error: true }),
  });
  const prune = async (): Promise<void> => {
    const retained = new Set(
      (await options.cases.list(Number.POSITIVE_INFINITY)).map((item) => `${item.id}.json`),
    );
    for (const name of readdirSync(options.directory)) {
      const match = /^(case-[a-z0-9]{1,40}\.json)(?:\.recovery)?(?:\.[0-9a-f-]+\.tmp)?$/u.exec(
        name,
      );
      if (match !== null && (!retained.has(match[1]!) || name.endsWith('.tmp'))) {
        try {
          const path = join(options.directory, name);
          retireDirectory(path);
          rmSync(path, { force: true });
        } catch {
          // allow-fallback: an inaccessible orphan must not prevent a different case from being used.
        }
      }
    }
  };
  const withAuthority = async <T>(
    caseId: string,
    use: (state: ICaseAuthorityState | undefined) => { readonly value: T },
  ): Promise<{ readonly value: T }> => {
    for (let attempt = 0; attempt <= 100; attempt += 1) {
      const result = await options.scope.tryExclusive(() =>
        options.writes.tryExclusive(async () => {
          let state: ICaseAuthorityState | undefined;
          if ((await options.cases.get(caseId))?.state === 'open' && !hasRecovery(caseId)) {
            const current = read(caseId);
            if (current?.connectorId !== undefined) {
              const connector = await options.connectors.get(current.connectorId);
              if (connector !== undefined) {
                state = {
                  binding: { connectorId: current.connectorId, generation: current.generation },
                  connector,
                };
              }
            }
          }
          // Never await the caller's value while either lock is held.
          return { value: use(state).value };
        }),
      );
      if (result.acquired && result.value.acquired) return result.value.value;
      if (attempt === 100) throw new ConnectorRefusedError('Case authority is busy; try again');
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
    }
    throw new ConnectorRefusedError('Case authority cannot be locked');
  };
  return {
    withAuthority,
    authoritySnapshot: async (caseId) =>
      (await withAuthority(caseId, (state) => ({ value: state?.binding }))).value,
    get: (caseId) =>
      options.scope.exclusive(async () => {
        const found = await options.cases.get(caseId);
        if (found === undefined) return undefined;
        await prune();
        const current = present(caseId);
        return found.state === 'closed' && current.connectorId !== undefined
          ? { revision: current.revision }
          : visible(current);
      }),
    set: (caseId, connectorId, revision) =>
      options.scope.exclusive(async () => {
        const found = await options.cases.get(caseId);
        if (found === undefined) return undefined;
        const current = present(caseId);
        if (current.revision !== revision || (current.error === true && connectorId !== null)) {
          throw new ConnectorRefusedError('Case connector settings changed; try again');
        }
        if (connectorId !== null) {
          if (
            !CONNECTOR_ID.test(connectorId) ||
            (await options.connectors.get(connectorId)) === undefined
          ) {
            throw new ConnectorRefusedError('Choose a connector that exists');
          }
          if (found.state !== 'open') throw new ConnectorRefusedError('This case is closed');
        }
        const next: ISavedBinding = {
          revision: randomUUID(),
          generation: randomUUID(),
          ...(connectorId !== null && { connectorId }),
        };
        await prune();
        write(caseId, next, current.error === true);
        clearRecovery(caseId);
        if (connectorId !== null && (await options.cases.get(caseId))?.state !== 'open') {
          write(caseId, { revision: randomUUID(), generation: randomUUID() });
          throw new ConnectorRefusedError('This case is closed');
        }
        return visible(next);
      }),
    fence: (caseId, revision) =>
      options.scope.exclusive(async () => {
        const found = await options.cases.get(caseId);
        if (found === undefined) return undefined;
        await prune();
        const current = present(caseId);
        if (current.revision !== revision) {
          return found.state === 'closed' && current.connectorId !== undefined
            ? { revision: current.revision }
            : visible(current);
        }
        const next =
          current.error === true || found.state === 'closed'
            ? { revision: randomUUID(), generation: randomUUID() }
            : { ...current, revision: randomUUID() };
        write(caseId, next, current.error === true);
        clearRecovery(caseId);
        return visible(next);
      }),
    closeLocked: async (caseId) => {
      if (!existsSync(pathOf(caseId)) && !existsSync(recoveryPath(caseId))) return;
      write(caseId, { revision: randomUUID(), generation: randomUUID() }, true);
      clearRecovery(caseId);
    },
    removeConnectorLocked: async (connectorId) => {
      const retained = new Set(
        (await options.cases.list(Number.POSITIVE_INFINITY)).map((item) => item.id),
      );
      for (const name of readdirSync(options.directory)) {
        const match = /^(case-[a-z0-9]{1,40})\.json$/u.exec(name);
        if (match === null) continue;
        const caseId = match[1]!;
        if (!retained.has(caseId)) continue;
        let clear = hasRecovery(caseId);
        try {
          clear ||= read(caseId)?.connectorId === connectorId;
        } catch (error) {
          if (!(error instanceof ConnectorRefusedError)) throw error;
          clear = true;
        }
        if (clear) {
          write(caseId, { revision: randomUUID(), generation: randomUUID() }, true);
          clearRecovery(caseId);
        }
      }
    },
  };
}
