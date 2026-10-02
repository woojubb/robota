import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import {
  decodeHostedIdentity,
  exactKeys,
  hostedAdmissionError,
  identifier,
  positiveInteger,
  record,
} from './hosted-runtime-config.js';
import { projectHostedSessionCheckpoint } from './hosted-session-checkpoint.js';
import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';
import type { IHostedIdentity, IHostedSnapshot } from './hosted-runtime-types.js';

export interface IHostedCheckpointFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

export interface IHostedFilesystemCheckpoint {
  readonly sourceWorker: string;
  readonly sourceRuntime: string;
  readonly sourceEpoch: number;
  readonly files: readonly IHostedCheckpointFile[];
  readonly session?: IInteractiveSessionRecord;
}

/** The reference and current identity come from the owner outside the worker, not the manifest. */
export function decodeHostedFilesystemCheckpoint(
  contents: Uint8Array,
  reference: IHostedSnapshot,
  current: { readonly identity: IHostedIdentity; readonly epoch: number },
): IHostedFilesystemCheckpoint {
  if (
    contents.byteLength > 48 * 1024 * 1024 ||
    createHash('sha256').update(contents).digest('hex') !== reference.digest
  )
    throw hostedAdmissionError('filesystem checkpoint digest or size is invalid');
  let raw: Record<string, unknown>;
  try {
    raw = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(contents)), 'checkpoint');
  } catch {
    throw hostedAdmissionError('filesystem checkpoint is not valid UTF-8 JSON');
  }
  exactKeys(raw, ['version', 'id', 'identity', 'epoch', 'worker', 'files', ...(raw.version === 2 ? ['session'] : [])], 'checkpoint');
  if ((raw.version !== 1 && raw.version !== 2) || raw.id !== reference.id)
    throw hostedAdmissionError('filesystem checkpoint version or identity does not match');
  const identity = decodeHostedIdentity(raw.identity);
  const sourceEpoch = positiveInteger(raw.epoch, 'checkpoint epoch');
  const sourceWorker = identifier(raw.worker, 'checkpoint worker');
  if (
    ['tenant', 'task', 'rootTask'].some(
      (key) => identity[key as keyof IHostedIdentity] !== current.identity[key as keyof IHostedIdentity],
    ) ||
    identity.runtime === current.identity.runtime ||
    sourceEpoch >= current.epoch
  )
    throw hostedAdmissionError('filesystem checkpoint requires the same task and a fresh identity/epoch');
  if (!Array.isArray(raw.files) || raw.files.length > 1000)
    throw hostedAdmissionError('filesystem checkpoint file inventory is invalid');
  const paths = new Set<string>();
  let total = 0;
  const files = raw.files.map((value): IHostedCheckpointFile => {
    const file = record(value, 'checkpoint file');
    exactKeys(file, ['path', 'base64'], 'checkpoint file');
    const path = identifier(file.path, 'checkpoint file path');
    const first = path.split('/')[0];
    if (
      posix.isAbsolute(path) ||
      posix.normalize(path) !== path ||
      path === '.' ||
      path === '..' ||
      path.startsWith('../') ||
      path.endsWith('/') ||
      path.includes('\\') ||
      first === '.home' ||
      first === '.tmp' ||
      paths.has(path)
    )
      throw hostedAdmissionError('filesystem checkpoint path escapes or replaces private state');
    if (typeof file.base64 !== 'string' || file.base64.length > 44 * 1024 * 1024)
      throw hostedAdmissionError('filesystem checkpoint file encoding is invalid');
    const bytes = Buffer.from(file.base64, 'base64');
    total += bytes.byteLength;
    if (bytes.toString('base64') !== file.base64 || total > 32 * 1024 * 1024)
      throw hostedAdmissionError('filesystem checkpoint encoding or byte budget is invalid');
    paths.add(path);
    return Object.freeze({ path, bytes: new Uint8Array(bytes) });
  });
  for (const path of paths) {
    let parent = posix.dirname(path);
    while (parent !== '.') {
      if (paths.has(parent))
        throw hostedAdmissionError('filesystem checkpoint file conflicts with a directory');
      parent = posix.dirname(parent);
    }
  }
  return Object.freeze({ sourceWorker, sourceRuntime: identity.runtime, sourceEpoch, files,
    ...(raw.version === 2 ? { session: projectHostedSessionCheckpoint(raw.session, '/') } : {}),
  });
}
