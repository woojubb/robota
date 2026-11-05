/** The runtime's answer to an owner's request to open a stored session. */
export type TOwnerSessionQuestion =
  | { readonly kind: 'open' }
  | {
      readonly kind: 'accept';
      readonly digest: string;
      readonly questionId: string;
      readonly notice: string;
      readonly question: string;
    }
  | { readonly kind: 'refused'; readonly message: string };

/**
 * Owner-only decisions for one client binding. Never give this port to a session-protocol handler:
 * accepting a record needs an owner surface that shows fixed words without the record's content.
 */
export interface IOwnerSessionDirectory {
  question(sessionId: string): TOwnerSessionQuestion | Promise<TOwnerSessionQuestion>;
  cancelQuestion(): void | Promise<void>;
  openAccepted(sessionId: string, acceptedDigest: string, questionId: string): void | Promise<void>;
}
