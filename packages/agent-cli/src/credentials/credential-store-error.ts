import type { ICredentialKey } from '@robota-sdk/agent-core';

/**
 * A credential store failure. Its message names the key and the backend, never the secret: an error
 * travels to logs, transcripts and the model, and a secret must reach none of them. No `cause` is
 * attached, because a cause from a parser or a native binding may quote what it was handed.
 */
export class CredentialStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CredentialStoreError';
  }
}

/** How a key is named in a message: `service/account`. */
export function credentialKeyLabel(key: ICredentialKey): string {
  return `${key.service}/${key.account}`;
}

/** A thrown value's message, with `secret` — when given — cut out wherever it appears. */
export function redactedReason(error: unknown, secret?: string): string {
  const message = error instanceof Error ? error.message : String(error);
  return secret === undefined || secret.length === 0
    ? message
    : message.split(secret).join('[redacted]');
}
