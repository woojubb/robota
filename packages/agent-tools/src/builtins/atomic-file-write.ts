import { randomBytes } from 'node:crypto';
import { chmod, mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const TEMP_RANDOM_BYTES = 6;
const PRESERVED_MODE_BITS = 0o7777;
const MISSING_FILE_ERROR_CODE = 'ENOENT';

function createTempFilePath(filePath: string): string {
  const dir = dirname(filePath);
  const name = basename(filePath);
  const suffix = randomBytes(TEMP_RANDOM_BYTES).toString('hex');
  return join(dir, `.${name}.robota-tmp-${process.pid}-${Date.now()}-${suffix}`);
}

async function readExistingMode(filePath: string): Promise<number | undefined> {
  try {
    const fileStats = await stat(filePath);
    return fileStats.mode & PRESERVED_MODE_BITS;
  } catch (error) {
    if (error instanceof Error && hasErrorCode(error, MISSING_FILE_ERROR_CODE)) return undefined;
    throw error;
  }
}

function hasErrorCode(error: Error, code: string): boolean {
  return 'code' in error && error.code === code;
}

export async function atomicWriteUtf8File(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const existingMode = await readExistingMode(filePath);
  const tempFilePath = createTempFilePath(filePath);
  try {
    await writeFile(tempFilePath, content, 'utf8');
    if (existingMode !== undefined) {
      await chmod(tempFilePath, existingMode);
    }
    await rename(tempFilePath, filePath);
  } catch (error) {
    await rm(tempFilePath, { force: true }).catch(() => undefined);
    throw error;
  }
}
