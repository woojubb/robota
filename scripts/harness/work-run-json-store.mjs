import { randomUUID } from 'node:crypto';
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { assertSafeOwnedParent } from './work-run-paths.mjs';

const MAX_BYTES = 1_048_576;
const PRIVATE_FILE_MODE = 0o600;

function assertWithinSizeLimit(bytes) {
  if (bytes > MAX_BYTES) throw new Error('work-run state exceeds 1 MiB');
}

function jsonText(value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  assertWithinSizeLimit(Buffer.byteLength(text));
  return text;
}

function noFollowFlags(base) {
  return base | (constants.O_NOFOLLOW ?? 0);
}

function assertDescriptorMatchesPath(descriptor, file) {
  const opened = fstatSync(descriptor);
  const current = lstatSync(file);
  if (!opened.isFile() || opened.dev !== current.dev || opened.ino !== current.ino) {
    throw new Error(`work-run file changed during access: ${file}`);
  }
  return opened;
}

function safeReadText(file, ownerDirectory) {
  assertSafeOwnedParent(ownerDirectory, file);
  const descriptor = openSync(file, noFollowFlags(constants.O_RDONLY));
  try {
    assertWithinSizeLimit(assertDescriptorMatchesPath(descriptor, file).size);
    assertSafeOwnedParent(ownerDirectory, file);
    const content = readFileSync(descriptor);
    assertWithinSizeLimit(content.byteLength);
    assertWithinSizeLimit(assertDescriptorMatchesPath(descriptor, file).size);
    return content.toString('utf8');
  } finally {
    closeSync(descriptor);
  }
}

function createTemporary(file, text, ownerDirectory) {
  assertSafeOwnedParent(ownerDirectory, file);
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  const flags = noFollowFlags(constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY);
  const descriptor = openSync(temporary, flags, PRIVATE_FILE_MODE);
  let failed = false;
  try {
    assertDescriptorMatchesPath(descriptor, temporary);
    assertSafeOwnedParent(ownerDirectory, temporary);
    writeFileSync(descriptor, text, 'utf8');
    fsyncSync(descriptor);
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    closeSync(descriptor);
    if (failed) rmSync(temporary, { force: true });
  }
  return temporary;
}

export function atomicJson(file, value, ownerDirectory = path.dirname(file)) {
  const text = jsonText(value);
  const temporary = createTemporary(file, text, ownerDirectory);
  try {
    assertSafeOwnedParent(ownerDirectory, file);
    renameSync(temporary, file);
    if (safeReadText(file, ownerDirectory) !== text) {
      throw new Error(`atomic work-run state changed during persistence: ${file}`);
    }
  } finally {
    rmSync(temporary, { force: true });
  }
}

export function immutableJson(file, value, ownerDirectory = path.dirname(file)) {
  const text = jsonText(value);
  assertSafeOwnedParent(ownerDirectory, file);
  if (existsSync(file)) {
    if (safeReadText(file, ownerDirectory) !== text) {
      throw new Error(`immutable work-run receipt conflict: ${file}`);
    }
    return;
  }
  const temporary = createTemporary(file, text, ownerDirectory);
  try {
    assertSafeOwnedParent(ownerDirectory, file);
    linkSync(temporary, file);
  } catch (error) {
    if (error.code !== 'EEXIST' || safeReadText(file, ownerDirectory) !== text) {
      throw new Error(`immutable work-run receipt conflict: ${file}`);
    }
  } finally {
    rmSync(temporary, { force: true });
  }
  safeReadText(file, ownerDirectory);
}

export function readJson(file, ownerDirectory = path.dirname(file)) {
  return JSON.parse(safeReadText(file, ownerDirectory));
}

export function sameJson(value, other) {
  return JSON.stringify(value) === JSON.stringify(other);
}
