import { createReadStream } from 'node:fs';
import { Parser, create, extract } from 'tar';
import { verifyPackedTarball } from './pack-tar.mjs';

const MAX_DESCRIPTOR_BYTES = 16 * 1024 * 1024;

/** Read just the bounded descriptor; the whole tar is verified before any extraction. */
export async function readTransferDescriptor(archive) {
  return new Promise((resolve, reject) => {
    const parser = new Parser({ strict: true });
    const input = createReadStream(archive);
    const chunks = [];
    let size = 0;
    let found = false;
    const fail = (error) => {
      input.destroy();
      reject(error);
    };
    input.on('error', fail);
    parser.on('error', fail);
    parser.on('entry', (entry) => {
      if (entry.path !== 'package/transfer.json') {
        entry.resume();
        return;
      }
      if (found || entry.type !== 'File') {
        fail(new Error('transfer: descriptor must be one regular file'));
        entry.resume();
        return;
      }
      found = true;
      entry.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_DESCRIPTOR_BYTES) fail(new Error('transfer: descriptor exceeds size limit'));
        else chunks.push(chunk);
      });
      entry.on('error', fail);
      entry.resume();
    });
    parser.on('end', () => {
      if (!found) reject(new Error('transfer: missing descriptor'));
      else resolve(Buffer.concat(chunks));
    });
    input.pipe(parser);
  });
}

export async function createTransferArchive(imageRoot, archive, expected) {
  await create(
    { cwd: imageRoot, file: archive, gzip: true, portable: true, noDirRecurse: true },
    expected.map((file) => `package/${file.path}`),
  );
  return verifyPackedTarball(archive, expected);
}

export async function extractVerifiedTransfer(archive, destination, expected) {
  await verifyPackedTarball(archive, expected);
  await extract({
    file: archive,
    cwd: destination,
    strict: true,
    preserveOwner: false,
    noMtime: true,
  });
}
