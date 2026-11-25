import { closeSync, fstatSync, readSync } from 'node:fs';

/**
 * Where a supervised launch hands its child the WebSocket transport token: one extra inherited
 * pipe, at a fixed index so the child needs no argument naming it. The environment would keep the
 * value readable to every program of the same user (`/proc/<pid>/environ`, `ps -E`) for as long as
 * the process lives, however soon the runtime removes it from `process.env`.
 */
export const SUPERVISED_TRANSPORT_TOKEN_FD = 4;

/** The argument a supervised launch adds when it hands the child a token on that pipe. */
export const SUPERVISED_TRANSPORT_TOKEN_FLAG = '--supervised-transport-token-fd';
const FLAG = SUPERVISED_TRANSPORT_TOKEN_FLAG;
/** The launcher mints 32 random bytes as lowercase hex. */
const TRANSPORT_TOKEN = /^[0-9a-f]{64}$/u;
/** A token is 64 bytes; more than this is not one, and is not read to its end. */
const MAX_TOKEN_BYTES = 256;

export function isSupervisedTransportToken(value: string): boolean {
  return TRANSPORT_TOKEN.test(value);
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
}

/**
 * Whether `fd` is a pipe a launcher handed over. A runtime started without one has its own internal
 * descriptors at this index (the event loop's wake-up pipe, say): a blocking read there never
 * returns, and closing it would break the runtime. A launcher's pipe is a socket pair on every POSIX
 * runtime (measured on Node and Bun); Windows has no such internal descriptors at a CRT index.
 *
 * The stat is a bigint one: Node 22 keeps the result of a plain stat in a buffer its path resolution
 * reads back, and a socket left there made the next module resolution stop following links.
 */
function assertHandedOverPipe(fd: number): void {
  if (process.platform === 'win32') return;
  let handedOver: boolean;
  try {
    handedOver = fstatSync(fd, { bigint: true }).isSocket();
  } catch (error) {
    const code = errorCode(error);
    throw new Error(
      `${FLAG}: descriptor ${fd} could not be read${code === undefined ? '' : ` (${code})`}; ` +
        'the launcher must pass the transport token on an extra inherited pipe.',
    );
  }
  if (!handedOver) {
    throw new Error(
      `${FLAG}: descriptor ${fd} is not the pipe the launcher hands over the transport token on.`,
    );
  }
}

/**
 * Read the token from `fd` to its end, then close it, so no process this runtime starts inherits
 * the descriptor. Throws, without the value, when what arrived is not a token. Reads only a
 * descriptor already known to be the launcher's pipe.
 */
export function readTransportTokenFrom(fd: number): string {
  const buffer = Buffer.alloc(MAX_TOKEN_BYTES + 1);
  let length = 0;
  try {
    while (length <= MAX_TOKEN_BYTES) {
      let bytes: number;
      try {
        bytes = readSync(fd, buffer, length, buffer.length - length, null);
      } catch (error) {
        // The writer closed: end of data (Windows reports a closed pipe as an `EOF` error).
        if (errorCode(error) === 'EOF') break;
        throw new Error(
          `${FLAG}: descriptor ${fd} could not be read (${errorCode(error) ?? 'unknown error'}).`,
        );
      }
      if (bytes === 0) break;
      length += bytes;
    }
  } finally {
    try {
      closeSync(fd);
    } catch {
      // Not open: the read above already said so.
    }
  }
  const value = buffer.toString('utf8', 0, length);
  if (length > MAX_TOKEN_BYTES || !isSupervisedTransportToken(value)) {
    throw new Error(
      `${FLAG}: descriptor ${fd} did not carry a transport token of 64 lowercase hex characters.`,
    );
  }
  return value;
}

/**
 * The transport token the launcher wrote to its inherited pipe, read once and synchronously at
 * startup. Throws, without the value, when nothing valid arrives: a runtime told to expect a token
 * must not fall back to another one.
 */
export function readSupervisedTransportToken(fd: number = SUPERVISED_TRANSPORT_TOKEN_FD): string {
  assertHandedOverPipe(fd);
  return readTransportTokenFrom(fd);
}
