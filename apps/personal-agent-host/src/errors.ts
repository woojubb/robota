/** Typed failures of the control plane. Messages never carry a secret value. */
export type HostErrorCode =
  | 'config-invalid'
  | 'bad-request'
  | 'invalid-input'
  | 'refused'
  | 'not-found'
  | 'conflict'
  | 'confirmation-required'
  | 'busy'
  | 'guard-unverified'
  | 'runtime-failed'
  | 'store-corrupt'
  | 'secret-missing';

/** Codes that mean the request was turned down, as opposed to something that broke. */
export const REFUSAL_CODES: ReadonlySet<HostErrorCode> = new Set<HostErrorCode>([
  'bad-request',
  'invalid-input',
  'refused',
  'not-found',
  'conflict',
  'confirmation-required',
  'busy',
  'guard-unverified',
]);

export class HostError extends Error {
  constructor(
    readonly code: HostErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'HostError';
  }
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const REDACTED = '[redacted]';

/** Replaces every occurrence of a known secret value, so an error from below cannot carry one out. */
export function scrub(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret.length > 0) out = out.split(secret).join(REDACTED);
  }
  return out;
}
