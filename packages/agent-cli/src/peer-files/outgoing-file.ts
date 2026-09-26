/**
 * A file this session is about to send: resolved, checked and measured before anyone is asked.
 *
 * Who asked decides what may go. The operator's own command can send any regular file they can read:
 * they typed the path. The model can send only a file inside the workspace whose path does not look
 * like it holds a secret, and only with the operator's yes for that one file — a model steered by
 * something it read must not be able to reach the credentials beside the project, however it words
 * the path. The check is made on the file's real location, so a link inside the workspace that points
 * out of it, or at a secret, is judged by where it points.
 *
 * Content is copied, never a path handed over: the receiver gets bytes and a hash, and what it keeps
 * is its own copy.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import type { IFileSource } from '@robota-sdk/agent-transport/node';

/** Who is sending: the operator's command, or the model's tool. */
export type TFileSendOrigin = 'operator' | 'model';

/** A directory anywhere on the path that holds keys, tokens or credentials. */
const SECRET_DIRECTORIES: ReadonlySet<string> = new Set([
  '.ssh',
  '.gnupg',
  '.aws',
  '.azure',
  '.kube',
  '.docker',
  '.robota',
  '.password-store',
  'gcloud',
]);

/** File names, and name patterns, that hold secrets. */
const SECRET_NAMES: ReadonlySet<string> = new Set([
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.git-credentials',
  '.htpasswd',
  'credentials',
  'credentials.json',
]);
const SECRET_NAME_PATTERNS: readonly RegExp[] = [
  /^\.env(\..*)?$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)(\..*)?$/i,
  /\.(pem|key|p12|pfx|jks|keystore|kdbx)$/i,
];

/** Whether a path names something that holds secrets, judged on its segments. */
export function isSecretPath(file: string): boolean {
  const segments = path
    .resolve(file)
    .split(path.sep)
    .filter((segment) => segment !== '');
  const name = segments[segments.length - 1] ?? '';
  if (SECRET_NAMES.has(name.toLowerCase())) return true;
  if (SECRET_NAME_PATTERNS.some((pattern) => pattern.test(name))) return true;
  return segments.slice(0, -1).some((segment) => SECRET_DIRECTORIES.has(segment.toLowerCase()));
}

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** A file ready to send. */
export interface IOutgoingFile {
  /** Where it was read from, as resolved. */
  readonly path: string;
  /** The name the receiver is offered. */
  readonly name: string;
  readonly size: number;
  readonly sha256: string;
  readonly source: IFileSource;
}

export type TOutgoingFile =
  | { readonly ok: true; readonly file: IOutgoingFile }
  | { readonly ok: false; readonly reason: string };

export interface IPrepareOutgoingFileOptions {
  /** As typed: absolute, relative to `cwd`, or starting with `~/`. */
  readonly path: string;
  /** The session's working directory: where a relative path starts, and the model's workspace. */
  readonly cwd: string;
  readonly home: string;
  readonly origin: TFileSendOrigin;
  readonly maxBytes: number;
}

function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    createReadStream(file)
      .on('data', (chunk) => hash.update(chunk))
      .on('error', reject)
      .on('end', () => resolve(hash.digest('hex')));
  });
}

/** Resolve, check and measure `options.path` for sending. Nothing is read beyond what hashing needs. */
export async function prepareOutgoingFile(
  options: IPrepareOutgoingFileOptions,
): Promise<TOutgoingFile> {
  const typed = options.path.trim();
  if (typed === '') return { ok: false, reason: 'no file was named.' };
  const expanded =
    typed === '~' || typed.startsWith('~/') ? path.join(options.home, typed.slice(1)) : typed;
  const resolved = path.resolve(options.cwd, expanded);
  let real: string;
  try {
    real = await realpath(resolved);
  } catch {
    return { ok: false, reason: `${resolved} does not exist or cannot be read.` };
  }
  const info = await stat(real);
  if (!info.isFile()) return { ok: false, reason: `${resolved} is not a regular file.` };
  if (info.size > options.maxBytes) {
    return {
      ok: false,
      reason: `${resolved} is ${info.size} bytes, over the ${options.maxBytes}-byte limit.`,
    };
  }
  if (options.origin === 'model') {
    const workspace = await realpath(options.cwd).catch(() => path.resolve(options.cwd));
    if (!inside(workspace, real) || !inside(path.resolve(options.cwd), resolved)) {
      return {
        ok: false,
        reason:
          `${resolved} is outside the workspace. Only the operator can send it, with ` +
          '/peers send-file.',
      };
    }
    if (isSecretPath(resolved) || isSecretPath(real)) {
      return {
        ok: false,
        reason:
          `${resolved} looks like it holds secrets. Only the operator can send it, with ` +
          '/peers send-file.',
      };
    }
  }
  const sha256 = await hashFile(real);
  const size = info.size;
  return {
    ok: true,
    file: {
      path: resolved,
      name: path.basename(resolved),
      size,
      sha256,
      source: { size, read: () => createReadStream(real) },
    },
  };
}
