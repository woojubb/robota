import { createHash } from 'node:crypto';

import { git, gitBytes } from './work-run-git-adapter.mjs';

export function rawTopicChangeDigest(root, baseRef, subjectRef, runtime) {
  const fields = gitBytes(
    root,
    [
      'diff',
      '--raw',
      '-z',
      '--find-renames',
      '--find-copies',
      '--no-abbrev',
      `${baseRef}..${subjectRef}`,
    ],
    { runtime },
  )
    .toString('utf8')
    .split('\0');
  if (fields.at(-1) === '') fields.pop();
  const records = [];
  for (let index = 0; index < fields.length;) {
    const match = /^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([ACDMRT])\d*$/u.exec(fields[index]);
    if (!match) throw new Error('local topic change projection is invalid');
    const [, oldMode, newMode, oldOid, newOid, status] = match;
    const moved = ['R', 'C'].includes(status);
    const firstPath = fields[index + 1];
    const secondPath = moved ? fields[index + 2] : null;
    if (!firstPath || (moved && !secondPath))
      throw new Error('local topic change projection is incomplete');
    records.push({
      status,
      oldPath: status === 'A' ? null : firstPath,
      newPath: status === 'D' ? null : (secondPath ?? firstPath),
      oldMode: status === 'A' ? null : oldMode,
      newMode: status === 'D' ? null : newMode,
      oldOid: status === 'A' ? null : oldOid,
      newOid: status === 'D' ? null : newOid,
    });
    index += moved ? 3 : 2;
  }
  records.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'));
  return createHash('sha256').update(JSON.stringify(records)).digest('hex');
}

export function currentCutoverDigest(root, baseRef, subjectRef, context, runtime) {
  if (!context.entry || !context.closureValid) return null;
  const receiptParent = git(root, ['rev-parse', `${subjectRef}^1`], { runtime });
  return rawTopicChangeDigest(root, baseRef, receiptParent, runtime);
}
