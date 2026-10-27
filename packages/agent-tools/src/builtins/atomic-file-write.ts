import { dirname, relative, resolve, sep } from 'node:path';

import { createStableRootedFileWriter } from '@robota-sdk/agent-file-authority';

function rootRelativeSegments(rootDirectory: string, filePath: string): readonly string[] {
  const root = resolve(rootDirectory);
  const target = resolve(filePath);
  const path = relative(root, target);
  if (path.length === 0) return [];
  return path.split(sep);
}

/**
 * Atomically replace one UTF-8 file through a retained root authority. The authority performs every
 * directory walk and commit relative to native handles, so a path checked by the caller cannot be
 * retargeted to a different parent before the write lands.
 */
export async function atomicWriteUtf8File(
  filePath: string,
  content: string,
  rootDirectory = dirname(filePath),
): Promise<void> {
  const writer = createStableRootedFileWriter(rootDirectory);
  try {
    writer.writeUtf8(rootRelativeSegments(rootDirectory, filePath), content);
  } finally {
    writer.close();
  }
}
