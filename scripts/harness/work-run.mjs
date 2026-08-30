#!/usr/bin/env node

import path from 'node:path';

import { parsePostFindingsAuthorization } from './post-findings-authorization.mjs';
import { main } from './work-run-cli.mjs';

export { buildCutoverMarker } from './work-run-cutover.mjs';
export {
  applyWorkRunTrailers,
  assertReadyWorkingTreeClean,
  authorizePostPrReopen,
  prepareReopenRequest,
  resolveWorkRunSubject,
  terminalizeWorkRun,
  writeImmutableWorkRunReceipt,
} from './work-run-domain.mjs';
export {
  openPullRequestNumber,
  topicChangeDigestFromCompareFiles,
  topicChangeDigestFromGit,
} from './work-run-git.mjs';
export { parsePostFindingsAuthorization };

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  try {
    const result = main();
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`work-run: ${error.message}\n`);
    process.exitCode = 1;
  }
}
