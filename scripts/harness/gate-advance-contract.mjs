import { existsSync } from 'node:fs';
import path from 'node:path';

export function vacantAdvanceDestination(root, docPath, folder) {
  const target = path.join(path.dirname(path.dirname(docPath)), folder, path.basename(docPath));
  const moved = target !== docPath;
  if (moved && existsSync(target)) {
    const targetRel = path.relative(root, target).split(path.sep).join('/');
    throw new Error(`refused: destination spec already exists: ${targetRel}`);
  }
  return { target, moved };
}
