import { SessionLogPayloadResolutionError } from './external-payload-resolution-contracts.js';

import type { IExternalPayloadReference } from './session-logger.js';

const SHA256_PATTERN = /^[0-9a-f]{64}$/i;

export function validateExternalPayloadReference(
  value: Record<string, unknown>,
): IExternalPayloadReference {
  if (!isValidSessionLogExternalPayloadReference(value)) {
    throw new SessionLogPayloadResolutionError(
      'INVALID_REFERENCE',
      'External payload reference has an invalid shape.',
    );
  }
  return {
    kind: 'external-payload',
    encoding: 'json',
    sha256: String(value.sha256).toLowerCase(),
    byteLength: Number(value.byteLength),
    relativePath: String(value.relativePath),
  };
}

/** Internal SSOT shared by the resolver and raw-log validator; not part of the package barrel. */
export function isValidSessionLogExternalPayloadReference(value: Record<string, unknown>): boolean {
  const keys = Object.keys(value).sort();
  const expectedKeys = ['byteLength', 'encoding', 'kind', 'relativePath', 'sha256'];
  return (
    keys.length === expectedKeys.length &&
    keys.every((key, index) => key === expectedKeys[index]) &&
    value.kind === 'external-payload' &&
    value.encoding === 'json' &&
    typeof value.sha256 === 'string' &&
    SHA256_PATTERN.test(value.sha256) &&
    typeof value.byteLength === 'number' &&
    Number.isSafeInteger(value.byteLength) &&
    value.byteLength >= 0 &&
    typeof value.relativePath === 'string' &&
    value.relativePath.trim().length > 0
  );
}
