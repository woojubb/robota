/** An owner's explicit choice of connector for a case, kept apart from model-written case text. */
import { randomUUID } from 'node:crypto';
import {
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

import type { CaseBook, ConnectorBook } from '@robota-sdk/agent-product/personal';
import type { ICaseActionScope } from './connectors/case-action-scope.js';

export interface ICaseConnectorBinding {
  readonly revision: string;
  readonly connectorId?: string;
  readonly error?: true;
}

export interface ICaseConnectorBindings {
  get(caseId: string): Promise<ICaseConnectorBinding | undefined>;
  set(
    caseId: string,
    connectorId: string | null,
    revision: string,
  ): Promise<ICaseConnectorBinding | undefined>;
  fence(caseId: string, revision: string): Promise<ICaseConnectorBinding | undefined>;
}

const CASE_ID = /^case-[a-z0-9]{1,40}$/u;
const CONNECTOR_ID = /^connector-[a-z0-9-]{1,60}$/u;
const REVISION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function createCaseConnectorBindings(options: {
  readonly directory: string;
  readonly cases: CaseBook;
  readonly connectors: ConnectorBook;
  /** The same filesystem-backed lock that protects connector scope changes and removals. */
  readonly scope: ICaseActionScope;
}): ICaseConnectorBindings {
  mkdirSync(options.directory, { recursive: true, mode: 0o700 });
  const pathOf = (caseId: string): string => {
    if (!CASE_ID.test(caseId)) throw new ConnectorRefusedError('Invalid case id');
    return join(options.directory, `${caseId}.json`);
  };
  const write = (caseId: string, value: ICaseConnectorBinding): void => {
    const path = pathOf(caseId);
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
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
        renameSync(temporary, path);
      } finally {
        rmSync(temporary, { force: true });
      }
      return `broken:${token}`;
    } catch {
      throw new ConnectorRefusedError('The case connector recovery setting cannot be read');
    }
  };
  const read = (caseId: string): ICaseConnectorBinding | undefined => {
    try {
      const value: unknown = JSON.parse(readFileSync(pathOf(caseId), 'utf8'));
      if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
      const entry = value as { revision?: unknown; connectorId?: unknown };
      if (
        typeof entry.revision !== 'string' ||
        !REVISION.test(entry.revision) ||
        (entry.connectorId !== undefined &&
          (typeof entry.connectorId !== 'string' || !CONNECTOR_ID.test(entry.connectorId)))
      )
        throw new Error();
      return {
        revision: entry.revision,
        ...(entry.connectorId !== undefined && { connectorId: entry.connectorId }),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
      throw new ConnectorRefusedError('The case connector setting cannot be read');
    }
  };
  const present = (caseId: string): ICaseConnectorBinding => {
    let found: ICaseConnectorBinding | undefined;
    try {
      found = read(caseId);
    } catch (error) {
      if (!(error instanceof ConnectorRefusedError)) throw error;
      return { revision: recoveryRevision(caseId), error: true };
    }
    if (found !== undefined && !hasRecovery(caseId)) return found;
    const refreshed = { ...found, revision: randomUUID() };
    write(caseId, refreshed);
    clearRecovery(caseId);
    return refreshed;
  };
  const prune = async (): Promise<void> => {
    const retained = new Set(
      (await options.cases.list(Number.POSITIVE_INFINITY)).map((item) => `${item.id}.json`),
    );
    for (const name of readdirSync(options.directory)) {
      const match = /^(case-[a-z0-9]{1,40}\.json)(?:\.recovery)?$/u.exec(name);
      if (match !== null && !retained.has(match[1]!)) {
        rmSync(join(options.directory, name), { force: true });
      }
    }
  };
  return {
    get: (caseId) =>
      options.scope.exclusive(async () => {
        if ((await options.cases.get(caseId)) === undefined) return undefined;
        return present(caseId);
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
        const next: ICaseConnectorBinding = {
          revision: randomUUID(),
          ...(connectorId !== null && { connectorId }),
        };
        await prune();
        write(caseId, next);
        clearRecovery(caseId);
        return next;
      }),
    fence: (caseId, revision) =>
      options.scope.exclusive(async () => {
        if ((await options.cases.get(caseId)) === undefined) return undefined;
        const current = present(caseId);
        if (current.revision !== revision) return current;
        const next =
          current.error === true
            ? { revision: randomUUID() }
            : { ...current, revision: randomUUID() };
        write(caseId, next);
        clearRecovery(caseId);
        return next;
      }),
  };
}
