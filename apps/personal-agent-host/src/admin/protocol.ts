import type { HostErrorCode } from '../errors.js';

/** The admin surface is JSON over HTTP on a Unix socket; these are its typed failures. */
export interface IAdminErrorBody {
  error: { code: HostErrorCode; message: string };
}

export interface IAdminResultBody<T = unknown> {
  result: T;
}

export const HTTP_STATUS: Record<HostErrorCode, number> = {
  'bad-request': 400,
  'invalid-input': 400,
  refused: 403,
  'not-found': 404,
  conflict: 409,
  busy: 409,
  'confirmation-required': 428,
  'guard-unverified': 503,
  'runtime-failed': 502,
  'store-corrupt': 500,
  'secret-missing': 500,
  'config-invalid': 500,
};

export const MAX_BODY_BYTES = 64 * 1024;

/**
 * Exit codes a script can rely on: 0 done; 1 something broke; 2 usage; 3 the request was turned
 * down; 4 no such account; 5 the control plane is not reachable.
 */
export const EXIT = {
  ok: 0,
  failed: 1,
  usage: 2,
  refused: 3,
  notFound: 4,
  unreachable: 5,
} as const;

export function exitCodeFor(code: HostErrorCode): number {
  switch (code) {
    case 'not-found':
      return EXIT.notFound;
    case 'bad-request':
    case 'invalid-input':
    case 'refused':
    case 'conflict':
    case 'busy':
    case 'confirmation-required':
    case 'guard-unverified':
      return EXIT.refused;
    default:
      return EXIT.failed;
  }
}
