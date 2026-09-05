import { existsSync } from 'node:fs';
import path from 'node:path';

export function repointCurrentSpec(text, oldPath, newPath) {
  const boundary = text.search(/^## Evidence(?: Log)?\s*$/m);
  const end = boundary < 0 ? text.length : boundary;
  return (
    text
      .slice(0, end)
      .replace(/^Spec:.*$/gm, (line) => line.split(oldPath).join(newPath))
      .replace(
        /(^## Bound spec document\s*\n)([\s\S]*?)(?=^## |$(?![\s\S]))/m,
        (all, heading, body) => heading + body.split(oldPath).join(newPath),
      ) + text.slice(end)
  );
}

export function vacantAdvanceDestination(root, docPath, folder) {
  const target = path.join(path.dirname(path.dirname(docPath)), folder, path.basename(docPath));
  const moved = target !== docPath;
  if (moved && existsSync(target)) {
    const targetRel = path.relative(root, target).split(path.sep).join('/');
    throw new Error(`refused: destination spec already exists: ${targetRel}`);
  }
  return { target, moved };
}
