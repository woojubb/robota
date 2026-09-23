import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

const PRIVATE_FILE_MODE = 0o600;

/** Publish a completed asset download without truncating an existing destination on failure. */
export async function writeAssetFile(
  filePath: string,
  stream: ReadableStream<Uint8Array>,
): Promise<void> {
  const destination = path.resolve(filePath);
  const temporary = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.${randomUUID()}.tmp`,
  );
  try {
    await pipeline(
      Readable.fromWeb(stream as NodeReadableStream<Uint8Array>),
      createWriteStream(temporary, { flags: 'wx', mode: PRIVATE_FILE_MODE }),
    );
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}
