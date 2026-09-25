/**
 * The owner-only file backend of the credential store port, for machines with no usable OS keychain
 * (headless servers, containers, SSH sessions with no Secret Service).
 *
 * One file per key, 0600, in a 0700 directory. Each write goes to a fresh temp file created
 * exclusively (`O_EXCL`) with its final mode and is renamed into place, so a reader sees a whole
 * record or none and no moment exists when a secret sits on disk at a wider mode.
 */
import { createHash } from 'node:crypto';
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  ensureOwnerOnlyDirectory,
  tightenExistingFile,
  writeOwnerOnlyFile,
} from '@robota-sdk/agent-core/node';

import {
  CredentialStoreError,
  credentialKeyLabel,
  redactedReason,
} from './credential-store-error.js';

import type { ICredentialKey, ICredentialStore } from '@robota-sdk/agent-core';

const RECORD_VERSION = 1;

interface ICredentialRecord {
  readonly version: typeof RECORD_VERSION;
  readonly key: ICredentialKey;
  readonly secret: string;
}

/** A file-name-safe name for a key; both parts are length-prefixed so no two keys collide. */
function fileNameOf(key: ICredentialKey): string {
  const hash = createHash('sha256');
  for (const part of [key.service, key.account]) hash.update(`${part.length}:${part}`);
  return `${hash.digest('hex')}.json`;
}

function isRecordFor(value: unknown, key: ICredentialKey): value is ICredentialRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<ICredentialRecord>;
  return (
    record.version === RECORD_VERSION &&
    typeof record.secret === 'string' &&
    record.key?.service === key.service &&
    record.key?.account === key.account
  );
}

export interface IFileCredentialStoreOptions {
  /**
   * An ancestor of the directory that this host also owns (e.g. `~/.robota`), tightened to 0700
   * along with it — a root an older version created at 0755 would otherwise stay that way.
   */
  readonly withinRoot?: string;
}

export function createFileCredentialStore(
  directory: string,
  options: IFileCredentialStoreOptions = {},
): ICredentialStore {
  const pathOf = (key: ICredentialKey): string => join(directory, fileNameOf(key));
  const ensureDirectory = (): void =>
    ensureOwnerOnlyDirectory(
      directory,
      options.withinRoot === undefined ? {} : { withinRoot: options.withinRoot },
    );
  const failure = (what: string, key: ICredentialKey, error?: unknown): Error =>
    new CredentialStoreError(
      `owner-only credential file for ${credentialKeyLabel(key)} ${what}` +
        (error === undefined ? '' : `: ${redactedReason(error)}`),
    );

  return {
    get: async (key) => {
      const path = pathOf(key);
      let text: string;
      try {
        tightenExistingFile(path);
        text = readFileSync(path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        throw failure('is unreadable', key, error);
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        // The parser's message quotes the text it choked on, which is the secret; it is dropped.
        throw failure('is corrupt', key);
      }
      // A record written for another key is refused, not read as absent: its secret is not this key's.
      if (!isRecordFor(parsed, key)) throw failure('has an unexpected shape', key);
      return parsed.secret;
    },
    set: async (key, secret) => {
      const record: ICredentialRecord = { version: RECORD_VERSION, key, secret };
      try {
        ensureDirectory();
        writeOwnerOnlyFile(pathOf(key), `${JSON.stringify(record)}\n`);
      } catch (error) {
        throw failure('could not be written', key, redactedReason(error, secret));
      }
    },
    delete: async (key) => {
      try {
        rmSync(pathOf(key), { force: true });
      } catch (error) {
        throw failure('could not be removed', key, error);
      }
    },
  };
}
