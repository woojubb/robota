import { randomBytes } from 'node:crypto';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

const TEMP_RANDOM_BYTES = 6;

function createTempFilePath(filePath: string): string {
  const dir = dirname(filePath);
  const name = basename(filePath);
  const suffix = randomBytes(TEMP_RANDOM_BYTES).toString('hex');
  return join(dir, `.${name}.robota-tmp-${process.pid}-${Date.now()}-${suffix}`);
}

export async function atomicWriteUtf8File(filePath: string, content: string): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tempFilePath = createTempFilePath(filePath);
  try {
    await writeFile(tempFilePath, content, 'utf8');
    await rename(tempFilePath, filePath);
  } catch (error) {
    await rm(tempFilePath, { force: true }).catch(() => undefined);
    throw error;
  }
}
