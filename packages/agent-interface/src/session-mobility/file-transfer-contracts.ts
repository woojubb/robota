/**
 * Moving a file from one session to another.
 *
 * A file is data, like a message: it carries no authority, and nothing about it runs or reaches the
 * receiving model by itself. What it adds over a message is size, so it travels on a channel of its
 * own, in pieces the receiver paces, and is checked whole against the hash the receiving operator
 * approved before it is kept.
 */

/** A file one session offers another: exactly what the receiving operator approves and what is verified. */
export interface IFileOffer {
  /** Names this transfer on its channel; chosen by the sender, trusted for nothing. */
  readonly transferId: string;
  /** The sender's name for the file. Untrusted: the receiver sanitizes it before using it. */
  readonly name: string;
  /** Bytes. */
  readonly size: number;
  /** Lowercase hex SHA-256 of the whole content. */
  readonly sha256: string;
}

/**
 * A duplex channel of text frames that carries one transfer and nothing else. Messages never share
 * it, so a transfer cannot delay, reorder or be mistaken for one.
 */
export interface IFileFrameChannel {
  send(frame: string): void;
  onFrame(handler: (frame: string) => void): () => void;
  /** Fires once when the channel ends, from either side. */
  onClose(handler: () => void): () => void;
  close(): void;
}
