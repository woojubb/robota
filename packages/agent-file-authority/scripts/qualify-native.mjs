import { mkdirSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createStableRootedFileReader, StableFileAuthorityError } from '../dist/node/index.js';

const fixture = mkdtempSync(join(tmpdir(), 'robota-file-authority-qualification-'));
const root = join(fixture, 'root');
const originalRoot = join(fixture, 'root-original');
const outside = join(fixture, 'outside');
let reader;

function expectCode(operation, code) {
  try {
    operation();
  } catch (error) {
    if (error instanceof StableFileAuthorityError && error.code === code) return;
    throw error;
  }
  throw new Error(`Expected ${code}.`);
}

try {
  mkdirSync(join(root, 'nested'), { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(root, 'nested', 'payload.bin'), 'approved');
  writeFileSync(join(outside, 'marker.bin'), 'outside-secret');
  reader = createStableRootedFileReader(root);

  renameSync(root, originalRoot);
  mkdirSync(join(root, 'nested'), { recursive: true });
  writeFileSync(join(root, 'nested', 'payload.bin'), 'retargeted');
  const bytes = reader.readBytes(['nested', 'payload.bin'], 8);
  if (Buffer.from(bytes ?? []).toString() !== 'approved') {
    throw new Error('The retained root was redirected to its replacement pathname.');
  }

  symlinkSync(
    join(outside, 'marker.bin'),
    join(originalRoot, 'linked.bin'),
    process.platform === 'win32' ? 'file' : 'file',
  );
  expectCode(() => reader.readBytes(['linked.bin'], 64), 'UNSAFE_ENTRY');
  expectCode(() => reader.readBytes(['nested', 'payload.bin'], 7), 'OVER_BUDGET');

  reader.close();
  reader.close();
  expectCode(() => reader.readBytes(['nested', 'payload.bin'], 8), 'AUTHORITY_CLOSED');
  reader = undefined;

  process.stdout.write(
    [
      'qualification=passed',
      `runtime=${typeof Bun === 'undefined' ? `node-${process.version}` : `bun-${Bun.version}`}`,
      `platform=${process.platform}`,
      `arch=${process.arch}`,
      'rootReplacement=preserved',
      'finalLink=refused',
      'boundedRead=refused',
    ].join('; ') + '\n',
  );
} finally {
  reader?.close();
  rmSync(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
}
