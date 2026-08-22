import { fstatSync, readSync } from 'node:fs';

import { ProjectReadLimitExceededError, refuseProjectRead } from './project-reader-path.js';

export function readBoundedProjectFile(descriptor: number, maxBytes: number): Uint8Array {
  const metadata = fstatSync(descriptor, { bigint: true });
  if (!metadata.isFile()) {
    refuseProjectRead('The requested project object is not a regular file.');
  }
  if (metadata.size > BigInt(maxBytes)) {
    throw new ProjectReadLimitExceededError(maxBytes, metadata.size);
  }

  const expectedSize = Number(metadata.size);
  const bytes = Buffer.alloc(expectedSize);
  let offset = 0;
  while (offset < expectedSize) {
    const count = readSync(descriptor, bytes, offset, expectedSize - offset, offset);
    if (count === 0) break;
    offset += count;
  }

  const probe = Buffer.alloc(1);
  const grew = readSync(descriptor, probe, 0, 1, expectedSize) !== 0;
  const finalSize = fstatSync(descriptor, { bigint: true }).size;
  if (finalSize > BigInt(maxBytes) || (grew && expectedSize >= maxBytes)) {
    const observedSize = finalSize > BigInt(expectedSize) ? finalSize : BigInt(expectedSize + 1);
    throw new ProjectReadLimitExceededError(maxBytes, observedSize);
  }
  if (offset !== expectedSize || grew || finalSize !== metadata.size) {
    refuseProjectRead('The requested project file changed while it was being read.');
  }
  return bytes;
}
