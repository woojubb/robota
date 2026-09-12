/** The two owner-approved non-atomic cases are explicit, journaled replacements. */
import { lstatSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { validateOutputName } from './writer-lock.mjs';

const reportTransition = (event) => process.stderr.write(`artifact: ${JSON.stringify(event)}\n`);

export function publishGeneration(owner, generation, options = {}) {
  const platform = options.platform ?? process.platform;
  const report = options.report ?? reportTransition;
  const rename = options.rename ?? renameSync;
  const outputName = validateOutputName(options.outputName);
  const destination = path.join(owner, outputName);
  const prior = lstatSync(destination, { throwIfNoEntry: false });
  if (prior && !prior.isSymbolicLink() && !prior.isDirectory()) {
    throw new Error(`artifact: dist must be a directory or managed link: ${destination}`);
  }
  const pending = path.join(owner, `.${outputName}-${generation.id}`);
  symlinkSync(
    platform === 'win32' ? generation.root : path.relative(owner, generation.root),
    pending,
    platform === 'win32' ? 'junction' : 'dir',
  );
  if (prior && (platform === 'win32' || !prior.isSymbolicLink())) {
    const reason = prior.isSymbolicLink() ? 'windows-replacement' : 'legacy-dist';
    replaceNonAtomically(destination, pending, generation, reason, report, rename);
  } else {
    rename(pending, destination);
  }
}

function replaceNonAtomically(destination, pending, generation, reason, report, rename) {
  const directory = path.dirname(generation.root);
  const backup = path.join(directory, 'previous-dist');
  const journal = path.join(directory, '../transaction.json');
  report({
    type: 'non-atomic-transition',
    reason,
    backup,
    message: 'Stop legacy readers for this initial transition; previous output is retained.',
  });
  writeFileSync(
    journal,
    JSON.stringify({
      version: 1,
      id: generation.id,
      reason,
      outputName: path.basename(destination),
    }),
    { flag: 'wx' },
  );
  try {
    rename(destination, backup);
    rename(pending, destination);
  } catch (error) {
    try {
      if (lstatSync(backup, { throwIfNoEntry: false })) rename(backup, destination);
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        `artifact: recovery required; retained ${backup} and ${journal}`,
      );
    }
    unlinkSync(journal);
    throw error;
  }
  unlinkSync(journal);
}
